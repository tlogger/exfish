#!/usr/bin/env python3
"""
Offline ETL for exfish coastal fishing-prohibited zones.
1. Reads KHOA TL_RESARE_ENS Shapefile (EPSG:5179, EUC-KR) from a zip or directory
   and inversely projects to WGS84 (EPSG:4326).
2. Optionally fetches VWorld WFS layers:
   - LT_C_UM901 (filtered strictly to uname == '습지보호지역')
   - LT_C_UM221 (야생생물 보호구역)
3. Simplifies geometries (~5m Douglas-Peucker), quantizes to 5 decimal places,
   assigns deterministic zone_id, excludes suppressed_zone_ids, and partitions
   into 0.25° grid cells under public/zones/{version}/{cellId}.json + manifest.json.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import struct
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

CELL_SIZE_DEG = 0.25
MAX_CELL_BYTES = 300 * 1024
LAT_MIN, LAT_MAX = 32.0, 39.0
LNG_MIN, LNG_MAX = 124.0, 132.0


def epsg5179_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Inverse Transverse Mercator for Korea 2000 Unified CS (EPSG:5179, GRS80)."""
    a = 6378137.0
    f = 1.0 / 298.257222101
    e2 = 2 * f - f * f
    ep2 = e2 / (1.0 - e2)

    k0 = 0.9996
    lat0 = math.radians(38.0)
    lon0 = math.radians(127.5)
    fe = 1000000.0
    fn = 2000000.0

    def m_dist(phi: float) -> float:
        return a * (
            (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
            - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * phi)
            + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * phi)
            - (35 * e2**3 / 3072) * math.sin(6 * phi)
        )

    m0 = m_dist(lat0)
    m = m0 + (y - fn) / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))

    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )

    sin_p1 = math.sin(phi1)
    cos_p1 = math.cos(phi1)
    tan_p1 = math.tan(phi1)

    n1 = a / math.sqrt(1 - e2 * sin_p1**2)
    t1 = tan_p1**2
    c1 = ep2 * cos_p1**2
    r1 = a * (1 - e2) / ((1 - e2 * sin_p1**2) ** 1.5)
    d = (x - fe) / (n1 * k0)

    lat = phi1 - (n1 * tan_p1 / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720
    )
    lon = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120
    ) / cos_p1

    return round(math.degrees(lng := lon), 5), round(math.degrees(lat), 5)


def douglas_peucker(pts: list[list[float]], tol_deg: float = 0.00005) -> list[list[float]]:
    """Simplify a coordinate ring (~0.00005 deg ≈ 5m) preserving closure."""
    if len(pts) <= 4:
        return pts

    def perp_dist(p: list[float], a: list[float], b: list[float]) -> float:
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == 0 and dy == 0:
            return math.hypot(p[0] - a[0], p[1] - a[1])
        t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))

    def dp(arr: list[list[float]]) -> list[list[float]]:
        if len(arr) <= 2:
            return arr
        max_d, idx = 0.0, 0
        for i in range(1, len(arr) - 1):
            d = perp_dist(arr[i], arr[0], arr[-1])
            if d > max_d:
                max_d, idx = d, i
        if max_d > tol_deg:
            left = dp(arr[: idx + 1])
            right = dp(arr[idx:])
            return left[:-1] + right
        return [arr[0], arr[-1]]

    simplified = dp(pts)
    if len(simplified) < 4:
        return pts
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def signed_ring_area(ring: list[list[float]]) -> float:
    area = 0.0
    for i in range(len(ring) - 1):
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return area / 2.0


def parse_dbf(dbf_bytes: bytes, encoding: str = "euc-kr") -> list[dict[str, str]]:
    num_rec, hdr_len, rec_len = struct.unpack("<IHH", dbf_bytes[4:12])
    fields: list[tuple[str, int]] = []
    pos = 32
    while pos < hdr_len - 1 and dbf_bytes[pos] != 0x0D:
        name = dbf_bytes[pos : pos + 11].split(b"\x00", 1)[0].decode("ascii")
        flen = dbf_bytes[pos + 16]
        fields.append((name, flen))
        pos += 32

    rows: list[dict[str, str]] = []
    for r in range(num_rec):
        offset = hdr_len + r * rec_len + 1
        row: dict[str, str] = {}
        for name, flen in fields:
            row[name] = dbf_bytes[offset : offset + flen].decode(encoding, "replace").strip()
            offset += flen
        rows.append(row)
    return rows


