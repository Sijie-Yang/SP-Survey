/**
 * Annotation drawing tools. Canonical id is `polygon` (legacy `region` still accepted).
 */

export const ANNOTATION_TOOLS = ['point', 'line', 'polygon', 'bbox'];

const TOOL_LABELS = {
  point: 'Point',
  line: 'Line',
  polygon: 'Polygon',
  bbox: 'Bounding box',
};

/** Map legacy / alias ids → canonical tool id. */
export function normalizeAnnotationTool(tool) {
  if (tool == null || tool === '') return '';
  const t = String(tool).toLowerCase().trim();
  if (t === 'region' || t === 'poly' || t === 'polygon') return 'polygon';
  if (t === 'rect' || t === 'box' || t === 'bbox') return 'bbox';
  // Skill/MCP vocabulary often uses points/path for native point/line tools.
  if (t === 'points' || t === 'point') return 'point';
  if (t === 'path' || t === 'polyline' || t === 'line') return 'line';
  return t;
}

export function annotationToolLabel(tool) {
  const t = normalizeAnnotationTool(tool);
  return TOOL_LABELS[t] || t || '(unknown)';
}

export function normalizeAllowedTools(tools, fallback = ANNOTATION_TOOLS) {
  const src = Array.isArray(tools) && tools.length ? tools : fallback;
  const out = [];
  const seen = new Set();
  src.forEach((raw) => {
    const t = normalizeAnnotationTool(raw);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out.length ? out : [...fallback];
}

export function isPolygonTool(tool) {
  return normalizeAnnotationTool(tool) === 'polygon';
}

/** Infer canonical tool from a stored shape (supports legacy `region`). */
export function inferShapeTool(shape) {
  if (shape?.tool) return normalizeAnnotationTool(shape.tool) || 'point';
  const n = shape?.points?.length || 0;
  if (n >= 3) return 'polygon';
  if (n === 2) return 'line';
  return 'point';
}
