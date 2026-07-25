import React, { useMemo, useState } from 'react';
import { Alert, Box, Typography, Tabs, Tab, Chip } from '@mui/material';
import AggregateDensityOverlay from './AggregateDensityOverlay';
import { average, pct } from '../../lib/stats';
import { computeBordaScores, kendallW, interpretKendallW } from '../../lib/rankingStats';
import { canonicalizeSkillResultType } from '../../lib/skillResultTypes';
import {
  MultiChoiceFieldSummary,
  MatrixFieldSummary,
  MediaChoiceFieldSummary,
  TimeRangesFieldSummary,
  TimeSeriesFieldSummary,
  PairwiseFieldSummary,
  PairwiseChoiceFieldSummary,
  BestWorstFieldSummary,
} from './skillFieldAnalyses';

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function stimulusUrlFromAnswer(answer, entry) {
  if (!answer || typeof answer !== 'object') return '';
  const direct = answer.imageUrl || answer.image_url || answer.videoUrl || answer.mediaUrl;
  if (typeof direct === 'string' && direct) return direct;
  const shown = entry?.shown_images || answer.shown_images || answer.shownImages;
  if (Array.isArray(shown) && shown[0]) {
    const first = shown[0];
    return typeof first === 'string' ? first : (first.url || first.src || '');
  }
  return '';
}

function shortName(url) {
  if (!url) return 'Stimulus';
  try {
    const u = String(url).split('?')[0];
    return u.split('/').pop() || u;
  } catch {
    return String(url).slice(0, 40);
  }
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = Number(pts[i].x) - Number(pts[i - 1].x);
    const dy = Number(pts[i].y) - Number(pts[i - 1].y);
    if (Number.isFinite(dx) && Number.isFinite(dy)) len += Math.hypot(dx, dy);
  }
  return len;
}

function pathDirectness(pts) {
  if (!pts || pts.length < 2) return null;
  const len = pathLength(pts);
  if (len <= 0) return null;
  const dx = Number(pts[pts.length - 1].x) - Number(pts[0].x);
  const dy = Number(pts[pts.length - 1].y) - Number(pts[0].y);
  const chord = Math.hypot(dx, dy);
  return chord / len;
}

function normalizeXy(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    ...(p.t != null ? { t: Number(p.t) } : {}),
    ...(p.label != null ? { label: String(p.label) } : {}),
  };
}

/** Expand a skill spatial field into annotation shapes (point/line/polygon/bbox). */
function shapesFromSpatialValue(raw, mode, fieldLabel) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const tool = mode === 'path' ? 'line'
    : mode === 'polygon' ? 'polygon'
      : mode === 'bbox' ? 'bbox'
        : 'point';

  // Multi-shape: [[{x,y}…], …] or [{ points:[{x,y}…], label? }, …]
  if (raw.some((item) => Array.isArray(item) || (item && Array.isArray(item.points)))) {
    return raw.map((item) => {
      const pts = (Array.isArray(item) ? item : item.points || [])
        .map(normalizeXy)
        .filter(Boolean);
      if (mode === 'polygon' && pts.length < 3) return null;
      if ((mode === 'path' || mode === 'bbox') && pts.length < 2) return null;
      if (mode === 'points' && !pts.length) return null;
      if (mode === 'points') {
        return pts.map((p) => ({
          tool: 'point',
          points: [{ x: p.x, y: p.y }],
          label: p.label || item.label || fieldLabel,
        }));
      }
      const usePts = mode === 'bbox' ? [pts[0], pts[1]] : pts;
      return [{
        tool,
        points: usePts,
        label: (!Array.isArray(item) && item.label) || fieldLabel,
      }];
    }).flat().filter(Boolean);
  }

  const pts = raw.map(normalizeXy).filter(Boolean);
  if (mode === 'points') {
    return pts.map((p) => ({
      tool: 'point',
      points: [{ x: p.x, y: p.y }],
      label: p.label || fieldLabel,
    }));
  }
  if (mode === 'path' && pts.length >= 2) {
    return [{ tool: 'line', points: pts, label: fieldLabel }];
  }
  if (mode === 'polygon' && pts.length >= 3) {
    return [{ tool: 'polygon', points: pts, label: fieldLabel }];
  }
  if (mode === 'bbox' && pts.length >= 2) {
    return [{ tool: 'bbox', points: [pts[0], pts[1]], label: fieldLabel }];
  }
  return [];
}

