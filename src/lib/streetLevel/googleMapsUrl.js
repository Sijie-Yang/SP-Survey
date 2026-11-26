/**
 * Keyless Google Maps helpers: build documented Maps URLs and parse
 * Street View / map URLs that a researcher copies back from Google Maps.
 * No Google API is called here. Pure module.
 *
 * Maps URLs reference: https://developers.google.com/maps/documentation/urls/get-started
 */

const GOOGLE_HOST_RE = /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`]+/gi;

const round = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeHeading(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return round(((n % 360) + 360) % 360, 2);
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseUrlSafe(raw) {
  try {
    return new URL(String(raw || '').trim());
  } catch {
    return null;
  }
}

export function isGoogleMapsHost(host) {
  return GOOGLE_HOST_RE.test(String(host || ''));
}

export function isShortMapsUrl(raw) {
  const url = parseUrlSafe(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return true;
  return host === 'goo.gl' && url.pathname.startsWith('/maps');
}

export function shortMapsHosts() {
  return [...SHORT_HOSTS];
}

/** Documented Maps URL that opens a map at a location (no key needed). */
export function buildGoogleMapUrl({ lat, lng, zoom = 17 } = {}) {
  const params = new URLSearchParams({ api: '1', map_action: 'map' });
  if (validLatLng(Number(lat), Number(lng))) {
    params.set('center', `${round(Number(lat), 7)},${round(Number(lng), 7)}`);
  }
  const z = finiteOrNull(zoom);
  if (z != null) params.set('zoom', String(clamp(Math.round(z), 0, 21)));
  return `https://www.google.com/maps/@?${params.toString()}`;
}

/** Documented Maps URL that opens Street View at a point (no key needed). */
export function buildStreetViewUrl({ lat, lng, heading, pitch, fov, panoId } = {}) {
  const params = new URLSearchParams({ api: '1', map_action: 'pano' });
  if (validLatLng(Number(lat), Number(lng))) {
    params.set('viewpoint', `${round(Number(lat), 7)},${round(Number(lng), 7)}`);
  }
  if (panoId) params.set('pano', String(panoId));
  const h = finiteOrNull(heading);
  if (h != null) params.set('heading', String(round(clamp(h, -180, 360), 2)));
  const p = finiteOrNull(pitch);
  if (p != null) params.set('pitch', String(round(clamp(p, -90, 90), 2)));
  const f = finiteOrNull(fov);
  if (f != null) params.set('fov', String(round(clamp(f, 10, 100), 2)));
  return `https://www.google.com/maps/@?${params.toString()}`;
}

/** Extract every http(s) URL from pasted text (lines, spaces, or mixed prose). */
export function extractUrls(text) {
  const found = String(text || '').match(URL_IN_TEXT_RE) || [];
  return found.map((u) => u.replace(/[),.;]+$/, ''));
}

function parseAtSegment(pathname) {
  const decoded = (() => {
    try { return decodeURIComponent(pathname); } catch { return pathname; }
  })();
  const match = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:,[-\d.]+[a-z])*)/i);
  if (!match) return null;
  const out = { lat: Number(match[1]), lng: Number(match[2]) };
  const tokens = (match[3] || '').split(',').filter(Boolean);
  tokens.forEach((token) => {
    const m = token.match(/^(-?\d+(?:\.\d+)?)([a-z])$/i);
    if (!m) return;
    const value = Number(m[1]);
    switch (m[2].toLowerCase()) {
      case 'a': out.streetView = true; break;
      case 'y': out.fov = value; break;
      case 'h': out.heading = value; break;
      case 't': out.tilt = value; break;
      case 'z': out.zoom = value; break;
      default: break;
    }
  });
  return out;
}

function parseDataSegment(pathname) {
  const idx = pathname.indexOf('/data=');
  if (idx < 0) return {};
  let data = pathname.slice(idx + 6).split('/')[0];
  try { data = decodeURIComponent(data); } catch { /* keep raw */ }
  const out = {};
  // Place URLs also carry !1s0x…:0x… feature ids; only Street View ids are kept.
  const ids = [...data.matchAll(/!1s([^!]+)/g)].map((m) => m[1]);
  const panoId = ids.find((id) => !/^0x/i.test(id) && !id.includes(':'));
  if (panoId && /!1e1/.test(data)) out.panoId = panoId;
  if (/!2e10/.test(data)) out.userUploaded = true;
  const lat = data.match(/!3d(-?\d+(?:\.\d+)?)/);
  const lng = data.match(/!4d(-?\d+(?:\.\d+)?)/);
  if (lat && lng) out.pin = { lat: Number(lat[1]), lng: Number(lng[1]) };
  return out;
}