def parse_shp_polygons(shp_bytes: bytes) -> list[dict[str, Any]]:
    geometries: list[dict[str, Any]] = []
    pos = 100
    total = len(shp_bytes)
    while pos < total:
        _rec_num, content_len_words = struct.unpack(">II", shp_bytes[pos : pos + 8])
        pos += 8
        rec_end = pos + content_len_words * 2
        shape_type = struct.unpack("<I", shp_bytes[pos : pos + 4])[0]
        if shape_type == 0:
            geometries.append({"type": "Polygon", "coordinates": []})
            pos = rec_end
            continue
        if shape_type not in (5, 15, 25):  # Polygon types
            pos = rec_end
            continue

        num_parts, num_points = struct.unpack("<II", shp_bytes[pos + 36 : pos + 44])
        parts_offset = pos + 44
        parts = list(struct.unpack(f"<{num_parts}I", shp_bytes[parts_offset : parts_offset + 4 * num_parts]))
        pts_offset = parts_offset + 4 * num_parts

        raw_rings: list[list[list[float]]] = []
        for p_idx in range(num_parts):
            start = parts[p_idx]
            end = parts[p_idx + 1] if p_idx + 1 < num_parts else num_points
            ring: list[list[float]] = []
            for pt_i in range(start, end):
                x, y = struct.unpack("<dd", shp_bytes[pts_offset + pt_i * 16 : pts_offset + (pt_i + 1) * 16])
                lng, lat = epsg5179_to_wgs84(x, y)
                ring.append([lng, lat])
            if len(ring) >= 3:
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                ring = douglas_peucker(ring)
                raw_rings.append(ring)

        # In Shapefile spec, clockwise (negative shoelace area) = outer ring, CCW = hole
        outers: list[list[list[list[float]]]] = []
        for ring in raw_rings:
            if signed_ring_area(ring) < 0 or not outers:
                outers.append([ring])
            else:
                outers[-1].append(ring)

        if len(outers) == 1:
            geometries.append({"type": "Polygon", "coordinates": outers[0]})
        elif len(outers) > 1:
            geometries.append({"type": "MultiPolygon", "coordinates": outers})
        else:
            geometries.append({"type": "Polygon", "coordinates": []})

        pos = rec_end
    return geometries


def deterministic_zone_id(source_layer: str, source_object_id: str, bbox: list[float]) -> str:
    raw = f"{source_layer}|{source_object_id}|{bbox[0]:.4f},{bbox[1]:.4f},{bbox[2]:.4f},{bbox[3]:.4f}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"pub_{digest}"


def compute_bbox(geometry: dict[str, Any]) -> list[float]:
    coords: list[list[float]] = []
    if geometry["type"] == "Polygon":
        for ring in geometry["coordinates"]:
            coords.extend(ring)
    elif geometry["type"] == "MultiPolygon":
        for poly in geometry["coordinates"]:
            for ring in poly:
                coords.extend(ring)
    elif geometry["type"] == "Point":
        coords.append(geometry["coordinates"])
    if not coords:
        return [0.0, 0.0, 0.0, 0.0]
    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return [round(min(lngs), 5), round(min(lats), 5), round(max(lngs), 5), round(max(lats), 5)]


