import {
  distanceMeters,
  gridInBounds,
  gridInPolygon,
  mergePoints,
  normalizePoint,
  pointDedupKey,
  pointFromParsedUrl,
  pointsFromCsv,
  pointsFromGeoJson,
  pointsToCsv,
  pointsToGeoJson,
  samplePolyline,
} from './points';
import { parseGoogleMapsUrl } from './googleMapsUrl';

const SV = 'https://www.google.com/maps/@1.3,103.8,3a,75y,90h,95t/data=!3m6!1e1!3m4!1sPANO_ABCDEFGHIJKLMNOP!2e0';

describe('point model', () => {
  it('normalizes and validates', () => {
    expect(normalizePoint({ lat: 91, lng: 0 })).toBeNull();
    const p = normalizePoint({ latitude: '1.5', longitude: '103.1', heading: 370, pitch: 120, pano_id: ' X ' });
    expect(p).toMatchObject({ lat: 1.5, lng: 103.1, heading: 10, pitch: 90, panoId: 'X', source: 'import' });
    expect(p.id).toMatch(/^pt_/);
  });

  it('creates a point from a pasted Street View URL', () => {
    const p = pointFromParsedUrl(parseGoogleMapsUrl(SV));
    expect(p).toMatchObject({ lat: 1.3, lng: 103.8, heading: 90, pitch: 5, fov: 75, panoId: 'PANO_ABCDEFGHIJKLMNOP', source: 'google-url', sourceUrl: SV });
  });

  it('dedups by pano id plus view, and by location plus view without pano', () => {
    const a = normalizePoint({ lat: 1, lng: 2, panoId: 'P', heading: 90 });
    const b = normalizePoint({ lat: 1.0001, lng: 2, panoId: 'P', heading: 90.2 });
    const c = normalizePoint({ lat: 1, lng: 2, panoId: 'P', heading: 180 });
    expect(pointDedupKey(a)).toBe(pointDedupKey(b));
    expect(pointDedupKey(a)).not.toBe(pointDedupKey(c));
    const merged = mergePoints([a], [b, c, c]);
    expect(merged).toMatchObject({ added: 1, duplicates: 2 });
    expect(merged.points).toHaveLength(2);
  });

  it('re-ids incoming points whose id collides with an existing one', () => {
    const a = normalizePoint({ id: 'same', lat: 1, lng: 2 });
    const b = normalizePoint({ id: 'same', lat: 3, lng: 4 });
    const { points } = mergePoints([a], [b]);
    expect(new Set(points.map((p) => p.id)).size).toBe(2);
  });

  it('enforces the point limit', () => {
    const incoming = [1, 2, 3].map((i) => normalizePoint({ lat: i, lng: i }));
    expect(mergePoints([], incoming, { max: 2 })).toMatchObject({ added: 2, overLimit: 1 });
  });
});

describe('sampling on our own map', () => {
  it('samples a road every N meters with the road bearing', () => {
    const line = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }];
    const len = distanceMeters(line[0], line[1]);
    const pts = samplePolyline(line, 20);
    expect(pts.length).toBe(Math.floor(len / 20) + 1 + (len % 20 > 5 ? 1 : 0));
    pts.forEach((p) => expect(p.roadBearing).toBeCloseTo(90, 0));
    for (let i = 1; i < pts.length - 1; i += 1) {
      expect(distanceMeters(pts[i - 1], pts[i])).toBeCloseTo(20, 0);
    }
  });

  it('builds a grid in bounds and in a polygon', () => {
    const grid = gridInBounds({ south: 0, west: 0, north: 0.001, east: 0.001 }, 50);
    expect(grid.length).toBe(9);
    const tri = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.002 }, { lat: 0.002, lng: 0 }];
    const inside = gridInPolygon(tri, 50);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.length).toBeLessThan(gridInBounds({ south: 0, west: 0, north: 0.002, east: 0.002 }, 50).length);
  });

  it('refuses grids above the point limit', () => {
    expect(() => gridInBounds({ south: 0, west: 0, north: 1, east: 1 }, 10)).toThrow(/limit/);
  });
});

describe('CSV and GeoJSON round trip', () => {
  const pts = [
    normalizePoint({ lat: 1.3, lng: 103.8, heading: 90, pitch: 5, fov: 75, panoId: 'P1', sourceUrl: SV, source: 'google-url', label: 'A, "quoted"' }),
    normalizePoint({ lat: 1.31, lng: 103.81, source: 'grid' }),
  ];

  it('CSV', () => {
    const { points, invalid } = pointsFromCsv(pointsToCsv(pts));
    expect(invalid).toBe(0);
    expect(points).toEqual(pts);
  });

  it('GeoJSON', () => {
    const { points } = pointsFromGeoJson(JSON.stringify(pointsToGeoJson(pts)));
    expect(points).toEqual(pts);
  });

  it('accepts alias headers and URL-only rows', () => {
    const { points, invalid } = pointsFromCsv(`latitude,longitude,yaw\n1,2,45\n,,\nurl\n`);
    expect(points[0]).toMatchObject({ lat: 1, lng: 2, heading: 45 });
    expect(invalid).toBe(1);
    const urlOnly = pointsFromCsv(`url\n"${SV}"\n`);
    expect(urlOnly.points[0]).toMatchObject({ panoId: 'PANO_ABCDEFGHIJKLMNOP', source: 'google-url' });
  });

  it('expands MultiPoint features', () => {
    const { points } = pointsFromGeoJson({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[2, 1], [4, 3]] }, properties: {} });
    expect(points.map((p) => [p.lat, p.lng])).toEqual([[1, 2], [3, 4]]);
  });
});
