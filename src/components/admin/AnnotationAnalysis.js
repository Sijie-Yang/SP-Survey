import React, { useMemo, useContext, useRef, useEffect, useState } from 'react';
import {
  Box, Typography, Button, Stack, Chip, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { AnnotationOverlay, drawAnnotationShape, colorForLabel, inferShapeTool } from '../ImageAnnotationWidget';
import { ImageResolverContext } from './imageResolverContext';

function AggregateDensityOverlay({ imageUrl, annotations, width = 480, labelFilter = null }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
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
          const pts = shape.points || [];
          // For bbox, sample corners + center so density reflects the box area better
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
  }, [imageUrl, annotations, width, labelFilter]);

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Aggregate overlay — darker cells = more annotations in that area
      </Typography>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)' }} />
    </Box>
  );
}

/**
 * Group annotation answers by base image URL and render overlay + export.
 */
export default function AnnotationAnalysis({ answers, questionName, responses }) {
  const nameToUrl = useContext(ImageResolverContext);
  const [labelFilter, setLabelFilter] = useState('');

  const byImage = useMemo(() => {
    const isUrl = (s) => s && (s.startsWith('http') || s.startsWith('/') || s.startsWith('data:'));
    const map = {};
    answers.forEach(({ answer, shown_images }, idx) => {
      const ann = typeof answer === 'object' ? answer : null;
      if (!ann?.shapes?.length) return;
      let imgUrl = ann.image || shown_images?.[0] || 'unknown';
      if (!isUrl(imgUrl) && nameToUrl?.has(imgUrl)) imgUrl = nameToUrl.get(imgUrl);
      if (!map[imgUrl]) map[imgUrl] = [];
      map[imgUrl].push({ shapes: ann.shapes, participantIndex: idx });
    });
    return map;
  }, [answers, nameToUrl]);

  const allLabels = useMemo(() => {
    const set = new Set();
    Object.values(byImage).forEach((anns) => {
      anns.forEach((ann) => {
        (ann.shapes || []).forEach((s) => {
          if (s.label) set.add(s.label);
        });
      });
    });
    return [...set].sort();
  }, [byImage]);

  const exportAnnotationCsv = () => {
    const rows = [['participant_id', 'session_id', 'attempt_index', 'question', 'image', 'tool', 'label', 'points_json']];
    (responses || []).forEach((row) => {
      const qData = row.responses?.[questionName];
      const ann = qData?.answer || qData;
      if (!ann?.shapes) return;
      const img = ann.image || '';
      ann.shapes.forEach((shape) => {
        if (labelFilter && shape.label !== labelFilter) return;
        rows.push([
          row.participant_id || '',
          row.survey_metadata?.session_id || '',
          row.survey_metadata?.attempt_index ?? '',
          questionName,
          img.split('/').pop(),
          shape.tool,
          shape.label || '',
          JSON.stringify(shape.points),
        ]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAnnotationJson = () => {
    const payload = (responses || []).map((row) => ({
      participant_id: row.participant_id,
      session_id: row.survey_metadata?.session_id,
      attempt_index: row.survey_metadata?.attempt_index,
      annotation: row.responses?.[questionName]?.answer || row.responses?.[questionName],
    })).filter((r) => r.annotation?.shapes?.length);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const imageKeys = Object.keys(byImage);
  if (!imageKeys.length) {
    return <Typography variant="body2" color="text.secondary">No annotation data yet.</Typography>;
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <Button size="small" variant="outlined" onClick={exportAnnotationCsv}>Export CSV</Button>
        <Button size="small" variant="outlined" onClick={exportAnnotationJson}>Export JSON</Button>
        {allLabels.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Filter label</InputLabel>
            <Select
              label="Filter label"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
            >
              <MenuItem value="">All labels</MenuItem>
              {allLabels.map((lb) => (
                <MenuItem key={lb} value={lb}>{lb}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {allLabels.map((lb) => (
          <Chip
            key={lb}
            size="small"
            label={lb}
            onClick={() => setLabelFilter(labelFilter === lb ? '' : lb)}
            variant={labelFilter === lb ? 'filled' : 'outlined'}
            sx={{
              borderColor: colorForLabel(lb),
              bgcolor: labelFilter === lb ? colorForLabel(lb) : undefined,
              color: labelFilter === lb ? '#fff' : undefined,
            }}
          />
        ))}
      </Stack>
      {imageKeys.map((imgUrl) => (
        <Box key={imgUrl} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {imgUrl.split('/').pop()}
            <Chip size="small" label={`${byImage[imgUrl].length} participant(s)`} sx={{ ml: 1 }} />
          </Typography>
          {byImage[imgUrl].length > 1 && (
            <AggregateDensityOverlay
              imageUrl={imgUrl}
              annotations={byImage[imgUrl]}
              width={480}
              labelFilter={labelFilter || null}
            />
          )}
          <AnnotationOverlay
            imageUrl={imgUrl}
            annotations={byImage[imgUrl]}
            width={480}
            labelFilter={labelFilter || null}
          />
        </Box>
      ))}
    </Box>
  );
}
