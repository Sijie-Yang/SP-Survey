/**
 * Per-project street-level point list: model, dedup, sampling on our own
 * map (road / area / grid), and CSV / GeoJSON import-export. Pure module.
 */

import { objectsToCsv } from '../csvUtil';
import { normalizeHeading, parseGoogleMapsUrl } from './googleMapsUrl';

export const POINT_SOURCES = ['google-url', 'map-click', 'road', 'area', 'grid', 'import'];
export const MAX_POINTS = 5000;
export const POINT_CSV_HEADERS = [
  'id', 'lat', 'lng', 'heading', 'pitch', 'fov', 'pano_id', 'road_bearing',
  'label', 'source', 'source_url',
];

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const round = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

let idCounter = 0;
export function newPointId() {
  idCounter = (idCounter + 1) % 1e6;
  return `pt_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Normalize untrusted input into a stored point, or null when lat/lng are invalid. */
export function normalizePoint(raw = {}, defaults = {}) {
  const lat = numOrNull(raw.lat ?? raw.latitude);
  const lng = numOrNull(raw.lng ?? raw.lon ?? raw.long ?? raw.longitude);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const pitch = numOrNull(raw.pitch);
  const fov = numOrNull(raw.fov);
  const source = POINT_SOURCES.includes(raw.source) ? raw.source : (defaults.source || 'import');
  return {
    id: String(raw.id || defaults.id || newPointId()),
    lat: round(lat, 7),
    lng: round(lng, 7),
    heading: normalizeHeading(raw.heading),
    pitch: pitch == null ? null : Math.max(-90, Math.min(90, round(pitch, 2))),
    fov: fov == null ? null : Math.max(1, Math.min(180, round(fov, 2))),
    panoId: String(raw.panoId ?? raw.pano_id ?? '').trim() || null,
    roadBearing: normalizeHeading(raw.roadBearing ?? raw.road_bearing),
    label: String(raw.label ?? '').slice(0, 200),
    source,
    sourceUrl: String(raw.sourceUrl ?? raw.source_url ?? '').trim() || null,
  };
}

/** Point from a parsed Google Maps URL (see parseGoogleMapsUrl). */
export function pointFromParsedUrl(parsed) {
  if (!parsed?.ok) return null;
  return normalizePoint({
    lat: parsed.lat,
    lng: parsed.lng,
    heading: parsed.heading,
    pitch: parsed.pitch,
    fov: parsed.fov,
    panoId: parsed.panoId,
    sourceUrl: parsed.sourceUrl,
    source: 'google-url',
  });
}

/** Dedup identity: pano id (when known) or rounded location, plus the view. */
export function pointDedupKey(point) {
  const view = [
    point.heading == null ? '' : Math.round(point.heading) % 360,
    point.pitch == null ? '' : Math.round(point.pitch),
    point.fov == null ? '' : Math.round(point.fov),
  ].join('|');
  const where = point.panoId
    ? `pano:${point.panoId}`
    : `ll:${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  return `${where}|${view}`;
}

/** Append incoming points, skipping duplicates of existing or earlier incoming points. */
export function mergePoints(existing = [], incoming = [], { max = MAX_POINTS } = {}) {
  const seen = new Set(existing.map(pointDedupKey));
  const ids = new Set(existing.map((p) => p.id));
  const points = [...existing];
  let added = 0;
  let duplicates = 0;
  let overLimit = 0;
  incoming.forEach((p) => {
    if (!p) return;
    const key = pointDedupKey(p);
    if (seen.has(key)) { duplicates += 1; return; }
    if (points.length >= max) { overLimit += 1; return; }
    seen.add(key);
    const point = ids.has(p.id) ? { ...p, id: newPointId() } : p;
    ids.add(point.id);
    points.push(point);
    added += 1;
  });
  return { points, added, duplicates, overLimit };
}

// ── Geometry ────────────────────────────────────────────────────────────────

export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial compass bearing from a to b, degrees clockwise from north. */
export function bearingDegrees(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
    - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Sample a drawn road polyline every `spacingM` meters (inclusive of the start,
 * and the end vertex). Each sample carries the local road bearing.
 */
export function samplePolyline(vertices = [], spacingM = 20) {
  const pts = vertices.filter((v) => Number.isFinite(v?.lat) && Number.isFinite(v?.lng));
  if (pts.length < 2 || !(spacingM > 0)) return [];
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = distanceMeters(a, b);
    const bearing = bearingDegrees(a, b);
    let d = carry;
    while (d <= segLen) {
      const p = interpolate(a, b, segLen ? d / segLen : 0);
      out.push({ lat: p.lat, lng: p.lng, roadBearing: round(bearing, 2) });
      d += spacingM;
    }
    carry = d - segLen;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (!tail || distanceMeters(tail, last) > spacingM * 0.25) {
    out.push({ lat: last.lat, lng: last.lng, roadBearing: round(bearingDegrees(pts[pts.length - 2], last), 2) });
  }
  return out;
}

/** Regular grid of points (spacing in meters) inside a lat/lng bounding box. */
export function gridInBounds({ south, west, north, east }, spacingM = 50, { max = MAX_POINTS } = {}) {
  if (![south, west, north, east].every(Number.isFinite) || !(spacingM > 0)) return [];
  const s = Math.min(south, north);
  const n = Math.max(south, north);
  const w = Math.min(west, east);
  const e = Math.max(west, east);
  const midLat = (s + n) / 2;
  const dLat = toDeg(spacingM / EARTH_RADIUS_M);
  const dLng = dLat / Math.max(0.01, Math.cos(toRad(midLat)));
  const rows = Math.floor((n - s) / dLat) + 1;
  const cols = Math.floor((e - w) / dLng) + 1;
  if (rows * cols > max) {
    throw new Error(`Grid would create ${rows * cols} points (limit ${max}); increase spacing.`);
  }
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({ lat: s + r * dLat, lng: w + c * dLng });
    }
  }
  return out;
}