const SPATIAL_CAPTIONS = {
  points: 'Point density overlay — darker cells = more clicks (annotation point)',
  path: 'Path overlay — darker cells = more vertices nearby (annotation line)',
  polygon: 'Polygon overlay — regions drawn on the stimulus (annotation polygon)',
  bbox: 'Bounding-box overlay — boxes on the stimulus (annotation bbox)',
};

/** Annotation-family fields → AggregateDensityOverlay, tabs per stimulus image. */
function SpatialFieldSummary({ field, answers, mode }) {
  const [tab, setTab] = useState(0);
  const byImage = useMemo(() => {
    const map = {};
    const lengths = [];
    const directness = [];
    answers.forEach((entry) => {
      const raw = getPath(entry.answer, field.key);
      const shapes = shapesFromSpatialValue(raw, mode, field.label || field.key);
      if (!shapes.length) return;
      if (mode === 'path') {
        shapes.forEach((s) => {
          const pts = s.points || [];
          if (pts.length >= 2) {
            lengths.push(pathLength(pts));
            const d = pathDirectness(pts);
            if (d != null) directness.push(d);
          }
        });
      }
      const url = stimulusUrlFromAnswer(entry.answer, entry) || '__none__';
      if (!map[url]) map[url] = [];
      map[url].push({ shapes });
    });
    return { map, lengths, directness };
  }, [answers, field, mode]);

  const urls = Object.keys(byImage.map);
  if (!urls.length) {
    return <Typography variant="body2" color="text.secondary">No spatial data.</Typography>;
  }
  const safeTab = Math.min(tab, urls.length - 1);
  const activeUrl = urls[safeTab];
  const annotations = byImage.map[activeUrl] || [];
  const labels = [...new Set(annotations.flatMap((a) => (a.shapes || []).map((s) => s.label).filter(Boolean)))];

  return (
    <Box>
      {mode === 'path' && byImage.lengths.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Mean path length (norm): {average(byImage.lengths)?.toFixed(3) ?? '—'}
          {byImage.directness.length > 0
            ? ` · Mean directness: ${average(byImage.directness)?.toFixed(3) ?? '—'}`
            : ''}
          {' '}· n={byImage.lengths.length}
        </Typography>
      )}
      {urls.length > 1 && (
        <Tabs
          value={safeTab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontSize: 12 } }}
        >
          {urls.map((u) => (
            <Tab key={u} label={`${shortName(u)} (${byImage.map[u].length})`} />
          ))}
        </Tabs>
      )}
      {activeUrl !== '__none__' ? (
        <AggregateDensityOverlay
          imageUrl={activeUrl}
          annotations={annotations}
          caption={SPATIAL_CAPTIONS[mode] || SPATIAL_CAPTIONS.points}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No imageUrl on answers — showing counts only (add imageUrl in SPSkill.setAnswer).
        </Typography>
      )}
      {labels.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {labels.map((lb) => {
            const count = annotations.reduce(
              (n, a) => n + (a.shapes || []).filter((s) => s.label === lb).length,
              0,
            );
            return <Chip key={lb} size="small" label={`${lb} × ${count}`} />;
          })}
        </Box>
      )}
    </Box>
  );
}

