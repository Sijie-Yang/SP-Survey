/**
 * Pre-annotate label palette: { name, color } with stable defaults.
 */
import { DEFAULT_SAM_LABELS } from './imageFeaturesR2';

export const LABEL_COLOR_PALETTE = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
  '#6d4c41', '#546e7a', '#c62828', '#1565c0', '#00897b', '#f9a825',
];

/**
 * Semantic colors for built-in streetscape labels (and common aliases).
 * Keys are lowercase.
 */
export const DEFAULT_LABEL_COLORS = {
  tree: '#2e7d32', // green
  trees: '#2e7d32',
  vegetation: '#43a047',
  building: '#6d4c41', // brown
  buildings: '#6d4c41',
  sky: '#42a5f5', // light blue
  road: '#78909c', // blue-gray asphalt
  sidewalk: '#90a4ae',
  person: '#8e24aa', // purple
  people: '#8e24aa',
  pedestrian: '#8e24aa',
  vehicle: '#fb8c00', // orange
  car: '#ef6c00',
  cars: '#ef6c00',
};

export function hashLabelColor(name) {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return LABEL_COLOR_PALETTE[hash % LABEL_COLOR_PALETTE.length];
}

/** Prefer semantic default, else stable hash. */
export function defaultColorForLabelName(name, fallbackIndex = 0) {
  const key = String(name || '').trim().toLowerCase();
  if (key && DEFAULT_LABEL_COLORS[key]) return DEFAULT_LABEL_COLORS[key];
  if (key) return hashLabelColor(key);
  return LABEL_COLOR_PALETTE[fallbackIndex % LABEL_COLOR_PALETTE.length];
}

/** Normalize to [{ name, color }, ...] */
export function normalizeLabelDefs(input) {
  if (!input) return defaultLabelDefs();
  if (typeof input === 'string') {
    return input
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({
        name,
        color: defaultColorForLabelName(name, i),
      }));
  }
  if (!Array.isArray(input) || !input.length) return defaultLabelDefs();

  const out = [];
  const seen = new Set();
  input.forEach((item, i) => {
    let name = '';
    let color = '';
    if (typeof item === 'string') {
      name = item.trim();
    } else if (item && typeof item === 'object') {
      name = String(item.name || item.label || '').trim();
      color = String(item.color || '').trim();
    }
    if (!name || seen.has(name)) return;
    seen.add(name);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      color = defaultColorForLabelName(name, i);
    }
    out.push({ name, color });
  });
  return out.length ? out : defaultLabelDefs();
}

export function defaultLabelDefs() {
  return DEFAULT_SAM_LABELS.map((name, i) => ({
    name,
    color: defaultColorForLabelName(name, i),
  }));
}

/**
 * If project still has the old index-based default colors for the stock
 * six labels, replace with semantic defaults (one-time migration).
 */
export function migrateLegacyDefaultLabelColors(defs) {
  if (!Array.isArray(defs) || defs.length !== DEFAULT_SAM_LABELS.length) return null;
  const normalized = normalizeLabelDefs(defs);
  const isStockNames = DEFAULT_SAM_LABELS.every((n, i) => normalized[i]?.name === n);
  if (!isStockNames) return null;
  const looksLegacyIndexPalette = DEFAULT_SAM_LABELS.every((_, i) => {
    const c = String(normalized[i]?.color || '').toLowerCase();
    return c === LABEL_COLOR_PALETTE[i].toLowerCase();
  });
  if (!looksLegacyIndexPalette) return null;
  return defaultLabelDefs();
}

export function labelNames(defs) {
  return normalizeLabelDefs(defs).map((d) => d.name);
}

export function labelColorMap(defs) {
  const map = {};
  normalizeLabelDefs(defs).forEach((d) => {
    map[d.name] = d.color;
  });
  return map;
}

export function resolveLabelColor(label, colorMap, fallback) {
  if (!label) return fallback;
  if (colorMap && colorMap[label]) return colorMap[label];
  return defaultColorForLabelName(label) || fallback;
}

/** Remap shape.label when a palette name changes. */
export function remapShapeLabels(shapes, oldName, newName) {
  if (!oldName || oldName === newName) return shapes || [];
  return (shapes || []).map((s) => (
    (s.label || '') === oldName ? { ...s, label: newName || null } : s
  ));
}

/** Clear label on shapes matching name (keep geometry). */
export function clearShapeLabel(shapes, name) {
  if (!name) return shapes || [];
  return (shapes || []).map((s) => (
    (s.label || '') === name ? { ...s, label: null } : s
  ));
}

/** Remove shapes that use this label. */
export function removeShapesWithLabel(shapes, name) {
  if (!name) return shapes || [];
  return (shapes || []).filter((s) => (s.label || '') !== name);
}