export function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.lat > point.lat) !== (b.lat > point.lat))
      && (point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / ((b.lat - a.lat) || 1e-12) + a.lng);
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Grid points (spacing in meters) that fall inside a drawn polygon. */
export function gridInPolygon(polygon = [], spacingM = 50, opts = {}) {
  if (polygon.length < 3) return [];
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  const candidates = gridInBounds({
    south: Math.min(...lats), north: Math.max(...lats),
    west: Math.min(...lngs), east: Math.max(...lngs),
  }, spacingM, { max: (opts.max || MAX_POINTS) * 4 });
  return candidates.filter((p) => pointInPolygon(p, polygon)).slice(0, opts.max || MAX_POINTS);
}

// ── Import / export ─────────────────────────────────────────────────────────

export function pointsToCsv(points = []) {
  return objectsToCsv(POINT_CSV_HEADERS, points.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    pitch: p.pitch,
    fov: p.fov,
    pano_id: p.panoId,
    road_bearing: p.roadBearing,
    label: p.label,
    source: p.source,
    source_url: p.sourceUrl,
  })));
}

export function pointsToGeoJson(points = []) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        heading: p.heading,
        pitch: p.pitch,
        fov: p.fov,
        pano_id: p.panoId,
        road_bearing: p.roadBearing,
        label: p.label,
        source: p.source,
        source_url: p.sourceUrl,
      },
    })),
  };
}

/** RFC4180 CSV → array of header-keyed objects. */
export function parseCsvRows(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((v) => v !== '')) records.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Invalid CSV: unterminated quoted field');
  if (cell || row.length) { row.push(cell); records.push(row); }
  const headers = (records.shift() || []).map((h) => h.trim());
  return records.map((values) => Object.fromEntries(
    headers.map((h, i) => [h, (values[i] ?? '').replace(/^'(?=[=+@-])/, '')]),
  ));
}

const CSV_ALIASES = {
  lat: ['lat', 'latitude', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x'],
  heading: ['heading', 'yaw', 'bearing'],
  pitch: ['pitch'],
  fov: ['fov'],
  pano_id: ['pano_id', 'panoid', 'pano'],
  road_bearing: ['road_bearing'],
  label: ['label', 'name'],
  source_url: ['source_url', 'url', 'google_url'],
  id: ['id', 'point_id'],
};

function pickAlias(row, key) {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  const hit = CSV_ALIASES[key].find((alias) => lower[alias] != null && lower[alias] !== '');
  return hit ? lower[hit] : undefined;
}

/**
 * Parse CSV rows into points. A row with only a Google Maps URL (no lat/lng)
 * is parsed through the URL parser.
 */
export function pointsFromCsv(text) {
  const rows = parseCsvRows(text);
  const points = [];
  let invalid = 0;
  rows.forEach((row) => {
    let p = normalizePoint({
      id: pickAlias(row, 'id'),
      lat: pickAlias(row, 'lat'),
      lng: pickAlias(row, 'lng'),
      heading: pickAlias(row, 'heading'),
      pitch: pickAlias(row, 'pitch'),
      fov: pickAlias(row, 'fov'),
      panoId: pickAlias(row, 'pano_id'),
      roadBearing: pickAlias(row, 'road_bearing'),
      label: pickAlias(row, 'label'),
      sourceUrl: pickAlias(row, 'source_url'),
      source: row.source,
    }, { source: 'import' });
    if (!p) {
      const url = pickAlias(row, 'source_url');
      p = url ? pointFromParsedUrl(parseGoogleMapsUrl(url)) : null;
    }
    if (p) points.push(p); else invalid += 1;
  });
  return { points, invalid };
}

export function pointsFromGeoJson(input) {
  const doc = typeof input === 'string' ? JSON.parse(input) : input;
  const features = doc?.type === 'FeatureCollection' ? doc.features || []
    : doc?.type === 'Feature' ? [doc] : [];
  const points = [];
  let invalid = 0;
  features.forEach((f) => {
    const g = f?.geometry;
    const props = f?.properties || {};
    const coords = g?.type === 'Point' ? [g.coordinates]
      : g?.type === 'MultiPoint' ? g.coordinates : null;
    if (!coords) { invalid += 1; return; }
    coords.forEach(([lng, lat]) => {
      const p = normalizePoint({
        ...props,
        id: coords.length > 1 ? undefined : props.id,
        lat,
        lng,
        panoId: props.pano_id ?? props.panoId,
        roadBearing: props.road_bearing ?? props.roadBearing,
        sourceUrl: props.source_url ?? props.sourceUrl,
      }, { source: 'import' });
      if (p) points.push(p); else invalid += 1;
    });
  });
  return { points, invalid };
}
