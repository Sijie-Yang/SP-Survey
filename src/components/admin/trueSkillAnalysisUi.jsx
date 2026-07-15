/** Shared TrueSkill analysis UI (imagepicker, ranking, MaxDiff, …). */

import React, { useContext, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
} from '@mui/material';
import Download from '@mui/icons-material/Download';
import { ImageResolverContext } from './imageResolverContext';
import { DensityHistogramChart } from './analysisCharts';
import { downloadTextFile } from '../../lib/methodsExport';

export const TRUESKILL_SORT_COLUMNS = [
  { id: 'mu', label: 'μ', align: 'right' },
  { id: 'muStd5', label: 'Std. μ (0–5)', align: 'right' },
  { id: 'sigma', label: 'σ', align: 'right' },
  { id: 'conservative', label: 'μ−3σ', align: 'right' },
  { id: 'games', label: 'Games', align: 'right' },
];

export const RANKING_EXTRA_COLUMNS = [
  { id: 'avgRank', label: 'Avg rank', align: 'right' },
  { id: 'rankSd', label: 'Rank SD', align: 'right' },
  { id: 'borda', label: 'Borda', align: 'right' },
  { id: 'nRanks', label: 'n', align: 'right' },
];

export const MAXDIFF_EXTRA_COLUMNS = [
  { id: 'bws', label: 'BWS', align: 'right' },
  { id: 'scoreStd5', label: 'BWS std (0–5)', align: 'right' },
  { id: 'best', label: 'Best', align: 'right' },
  { id: 'worst', label: 'Worst', align: 'right' },
  { id: 'appearances', label: 'Appearances', align: 'right' },
];

const INT_COLS = new Set([
  'games', 'nRanks', 'wins', 'losses', 'best', 'worst', 'appearances',
]);
const ASC_DEFAULT_COLS = new Set(['avgRank', 'imageKey']);

export function compareTrueSkillRows(a, b, orderBy, order) {
  const av = a[orderBy];
  const bv = b[orderBy];
  if (av == null && bv == null) return String(a.imageKey).localeCompare(String(b.imageKey));
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string' || typeof bv === 'string') {
    const cmp = String(av).localeCompare(String(bv));
    return order === 'asc' ? cmp : -cmp;
  }
  if (av === bv) return String(a.imageKey).localeCompare(String(b.imageKey));
  const cmp = av < bv ? -1 : 1;
  return order === 'asc' ? cmp : -cmp;
}

export function TrueSkillMuChart({ rankings }) {
  if (!rankings?.length) return null;
  const scores = rankings.map((r) => r.muStd5 ?? 0);
  return (
    <DensityHistogramChart
      scores={scores}
      domainMin={0}
      domainMax={5}
      title="Standardized μ distribution (0–5)"
      caption="Blue bars: histogram of standardized μ (density = count / n / bin width). Orange curve: fitted normal PDF."
      xLabel="Standardized μ (0–5)"
      padB={36}
    />
  );
}

export function TrueSkillTable({
  rankings,
  onExport,
  caption,
  columns = TRUESKILL_SORT_COLUMNS,
  title = 'TrueSkill image rankings',
}) {
  const resolvedUrl = useContext(ImageResolverContext);
  const [orderBy, setOrderBy] = useState('mu');
  const [order, setOrder] = useState('desc');

  const sorted = useMemo(() => {
    if (!rankings?.length) return [];
    return [...rankings].sort((a, b) => compareTrueSkillRows(a, b, orderBy, order));
  }, [rankings, orderBy, order]);

  if (!rankings?.length) return null;

  const resolveImg = (row) => {
    if (row.displayUrl) return row.displayUrl;
    const key = row.imageKey;
    if (key?.startsWith('http') || key?.startsWith('/')) return key;
    return resolvedUrl?.get(key) || null;
  };

  const handleSort = (colId) => {
    if (orderBy === colId) {
      setOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setOrderBy(colId);
    setOrder(ASC_DEFAULT_COLS.has(colId) ? 'asc' : 'desc');
  };

  const formatCell = (colId, row) => {
    const v = row[colId];
    if (v == null || Number.isNaN(v)) return '—';
    if (INT_COLS.has(colId)) return String(v);
    return Number(v).toFixed(2);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{title}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {caption || 'Click a column header to sort (default: μ descending).'}
          </Typography>
        </Box>
        {onExport && (
          <Button size="small" variant="outlined" startIcon={<Download />} onClick={onExport} sx={{ flexShrink: 0 }}>
            Export scores CSV
          </Button>
        )}
      </Box>
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell sortDirection={orderBy === 'imageKey' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'imageKey'}
                  direction={orderBy === 'imageKey' ? order : 'asc'}
                  onClick={() => handleSort('imageKey')}
                >
                  Image
                </TableSortLabel>
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align}
                  sortDirection={orderBy === col.id ? order : false}
                >
                  <TableSortLabel
                    active={orderBy === col.id}
                    direction={orderBy === col.id ? order : (col.id === 'avgRank' ? 'asc' : 'desc')}
                    onClick={() => handleSort(col.id)}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((row, idx) => (
              <TableRow key={row.imageKey}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {resolveImg(row) && (
                      <Box
                        component="img"
                        src={resolveImg(row)}
                        alt={row.imageKey}
                        sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5 }}
                      />
                    )}
                    <Typography variant="caption">{row.imageKey}</Typography>
                  </Box>
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col.id} align={col.align}>
                    {formatCell(col.id, row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function exportTrueSkillCsv(questionName, rankings, orderBy = 'mu', order = 'desc', extraHeaders = []) {
  const sorted = [...(rankings || [])].sort((a, b) => compareTrueSkillRows(a, b, orderBy, order));
  const headers = [
    'rank', 'image',
    ...extraHeaders.map((h) => h.id),
    'mu', 'mu_std5', 'sigma', 'conservative', 'wins', 'losses', 'games',
  ];
  const rows = sorted.map((r, idx) => [
    idx + 1,
    r.imageKey,
    ...extraHeaders.map((h) => {
      const v = r[h.id];
      if (v == null || Number.isNaN(v)) return '';
      return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : v;
    }),
    r.mu?.toFixed(4) ?? '',
    (r.muStd5 ?? 0).toFixed(4),
    r.sigma?.toFixed(4) ?? '',
    r.conservative?.toFixed(4) ?? '',
    r.wins ?? '',
    r.losses ?? '',
    r.games ?? '',
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadTextFile(csv, `${questionName}_trueskill_${new Date().toISOString().slice(0, 10)}.csv`);
}
