import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Box, Button, Typography, FormControl, InputLabel, Select, MenuItem, Chip, TextField, CircularProgress, Alert, IconButton,
} from '@mui/material';
import { Check, Close } from '@mui/icons-material';
import { runSam3, loadMaskUrlToCanvas, maskCanvasToPolygon } from '../lib/falInference';

const TOOL_COLORS = {
  point: '#e53935',
  line: '#1e88e5',
  region: '#43a047',
  bbox: '#fb8c00',
};

const LABEL_PALETTE = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
  '#6d4c41', '#546e7a', '#c62828', '#1565c0',
];

export function newShapeId() {
  return `shp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function inferShapeTool(shape) {
  if (shape?.tool) return shape.tool;
  const n = shape?.points?.length || 0;
  if (n >= 3) return 'region';
  if (n === 2) return 'line';
  return 'point';
}

export function colorForLabel(label, fallback) {
  if (!label) return fallback;
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return LABEL_PALETTE[hash % LABEL_PALETTE.length];
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
} = {}) {
  const tool = inferShapeTool(shape);
  const pts = (shape.points || []).map((p) => ({ x: p.x * w, y: p.y * h }));
  if (!pts.length) return;
  const baseColor = color || colorForLabel(shape.label, TOOL_COLORS[tool] || '#333');
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
  } else if (tool === 'region' && pts.length >= 2) {
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
  if (tool === 'region' && pts.length >= 3) {
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
  if (draft.tool === 'point') return draft.points.length >= 1;
  if (draft.tool === 'line') return draft.points.length >= 2;
  if (draft.tool === 'region') return draft.points.length >= 3;
  if (draft.tool === 'bbox') return draft.points.length >= 2;
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
  allowedTools = ['point', 'line', 'region'],
  annotationLabels = [],
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
  const tools = allowedTools?.length ? allowedTools : ['point', 'line', 'region'];
  const [tool, setTool] = useState(tools[0] || 'point');
  const [draft, setDraft] = useState(null); // { tool, points } | null
  const [drag, setDrag] = useState(null); // { mode, index?, handle?, startPt, origPoints, moved }
  const [shapes, setShapes] = useState(value?.shapes || []);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [imgError, setImgError] = useState(false);
  const [imgSrc, setImgSrc] = useState(imageUrl);
  const [selectedId, setSelectedId] = useState(null);
  const [activeLabel, setActiveLabel] = useState(annotationLabels?.[0] || '');
  const [samMode, setSamMode] = useState(false);
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
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const incoming = (value?.shapes || []).map((s) => (s.id ? s : { ...s, id: newShapeId() }));
    setShapes(incoming);
  }, [value?.shapes]);

  useEffect(() => {
    if (!tools.includes(tool)) setTool(tools[0] || 'point');
  }, [tools, tool]);

  useEffect(() => {
    if (annotationLabels?.length && !annotationLabels.includes(activeLabel)) {
      setActiveLabel(annotationLabels[0]);
    }
  }, [annotationLabels, activeLabel]);

  const emitChange = useCallback((nextShapes) => {
    setShapes(nextShapes);
    onChange?.({ image: imageUrl, shapes: nextShapes });
  }, [imageUrl, onChange]);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDrag(null);
  }, []);

  const confirmDraft = useCallback(() => {
    const d = draftRef.current;
    if (!draftReady(d)) return;
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;
    const shape = {
      id: newShapeId(),
      tool: d.tool,
      points: d.points,
      label: activeLabel || null,
    };
    setDraft(null);
    setDrag(null);
    setSelectedId(shape.id);
    emitChange([...shapesRef.current, shape]);
  }, [activeLabel, emitChange, maxAnnotations]);

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

    shapes.forEach((s) => {
      drawAnnotationShape(ctx, s, w, h, {
        alpha: 1,
        fillAlpha: 0.35,
        selected: s.id && s.id === selectedId,
      });
    });

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
      });

      if (draft.tool === 'bbox' && draft.points.length >= 2) {
        const box = bboxCorners(draft.points);
        if (box) {
          const positions = bboxHandlePositions(box, w, h);
          BOX_HANDLES.forEach((name) => {
            const p = positions[name];
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = TOOL_COLORS.bbox;
            ctx.lineWidth = 2;
            ctx.rect(p.x - 4, p.y - 4, 8, 8);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
    }
  }, [shapes, draft, selectedId, activeLabel]);

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [redraw, imageUrl]);

  useEffect(() => {
    if (!imageUrl) return undefined;
    setImgError(false);
    setSelectedId(null);
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
  }, [imageUrl]);

  const canvasPoint = (e) => {
    const { w, h } = dimsRef.current;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return normalizePoint(x, y, w, h);
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
    setTool(next);
    setDraft(null);
    setDrag(null);
  };

  const putSamPolygonInDraft = (poly) => {
    if (!poly?.length) return;
    setSelectedId(null);
    setDraft({ tool: 'region', points: poly });
    setDrag(null);
  };

  const runSamAtPoint = async (pt) => {
    setSamBusy(true);
    setSamError(null);
    try {
      const result = await runSam3({
        falKey: falKey || undefined,
        projectId: projectId || undefined,
        imageUrl,
        prompt: samPrompt || undefined,
        points: [{ x: pt.x, y: pt.y, label: 1 }],
      });
      if (!result.maskUrl) throw new Error('No mask returned from SAM3');
      const canvas = await loadMaskUrlToCanvas(result.maskUrl);
      const poly = maskCanvasToPolygon(canvas, 6);
      if (poly.length < 3) throw new Error('Could not convert mask to polygon');
      putSamPolygonInDraft(poly);
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
      const box = {
        x1: Math.min(start.x, end.x),
        y1: Math.min(start.y, end.y),
        x2: Math.max(start.x, end.x),
        y2: Math.max(start.y, end.y),
      };
      const result = await runSam3({
        falKey: falKey || undefined,
        projectId: projectId || undefined,
        imageUrl,
        prompt: samPrompt || undefined,
        box,
      });
      if (!result.maskUrl) throw new Error('No mask returned from SAM3');
      const canvas = await loadMaskUrlToCanvas(result.maskUrl);
      const poly = maskCanvasToPolygon(canvas, 6);
      if (poly.length < 3) throw new Error('Could not convert mask to polygon');
      putSamPolygonInDraft(poly);
    } catch (err) {
      setSamError(err.message || String(err));
      setDraft({ tool: 'bbox', points: [start, end] });
    } finally {
      setSamBusy(false);
    }
  };

  const runSamTextPrompt = async () => {
    if (!samPrompt.trim()) {
      setSamError('Enter a text prompt (e.g. tree, car)');
      return;
    }
    if (draftRef.current) {
      setSamError('Confirm or cancel the current draft first');
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
      if (!result.maskUrl) throw new Error('No mask returned from SAM3');
      const canvas = await loadMaskUrlToCanvas(result.maskUrl);
      const poly = maskCanvasToPolygon(canvas, 6);
      if (poly.length < 3) throw new Error('Could not convert mask to polygon');
      putSamPolygonInDraft(poly);
    } catch (err) {
      setSamError(err.message || String(err));
    } finally {
      setSamBusy(false);
    }
  };

  const handlePointerDown = (e) => {
    if (readOnly || !dimsRef.current.w || imgError || samBusy) return;
    if (samMode && enableSamAssist) return; // SAM uses click / bbox-up paths
    e.preventDefault();
    const pt = canvasPoint(e);
    const { w, h } = dimsRef.current;
    const d = draftRef.current;

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

      if (d.tool === 'point' || d.tool === 'line' || d.tool === 'region') {
        const vi = hitTestVertex(d, pt, w, h);
        if (vi >= 0) {
          setDrag({ mode: 'vertex', index: vi, startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        if ((d.tool === 'line' || d.tool === 'region') && toolRef.current === d.tool) {
          setDrag({ mode: 'pending-add', startPt: pt, origPoints: d.points.map((p) => ({ ...p })), moved: false });
          canvasRef.current?.setPointerCapture?.(e.pointerId);
          return;
        }
        return; // must confirm/cancel
      }
      return;
    }

    const hit = findHitShape(pt);
    if (hit) {
      setSelectedId(hit.id || null);
      return;
    }
    setSelectedId(null);
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;

    const t = toolRef.current;
    if (t === 'point') {
      setDraft({ tool: 'point', points: [pt] });
    } else if (t === 'line' || t === 'region') {
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
      if (samMode && enableSamAssist) {
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
    if (!(samMode && enableSamAssist)) return;
    if (draftRef.current) {
      setSamError('Confirm or cancel the current draft first');
      return;
    }
    if (maxAnnotations > 0 && shapesRef.current.length >= maxAnnotations) return;
    const pt = canvasPoint(e);
    runSamAtPoint(pt);
  };

  const undo = () => {
    if (draftRef.current) {
      cancelDraft();
      return;
    }
    const next = shapesRef.current.slice(0, -1);
    setSelectedId(null);
    emitChange(next);
  };

  const clear = () => {
    setSelectedId(null);
    setDraft(null);
    setDrag(null);
    emitChange([]);
  };

  const deleteSelected = useCallback(() => {
    if (!selectedIdRef.current) return;
    const next = shapesRef.current.filter((s) => s.id !== selectedIdRef.current);
    setSelectedId(null);
    emitChange(next);
  }, [emitChange]);

  const updateSelectedLabel = (label) => {
    if (!selectedId) return;
    const next = shapes.map((s) => (s.id === selectedId ? { ...s, label: label || null } : s));
    emitChange(next);
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
        setSelectedId(null);
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
        if (selectedIdRef.current) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, confirmDraft, deleteSelected]);

  const selectedShape = shapes.find((s) => s.id === selectedId);
  const showDraftUi = !readOnly && !!draft?.points?.length && dims.w > 0 && !imgError;
  const confirmPos = showDraftUi ? draftCentroidPx(draft, dims.w, dims.h) : null;
  const canConfirm = draftReady(draft);

  const toolHint = (() => {
    if (draft) {
      if (draft.tool === 'line') return 'Click to add more points · drag vertices to edit · ✓ confirm · ✕ discard';
      if (draft.tool === 'region') return 'Click to add vertices · drag to edit · ✓ confirm (≥3) · ✕ discard';
      if (draft.tool === 'bbox') return 'Drag body to move · handles to resize · ✓ confirm · ✕ discard';
      if (draft.tool === 'point') return 'Drag to adjust · ✓ confirm · ✕ discard';
    }
    if (tool === 'point') return 'Click to place a point, then ✓ to confirm';
    if (tool === 'line') return 'Click to add polyline points, then ✓ to confirm (Esc cancels)';
    if (tool === 'region') return 'Click to add polygon vertices, then ✓ to confirm (no double-click)';
    if (tool === 'bbox') return 'Drag to draw a box, then ✓ to confirm';
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
          {/* Individual buttons wrap on phones; ButtonGroup does not */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {tools.includes('point') && (
              <Button size="small" variant={tool === 'point' ? 'contained' : 'outlined'} onClick={() => switchTool('point')}>Point</Button>
            )}
            {tools.includes('line') && (
              <Button size="small" variant={tool === 'line' ? 'contained' : 'outlined'} onClick={() => switchTool('line')}>Line</Button>
            )}
            {tools.includes('region') && (
              <Button size="small" variant={tool === 'region' ? 'contained' : 'outlined'} onClick={() => switchTool('region')}>Region</Button>
            )}
            {tools.includes('bbox') && (
              <Button size="small" variant={tool === 'bbox' ? 'contained' : 'outlined'} onClick={() => switchTool('bbox')}>Box</Button>
            )}
          </Box>
          <Button size="small" onClick={undo} disabled={!shapes.length && !draft}>Undo</Button>
          <Button size="small" color="error" onClick={clear} disabled={!shapes.length && !draft}>Clear</Button>
          <Button size="small" color="error" onClick={deleteSelected} disabled={!selectedId || !!draft}>Delete</Button>
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
          {enableSamAssist && (
            <Button
              size="small"
              variant={samMode ? 'contained' : 'outlined'}
              color="secondary"
              disabled={samBusy}
              onClick={() => { setSamMode((v) => !v); setDraft(null); setDrag(null); }}
            >
              {samBusy ? 'SAM…' : (samMode ? 'SAM on' : 'SAM')}
            </Button>
          )}
        </Box>
      )}
      {!readOnly && enableSamAssist && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
          <TextField
            size="small"
            label="SAM text prompt"
            placeholder="e.g. tree, building"
            value={samPrompt}
            onChange={(e) => setSamPrompt(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 200 }, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}
          />
          <Button size="small" variant="outlined" disabled={samBusy} onClick={runSamTextPrompt}>
            Segment prompt
          </Button>
          {samBusy && <CircularProgress size={18} />}
          {samMode && (
            <Typography variant="caption" color="text.secondary">
              Click for point · drag box tool for box · result stays editable until ✓ · Esc cancels
            </Typography>
          )}
          {samError && <Alert severity="warning" sx={{ py: 0 }} onClose={() => setSamError(null)}>{samError}</Alert>}
        </Box>
      )}
      {!readOnly && annotationLabels?.length > 0 && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 160 } }}>
            <InputLabel>Active label</InputLabel>
            <Select
              label="Active label"
              value={activeLabel || ''}
              onChange={(e) => setActiveLabel(e.target.value)}
            >
              {annotationLabels.map((lb) => (
                <MenuItem key={lb} value={lb}>{lb}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedShape && (
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 160 } }}>
              <InputLabel>Selected label</InputLabel>
              <Select
                label="Selected label"
                value={selectedShape.label || ''}
                onChange={(e) => updateSelectedLabel(e.target.value)}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {annotationLabels.map((lb) => (
                  <MenuItem key={lb} value={lb}>{lb}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {annotationLabels.map((lb) => (
              <Chip
                key={lb}
                size="small"
                label={lb}
                onClick={() => setActiveLabel(lb)}
                variant={activeLabel === lb ? 'filled' : 'outlined'}
                sx={{
                  borderColor: colorForLabel(lb),
                  bgcolor: activeLabel === lb ? colorForLabel(lb) : undefined,
                  color: activeLabel === lb ? '#fff' : undefined,
                }}
              />
            ))}
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
export function AnnotationOverlay({ imageUrl, annotations, width = 500, labelFilter = null }) {
  const canvasRef = useRef(null);
  const PARTICIPANT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    let cancelled = false;

    const drawAnnotations = (ctx, w, h) => {
      annotations.forEach((ann, pi) => {
        const color = PARTICIPANT_COLORS[pi % PARTICIPANT_COLORS.length];
        (ann.shapes || []).forEach((shape) => {
          if (labelFilter && shape.label !== labelFilter) return;
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
  }, [imageUrl, annotations, width, labelFilter]);

  return <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)' }} />;
}
