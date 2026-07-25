import React, { useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { drawAnnotationShape, colorForLabel, inferShapeTool } from '../ImageAnnotationWidget';
import { normalizeAnnotationTool } from '../../lib/annotationTools';

/**
 * Shared density + shape overlay used by AnnotationAnalysis and skill points/path fields.
 */
export default function AggregateDensityOverlay({
  imageUrl, annotations, width = 480, labelFilter = null, toolFilter = null,
  caption = 'Aggregate overlay — darker cells = more annotations in that area',
}) {
  const canvasRef = useRef(null);
  const toolFilterNorm = toolFilter ? normalizeAnnotationTool(toolFilter) : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return undefined;
    let cancelled = false;

    const draw = (img) => {
      if (cancelled) return;
      const aspect = img ? img.height / img.width : 0.625;
      const w = width;
      const h = Math.round(w * aspect);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (img) ctx.drawImage(img, 0, 0, w, h);
      else { ctx.fillStyle = '#eceff1'; ctx.fillRect(0, 0, w, h); }

      const grid = {};
      const cell = 12;
      annotations.forEach((ann) => {
        (ann.shapes || []).forEach((shape) => {
          if (labelFilter && shape.label !== labelFilter) return;
          const tool = inferShapeTool(shape);
          if (toolFilterNorm && tool !== toolFilterNorm) return;
          const pts = shape.points || [];
          const samplePts = tool === 'bbox' && pts.length >= 2
            ? [
              pts[0],
              pts[1],
              { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
            ]
            : pts;
          samplePts.forEach((p) => {
            const gx = Math.floor((p.x * w) / cell);
            const gy = Math.floor((p.y * h) / cell);
            const key = `${gx},${gy}`;
            grid[key] = (grid[key] || 0) + 1;
          });
        });
      });
      const max = Math.max(...Object.values(grid), 1);
      Object.entries(grid).forEach(([key, count]) => {
        const [gx, gy] = key.split(',').map(Number);
        const alpha = 0.15 + 0.65 * (count / max);
        ctx.fillStyle = `rgba(25, 118, 210, ${alpha})`;
        ctx.fillRect(gx * cell, gy * cell, cell, cell);
      });

      annotations.forEach((ann, pi) => {
        const color = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'][pi % 6];
        (ann.shapes || []).forEach((shape) => {
          if (labelFilter && shape.label !== labelFilter) return;
          if (toolFilterNorm && inferShapeTool(shape) !== toolFilterNorm) return;
          drawAnnotationShape(ctx, shape, w, h, {
            color: shape.label ? colorForLabel(shape.label, color) : color,
            alpha: 0.55,
            fillAlpha: 0.22,
          });
        });
      });
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => draw(img);
    img.onerror = () => draw(null);
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, annotations, width, labelFilter, toolFilterNorm]);

  return (
    <Box sx={{ mb: 1 }}>
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {caption}
        </Typography>
      )}
      <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)' }} />
    </Box>
  );
}
