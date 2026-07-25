import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Box, Button, Typography, Chip, TextField, CircularProgress, Alert, IconButton,
} from '@mui/material';
import { Check, Close } from '@mui/icons-material';
import { runSam3, instancesToPolygons } from '../lib/falInference';
import {
  inferShapeTool,
  isPolygonTool,
  normalizeAllowedTools,
  normalizeAnnotationTool,
} from '../lib/annotationTools';
import { resolveLabelColor } from '../lib/preannotateLabels';
import {
  SAM_PREANNOT_MODEL,
  SHAPE_SOURCE_SAM_TEXT,
  SHAPE_SOURCE_SAM_CLICK,
  SHAPE_SOURCE_SAM_BOX,
  withShapeProvenance,
} from '../lib/imageFeaturesR2';

export { inferShapeTool, normalizeAnnotationTool, annotationToolLabel } from '../lib/annotationTools';

const TOOL_COLORS = {
  point: '#e53935',
  line: '#1e88e5',
  polygon: '#43a047',
  region: '#43a047', // legacy alias color
  bbox: '#fb8c00',
};

/** Unlabeled (None) — one fixed color for every tool (not per-tool TOOL_COLORS). */
export const NONE_SHAPE_COLOR = '#78909c';

export function newShapeId() {
  return `shp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @param {Record<string,string>} [colorMap] optional palette override */
export function colorForLabel(label, fallback, colorMap) {
  return resolveLabelColor(label, colorMap, fallback);
}

function withAlpha(hex, alpha) {
  if (!hex || hex.length !== 7) return hex;
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function bboxCorners(pts) {
  if (!pts?.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function drawLabelTag(ctx, text, x, y, color) {
  if (!text) return;
  ctx.save();
  ctx.font = '12px sans-serif';
  const padX = 4;
  const padY = 2;
  const metrics = ctx.measureText(text);
  const tw = metrics.width + padX * 2;
  const th = 16;
  const tx = Math.max(0, x);
  const ty = Math.max(th, y);
  ctx.fillStyle = color || '#333';
  ctx.globalAlpha = 0.9;
  ctx.fillRect(tx, ty - th, tw, th);
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 1;
  ctx.fillText(text, tx + padX, ty - padY - 2);
  ctx.restore();
}

export function drawAnnotationShape(ctx, shape, w, h, {
  color, alpha = 1, fillAlpha = 0.35, selected = false, showLabel = true, showVertices = false,
  labelColors = null,
} = {}) {
  const tool = inferShapeTool(shape);
  const pts = (shape.points || []).map((p) => ({ x: p.x * w, y: p.y * h }));
  if (!pts.length) return;
  const hasLabel = !!(shape.label && String(shape.label).trim());
  const baseColor = color || (hasLabel
    ? colorForLabel(shape.label, TOOL_COLORS[tool] || '#333', labelColors)
    : NONE_SHAPE_COLOR);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = baseColor;
  ctx.fillStyle = baseColor;
  ctx.lineWidth = selected ? 3 : 2;
  if (selected) {
    ctx.setLineDash([6, 3]);
  } else {
    ctx.setLineDash([]);
  }

  if (tool === 'point' && pts[0]) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, selected ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (showLabel && shape.label) drawLabelTag(ctx, shape.label, pts[0].x + 8, pts[0].y - 4, baseColor);
  } else if (tool === 'bbox' && pts.length >= 2) {
    const box = bboxCorners(pts);
    if (box) {
      const rw = box.x2 - box.x1;
      const rh = box.y2 - box.y1;
      ctx.fillStyle = withAlpha(baseColor, fillAlpha);
      ctx.fillRect(box.x1, box.y1, rw, rh);
      ctx.strokeStyle = baseColor;
      ctx.strokeRect(box.x1, box.y1, rw, rh);
      if (showLabel && shape.label) drawLabelTag(ctx, shape.label, box.x1, box.y1 - 2, baseColor);
    }
  } else if (tool === 'line' && pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
    if (showLabel && shape.label) drawLabelTag(ctx, shape.label, pts[0].x, pts[0].y - 4, baseColor);
  } else if (isPolygonTool(tool) && pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    if (pts.length >= 3) ctx.closePath();
    ctx.fillStyle = withAlpha(baseColor, fillAlpha);
    ctx.fill();
    ctx.strokeStyle = baseColor;
    ctx.stroke();
    if (showLabel && shape.label) drawLabelTag(ctx, shape.label, pts[0].x, pts[0].y - 4, baseColor);
  }

  if (showVertices && pts.length) {
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2;
      ctx.arc(p.x, p.y, selected ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function normalizePoint(x, y, w, h) {
  return {
    x: Math.min(1, Math.max(0, x / w)),
    y: Math.min(1, Math.max(0, y / h)),
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
      && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitTestShape(shape, pt, w, h, thresholdPx = 8) {
  const tool = inferShapeTool(shape);
  const pts = (shape.points || []).map((p) => ({ x: p.x * w, y: p.y * h }));
  const nPt = { x: pt.x, y: pt.y };
  if (tool === 'point' && pts[0]) {
    return dist({ x: nPt.x * w, y: nPt.y * h }, pts[0]) <= thresholdPx * 1.5;
  }
  if (tool === 'bbox' && pts.length >= 2) {
    const box = bboxCorners(shape.points);
    return nPt.x >= box.x1 && nPt.x <= box.x2 && nPt.y >= box.y1 && nPt.y <= box.y2;
  }
  if (tool === 'line' && pts.length >= 2) {
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (distToSegment(
        { x: nPt.x * w, y: nPt.y * h },
        pts[i],
        pts[i + 1],
      ) <= thresholdPx) return true;
    }
    return false;
  }
  if (isPolygonTool(tool) && pts.length >= 3) {
    return pointInPolygon({ x: nPt.x * w, y: nPt.y * h }, pts);
  }
  return false;
}

function hitTestVertex(shape, pt, w, h, thresholdPx = 10) {
  const pts = shape?.points || [];
  const px = { x: pt.x * w, y: pt.y * h };
  for (let i = 0; i < pts.length; i += 1) {
    if (dist(px, { x: pts[i].x * w, y: pts[i].y * h }) <= thresholdPx) return i;
  }
  return -1;
}

const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function bboxHandlePositions(box, w, h) {
  const x1 = box.x1 * w;
  const y1 = box.y1 * h;
  const x2 = box.x2 * w;
  const y2 = box.y2 * h;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return {
    nw: { x: x1, y: y1 },
    n: { x: cx, y: y1 },
    ne: { x: x2, y: y1 },
    e: { x: x2, y: cy },
    se: { x: x2, y: y2 },
    s: { x: cx, y: y2 },
    sw: { x: x1, y: y2 },
    w: { x: x1, y: cy },
  };
}

function hitTestBboxHandle(box, pt, w, h, thresholdPx = 10) {
  const positions = bboxHandlePositions(box, w, h);
  const px = { x: pt.x * w, y: pt.y * h };
  for (const name of BOX_HANDLES) {
    if (dist(px, positions[name]) <= thresholdPx) return name;
  }
  return null;
}

function applyBboxResize(box, handle, pt) {
  let { x1, y1, x2, y2 } = box;
  const x = Math.min(1, Math.max(0, pt.x));
  const y = Math.min(1, Math.max(0, pt.y));
  if (handle.includes('n')) y1 = y;
  if (handle.includes('s')) y2 = y;
  if (handle.includes('w')) x1 = x;
  if (handle.includes('e')) x2 = x;
  return {
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
  };
}

function boxToPoints(box) {
  return [
    { x: box.x1, y: box.y1 },
    { x: box.x2, y: box.y2 },
  ];
}

function draftReady(draft) {
  if (!draft?.points?.length) return false;
  const t = normalizeAnnotationTool(draft.tool);
  if (t === 'point') return draft.points.length >= 1;
  if (t === 'line') return draft.points.length >= 2;
  if (t === 'polygon') return draft.points.length >= 3;
  if (t === 'bbox') return draft.points.length >= 2;
  return false;
}

function draftCentroidPx(draft, w, h) {
  const pts = draft?.points || [];
  if (!pts.length || !w || !h) return { x: 16, y: 16 };
  if (draft.tool === 'bbox' && pts.length >= 2) {
    const box = bboxCorners(pts);
    return { x: ((box.x1 + box.x2) / 2) * w, y: box.y2 * h + 8 };
  }
  const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const sy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x: sx * w, y: sy * h + 12 };
}
export default function ImageAnnotationCanvas({
  imageUrl,
  value,
  onChange,
  allowedTools = ['point', 'line', 'polygon', 'bbox'],
  annotationLabels = [],
  /** Optional { [labelName]: '#rrggbb' } for chip/shape colors */
  labelColors = null,
  readOnly = false,
  minAnnotations = 0,
  maxAnnotations = 50,
  enableSamAssist = false,
  falKey = '',
  projectId = '',
  centerContent = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const tools = normalizeAllowedTools(allowedTools);
  const [tool, setTool] = useState(tools[0] || 'point');
  const [draft, setDraft] = useState(null); // { tool, points } | null
  /** Draft edit, or Select-mode edit of a committed shape via `shapeId`. */
  const [drag, setDrag] = useState(null); // { mode, shapeId?, index?, handle?, startPt, origPoints, moved }
  const [shapes, setShapes] = useState(value?.shapes || []);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [imgError, setImgError] = useState(false);
  const [imgSrc, setImgSrc] = useState(imageUrl);
  /** Multi-select: ids of highlighted shapes (Select mode + SAM Text batch). */
  const [selectedIds, setSelectedIds] = useState([]);
  // Empty string = None (no label on newly confirmed shapes).
  const [activeLabel, setActiveLabel] = useState('');
  /** null | 'click' | 'box' | 'text' — mutually exclusive with manual Point/Line/Polygon/Box. */
  const [samMethod, setSamMethod] = useState(null);
  const [samPrompt, setSamPrompt] = useState('');
  const [samBusy, setSamBusy] = useState(false);
  const [samError, setSamError] = useState(null);

  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const samMethodRef = useRef(samMethod);
  samMethodRef.current = samMethod;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const selectOnly = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  const selectMany = useCallback((ids) => {
    const uniq = [...new Set((ids || []).filter(Boolean))];
    setSelectedIds(uniq);
  }, []);
  const toggleSelectedId = useCallback((id) => {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  useEffect(() => {
    const incoming = (value?.shapes || []).map((s) => (s.id ? s : { ...s, id: newShapeId() }));
    setShapes(incoming);
  }, [value?.shapes]);

  useEffect(() => {
    // `select` is UI-only (not part of survey allowedTools).
    if (tool === 'select') return;
    if (!tools.includes(tool)) setTool(tools[0] || 'point');
  }, [tools, tool]);

  useEffect(() => {
    // Keep None (''); only clear if a non-empty active label was removed from the list.
    if (activeLabel && annotationLabels?.length && !annotationLabels.includes(activeLabel)) {
      setActiveLabel('');
    }
  }, [annotationLabels, activeLabel]);

  const emitChange = useCallback((nextShapes) => {
    setShapes(nextShapes);
    onChange?.({ image: imageUrl, shapes: nextShapes });
  }, [imageUrl, onChange]);

  const patchShapePoints = useCallback((shapeId, nextPoints) => {
    if (!shapeId || !Array.isArray(nextPoints)) return;
    emitChange(shapesRef.current.map((s) => (
      s.id === shapeId ? { ...s, points: nextPoints } : s
    )));
  }, [emitChange]);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDrag(null);
  }, []);

  const confirmDraft = useCallback(() => {
    const d = draftRef.current;
    if (!draftReady(d)) return;
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;
    const source = d.source || (d.tool === 'polygon' && d.fromSam ? SHAPE_SOURCE_SAM_CLICK : null);
    const shape = withShapeProvenance({
      id: newShapeId(),
      tool: normalizeAnnotationTool(d.tool) || d.tool,
      points: d.points,
      label: activeLabel || null,
    }, {
      source: source || undefined,
      prompt: d.prompt || null,
      model: source ? SAM_PREANNOT_MODEL : null,
    });
    setDraft(null);
    setDrag(null);
    selectOnly(shape.id);
    emitChange([...shapesRef.current, shape]);
  }, [activeLabel, emitChange, maxAnnotations, selectOnly]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;
    const ctx = canvas.getContext('2d');
    const w = img.clientWidth;
    const h = img.clientHeight;
    canvas.width = w;
    canvas.height = h;
    setDims({ w, h });
    ctx.clearRect(0, 0, w, h);
    const sel = new Set(selectedIds);
    const soleId = selectedIds.length === 1 ? selectedIds[0] : null;

    shapes.forEach((s) => {
      const isSole = !!(soleId && s.id === soleId);
      const sTool = inferShapeTool(s);
      drawAnnotationShape(ctx, s, w, h, {
        alpha: 1,
        fillAlpha: 0.35,
        selected: !!(s.id && sel.has(s.id)),
        // Single selection in Select mode: show editable vertices (bbox uses handles below).
        showVertices: isSole && sTool !== 'bbox',
        labelColors,
      });
    });

    if (soleId) {
      const sole = shapes.find((s) => s.id === soleId);
      if (sole && inferShapeTool(sole) === 'bbox' && (sole.points || []).length >= 2) {
        const box = bboxCorners(sole.points);
        if (box) {
          const positions = bboxHandlePositions(box, w, h);
          const stroke = sole.label
            ? colorForLabel(sole.label, TOOL_COLORS.bbox, labelColors)
            : NONE_SHAPE_COLOR;
          BOX_HANDLES.forEach((name) => {
            const p = positions[name];
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.rect(p.x - 4, p.y - 4, 8, 8);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
    }

    if (draft?.points?.length) {
      drawAnnotationShape(ctx, {
        tool: draft.tool,
        points: draft.points,
        label: activeLabel || null,
      }, w, h, {
        alpha: 0.75,
        fillAlpha: 0.3,
        selected: true,
        showVertices: draft.tool !== 'bbox',
        labelColors,
      });

      if (draft.tool === 'bbox' && draft.points.length >= 2) {
        const box = bboxCorners(draft.points);
        if (box) {
          const positions = bboxHandlePositions(box, w, h);
          BOX_HANDLES.forEach((name) => {
            const p = positions[name];
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = activeLabel
              ? colorForLabel(activeLabel, TOOL_COLORS.bbox, labelColors)
              : NONE_SHAPE_COLOR;
            ctx.lineWidth = 2;
            ctx.rect(p.x - 4, p.y - 4, 8, 8);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
    }
  }, [shapes, draft, selectedIds, activeLabel, labelColors]);

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [redraw, imageUrl]);

  useEffect(() => {
    if (!imageUrl) return undefined;
    setImgError(false);
    clearSelection();
    setDraft(null);
    setDrag(null);
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (!cancelled) setImgSrc(imageUrl);
    };
    probe.onerror = () => {
      if (!cancelled) {
        setImgSrc(imageUrl);
        setImgError(true);
      }
    };
    probe.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, clearSelection]);

  const canvasPoint = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      const { w, h } = dimsRef.current;
      return normalizePoint(0, 0, w || 1, h || 1);
    }
    // Normalize against the same rect used for pointer offsets (avoids img/canvas size drift).
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return normalizePoint(x, y, rect.width, rect.height);
  };

  const findHitShape = (pt) => {
    const { w, h } = dimsRef.current;
    const list = shapesRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (hitTestShape(list[i], pt, w, h)) return list[i];
    }
    return null;
  };

  const switchTool = (next) => {
    const t = next === 'select' ? 'select' : (normalizeAnnotationTool(next) || next);
    setTool(t);
    setSamMethod(null);
    setSamError(null);
    setDraft(null);
    setDrag(null);
    if (t !== 'select') clearSelection();
  };

  const selectSamMethod = (method) => {
    setSamMethod(method);
    setSamError(null);
    setDraft(null);
    setDrag(null);
    clearSelection();
  };

  const putSamPolygonInDraft = (poly, { source = SHAPE_SOURCE_SAM_CLICK, prompt = null } = {}) => {
    if (!poly?.length) return;
    clearSelection();
    setDraft({ tool: 'polygon', points: poly, source, prompt, fromSam: true });
    setDrag(null);
  };

  /** fal SAM3 point/box prompts expect pixel coords, not normalized 0–1. */
  const naturalImageSize = () => {
    const img = imgRef.current;
    const nw = img?.naturalWidth || dimsRef.current.w || 1;
    const nh = img?.naturalHeight || dimsRef.current.h || 1;
    return { nw: Math.max(1, nw), nh: Math.max(1, nh) };
  };

  const toPixelPoint = (pt, label = 1) => {
    const { nw, nh } = naturalImageSize();
    return {
      x: Math.round(Math.min(1, Math.max(0, pt.x)) * nw),
      y: Math.round(Math.min(1, Math.max(0, pt.y)) * nh),
      label: label === 0 ? 0 : 1,
    };
  };

  const toPixelBox = (start, end) => {
    const { nw, nh } = naturalImageSize();
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    return {
      x1: Math.round(Math.min(1, Math.max(0, x1)) * nw),
      y1: Math.round(Math.min(1, Math.max(0, y1)) * nh),
      x2: Math.round(Math.min(1, Math.max(0, x2)) * nw),
      y2: Math.round(Math.min(1, Math.max(0, y2)) * nh),
    };
  };

  /**
   * @param {object} result fal proxy payload
   * @param {{ multi?: boolean }} opts multi=true (SAM Text): add all polygons as shapes
   */
  const applySamResult = async (result, { multi = false, source = SHAPE_SOURCE_SAM_CLICK, prompt = null } = {}) => {
    // Mask → contour polygon first. Never prefer fal's axis-aligned box (looks like "my drag box").
    const polys = await instancesToPolygons(result, { allowBoxFallback: true });
    if (!polys.length) {
      throw new Error(result.error || 'SAM3 returned no usable polygon. Try another click/box, or a clearer noun.');
    }
    if (multi) {
      let room = Infinity;
      if (maxAnnotations > 0) {
        room = Math.max(0, maxAnnotations - shapesRef.current.length);
      }
      const take = polys.slice(0, room === Infinity ? polys.length : room);
      if (!take.length) {
        throw new Error(`Annotation limit reached (${maxAnnotations}).`);
      }
      const added = take.map((points) => withShapeProvenance({
        id: newShapeId(),
        tool: 'polygon',
        points,
        label: activeLabel || null,
      }, {
        source: SHAPE_SOURCE_SAM_TEXT,
        prompt: prompt || samPrompt || null,
        model: SAM_PREANNOT_MODEL,
      }));
      setDraft(null);
      setDrag(null);
      emitChange([...shapesRef.current, ...added]);
      // All new regions selected so user can batch-label immediately.
      selectMany(added.map((s) => s.id));
      setTool('select');
      setSamMethod(null);
      const apiCount = Number(result?.candidates) > 0
        ? Number(result.candidates)
        : (Array.isArray(result?.instances) ? result.instances.length : take.length);
      if (take.length < polys.length) {
        setSamError(`Added ${take.length}/${polys.length} polygons (annotation cap ${maxAnnotations}). All selected — use Selected chips to label.`);
      } else {
        setSamError(`Added ${take.length} polygon${take.length === 1 ? '' : 's'} from ${apiCount} SAM instance${apiCount === 1 ? '' : 's'} (fal max_masks ≤32). All selected — use Selected chips to label.`);
      }
      return;
    }
    putSamPolygonInDraft(polys[0], { source, prompt: prompt || null });
  };

  const runSamAtPoint = async (pt) => {
    setSamBusy(true);
    setSamError(null);
    try {
      const result = await runSam3({
        falKey: falKey || undefined,
        projectId: projectId || undefined,
        imageUrl,
        points: [toPixelPoint(pt, 1)],
      });
      await applySamResult(result, { multi: false, source: SHAPE_SOURCE_SAM_CLICK });
    } catch (err) {
      setSamError(err.message || String(err));
    } finally {
      setSamBusy(false);
    }
  };

  const runSamWithBox = async (start, end) => {
    setSamBusy(true);
    setSamError(null);
    try {
      const result = await runSam3({
        falKey: falKey || undefined,
        projectId: projectId || undefined,
        imageUrl,
        box: toPixelBox(start, end),
      });
      await applySamResult(result, { multi: false, source: SHAPE_SOURCE_SAM_BOX });
    } catch (err) {
      setSamError(err.message || String(err));
      setDraft(null);
    } finally {
      setSamBusy(false);
    }
  };

  const runSamTextPrompt = async () => {
    if (!samPrompt.trim()) {
      setSamError('Enter one noun (e.g. tree, car)');
      return;
    }
    if (draftRef.current) {
      setSamError('Confirm (✓) or discard (✕) the current draft first — ✓ saves the region, it does not enlarge it.');
      return;
    }
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;
    setSamBusy(true);
    setSamError(null);
    try {
      const result = await runSam3({
        falKey: falKey || undefined,
        projectId: projectId || undefined,
        imageUrl,
        prompt: samPrompt.trim(),
      });
      // Text: add every matching instance as a polygon shape.
      await applySamResult(result, {
        multi: true,
        source: SHAPE_SOURCE_SAM_TEXT,
        prompt: samPrompt.trim(),
      });
    } catch (err) {
      setSamError(err.message || String(err));
    } finally {
      setSamBusy(false);
    }
  };

  const handlePointerDown = (e) => {
    if (readOnly || !dimsRef.current.w || imgError || samBusy) return;
    e.preventDefault();
    const pt = canvasPoint(e);
    const { w, h } = dimsRef.current;
    const d = draftRef.current;
    const method = enableSamAssist ? samMethodRef.current : null;

    // Draft editing always works (including SAM polygon drafts).
    if (d) {
      if (d.tool === 'bbox' && d.points.length >= 2) {
        const box = bboxCorners(d.points);
        const handle = hitTestBboxHandle(box, pt, w, h);
        if (handle) {
          setDrag({ mode: 'resize', handle, startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        if (hitTestShape(d, pt, w, h)) {
          setDrag({ mode: 'move', startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        return; // must confirm/cancel
      }

      const draftTool = normalizeAnnotationTool(d.tool);
      if (draftTool === 'point' || draftTool === 'line' || draftTool === 'polygon') {
        const vi = hitTestVertex(d, pt, w, h);
        if (vi >= 0) {
          setDrag({ mode: 'vertex', index: vi, startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        const canExtendManual = !method
          && (draftTool === 'line' || draftTool === 'polygon')
          && normalizeAnnotationTool(toolRef.current) === draftTool;
        if (canExtendManual) {
          if (draftTool === 'polygon' && d.points.length >= 3) {
            const first = d.points[0];
            const closePx = Math.hypot((pt.x - first.x) * w, (pt.y - first.y) * h);
            if (closePx <= 14) {
              if (draftReady(d)) confirmDraft();
              return;
            }
          }
          setDrag({ mode: 'pending-add', startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        return; // must confirm/cancel
      }
      return;
    }

    // Select mode: edit geometry when exactly one shape is selected; else multi-select.
    if (!method && toolRef.current === 'select') {
      const soleId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
      if (soleId) {
        const shape = shapesRef.current.find((s) => s.id === soleId);
        if (shape) {
          const sTool = inferShapeTool(shape);
          const origPoints = (shape.points || []).map((p) => ({ ...p }));
          if (sTool === 'bbox' && origPoints.length >= 2) {
            const box = bboxCorners(origPoints);
            const handle = hitTestBboxHandle(box, pt, w, h);
            if (handle) {
              setDrag({
                mode: 'resize', shapeId: soleId, handle, startPt: pt, origPoints, moved: false,
              });
              canvasRef.current?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (hitTestShape(shape, pt, w, h)) {
              setDrag({
                mode: 'move', shapeId: soleId, startPt: pt, origPoints, moved: false,
              });
              canvasRef.current?.setPointerCapture?.(e.pointerId);
              return;
            }
          } else if (sTool === 'point' || sTool === 'line' || sTool === 'polygon') {
            const vi = hitTestVertex(shape, pt, w, h);
            if (vi >= 0) {
              setDrag({
                mode: 'vertex', shapeId: soleId, index: vi, startPt: pt, origPoints, moved: false,
              });
              canvasRef.current?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (hitTestShape(shape, pt, w, h)) {
              setDrag({
                mode: 'move', shapeId: soleId, startPt: pt, origPoints, moved: false,
              });
              canvasRef.current?.setPointerCapture?.(e.pointerId);
              return;
            }
          }
        }
      }
      const hit = findHitShape(pt);
      if (hit?.id) toggleSelectedId(hit.id);
      else clearSelection();
      return;
    }

    // SAM Click / Text: canvas draw off (Click uses onClick; Text uses Run). Use Select to pick shapes.
    if (method === 'click' || method === 'text') return;

    clearSelection();
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;

    // SAM Box: drag a guide box, then segment (not a manual bbox annotation).
    if (method === 'box') {
      setDraft({ tool: 'bbox', points: [pt, pt] });
      setDrag({ mode: 'draw-bbox', startPt: pt, origPoints: [pt, pt], moved: false });
      canvasRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }

    // Draw tools: start a new shape even on top of existing annotations (Select is separate).
    const t = normalizeAnnotationTool(toolRef.current);
    if (t === 'point') {
      setDraft({ tool: 'point', points: [pt] });
    } else if (t === 'line' || t === 'polygon') {
      setDraft({ tool: t, points: [pt] });
    } else if (t === 'bbox') {
      setDraft({ tool: 'bbox', points: [pt, pt] });
      setDrag({ mode: 'draw-bbox', startPt: pt, origPoints: [pt, pt], moved: false });
      canvasRef.current?.setPointerCapture?.(e.pointerId);
    }
  };

  const handlePointerMove = (e) => {
    const cur = dragRef.current;
    if (!cur) return;
    const pt = canvasPoint(e);
    const { w, h } = dimsRef.current;

    // Select-mode edit of a committed shape
    if (cur.shapeId) {
      if (cur.mode === 'vertex') {
        const shape = shapesRef.current.find((s) => s.id === cur.shapeId);
        if (!shape) return;
        const pts = (shape.points || []).map((p) => ({ ...p }));
        pts[cur.index] = {
          x: Math.min(1, Math.max(0, pt.x)),
          y: Math.min(1, Math.max(0, pt.y)),
        };
        patchShapePoints(cur.shapeId, pts);
        setDrag({ ...cur, moved: true });
      } else if (cur.mode === 'move') {
        const dx = pt.x - cur.startPt.x;
        const dy = pt.y - cur.startPt.y;
        patchShapePoints(cur.shapeId, cur.origPoints.map((p) => ({
          x: Math.min(1, Math.max(0, p.x + dx)),
          y: Math.min(1, Math.max(0, p.y + dy)),
        })));
        setDrag({ ...cur, moved: true });
      } else if (cur.mode === 'resize') {
        const box = bboxCorners(cur.origPoints);
        const next = applyBboxResize(box, cur.handle, pt);
        patchShapePoints(cur.shapeId, boxToPoints(next));
        setDrag({ ...cur, moved: true });
      }
      return;
    }

    if (cur.mode === 'vertex') {
      setDraft((d) => {
        if (!d) return d;
        const pts = d.points.map((p) => ({ ...p }));
        pts[cur.index] = pt;
        return { ...d, points: pts };
      });
      setDrag({ ...cur, moved: true });
    } else if (cur.mode === 'move') {
      const dx = pt.x - cur.startPt.x;
      const dy = pt.y - cur.startPt.y;
      setDraft((d) => {
        if (!d) return d;
        return {
          ...d,
          points: cur.origPoints.map((p) => ({
            x: Math.min(1, Math.max(0, p.x + dx)),
            y: Math.min(1, Math.max(0, p.y + dy)),
          })),
        };
      });
      setDrag({ ...cur, moved: true });
    } else if (cur.mode === 'resize') {
      const box = bboxCorners(cur.origPoints);
      const next = applyBboxResize(box, cur.handle, pt);
      setDraft((d) => (d ? { ...d, points: boxToPoints(next) } : d));
      setDrag({ ...cur, moved: true });
    } else if (cur.mode === 'draw-bbox') {
      setDraft({ tool: 'bbox', points: [cur.startPt, pt] });
      setDrag({ ...cur, moved: true });
    } else if (cur.mode === 'pending-add') {
      const px = Math.hypot((pt.x - cur.startPt.x) * w, (pt.y - cur.startPt.y) * h);
      if (px > 6) setDrag({ ...cur, moved: true });
    }
  };

  const handlePointerUp = async (e) => {
    const cur = dragRef.current;
    if (!cur) return;
    const pt = canvasPoint(e);

    if (cur.mode === 'pending-add' && !cur.moved) {
      setDraft((d) => {
        if (!d) return d;
        return { ...d, points: [...d.points, cur.startPt] };
      });
      setDrag(null);
      return;
    }

    if (cur.mode === 'draw-bbox') {
      const start = cur.startPt;
      const end = pt;
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      setDrag(null);
      if (dx < 0.005 && dy < 0.005) {
        setDraft(null);
        return;
      }
      if (enableSamAssist && samMethodRef.current === 'box') {
        setDraft(null);
        await runSamWithBox(start, end);
        return;
      }
      setDraft({ tool: 'bbox', points: [start, end] });
      return;
    }

    setDrag(null);
  };

  const handleClick = (e) => {
    if (readOnly || !dimsRef.current.w || imgError || samBusy) return;
    if (!(enableSamAssist && samMethodRef.current === 'click')) return;
    if (draftRef.current) {
      setSamError('Confirm (✓) or discard (✕) the current draft first');
      return;
    }
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;
    const pt = canvasPoint(e);
    runSamAtPoint(pt);
  };

  const handleDoubleClick = (e) => {
    if (readOnly || samBusy) return;
    e.preventDefault();
    e.stopPropagation();
    const d = draftRef.current;
    if (!d || normalizeAnnotationTool(d.tool) !== 'polygon') return;
    if (!draftReady(d)) return;
    confirmDraft();
  };

  const undo = () => {
    if (draftRef.current) {
      cancelDraft();
      return;
    }
    const next = shapesRef.current.slice(0, -1);
    clearSelection();
    emitChange(next);
  };

  const clear = () => {
    clearSelection();
    setDraft(null);
    setDrag(null);
    emitChange([]);
  };

  const deleteSelected = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (!ids.size) return;
    const next = shapesRef.current.filter((s) => !ids.has(s.id));
    clearSelection();
    emitChange(next);
  }, [emitChange, clearSelection]);

  const updateSelectedLabel = (label) => {
    const ids = new Set(selectedIds);
    if (!ids.size) return;
    const nextLabel = label || null;
    const next = shapes.map((s) => (ids.has(s.id) ? { ...s, label: nextLabel } : s));
    emitChange(next);
  };

  const toggleActiveLabel = (lb) => {
    setActiveLabel((prev) => (prev === lb ? '' : lb));
  };

  const toggleSelectedLabel = (lb) => {
    if (!selectedIds.length) return;
    const selected = shapes.filter((s) => selectedIds.includes(s.id));
    const allHave = selected.length > 0 && selected.every((s) => (s.label || '') === lb);
    updateSelectedLabel(allHave ? '' : lb);
  };

  useEffect(() => {
    if (readOnly) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(null);
        setDrag(null);
        clearSelection();
        return;
      }
      if (e.key === 'Enter') {
        if (draftReady(draftRef.current)) {
          e.preventDefault();
          confirmDraft();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (draftRef.current) {
          e.preventDefault();
          setDraft(null);
          setDrag(null);
          return;
        }
        if (selectedIdsRef.current.length) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, confirmDraft, deleteSelected, clearSelection]);

  const selectedShapes = shapes.filter((s) => selectedIds.includes(s.id));
  const selectedLabelCommon = (() => {
    if (!selectedShapes.length) return null;
    const labels = selectedShapes.map((s) => s.label || '');
    const first = labels[0];
    return labels.every((l) => l === first) ? first : '__mixed__';
  })();
  const showDraftUi = !readOnly && !!draft?.points?.length && dims.w > 0 && !imgError;
  const confirmPos = showDraftUi ? draftCentroidPx(draft, dims.w, dims.h) : null;
  const canConfirm = draftReady(draft);

  const toolHint = (() => {
    const draftTool = normalizeAnnotationTool(draft?.tool);
    const activeTool = normalizeAnnotationTool(tool);
    if (draft) {
      if (draftTool === 'line') return 'Click to add more points · drag vertices to edit · ✓ confirm · ✕ discard';
      if (draftTool === 'polygon') {
        return samMethod
          ? 'SAM region draft · drag vertices to edit · ✓ save as polygon · ✕ / Esc discard'
          : 'Click to add vertices · click first point or double-click to close · ✓ confirm (≥3) · ✕ discard';
      }
      if (draftTool === 'bbox') return 'Drag body to move · handles to resize · ✓ confirm · ✕ discard';
      if (draftTool === 'point') return 'Drag to adjust · ✓ confirm · ✕ discard';
    }
    if (samMethod === 'click') return 'SAM Click: click object → polygon draft → ✓ · switch to Select to pick existing';
    if (samMethod === 'box') return 'SAM Box: drag guide box → polygon draft → ✓ · switch to Select to pick existing';
    if (samMethod === 'text') return 'SAM Text: one noun + Run → all matches as polygons (all selected for batch label)';
    if (tool === 'select') {
      if (selectedIds.length === 1) {
        return 'Edit: drag vertices / move shape · box handles resize · click elsewhere to multi-select or clear';
      }
      return 'Select: click toggles multi-select · select one to edit points · Selected row labels all · Delete removes selected';
    }
    if (activeTool === 'point') return 'Point: click to place (can overlap existing) · ✓ to confirm';
    if (activeTool === 'line') return 'Line: click to add points · ✓ to confirm (Esc cancels)';
    if (activeTool === 'polygon') return 'Polygon: click vertices; click first point or double-click to close (≥3)';
    if (activeTool === 'bbox') return 'Box: drag to draw (can overlap existing) · ✓ to confirm';
    return '';
  })();

  return (
    <Box
      ref={containerRef}
      sx={centerContent ? { width: '100%' } : undefined}
    >
      {!readOnly && (
        <Box
          className="sp-annotation-toolbar"
          sx={{
            mb: 1,
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            alignItems: 'center',
            width: '100%',
            '& .MuiButton-root': {
              minHeight: { xs: 40, sm: 30 },
            },
          }}
        >
          {/* Select is its own mode — separate from draw tools and SAM */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pr: 1.25,
              mr: 0.5,
              borderRight: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Button
              size="small"
              color="info"
              variant={!samMethod && tool === 'select' ? 'contained' : 'outlined'}
              onClick={() => switchTool('select')}
              sx={{ fontWeight: 700, minWidth: 72 }}
            >
              Select
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>Draw</Typography>
            {tools.includes('point') && (
              <Button size="small" variant={!samMethod && tool === 'point' ? 'contained' : 'outlined'} onClick={() => switchTool('point')}>Point</Button>
            )}
            {tools.includes('line') && (
              <Button size="small" variant={!samMethod && tool === 'line' ? 'contained' : 'outlined'} onClick={() => switchTool('line')}>Line</Button>
            )}
            {tools.includes('polygon') && (
              <Button size="small" variant={!samMethod && tool === 'polygon' ? 'contained' : 'outlined'} onClick={() => switchTool('polygon')}>Polygon</Button>
            )}
            {tools.includes('bbox') && (
              <Button size="small" variant={!samMethod && tool === 'bbox' ? 'contained' : 'outlined'} onClick={() => switchTool('bbox')}>Box</Button>
            )}
          </Box>
          {enableSamAssist && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                alignItems: 'center',
                pl: 1,
                ml: 0.5,
                borderLeft: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>SAM</Typography>
              <Button
                size="small"
                color="secondary"
                variant={samMethod === 'click' ? 'contained' : 'outlined'}
                disabled={samBusy}
                onClick={() => selectSamMethod('click')}
              >
                {samBusy && samMethod === 'click' ? 'SAM…' : 'Click'}
              </Button>
              <Button
                size="small"
                color="secondary"
                variant={samMethod === 'box' ? 'contained' : 'outlined'}
                disabled={samBusy}
                onClick={() => selectSamMethod('box')}
              >
                {samBusy && samMethod === 'box' ? 'SAM…' : 'Box'}
              </Button>
              <Button
                size="small"
                color="secondary"
                variant={samMethod === 'text' ? 'contained' : 'outlined'}
                disabled={samBusy}
                onClick={() => selectSamMethod('text')}
              >
                Text
              </Button>
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml: { xs: 0, sm: 'auto' } }}>
            <Button size="small" onClick={undo} disabled={!shapes.length && !draft}>Undo</Button>
            <Button size="small" color="error" onClick={clear} disabled={!shapes.length && !draft}>Clear</Button>
            <Button size="small" color="error" onClick={deleteSelected} disabled={!selectedIds.length || !!draft}>Delete</Button>
          </Box>
          {(minAnnotations > 0 || maxAnnotations > 0) && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Annotations: {shapes.length}{maxAnnotations > 0 ? ` / ${maxAnnotations}` : ''}{minAnnotations > 0 ? ` (min ${minAnnotations})` : ''}
            </Typography>
          )}
          {toolHint && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {toolHint}
            </Typography>
          )}
        </Box>
      )}
      {!readOnly && enableSamAssist && samMethod === 'text' && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
          <TextField
            size="small"
            label="One noun"
            placeholder="e.g. tree"
            value={samPrompt}
            onChange={(e) => setSamPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSamTextPrompt();
              }
            }}
            sx={{ minWidth: { xs: '100%', sm: 200 }, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}
          />
          <Button size="small" variant="contained" color="secondary" disabled={samBusy} onClick={runSamTextPrompt}>
            Run
          </Button>
          {samBusy && <CircularProgress size={18} />}
        </Box>
      )}
      {!readOnly && enableSamAssist && samError && (
        <Alert severity="warning" sx={{ mb: 1, py: 0 }} onClose={() => setSamError(null)}>{samError}</Alert>
      )}
      {!readOnly && annotationLabels?.length > 0 && (
        <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 1,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: 'primary.light',
              bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(25,118,210,0.08)' : 'rgba(25,118,210,0.04)'),
            }}
          >
            <Chip
              size="small"
              color="primary"
              label="Active"
              sx={{ fontWeight: 700 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              next new shape · click again for None
            </Typography>
            <Chip
              size="small"
              label="None"
              onClick={() => setActiveLabel('')}
              variant={!activeLabel ? 'filled' : 'outlined'}
              sx={{
                fontWeight: !activeLabel ? 700 : 500,
                bgcolor: !activeLabel ? NONE_SHAPE_COLOR : undefined,
                color: !activeLabel ? '#fff' : 'text.secondary',
                borderColor: NONE_SHAPE_COLOR,
              }}
            />
            {annotationLabels.map((lb) => {
              const on = activeLabel === lb;
              const c = colorForLabel(lb, undefined, labelColors);
              return (
                <Chip
                  key={`active-${lb}`}
                  size="small"
                  label={lb}
                  onClick={() => toggleActiveLabel(lb)}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{
                    borderColor: c,
                    bgcolor: on ? c : undefined,
                    color: on ? '#fff' : undefined,
                    fontWeight: on ? 700 : 500,
                  }}
                />
              );
            })}
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 1,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: selectedShapes.length ? 'warning.main' : 'divider',
              bgcolor: selectedShapes.length
                ? ((t) => (t.palette.mode === 'dark' ? 'rgba(237,108,2,0.12)' : 'rgba(237,108,2,0.06)'))
                : 'action.hover',
              opacity: selectedShapes.length ? 1 : 0.72,
            }}
          >
            <Chip
              size="small"
              color="warning"
              label={selectedShapes.length ? `Selected ×${selectedShapes.length}` : 'Selected'}
              sx={{ fontWeight: 700 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              {selectedShapes.length
                ? (selectedLabelCommon === '__mixed__'
                  ? 'mixed labels · click a chip to set all · click again for None'
                  : 'label applies to all selected · click again for None')
                : 'Select mode: click shapes to multi-select'}
            </Typography>
            <Chip
              size="small"
              label="None"
              disabled={!selectedShapes.length}
              onClick={() => selectedShapes.length && updateSelectedLabel('')}
              variant={selectedLabelCommon === '' ? 'filled' : 'outlined'}
              sx={{
                fontWeight: selectedLabelCommon === '' ? 700 : 500,
                bgcolor: selectedLabelCommon === '' ? NONE_SHAPE_COLOR : undefined,
                color: selectedLabelCommon === '' ? '#fff' : 'text.secondary',
                borderColor: NONE_SHAPE_COLOR,
              }}
            />
            {annotationLabels.map((lb) => {
              const on = selectedLabelCommon === lb;
              const c = colorForLabel(lb, undefined, labelColors);
              return (
                <Chip
                  key={`sel-${lb}`}
                  size="small"
                  label={lb}
                  disabled={!selectedShapes.length}
                  onClick={() => toggleSelectedLabel(lb)}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{
                    borderColor: c,
                    bgcolor: on ? c : undefined,
                    color: on ? '#fff' : undefined,
                    fontWeight: on ? 700 : 500,
                  }}
                />
              );
            })}
          </Box>
        </Box>
      )}
      <Box sx={{
        position: 'relative',
        display: 'block',
        maxWidth: '100%',
        width: 'fit-content',
        mx: centerContent ? 'auto' : undefined,
      }}>
        {imgError ? (
          <Box sx={{ p: 3, bgcolor: 'grey.100', borderRadius: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Image failed to load</Typography>
            <Button size="small" onClick={() => { setImgError(false); setImgSrc(`${imageUrl}${imageUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`); }}>Retry</Button>
          </Box>
        ) : (
          <img
            ref={imgRef}
            src={imgSrc}
            alt="annotate"
            style={{ maxWidth: '100%', display: 'block', borderRadius: 8 }}
            onLoad={redraw}
            onError={() => setImgError(true)}
          />
        )}
        {!imgError && (
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrag(null)}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              cursor: readOnly ? 'default' : 'crosshair',
              touchAction: 'none',
            }}
          />
        )}
        {showDraftUi && confirmPos && (
          <Box
            sx={{
              position: 'absolute',
              left: Math.min(dims.w - 100, Math.max(4, confirmPos.x - 44)),
              top: Math.min(dims.h - 52, Math.max(4, confirmPos.y)),
              display: 'flex',
              gap: 0.5,
              zIndex: 3,
              bgcolor: 'rgba(255,255,255,0.92)',
              borderRadius: 1,
              boxShadow: 1,
              p: 0.25,
              '& .MuiIconButton-root': {
                minWidth: 44,
                minHeight: 44,
              },
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconButton
              color="success"
              aria-label="Confirm annotation"
              onClick={confirmDraft}
              disabled={!canConfirm}
              title={canConfirm ? 'Confirm' : 'Add more points first'}
            >
              <Check />
            </IconButton>
            <IconButton
              color="error"
              aria-label="Discard annotation"
              onClick={cancelDraft}
              title="Discard"
            >
              <Close />
            </IconButton>
          </Box>
        )}
      </Box>
    </Box>
  );
}
/** Overlay multiple participants' annotations on one image (for ResultsAnalysis). */
export function AnnotationOverlay({
  imageUrl,
  annotations,
  width = 500,
  labelFilter = null,
  toolFilter = null,
}) {
  const canvasRef = useRef(null);
  const PARTICIPANT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];
  const toolFilterNorm = toolFilter ? normalizeAnnotationTool(toolFilter) : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    let cancelled = false;

    const drawAnnotations = (ctx, w, h) => {
      annotations.forEach((ann, pi) => {
        const color = PARTICIPANT_COLORS[pi % PARTICIPANT_COLORS.length];
        (ann.shapes || []).forEach((shape) => {
          if (labelFilter && shape.label !== labelFilter) return;
          if (toolFilterNorm && inferShapeTool(shape) !== toolFilterNorm) return;
          drawAnnotationShape(ctx, shape, w, h, {
            color: shape.label ? colorForLabel(shape.label, color) : color,
            alpha: 0.75,
            fillAlpha: 0.28,
          });
        });
      });
    };

    const render = (img) => {
      if (cancelled) return;
      const aspect = img ? img.height / img.width : 0.625;
      const w = width;
      const h = Math.round(w * aspect);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (img) {
        ctx.drawImage(img, 0, 0, w, h);
      } else {
        ctx.fillStyle = '#eceff1';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#90a4ae';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Image unavailable — showing annotations only', w / 2, h / 2);
        ctx.textAlign = 'start';
      }
      drawAnnotations(ctx, w, h);
    };

    const tryLoad = (useCors) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => render(img);
      img.onerror = () => {
        if (cancelled) return;
        if (useCors) tryLoad(false);
        else render(null);
      };
      img.src = imageUrl;
    };
    tryLoad(true);

    return () => { cancelled = true; };
  }, [imageUrl, annotations, width, labelFilter, toolFilterNorm]);

  return <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)' }} />;
}