/**
 * Parse one Google Maps URL.
 * Street View form: /maps/@lat,lng,3a,{fov}y,{heading}h,{tilt}t/data=...!1s{panoId}...
 * pitch = tilt − 90. Also accepts documented api=1 map/pano URLs and plain map views.
 *
 * @returns {{ ok: true, lat, lng, heading, pitch, fov, panoId, zoom, kind, userUploaded, sourceUrl }
 *   | { ok: false, reason: 'empty'|'invalid'|'not-google'|'short-link'|'no-location', sourceUrl }}
 */
export function parseGoogleMapsUrl(raw) {
  const sourceUrl = String(raw || '').trim();
  if (!sourceUrl) return { ok: false, reason: 'empty', sourceUrl };
  const url = parseUrlSafe(sourceUrl);
  if (!url || !/^https?:$/.test(url.protocol)) return { ok: false, reason: 'invalid', sourceUrl };
  if (isShortMapsUrl(sourceUrl)) return { ok: false, reason: 'short-link', sourceUrl };
  if (!isGoogleMapsHost(url.hostname)) return { ok: false, reason: 'not-google', sourceUrl };
  if (!url.pathname.startsWith('/maps') && url.hostname.toLowerCase().startsWith('www.')) {
    return { ok: false, reason: 'not-google', sourceUrl };
  }

  const result = {
    ok: true,
    lat: null,
    lng: null,
    heading: null,
    pitch: null,
    fov: null,
    panoId: null,
    zoom: null,
    kind: 'map',
    userUploaded: false,
    sourceUrl,
  };

  const q = url.searchParams;
  if (q.get('api') === '1') {
    const action = q.get('map_action') || 'map';
    const coords = (action === 'pano' ? q.get('viewpoint') : q.get('center')) || q.get('viewpoint') || q.get('center') || q.get('query');
    const [la, ln] = String(coords || '').split(',').map((s) => Number(s));
    if (validLatLng(la, ln)) { result.lat = la; result.lng = ln; }
    if (action === 'pano') {
      result.kind = 'pano';
      result.panoId = q.get('pano') || null;
      result.heading = normalizeHeading(q.get('heading'));
      result.pitch = finiteOrNull(q.get('pitch'));
      result.fov = finiteOrNull(q.get('fov'));
    }
    result.zoom = finiteOrNull(q.get('zoom'));
  } else {
    const at = parseAtSegment(url.pathname);
    const data = parseDataSegment(url.pathname);
    if (at && validLatLng(at.lat, at.lng)) {
      result.lat = at.lat;
      result.lng = at.lng;
      if (at.zoom != null) result.zoom = at.zoom;
      if (at.streetView || data.panoId) {
        result.kind = 'pano';
        if (at.fov != null) result.fov = at.fov;
        if (at.heading != null) result.heading = normalizeHeading(at.heading);
        if (at.tilt != null) result.pitch = round(at.tilt - 90, 2);
      }
    } else if (data.pin && validLatLng(data.pin.lat, data.pin.lng)) {
      result.lat = data.pin.lat;
      result.lng = data.pin.lng;
    } else {
      const ll = q.get('ll') || q.get('q') || q.get('cbll');
      const [la, ln] = String(ll || '').split(',').map((s) => Number(s));
      if (validLatLng(la, ln)) { result.lat = la; result.lng = ln; }
    }
    if (result.kind === 'pano' || at?.streetView) {
      result.panoId = data.panoId || null;
      result.userUploaded = Boolean(data.userUploaded);
    }
  }

  if (!validLatLng(result.lat, result.lng)) {
    return { ok: false, reason: 'no-location', sourceUrl };
  }
  if (result.fov != null) result.fov = round(clamp(result.fov, 1, 180), 2);
  if (result.pitch != null) result.pitch = round(clamp(result.pitch, -90, 90), 2);
  result.lat = round(result.lat, 7);
  result.lng = round(result.lng, 7);
  return result;
}

/** Parse every URL found in pasted text; keeps input order. */
export function parseGoogleMapsText(text) {
  return extractUrls(text).map(parseGoogleMapsUrl);
}

/**
 * One pasted Street View URL → the fields that replace a single point’s view.
 * Heading, pitch (tilt − 90), FOV and pano id come from parseGoogleMapsUrl.
 * Several URLs are rejected; this is not the batch paste box.
 *
 * @returns {{ ok: true, patch: { heading, pitch, fov, panoId, sourceUrl } }
 *   | { ok: false, reason: string }}
 */
export function viewPatchFromStreetViewUrl(raw) {
  const urls = extractUrls(raw);
  if (urls.length !== 1) return { ok: false, reason: urls.length ? 'several' : 'empty' };
  const parsed = parseGoogleMapsUrl(urls[0]);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.kind !== 'pano') return { ok: false, reason: 'not-pano' };
  return {
    ok: true,
    patch: {
      heading: parsed.heading,
      pitch: parsed.pitch,
      fov: parsed.fov,
      panoId: parsed.panoId,
      sourceUrl: parsed.sourceUrl,
    },
  };
}
