/**
 * Skill resultSchema field analyses for types beyond spatial/allocation/rankedList.
 * Reuses preset skillAnalysis UIs where answer shapes match (pairwise, MaxDiff, video).
 */
import React, { useMemo } from 'react';
import { Alert, Box, Chip, Typography } from '@mui/material';
import { average, pct } from '../../lib/stats';
import {
  PairwisePreferenceAnalysis,
  ForcedChoicePreferenceAnalysis,
  MaxDiffAnalysis,
  VideoMomentAnalysis,
  ContinuousVideoRatingAnalysis,
} from './skillAnalysis';

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function remapFieldAnswers(answers, fieldKey, mapFn) {
  return (answers || []).map((entry) => {
    const root = (entry.answer && typeof entry.answer === 'object' && !Array.isArray(entry.answer))
      ? entry.answer
      : {};
    const raw = getPath(root, fieldKey);
    if (raw === undefined || raw === null) return null;
    const answer = mapFn(raw, root, entry);
    if (answer == null) return null;
    return { ...entry, answer };
  }).filter(Boolean);
}

function filenameKey(val) {
  if (!val || typeof val !== 'string') return String(val ?? '');
  return val.split('?')[0].split('/').pop() || val;
}

function resolveIndex(val, shown) {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const key = filenameKey(String(val));
  const list = Array.isArray(shown) ? shown : [];
  const idx = list.findIndex((s) => {
    const u = typeof s === 'string' ? s : (s?.url || s?.name || '');
    return filenameKey(u) === key || u === val;
  });
  return idx >= 0 ? idx : null;
}

