/**
 * Normalized (0–1) polygon geometry helpers for pre-annotate dedupe / review.
 */

function bboxOf(pts) {
  if (!pts?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pts.forEach((p) => {
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function bboxArea(b) {
  if (!b) return 0;
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function bboxIntersectionArea(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.minX, b.minX);
  const y1 = Math.max(a.minY, b.minY);
  const x2 = Math.min(a.maxX, b.maxX);
  const y2 = Math.min(a.maxY, b.maxY);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/** Axis-aligned box IoU from shape points (fast proxy for polygons). */
export function shapeBBoxIoU(a, b) {
  const ba = bboxOf(a?.points);
  const bb = bboxOf(b?.points);
  const inter = bboxIntersectionArea(ba, bb);
  if (inter <= 0) return 0;
  const union = bboxArea(ba) + bboxArea(bb) - inter;
  return union > 0 ? inter / union : 0;
}

export function shapeAreaApprox(shape) {
  return bboxArea(bboxOf(shape?.points));
}

/**
 * Find high-overlap pairs among shapes (same label by default).
 * @returns {Array<{ aId, bId, iou, label }>}
 */
export function findDuplicateShapePairs(shapes = [], { iouThreshold = 0.7, sameLabelOnly = true } = {}) {
  const list = (shapes || []).filter((s) => s?.id && s?.points?.length >= 2);
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (sameLabelOnly && (a.label || '') !== (b.label || '')) continue;
      const iou = shapeBBoxIoU(a, b);
      if (iou >= iouThreshold) {
        pairs.push({
          aId: a.id,
          bId: b.id,
          iou,
          label: a.label || b.label || null,
        });
      }
    }
  }
  return pairs;
}

/**
 * Drop weaker duplicates: keep larger area (or first) when IoU >= threshold.
 * Returns { shapes, removedIds }.
 */
export function dedupeShapesByOverlap(shapes = [], { iouThreshold = 0.7, sameLabelOnly = true } = {}) {
  const list = [...(shapes || [])];
  const remove = new Set();
  for (let i = 0; i < list.length; i += 1) {
    if (remove.has(list[i]?.id)) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      if (remove.has(list[j]?.id)) continue;
      const a = list[i];
      const b = list[j];
      if (sameLabelOnly && (a.label || '') !== (b.label || '')) continue;
      if (shapeBBoxIoU(a, b) < iouThreshold) continue;
      const areaA = shapeAreaApprox(a);
      const areaB = shapeAreaApprox(b);
      // Prefer keeping existing non-batch / earlier shapes when areas are close.
      if (areaB > areaA * 1.05) remove.add(a.id);
      else remove.add(b.id);
    }
  }
  return {
    shapes: list.filter((s) => s?.id && !remove.has(s.id)),
    removedIds: [...remove],
  };
}

/** True if shape looks like a SAM Text result for this prompt. */
export function isSamTextShapeForPrompt(shape, prompt) {
  if (!shape) return false;
  const p = String(prompt || '').trim();
  if (!p) return false;
  if (shape.source === 'sam-text' && String(shape.prompt || '').trim() === p) return true;
  // Legacy shapes have no source — treat same-label batch legacy as replaceable only via explicit label match elsewhere.
  return false;
}