function AllocationFieldSummary({ field, answers }) {
  const stats = useMemo(() => {
    const totals = {};
    let n = 0;
    answers.forEach((entry) => {
      const raw = getPath(entry.answer, field.key);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      n += 1;
      Object.entries(raw).forEach(([k, v]) => {
        const num = Number(v);
        if (!Number.isFinite(num)) return;
        if (!totals[k]) totals[k] = [];
        totals[k].push(num);
      });
    });
    const rows = Object.entries(totals).map(([key, vals]) => ({
      key,
      mean: average(vals) ?? 0,
      sd: vals.length > 1
        ? Math.sqrt(vals.reduce((s, v) => s + (v - (average(vals) ?? 0)) ** 2, 0) / vals.length)
        : 0,
      n: vals.length,
    })).sort((a, b) => b.mean - a.mean);
    return { rows, n };
  }, [answers, field.key]);

  if (!stats.rows.length) {
    return <Typography variant="body2" color="text.secondary">No allocation data.</Typography>;
  }
  const maxMean = Math.max(...stats.rows.map((r) => r.mean), 1);
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Mean allocation per item · n={stats.n}
      </Typography>
      {stats.rows.map((r) => (
        <Box key={r.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography variant="caption" sx={{ width: 140, flexShrink: 0 }} noWrap>{r.key}</Typography>
          <Box sx={{ flex: 1, height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ width: `${(r.mean / maxMean) * 100}%`, height: '100%', bgcolor: 'primary.main' }} />
          </Box>
          <Typography variant="caption" fontWeight={700} sx={{ width: 110, textAlign: 'right' }}>
            {r.mean.toFixed(1)} ± {r.sd.toFixed(1)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function RankedListFieldSummary({ field, answers }) {
  const { sorted, w, nLists } = useMemo(() => {
    const rankPositions = {};
    const rankingLists = [];
    answers.forEach((entry) => {
      const raw = getPath(entry.answer, field.key);
      if (!Array.isArray(raw) || !raw.length) return;
      const ranked = raw.map((x) => String(x));
      rankingLists.push(ranked);
      ranked.forEach((val, idx) => {
        if (!rankPositions[val]) rankPositions[val] = [];
        rankPositions[val].push(idx + 1);
      });
    });
    const items = Object.keys(rankPositions);
    const bordaMap = computeBordaScores(rankPositions, items.length);
    const sortedRows = Object.entries(rankPositions)
      .map(([val, ranks]) => ({
        val,
        avg: average(ranks),
        sd: ranks.length > 1
          ? Math.sqrt(ranks.reduce((s, r) => s + (r - (average(ranks) ?? 0)) ** 2, 0) / ranks.length)
          : 0,
        borda: bordaMap[val]?.borda,
        n: ranks.length,
      }))
      .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
    return {
      sorted: sortedRows,
      w: kendallW(rankingLists, items),
      nLists: rankingLists.length,
    };
  }, [answers, field.key]);

  if (!sorted.length) {
    return <Typography variant="body2" color="text.secondary">No ranking data.</Typography>;
  }
  const maxRank = sorted.length;
  return (
    <Box>
      {w != null && (
        <Alert severity={w >= 0.5 ? 'success' : 'info'} sx={{ mb: 1 }}>
          Kendall&apos;s W = {w.toFixed(3)} — {interpretKendallW(w)} · n={nLists}
        </Alert>
      )}
      {sorted.map(({ val, avg, sd, borda, n }, idx) => (
        <Box key={val} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Chip size="small" label={`#${idx + 1}`} color={idx === 0 ? 'primary' : 'default'} sx={{ width: 44 }} />
          <Typography variant="body2" sx={{ width: 160, flexShrink: 0 }} noWrap>{val}</Typography>
          <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%',
                width: `${pct(maxRank - (avg ?? maxRank) + 1, maxRank)}%`,
                bgcolor: 'primary.main',
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 150, textAlign: 'right' }}>
            avg {avg?.toFixed(2) ?? '–'} ±{sd?.toFixed(2)} · Borda {borda?.toFixed(1)} · n={n}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Render skill resultSchema fields that map onto native analyses.
 * Returns null when field.type is not an archetype (caller handles legacy types).
 */
export default function SkillArchetypeFieldSummary({ field, answers }) {
  const t = canonicalizeSkillResultType(field.type);
  if (t === 'points' || t === 'path' || t === 'polygon' || t === 'bbox') {
    return <SpatialFieldSummary field={field} answers={answers} mode={t} />;
  }
  if (t === 'allocation') {
    return <AllocationFieldSummary field={field} answers={answers} />;
  }
  if (t === 'rankedList' || t === 'mediaRankedList') {
    return <RankedListFieldSummary field={field} answers={answers} />;
  }
  if (t === 'multiChoice') return <MultiChoiceFieldSummary field={field} answers={answers} />;
  if (t === 'matrix') return <MatrixFieldSummary field={field} answers={answers} />;
  if (t === 'mediaChoice') return <MediaChoiceFieldSummary field={field} answers={answers} />;
  if (t === 'timeRanges') return <TimeRangesFieldSummary field={field} answers={answers} />;
  if (t === 'timeSeries') return <TimeSeriesFieldSummary field={field} answers={answers} />;
  if (t === 'pairwise' || t === 'pairwisePreference') return <PairwiseFieldSummary field={field} answers={answers} />;
  if (t === 'pairwiseChoice') return <PairwiseChoiceFieldSummary field={field} answers={answers} />;
  if (t === 'bestWorst') return <BestWorstFieldSummary field={field} answers={answers} />;
  return null;
}

export { getPath as getSkillFieldPath, stimulusUrlFromAnswer };