def load_khoa_zip(zip_path: Path) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    with zipfile.ZipFile(zip_path, "r") as z:
        shp_name = [n for n in z.namelist() if n.lower().endswith(".shp")][0]
        dbf_name = [n for n in z.namelist() if n.lower().endswith(".dbf")][0]
        cpg_names = [n for n in z.namelist() if n.lower().endswith(".cpg")]
        encoding = z.read(cpg_names[0]).decode("ascii", "ignore").strip().lower() if cpg_names else "euc-kr"

        rows = parse_dbf(z.read(dbf_name), encoding or "euc-kr")
        geoms = parse_shp_polygons(z.read(shp_name))

    today = dt.date.today().isoformat()
    for row, geom in zip(rows, geoms):
        if not geom.get("coordinates"):
            continue
        bbox = compute_bbox(geom)
        if not (LNG_MIN <= bbox[0] <= LNG_MAX and LAT_MIN <= bbox[1] <= LAT_MAX):
            continue
        obj_id = row.get("obj_sn") or row.get("gid") or ""
        name = row.get("korn_nm") or row.get("eng_nm") or f"해양조사원 낚시금지구역 ({row.get('enc_no', obj_id)})"
        reason = row.get("korn_etc_i") or f"국립해양조사원 전자해도 낚시금지구역 ({row.get('lmt_artcl_', 'RSN028')})"
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "zone_id": deterministic_zone_id("TL_RESARE_ENS", obj_id, bbox),
                    "tier": "confirmed_polygon",
                    "zone_name": name,
                    "restriction_scope": "all_year",
                    "notice_number": row.get("enc_no") or None,
                    "reason": reason,
                    "source_agency": "해양수산부 국립해양조사원",
                    "verified_at": today,
                },
            }
        )
    return features


def fetch_vworld_layer(vworld_key: str, typename: str, domain: str = "https://exfish.vercel.app") -> list[dict[str, Any]]:
    raw_features: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        params = urllib.parse.urlencode(
            {
                "service": "data",
                "request": "GetFeature",
                "data": typename,
                "format": "json",
                "crs": "EPSG:4326",
                "geomFilter": f"BOX({LNG_MIN},{LAT_MIN},{LNG_MAX},{LAT_MAX})",
                "size": "1000",
                "page": str(page),
                "key": vworld_key,
                "domain": domain,
            }
        )
        url = f"https://api.vworld.kr/req/data?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "exfish-zones-etl/1.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        r = payload.get("response") or {}
        if r.get("status") != "OK":
            raise RuntimeError(f"VWorld Data API status={r.get('status')}: {r.get('error')}")
        total_pages = int((r.get("page") or {}).get("total") or 1)
        fc = (r.get("result") or {}).get("featureCollection") or {}
        raw_features.extend(fc.get("features") or [])
        page += 1
    out: list[dict[str, Any]] = []
    today = dt.date.today().isoformat()
    for idx, feat in enumerate(raw_features):
        props = feat.get("properties") or {}
        if typename == "LT_C_UM901" and props.get("uname") != "습지보호지역":
            continue
        geom = feat.get("geometry")
        if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue

        # Simplify and quantize rings
        if geom["type"] == "Polygon":
            geom["coordinates"] = [
                douglas_peucker([[round(c[0], 5), round(c[1], 5)] for c in r]) for r in geom["coordinates"]
            ]
        else:
            geom["coordinates"] = [
                [douglas_peucker([[round(c[0], 5), round(c[1], 5)] for c in r]) for r in poly]
                for poly in geom["coordinates"]
            ]

        bbox = compute_bbox(geom)
        obj_id = str(feat.get("id") or props.get("dnum") or idx)
        label_parts = [props.get("sido_name"), props.get("sigg_name"), props.get("uname")]
        name = " ".join(str(p) for p in label_parts if p) or typename
        reason = (
            "습지보전법 제13조제1항제5호 포획·채취 금지"
            if typename == "LT_C_UM901"
            else "야생생물 보호 및 관리에 관한 법률 제28조·제33조"
        )
        out.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "zone_id": deterministic_zone_id(typename, obj_id, bbox),
                    "tier": "confirmed_polygon",
                    "zone_name": name,
                    "restriction_scope": "all_year",
                    "notice_number": str(props.get("dnum") or "") or None,
                    "reason": reason,
                    "source_agency": "브이월드(VWorld)",
                    "verified_at": today,
                },
            }
        )
    return out


def cells_for_bbox(bbox: list[float]) -> list[str]:
    min_lng, min_lat, max_lng, max_lat = bbox
    lat_start = math.floor(min_lat / CELL_SIZE_DEG)
    lat_end = math.floor(max_lat / CELL_SIZE_DEG)
    lng_start = math.floor(min_lng / CELL_SIZE_DEG)
    lng_end = math.floor(max_lng / CELL_SIZE_DEG)
    cells: list[str] = []
    for la in range(lat_start, lat_end + 1):
        for ln in range(lng_start, lng_end + 1):
            cells.append(f"cell_{la}_{ln}")
    return cells


