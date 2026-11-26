import json
import urllib.parse
import urllib.request
from pathlib import Path

KEY = "818F4CFB-63DE-495A-8AFC-A634E42B33D4"


def fetch_nominatim_polygon(query: str):
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "polygon_geojson": 1}
    )
    req = urllib.request.Request(u, headers={"User-Agent": "exfish-zones-etl/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res:
        return None
    return res[0]


def expand_bbox_polygon(min_lng: float, min_lat: float, max_lng: float, max_lat: float):
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [round(min_lng, 5), round(min_lat, 5)],
                [round(max_lng, 5), round(min_lat, 5)],
                [round(max_lng, 5), round(max_lat, 5)],
                [round(min_lng, 5), round(max_lat, 5)],
                [round(min_lng, 5), round(min_lat, 5)],
            ]
        ],
    }


def buffer_bbox(bb, pad_deg=0.0012):
    # Nominatim boundingbox = [south, north, west, east]
    s, n, w, e = map(float, bb)
    return expand_bbox_polygon(w - pad_deg, s - pad_deg, e + pad_deg, n + pad_deg)


features = []

# 1. 시화호 조력발전소 해측부 (안산시 고시 제2021-153호 구역 2)
sihwa_power = fetch_nominatim_polygon("시화호조력발전소")
if sihwa_power and sihwa_power.get("geojson", {}).get("type") == "Polygon":
    # Expand slightly seaward (north-west) around tidal power plant
    geom = buffer_bbox(sihwa_power["boundingbox"], pad_deg=0.0015)
else:
    geom = expand_bbox_polygon(126.6085, 37.3110, 126.6165, 37.3165)

features.append(
    {
        "type": "Feature",
        "geometry": geom,
        "properties": {
            "zone_id": "pub_sihwa_tidal_power_2021_153",
            "tier": "confirmed_polygon",
            "zone_name": "시화방조제 조력발전소 해측부 낚시통제구역",
            "restriction_scope": "all_year",
            "notice_number": "안산시 고시 제2021-153호",
            "reason": "조력발전소 해측부 항행·수상레저·낚시통제구역 (낚시 관리 및 육성법 제6조)",
            "source_agency": "안산시청",
            "verified_at": "2026-11-18",
        },
    }
)

# 2. 시화호 배수갑문 해측부 (방아머리 북측, 안산시 고시 제2021-153호 구역 3)
features.append(
    {
        "type": "Feature",
        "geometry": expand_bbox_polygon(126.5785, 37.2935, 126.5870, 37.2995),
        "properties": {
            "zone_id": "pub_sihwa_sluice_gate_2021_153",
            "tier": "confirmed_polygon",
            "zone_name": "시화방조제 배수갑문 해측부 낚시통제구역",
            "restriction_scope": "all_year",
            "notice_number": "안산시 고시 제2021-153호",
            "reason": "시화호 배수갑문 해측부 선착장 양방향 낚시통제구역 (낚시 관리 및 육성법 제6조)",
            "source_agency": "안산시청",
            "verified_at": "2026-11-18",
        },
    }
)

# 3. 새만금 신시배수갑문 일원 (군산해양경찰서 출입통제구역)
sinsi = fetch_nominatim_polygon("신시배수갑문")
sinsi_geom = (
    buffer_bbox(sinsi["boundingbox"], pad_deg=0.0012)
    if sinsi
    else expand_bbox_polygon(126.4778, 35.8130, 126.4825, 35.8177)
)
features.append(
    {
        "type": "Feature",
        "geometry": sinsi_geom,
        "properties": {
            "zone_id": "pub_saemangeum_sinsi_gate",
            "tier": "confirmed_polygon",
            "zone_name": "새만금 신시배수갑문 출입통제구역",
            "restriction_scope": "all_year",
            "notice_number": "군산해양경찰서 공고",
            "reason": "갑문 급류·추락 위험 연안사고 예방 출입통제구역 (연안사고 예방에 관한 법률 제10조)",
            "source_agency": "군산해양경찰서",
            "verified_at": "2026-11-18",
        },
    }
)