/** checkbox / multi-select → frequency bars */
export function MultiChoiceFieldSummary({ field, answers }) {
  const counts = useMemo(() => {
    const map = {};
    let n = 0;
    for (const entry of answers || []) {
      const raw = getPath(entry.answer, field.key);
      if (!Array.isArray(raw) || !raw.length) continue;
      n += 1;
      raw.forEach((item) => {
        const k = String(item);
        map[k] = (map[k] || 0) + 1;
      });
    }
    const rows = Object.entries(map)
      .map(([val, count]) => ({ val, count }))
      .sort((a, b) => b.count - a.count);
    return { rows, n };
  }, [answers, field.key]);

  if (!counts.rows.length) {
    return <Typography variant="body2" color="text.secondary">No multi-choice data.</Typography>;
  }
  const max = counts.rows[0].count || 1;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Multi-select frequency · n={counts.n} responses
      </Typography>
      {counts.rows.map(({ val, count }) => (
        <Box key={val} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography variant="body2" sx={{ width: 160, flexShrink: 0 }} noWrap>{val}</Typography>
          <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${pct(count, max)}%`, bgcolor: 'primary.main' }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 90, textAlign: 'right' }}>
            {count} ({pct(count, counts.n)}%)
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** matrix / imagematrix cell frequencies */
export function MatrixFieldSummary({ field, answers }) {
  const { cells, n } = useMemo(() => {
    const map = {};
    let responses = 0;
    for (const entry of answers || []) {
      const raw = getPath(entry.answer, field.key);
      if (raw == null) continue;
      let touched = false;
      if (Array.isArray(raw)) {
        raw.forEach((c) => {
          if (!c || typeof c !== 'object') return;
          const row = String(c.row ?? c.row_key ?? c.rowKey ?? '');
          const col = String(c.column ?? c.col ?? c.value ?? '');
          if (!row && !col) return;
          const key = `${row}||${col}`;
          map[key] = (map[key] || 0) + 1;
          touched = true;
        });
      } else if (typeof raw === 'object') {
        Object.entries(raw).forEach(([row, col]) => {
          const key = `${row}||${String(col)}`;
          map[key] = (map[key] || 0) + 1;
          touched = true;
        });
      }
      if (touched) responses += 1;
    }
    const rows = Object.entries(map)
      .map(([key, count]) => {
        const [row, col] = key.split('||');
        return { row, col, count };
      })
      .sort((a, b) => b.count - a.count);
    return { cells: rows, n: responses };
  }, [answers, field.key]);

  if (!cells.length) {
    return <Typography variant="body2" color="text.secondary">No matrix data.</Typography>;
  }
  const max = cells[0].count || 1;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Matrix cell frequency · n={n} responses
      </Typography>
      {cells.slice(0, 40).map(({ row, col, count }) => (
        <Box key={`${row}-${col}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography variant="body2" sx={{ width: 200, flexShrink: 0 }} noWrap>
            {row} → {col}
          </Typography>
          <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${pct(count, max)}%`, bgcolor: 'secondary.main' }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>
            {count}
          </Typography>
        </Box>
      ))}
      {cells.length > 40 && (
        <Alert severity="info" sx={{ mt: 1 }}>Showing top 40 of {cells.length} cells.</Alert>
      )}
    </Box>
  );
}

/** imagepicker / mediapicker single choice */
export function MediaChoiceFieldSummary({ field, answers }) {
  const { rows, n } = useMemo(() => {
    const map = {};
    let responses = 0;
    for (const entry of answers || []) {
      const raw = getPath(entry.answer, field.key);
      if (raw == null || raw === '') continue;
      responses += 1;
      const key = filenameKey(String(raw));
      if (!map[key]) map[key] = { key, url: String(raw), count: 0 };
      map[key].count += 1;
      if (String(raw).startsWith('http') || String(raw).startsWith('/')) map[key].url = String(raw);
    }
    return {
      n: responses,
      rows: Object.values(map).sort((a, b) => b.count - a.count),
    };
  }, [answers, field.key]);

  if (!rows.length) {
    return <Typography variant="body2" color="text.secondary">No media choice data.</Typography>;
  }
  const max = rows[0].count || 1;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Media pick frequency · n={n}
      </Typography>
      {rows.map(({ key, url, count }, idx) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Chip size="small" label={`#${idx + 1}`} color={idx === 0 ? 'primary' : 'default'} sx={{ width: 44 }} />
          {(url.startsWith('http') || url.startsWith('/')) ? (
            <Box
              component="img"
              src={url}
              alt=""
              sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
            />
          ) : null}
          <Typography variant="body2" sx={{ width: 140, flexShrink: 0 }} noWrap>{key}</Typography>
          <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${pct(count, max)}%`, bgcolor: 'primary.main' }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 90, textAlign: 'right' }}>
            {count} ({pct(count, n)}%)
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function TimeRangesFieldSummary({ field, answers }) {
  const remapped = useMemo(() => remapFieldAnswers(answers, field.key, (raw, root) => {
    const segments = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' ? (raw.segments || raw.ranges || []) : []);
    if (!Array.isArray(segments) || !segments.length) return null;
    const norm = segments.map((s) => ({
      start: Number(s.start ?? s.begin),
      end: Number(s.end ?? s.stop ?? s.start ?? s.begin),
      label: s.label,
    })).filter((s) => Number.isFinite(s.start));
    if (!norm.length) return null;
    const duration = Number(
      (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.duration : null)
      ?? root.duration,
    );
    return {
      ...root,
      ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}),
      segments: norm,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      videoUrl: (raw && raw.videoUrl) || root.videoUrl || root.imageUrl || root.mediaUrl,
    };
  }), [answers, field.key]);

  if (!remapped.length) {
    return <Typography variant="body2" color="text.secondary">No time-range data.</Typography>;
  }
  return <VideoMomentAnalysis answers={remapped} questionName={field.label || field.key} />;
}

export function TimeSeriesFieldSummary({ field, answers }) {
  const remapped = useMemo(() => remapFieldAnswers(answers, field.key, (raw, root) => {
    const samples = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' ? (raw.samples || raw.series || []) : []);
    if (!Array.isArray(samples) || !samples.length) return null;
    const norm = samples.map((s) => ({
      t: Number(s.t ?? s.time),
      v: Number(s.v ?? s.value),
    })).filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v));
    if (!norm.length) return null;
    const mean = Number(
      (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.mean : null)
      ?? average(norm.map((s) => s.v)),
    );
    return {
      ...root,
      ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}),
      samples: norm,
      mean: Number.isFinite(mean) ? mean : undefined,
      videoUrl: (raw && raw.videoUrl) || root.videoUrl || root.imageUrl || root.mediaUrl,
    };
  }), [answers, field.key]);

  if (!remapped.length) {
    return <Typography variant="body2" color="text.secondary">No time-series data.</Typography>;
  }
  return <ContinuousVideoRatingAnalysis answers={remapped} questionName={field.label || field.key} />;
}

export function PairwiseFieldSummary({ field, answers }) {
  const remapped = useMemo(() => remapFieldAnswers(answers, field.key, (raw, root) => {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { ...root, preference: raw };
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const preference = Number(raw.preference ?? raw.score ?? raw.value);
      return {
        ...root,
        ...raw,
        preference: Number.isFinite(preference) ? preference : raw.preference,
        imageA: raw.imageA || root.imageA,
        imageB: raw.imageB || root.imageB,
      };
    }
    return null;
  }), [answers, field.key]);

  if (!remapped.length) {
    return <PairwiseChoiceFieldSummary field={field} answers={answers} />;
  }
  return <PairwisePreferenceAnalysis answers={remapped} />;
}

export function PairwiseChoiceFieldSummary({ field, answers }) {
  const remapped = useMemo(() => remapFieldAnswers(answers, field.key, (raw, root, entry) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const pair = [raw.left ?? raw.imageA, raw.right ?? raw.imageB].filter(Boolean);
    const shownUrls = raw.shownUrls?.length
      ? raw.shownUrls
      : (pair.length ? pair : (entry.shown_images || []));
    let chosenIndex = raw.chosenIndex;
    const winner = raw.winner ?? raw.choice;
    if (chosenIndex == null && (winner === 'A' || winner === 'B')) chosenIndex = winner === 'A' ? 0 : 1;
    if (chosenIndex == null) chosenIndex = resolveIndex(winner, shownUrls);
    if (chosenIndex == null) return null;
    return { ...root, ...raw, shownUrls, chosenIndex, choice: chosenIndex === 0 ? 'A' : 'B' };
  }), [answers, field.key]);
  if (!remapped.length) {
    return <Typography variant="body2" color="text.secondary">No forced-choice pair data.</Typography>;
  }
  return <ForcedChoicePreferenceAnalysis answers={remapped} question={{ name: field.key }} />;
}

export function BestWorstFieldSummary({ field, answers }) {
  const remapped = useMemo(() => remapFieldAnswers(answers, field.key, (raw, root, entry) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const shown = entry.shown_images?.length
      ? entry.shown_images
      : (raw.shownUrls || root.shownUrls || root.shown_images || []);
    let bestIndex = raw.bestIndex;
    let worstIndex = raw.worstIndex;
    if (bestIndex == null) bestIndex = resolveIndex(raw.best ?? raw.bestUrl, shown);
    if (worstIndex == null) worstIndex = resolveIndex(raw.worst ?? raw.worstUrl, shown);
    if (bestIndex == null || worstIndex == null) return null;
    return {
      ...root,
      ...raw,
      bestIndex,
      worstIndex,
      shownUrls: raw.shownUrls || shown,
    };
  }), [answers, field.key]);

  if (!remapped.length) {
    return <Typography variant="body2" color="text.secondary">No best/worst data.</Typography>;
  }
  return <MaxDiffAnalysis answers={remapped} mediaCount={4} />;
}