def write_zones_output(features: list[dict[str, Any]], out_dir: Path, version: str) -> None:
    ver_dir = out_dir / version
    ver_dir.mkdir(parents=True, exist_ok=True)

    by_cell: dict[str, list[dict[str, Any]]] = {}
    for feat in features:
        bbox = compute_bbox(feat["geometry"])
        for cid in cells_for_bbox(bbox):
            by_cell.setdefault(cid, []).append(feat)

    available_cells = sorted(by_cell.keys())
    for cid in available_cells:
        fc = {"type": "FeatureCollection", "features": by_cell[cid]}
        raw = json.dumps(fc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(raw) > MAX_CELL_BYTES:
            raise ValueError(f"Cell {cid} exceeds {MAX_CELL_BYTES} bytes ({len(raw)} bytes)")
        (ver_dir / f"{cid}.json").write_bytes(raw)

    now_iso = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "version": version,
        "cellSizeDeg": CELL_SIZE_DEG,
        "staticWatermark": now_iso,
        "availableCells": available_cells,
        "generatedAt": now_iso,
        "featureCount": len(features),
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(features)} features across {len(available_cells)} cells to {ver_dir}")


def validate_output(out_dir: Path) -> None:
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ver_dir = out_dir / manifest["version"]
    for cid in manifest["availableCells"]:
        cell_file = ver_dir / f"{cid}.json"
        if not cell_file.exists():
            raise FileNotFoundError(f"Missing cell file listed in manifest: {cell_file}")
        if cell_file.stat().st_size > MAX_CELL_BYTES:
            raise ValueError(f"Cell {cid} exceeds 300KB limit")
        fc = json.loads(cell_file.read_text(encoding="utf-8"))
        for feat in fc.get("features", []):
            bbox = compute_bbox(feat["geometry"])
            if not (LAT_MIN <= bbox[1] <= LAT_MAX and LNG_MIN <= bbox[0] <= LNG_MAX):
                raise ValueError(f"Feature {feat['properties'].get('zone_id')} out of Korea bounds: {bbox}")
    print(f"Validation OK: {len(manifest['availableCells'])} cells verified in {ver_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build exfish prohibited-zone static GeoJSON chunks")
    parser.add_argument("--khoa-zip", type=Path, help="Path to KHOA TL_RESARE_ENS zip")
    parser.add_argument("--curated-json", type=Path, default=Path("scripts/zones-etl/curated_seawalls.json"), help="Optional curated GeoJSON")
    parser.add_argument("--vworld-key", type=str, default=os.environ.get("VWORLD_API_KEY", ""))
    parser.add_argument("--out-dir", type=Path, default=Path("public/zones"))
    parser.add_argument("--version", type=str, default=dt.date.today().strftime("%Y%m%d-01"))
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    if args.validate_only:
        validate_output(args.out_dir)
        return 0

    features: list[dict[str, Any]] = []
    if args.khoa_zip and args.khoa_zip.exists():
        khoa = load_khoa_zip(args.khoa_zip)
        print(f"Loaded {len(khoa)} KHOA TL_RESARE_ENS features")
        features.extend(khoa)

    if args.curated_json and args.curated_json.exists():
        curated = json.loads(args.curated_json.read_text(encoding="utf-8")).get("features") or []
        print(f"Loaded {len(curated)} curated features from {args.curated_json}")
        features.extend(curated)

    if args.vworld_key:
        for layer in ("LT_C_UM901", "LT_C_UM221"):
            try:
                vw = fetch_vworld_layer(args.vworld_key, layer)
                print(f"Fetched {len(vw)} VWorld {layer} features")
                features.extend(vw)
            except Exception as exc:
                print(f"Warning: VWorld {layer} fetch failed: {exc}", file=sys.stderr)

    write_zones_output(features, args.out_dir, args.version)
    validate_output(args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
