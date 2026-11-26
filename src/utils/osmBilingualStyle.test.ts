import { describe, it, expect } from 'vitest';
import {
  buildBilingualTextField,
  buildOsmRasterFallbackStyle,
  CARTO_DARK_TILES,
  ESRI_WORLD_IMAGERY_TILES,
  patchStyleForBilingual,
} from './osmBilingualStyle';

describe('osmBilingualStyle', () => {
  it('builds bilingual expression referencing name:ko and name:en', () => {
    const koExpr = JSON.stringify(buildBilingualTextField('ko'));
    expect(koExpr).toContain('name:ko');
    expect(koExpr).toContain('name:en');

    const enExpr = JSON.stringify(buildBilingualTextField('en'));
    expect(enExpr).toContain('name:en');
    expect(enExpr).not.toContain('name:ko');
  });

  it('patches symbol name layers immutably without mutating input style', () => {
    const baseStyle = {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
        { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': '#00f' } },
        {
          id: 'place_city',
          type: 'symbol',
          'source-layer': 'place',
          layout: { 'text-field': '{name}' },
          paint: { 'text-color': '#111' },
        },
        {
          id: 'highway_shield',
          type: 'symbol',
          'source-layer': 'transportation_name',
          layout: { 'text-field': ['get', 'ref'] },
        },
      ],
    };

    const patched = patchStyleForBilingual(baseStyle, 'ko');
    expect(baseStyle.layers[2]?.layout?.['text-field']).toBe('{name}');
    expect(Array.isArray(patched.layers[2].layout['text-field'])).toBe(true);
    // Non-name symbol layer (ref) remains untouched
    expect(patched.layers[3].layout['text-field']).toEqual(['get', 'ref']);
  });

  it('injects Esri satellite base, hides opaque fills, and adds dark text halo in satellite mode', () => {
    const baseStyle = {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', 'source-layer': 'water' },
        {
          id: 'poi_label',
          type: 'symbol',
          'source-layer': 'poi',
          layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']] },
          paint: { 'text-color': '#222' },
        },
      ],
    };

    const satStyle = patchStyleForBilingual(baseStyle, 'en', {
      transparentBaseForSatellite: true,
    });

    expect(satStyle.sources['esri-satellite']).toBeDefined();
    expect(satStyle.sources['esri-satellite'].maxzoom).toBe(17);
    expect(satStyle.layers[0].id).toBe('esri-satellite-base');
    expect(satStyle.layers.find((l: any) => l.type === 'background')).toBeUndefined();
    const waterLayer = satStyle.layers.find((l: any) => l.id === 'water');
    expect(waterLayer.layout.visibility).toBe('none');

    const poiLayer = satStyle.layers.find((l: any) => l.id === 'poi_label');
    expect(poiLayer.paint['text-color']).toBe('#f8fafc');
    expect(poiLayer.paint['text-halo-width']).toBe(1.5);
  });

  it('builds distinct raster fallback styles for ROADMAP, DARK, and HYBRID (maxzoom 17)', () => {
    const day = buildOsmRasterFallbackStyle('ROADMAP');
    expect(day.sources['osm-raster-fallback'].tiles[0]).toContain('tile.openstreetmap.org');

    const dark = buildOsmRasterFallbackStyle('DARK');
    expect(dark.sources['osm-raster-fallback'].tiles[0]).toBe(CARTO_DARK_TILES);

    const hybrid = buildOsmRasterFallbackStyle('HYBRID');
    expect(hybrid.sources['osm-raster-fallback'].tiles[0]).toBe(ESRI_WORLD_IMAGERY_TILES);
    expect(hybrid.sources['osm-raster-fallback'].maxzoom).toBe(17);
  });
});
