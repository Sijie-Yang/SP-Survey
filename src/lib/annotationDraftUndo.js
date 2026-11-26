import { normalizeAnnotationTool } from './annotationTools';

/** Polygon and line drafts undo one vertex at a time. A box draft does not. */
export function isVertexDraft(draft) {
  const tool = normalizeAnnotationTool(draft?.tool);
  return tool === 'polygon' || tool === 'line';
}

/**
 * Remove the last vertex of an in-progress polygon or line.
 * Returns null when no points remain. Other drafts are unchanged.
 */
export function popDraftPoint(draft) {
  if (!isVertexDraft(draft)) return draft;
  const points = Array.isArray(draft.points) ? draft.points : [];
  if (points.length <= 1) return null;
  return { ...draft, points: points.slice(0, -1) };
}