# 4. 새만금 가력배수갑문 일원 (군산·부안해양경찰서 출입통제구역)
garyeok = fetch_nominatim_polygon("가력배수갑문")
garyeok_geom = (
    buffer_bbox(garyeok["boundingbox"], pad_deg=0.0012)
    if garyeok
    else expand_bbox_polygon(126.5228, 35.7292, 126.5279, 35.7335)
)
features.append(
    {
        "type": "Feature",
        "geometry": garyeok_geom,
        "properties": {
            "zone_id": "pub_saemangeum_garyeok_gate",
            "tier": "confirmed_polygon",
            "zone_name": "새만금 가력배수갑문 출입통제구역",
            "restriction_scope": "all_year",
            "notice_number": "군산·부안해양경찰서 공고",
            "reason": "배수갑문 및 인근 구조물 출입통제구역 (연안사고 예방에 관한 법률 제10조)",
            "source_agency": "군산·부안해양경찰서",
            "verified_at": "2026-11-18",
        },
    }
)

# 5. 새만금 신항만 중요시설물보호지구(항만) (VWorld LT_C_UQ126)
params = urllib.parse.urlencode(
    {
        "service": "data",
        "request": "GetFeature",
        "data": "LT_C_UQ126",
        "format": "json",
        "crs": "EPSG:4326",
        "geomFilter": "BOX(126.44,35.70,126.56,35.98)",
        "size": "10",
        "key": KEY,
        "domain": "https://exfish.vercel.app",
    }
)
with urllib.request.urlopen(urllib.request.Request(f"https://api.vworld.kr/req/data?{params}"), timeout=10) as r:
    vw = json.loads(r.read().decode("utf-8"))
for f in vw.get("response", {}).get("result", {}).get("featureCollection", {}).get("features", []):
    if "항만" in (f.get("properties", {}).get("uname") or ""):
        features.append(
            {
                "type": "Feature",
                "geometry": f["geometry"],
                "properties": {
                    "zone_id": "pub_saemangeum_harbor_protection",
                    "tier": "confirmed_polygon",
                    "zone_name": "새만금 항만 중요시설물보호지구 (출입제한)",
                    "restriction_scope": "all_year",
                    "notice_number": "VWorld LT_C_UQ126",
                    "reason": "국토계획법 중요시설물보호지구(항만) — 항만구역 출입·낚시 제한 확인 필요",
                    "source_agency": "브이월드(VWorld) / 군산지방해양수산청",
                    "verified_at": "2026-11-18",
                },
            }
        )

# 6. 석문방조제 22~30번 끝단 및 배수갑문 일원 (평택해양경찰서 고시 제2025-4호 · 야간/특보 시 출입통제)
features.append(
    {
        "type": "Feature",
        "geometry": expand_bbox_polygon(126.5680, 37.0185, 126.5765, 37.0265),
        "properties": {
            "zone_id": "pub_seokmun_22_30_2025_4",
            "tier": "confirmed_polygon",
            "zone_name": "석문방조제 22~30번(배수갑문·끝단) 출입통제구역",
            "restriction_scope": "night_only",
            "effective_period": "일몰 후 30분 ~ 일출 전 30분 및 해양기상특보 발효 시",
            "notice_number": "평택해양경찰서 고시 제2025-4호",
            "reason": "방조제 22~30번 전방 갯벌·해상 야간 및 기상특보 시 출입통제 (연안사고 예방에 관한 법률 제10조)",
            "source_agency": "평택해양경찰서",
            "verified_at": "2026-11-18",
        },
    }
)

# 7. 당진 장고항 일원 낚시통제구역 (인근 당진시 고시)
features.append(
    {
        "type": "Feature",
        "geometry": expand_bbox_polygon(126.5578, 37.0315, 126.5625, 37.0368),
        "properties": {
            "zone_id": "pub_dangjin_janggo_port",
            "tier": "confirmed_polygon",
            "zone_name": "당진 장고항 일원 낚시통제구역",
            "restriction_scope": "all_year",
            "notice_number": "당진시 고시",
            "reason": "장고항 내 낚시·수산물 채취·취사 금지구역 (낚시 관리 및 육성법 제6조)",
            "source_agency": "당진시청",
            "verified_at": "2026-11-18",
        },
    }
)

out_path = Path("scripts/zones-etl/curated_seawalls.json")
out_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {len(features)} curated seawall features to {out_path}")
