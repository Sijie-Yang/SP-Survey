import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  average,
  normalPdf,
  buildScoreHistogram,
  histogramBinCount,
  descriptiveStats,
} from '../../lib/stats';

const BAR_COLORS = [
  '#1976d2', '#2196f3', '#0288d1', '#0097a7', '#00838f',
  '#388e3c', '#689f38', '#f57c00', '#e64a19', '#7b1fa2',
];

export function DescriptiveStatsLine({ nums, unit = '' }) {
  const s = descriptiveStats(nums);
  if (!s.n) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
      n={s.n} · mean={s.mean?.toFixed(2)}{unit} · SD={s.sd?.toFixed(2)} · median={s.median?.toFixed(2)} · range {s.min}–{s.max}
    </Typography>
  );
}

export function DensityHistogramChart({
  scores,
  domainMin = 0,
  domainMax = 5,
  title,
  caption,
  xLabel,
  bottomMarkers,
  chartW = 560,
  chartH = 280,
  padB = 88,
}) {
  if (!scores?.length) return null;

  const meanS = average(scores);
  const stdS = Math.sqrt(scores.reduce((s, v) => s + (v - meanS) ** 2, 0) / scores.length) || 0.5;
  const binCount = histogramBinCount(scores.length);
  const bins = buildScoreHistogram(scores, binCount, domainMin, domainMax);
  const span = domainMax - domainMin;

  const padL = 52;
  const padR = 16;
  const padT = 16;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const yBase = padT + plotH;

  const xAt = (s) => padL + ((s - domainMin) / span) * plotW;

  const curveSteps = 120;
  let maxPdf = 0;
  for (let step = 0; step <= curveSteps; step += 1) {
    const s = domainMin + (step / curveSteps) * span;
    maxPdf = Math.max(maxPdf, normalPdf(s, meanS, stdS));
  }
  const maxHist = Math.max(...bins.map((b) => b.density), 0);
  const maxY = Math.max(maxPdf, maxHist) * 1.1 || 1;
  const yAtDensity = (d) => yBase - (d / maxY) * plotH * 0.92;

  const curvePath = [];
  for (let step = 0; step <= curveSteps; step += 1) {
    const s = domainMin + (step / curveSteps) * span;
    const pdf = normalPdf(s, meanS, stdS);
    curvePath.push(`${step === 0 ? 'M' : 'L'} ${xAt(s).toFixed(2)} ${yAtDensity(pdf).toFixed(2)}`);
  }

  const tickStep = span <= 10 ? 1 : span <= 20 ? 2 : Math.ceil(span / 5);
  const xTicks = [];
  for (let t = domainMin; t <= domainMax + 1e-6; t += tickStep) xTicks.push(Math.round(t * 100) / 100);

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (maxY * i) / yTickCount);
  const formatDensity = (v) => (v === 0 ? '0' : v.toFixed(v >= 1 ? 2 : 3));

  return (
    <Box sx={{ mb: 2, overflowX: 'auto' }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      )}
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{caption}</Typography>
      )}
      {!caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Histogram (density) + N({meanS.toFixed(2)}, {stdS.toFixed(2)}²) PDF fit.
        </Typography>
      )}
      <svg width={chartW} height={chartH} role="img" aria-label={title || 'Density histogram'}>
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={padL} y1={yAtDensity(v)} x2={chartW - padR} y2={yAtDensity(v)} stroke="#eeeeee" strokeWidth={1} />
            <text x={padL - 6} y={yAtDensity(v) + 4} textAnchor="end" fontSize={10} fill="#757575">
              {formatDensity(v)}
            </text>
          </g>
        ))}
        <line x1={padL} y1={yBase} x2={chartW - padR} y2={yBase} stroke="#bdbdbd" strokeWidth={1.2} />

        {xTicks.map((v) => (
          <g key={`x-${v}`}>
            <line x1={xAt(v)} y1={padT} x2={xAt(v)} y2={yBase} stroke="#f5f5f5" strokeWidth={1} />
            <text x={xAt(v)} y={yBase + 14} textAnchor="middle" fontSize={10} fill="#757575">{v}</text>
          </g>
        ))}

        {bins.map((bin) => {
          if (bin.count === 0) return null;
          const barPxW = (bin.binWidth / span) * plotW * 0.88;
          const cx = xAt(bin.center);
          const top = yAtDensity(bin.density);
          return (
            <rect
              key={`bin-${bin.center}`}
              x={cx - barPxW / 2}
              y={top}
              width={barPxW}
              height={Math.max(yBase - top, 1)}
              rx={2}
              fill="#1976d2"
              fillOpacity={0.82}
            />
          );
        })}

        <path d={curvePath.join(' ')} fill="none" stroke="#ed6c02" strokeWidth={2.5} strokeLinecap="round" />

        {(bottomMarkers || []).map((m) => {
          const cx = xAt(m.value);
          return (
            <g key={m.key}>
              <line x1={cx} y1={yBase} x2={cx} y2={yBase + 6} stroke="#1976d2" strokeWidth={1.5} />
              {m.imageUrl ? (
                <image href={m.imageUrl} x={cx - 18} y={yBase + 22} width={36} height={36} />
              ) : m.label ? (
                <text x={cx} y={yBase + 66} textAnchor="middle" fontSize={8} fill="#616161">{m.label}</text>
              ) : null}
              {m.subLabel && (
                <text x={cx} y={yBase + 76} textAnchor="middle" fontSize={8} fill="#9e9e9e">{m.subLabel}</text>
              )}
            </g>
          );
        })}

        {xLabel && (
          <text x={padL + plotW / 2} y={chartH - 4} textAnchor="middle" fontSize={10} fill="#616161">{xLabel}</text>
        )}
        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#757575"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          Density
        </text>
      </svg>
    </Box>
  );
}

export function SemanticProfileChart({ dimensions, scaleMin = 1, scaleMax = 7 }) {
  if (!dimensions?.length) return null;
  const chartW = 560;
  const chartH = Math.max(160, dimensions.length * 36 + 60);
  const padL = 120;
  const padR = 120;
  const padT = 24;
  const padB = 24;
  const plotW = chartW - padL - padR;
  const yStep = (chartH - padT - padB) / dimensions.length;

  const xAt = (v) => padL + ((v - scaleMin) / (scaleMax - scaleMin)) * plotW;

  const points = dimensions.map((d, i) => ({
    x: xAt(d.mean ?? scaleMin),
    y: padT + i * yStep + yStep / 2,
    ...d,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <Box sx={{ mb: 2, overflowX: 'auto' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Semantic differential profile</Typography>
      <svg width={chartW} height={chartH} role="img" aria-label="Semantic profile">
        {[scaleMin, (scaleMin + scaleMax) / 2, scaleMax].map((v) => (
          <g key={v}>
            <line x1={xAt(v)} y1={padT} x2={xAt(v)} y2={chartH - padB} stroke="#eeeeee" strokeWidth={1} />
            <text x={xAt(v)} y={padT - 6} textAnchor="middle" fontSize={9} fill="#9e9e9e">{v}</text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={chartH - padB} stroke="#e0e0e0" />
        <line x1={chartW - padR} y1={padT} x2={chartW - padR} y2={chartH - padB} stroke="#e0e0e0" />
        <path d={pathD} fill="none" stroke="#1976d2" strokeWidth={2} />
        {points.map((p) => (
          <g key={p.id}>
            <text x={8} y={p.y + 4} fontSize={10} fill="#616161">{p.left || ''}</text>
            <text x={chartW - 8} y={p.y + 4} textAnchor="end" fontSize={10} fill="#616161">{p.right || ''}</text>
            <circle cx={p.x} cy={p.y} r={5} fill="#1976d2" />
            {p.sd != null && (
              <line
                x1={xAt(Math.max(scaleMin, (p.mean ?? 0) - p.sd))}
                y1={p.y}
                x2={xAt(Math.min(scaleMax, (p.mean ?? 0) + p.sd))}
                y2={p.y}
                stroke="#1976d2"
                strokeWidth={2}
                strokeOpacity={0.35}
              />
            )}
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={9} fill="#424242">
              {p.mean != null ? p.mean.toFixed(2) : '—'}
            </text>
          </g>
        ))}
      </svg>
    </Box>
  );
}

export function TimelineAreaChart({ timeline, title, xLabel = 'Time (s)', yLabel = 'Proportion', duration }) {
  if (!timeline?.length) return null;
  const chartW = 560;
  const chartH = 200;
  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const maxT = duration || Math.max(...timeline.map((p) => p.t)) + 1;
  const maxY = Math.max(...timeline.map((p) => p.proportion ?? p.mean ?? 0), 0.01);

  const xAt = (t) => padL + (t / maxT) * plotW;
  const yAt = (v) => padT + plotH - (v / maxY) * plotH * 0.92;

  const areaPath = timeline.map((p, i) => {
    const x = xAt(p.t);
    const y = yAt(p.proportion ?? p.mean ?? 0);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const closePath = `${areaPath} L ${xAt(timeline[timeline.length - 1].t).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(timeline[0].t).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  return (
    <Box sx={{ mb: 2, overflowX: 'auto' }}>
      {title && <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>}
      <svg width={chartW} height={chartH} role="img" aria-label={title}>
        <path d={closePath} fill="#1976d2" fillOpacity={0.25} />
        <path d={areaPath} fill="none" stroke="#1976d2" strokeWidth={2} />
        <line x1={padL} y1={padT + plotH} x2={chartW - padR} y2={padT + plotH} stroke="#bdbdbd" />
        <text x={padL + plotW / 2} y={chartH - 4} textAnchor="middle" fontSize={10} fill="#616161">{xLabel}</text>
        <text x={14} y={padT + plotH / 2} textAnchor="middle" fontSize={9} fill="#757575" transform={`rotate(-90 14 ${padT + plotH / 2})`}>{yLabel}</text>
      </svg>
    </Box>
  );
}

export function ContinuousRatingChart({ timeline, title, yMax = 100 }) {
  if (!timeline?.length) return null;
  const chartW = 560;
  const chartH = 220;
  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const maxT = Math.max(...timeline.map((p) => p.t)) + 1;

  const xAt = (t) => padL + (t / maxT) * plotW;
  const yAt = (v) => padT + plotH - (v / yMax) * plotH * 0.92;

  const meanPath = timeline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.t).toFixed(1)} ${yAt(p.mean).toFixed(1)}`).join(' ');

  const bandPath = [
    ...timeline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.t).toFixed(1)} ${yAt(Math.min(yMax, p.mean + (p.sd || 0))).toFixed(1)}`),
    ...[...timeline].reverse().map((p, i) => `${i === 0 ? 'L' : 'L'} ${xAt(p.t).toFixed(1)} ${yAt(Math.max(0, p.mean - (p.sd || 0))).toFixed(1)}`),
    'Z',
  ].join(' ');

  return (
    <Box sx={{ mb: 2, overflowX: 'auto' }}>
      {title && <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>}
      <svg width={chartW} height={chartH} role="img" aria-label={title}>
        <path d={bandPath} fill="#1976d2" fillOpacity={0.15} />
        <path d={meanPath} fill="none" stroke="#1976d2" strokeWidth={2.5} />
        <line x1={padL} y1={padT + plotH} x2={chartW - padR} y2={padT + plotH} stroke="#bdbdbd" />
        <text x={padL + plotW / 2} y={chartH - 4} textAnchor="middle" fontSize={10} fill="#616161">Time (s)</text>
        <text x={14} y={padT + plotH / 2} textAnchor="middle" fontSize={9} fill="#757575" transform={`rotate(-90 14 ${padT + plotH / 2})`}>Rating</text>
      </svg>
    </Box>
  );
}

export function HueWheelChart({ hueBuckets }) {
  if (!hueBuckets?.length) return null;
  const max = Math.max(...hueBuckets.map((b) => b.count), 1);
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Hue distribution (12 bins)</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {hueBuckets.map((b) => (
          <Box key={b.hue} sx={{ textAlign: 'center', minWidth: 48 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: 1, bgcolor: b.color,
              opacity: 0.4 + 0.6 * (b.count / max), mx: 'auto', mb: 0.5,
              border: '1px solid', borderColor: 'divider',
            }} />
            <Typography variant="caption" display="block">{b.count}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function WordFrequencyChart({ words, totalResponses }) {
  if (!words?.length) return null;
  const max = words[0]?.count || 1;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Top words (document frequency)</Typography>
      {words.map(({ word, count }, idx) => (
        <Box key={word} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
          <Typography variant="body2" sx={{ width: 100, flexShrink: 0 }} noWrap>{word}</Typography>
          <Box sx={{ flex: 1, height: 12, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ width: `${(count / max) * 100}%`, height: '100%', bgcolor: BAR_COLORS[idx % BAR_COLORS.length] }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>
            {count} ({totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0}%)
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Diverging horizontal bars for Pearson r in [-1, 1].
 * Expects optional p / stars from correlateFeaturesWithPerception.
 */
export function CorrelationBarChart({
  correlations,
  title = 'Feature correlations (Pearson r)',
  caption,
  maxItems = 24,
  chartW = 560,
}) {
  const items = (correlations || [])
    .filter((c) => c && Number.isFinite(c.r))
    .slice(0, maxItems);
  if (!items.length) return null;

  const padL = 156;
  const padR = 64;
  const padT = 28;
  const padB = 28;
  const rowH = 26;
  const chartH = padT + padB + items.length * rowH;
  const plotW = chartW - padL - padR;
  const midX = padL + plotW / 2;
  const xAt = (r) => midX + (r / 2) * plotW;
  const posColor = '#1565c0';
  const negColor = '#c62828';

  const ns = items.map((c) => c.n).filter((n) => Number.isFinite(n));
  const sharedN = ns.length && ns.every((n) => n === ns[0]) ? ns[0] : null;
  const defaultCaption = [
    'Bars diverge from r = 0. Blue +, red −.',
    'Stars: *** p<.001, ** p<.01, * p<.05, · p<.1 (two-tailed).',
    sharedN != null ? `n = ${sharedN}.` : null,
  ].filter(Boolean).join(' ');

  const formatP = (p) => {
    if (p == null || !Number.isFinite(p)) return '';
    if (p < 0.001) return 'p<.001';
    return `p=${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
  };

  return (
    <Box sx={{ mb: 0, overflowX: 'auto', width: '100%' }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {caption || defaultCaption}
      </Typography>
      <svg width={chartW} height={chartH} role="img" aria-label={title} style={{ maxWidth: '100%' }}>
        {[-1, -0.5, 0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={xAt(t)}
              y1={padT - 4}
              x2={xAt(t)}
              y2={chartH - padB}
              stroke={t === 0 ? '#9e9e9e' : '#eeeeee'}
              strokeWidth={t === 0 ? 1.4 : 1}
              strokeDasharray={t === 0 ? undefined : '3 3'}
            />
            <text x={xAt(t)} y={padT - 10} textAnchor="middle" fontSize={10} fill="#757575">
              {t}
            </text>
          </g>
        ))}

        {items.map((c, i) => {
          const y = padT + i * rowH + rowH / 2;
          const barH = 14;
          const x0 = midX;
          const x1 = xAt(c.r);
          const left = Math.min(x0, x1);
          const width = Math.max(Math.abs(x1 - x0), 1.5);
          const fill = c.r >= 0 ? posColor : negColor;
          const label = c.feature.length > 20 ? `${c.feature.slice(0, 18)}…` : c.feature;
          const stars = c.stars || '';
          const valueLabel = `${c.r.toFixed(2)}${stars}`;
          return (
            <g key={c.feature}>
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="#424242"
              >
                {label}
              </text>
              <title>
                {`${c.feature}: r=${c.r.toFixed(3)}${c.n != null ? ` · n=${c.n}` : ''}${c.p != null ? ` · ${formatP(c.p)}` : ''}${stars ? ` ${stars}` : ''}`}
              </title>
              <rect
                x={left}
                y={y - barH / 2}
                width={width}
                height={barH}
                rx={2}
                fill={fill}
                opacity={c.p != null && c.p >= 0.05 ? 0.45 : 0.85}
              />
              <text
                x={c.r >= 0 ? x1 + 4 : x1 - 4}
                y={y + 4}
                textAnchor={c.r >= 0 ? 'start' : 'end'}
                fontSize={10}
                fill="#616161"
                fontWeight={stars ? 600 : 400}
              >
                {valueLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

/**
 * Horizontal bars for non-negative feature importance in [0, 1]
 * (same layout language as CorrelationBarChart).
 */
export function ImportanceBarChart({
  items,
  title = 'Top features',
  caption = 'Relative importance (normalized). Longer bar = stronger contribution in this model.',
  maxItems = 12,
  chartW = 560,
}) {
  const rows = (items || [])
    .filter((d) => d && d.feature && Number.isFinite(d.importance))
    .slice(0, maxItems)
    .map((d) => ({
      feature: d.feature,
      importance: Math.max(0, Math.min(1, Number(d.importance))),
    }));
  if (!rows.length) return null;

  const padL = 156;
  const padR = 56;
  const padT = 28;
  const padB = 28;
  const rowH = 26;
  const chartH = padT + padB + rows.length * rowH;
  const plotW = chartW - padL - padR;
  const xAt = (v) => padL + v * plotW;
  const barColor = '#1565c0';

  return (
    <Box sx={{ mb: 2, overflowX: 'auto', width: '100%' }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      )}
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {caption}
        </Typography>
      )}
      <svg width={chartW} height={chartH} role="img" aria-label={title} style={{ maxWidth: '100%' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={xAt(t)}
              y1={padT - 4}
              x2={xAt(t)}
              y2={chartH - padB}
              stroke={t === 0 ? '#9e9e9e' : '#eeeeee'}
              strokeWidth={t === 0 ? 1.4 : 1}
              strokeDasharray={t === 0 ? undefined : '3 3'}
            />
            <text x={xAt(t)} y={padT - 10} textAnchor="middle" fontSize={10} fill="#757575">
              {t === 0 || t === 1 ? t.toFixed(0) : t.toFixed(2)}
            </text>
          </g>
        ))}

        {rows.map((d, i) => {
          const y = padT + i * rowH + rowH / 2;
          const barH = 14;
          const x1 = xAt(d.importance);
          const width = Math.max(x1 - padL, 1.5);
          const label = d.feature.length > 20 ? `${d.feature.slice(0, 18)}…` : d.feature;
          const valueLabel = `${(d.importance * 100).toFixed(0)}%`;
          return (
            <g key={d.feature}>
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="#424242"
              >
                {label}
              </text>
              <title>{`${d.feature}: ${(d.importance * 100).toFixed(1)}%`}</title>
              <rect
                x={padL}
                y={y - barH / 2}
                width={width}
                height={barH}
                rx={2}
                fill={barColor}
                opacity={0.85}
              />
              <text
                x={x1 + 4}
                y={y + 4}
                textAnchor="start"
                fontSize={10}
                fill="#616161"
              >
                {valueLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

function niceExtent(vals, padFrac = 0.06) {
  const finite = vals.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 0.5;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

/**
 * Scatter of feature (x) vs perception score (y).
 * @param {{ x: number, y: number, label?: string, url?: string }[]} points
 */
export function FeatureScoreScatterChart({
  points,
  featureLabel = 'Feature',
  scoreLabel = 'Score',
  title,
  caption,
  size = 420,
}) {
  const pts = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;

  const padL = 48;
  const padR = 20;
  const padT = 16;
  const padB = 44;
  // Square plot region; outer SVG is square-ish with axis label gutters.
  const plotSize = size;
  const chartW = padL + plotSize + padR;
  const chartH = padT + plotSize + padB;
  const plotW = plotSize;
  const plotH = plotSize;
  const [xMin, xMax] = niceExtent(pts.map((p) => p.x));
  const [yMin, yMax] = niceExtent(pts.map((p) => p.y));
  const xAt = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  // Simple OLS trend line
  let trend = null;
  {
    const n = pts.length;
    let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    pts.forEach((p) => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    const den = n * sxx - sx * sx;
    if (den) {
      const slope = (n * sxy - sx * sy) / den;
      const intercept = (sy - slope * sx) / n;
      trend = {
        x1: xMin,
        y1: intercept + slope * xMin,
        x2: xMax,
        y2: intercept + slope * xMax,
      };
    }
  }

  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const fmt = (v) => (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0)
    ? v.toExponential(1)
    : v.toFixed(Math.abs(v) >= 10 ? 1 : 2));

  return (
    <Box sx={{ mb: 0, overflowX: 'auto' }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      )}
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {caption}
        </Typography>
      )}
      <svg width={chartW} height={chartH} role="img" aria-label={title || 'Feature vs score scatter'} style={{ maxWidth: '100%' }}>
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line x1={padL} y1={yAt(t)} x2={chartW - padR} y2={yAt(t)} stroke="#eeeeee" />
            <text x={padL - 6} y={yAt(t) + 3} textAnchor="end" fontSize={10} fill="#757575">{fmt(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line x1={xAt(t)} y1={padT} x2={xAt(t)} y2={padT + plotH} stroke="#f5f5f5" />
            <text x={xAt(t)} y={padT + plotH + 14} textAnchor="middle" fontSize={10} fill="#757575">{fmt(t)}</text>
          </g>
        ))}
        <line x1={padL} y1={padT + plotH} x2={chartW - padR} y2={padT + plotH} stroke="#bdbdbd" />
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#bdbdbd" />

        {trend && (
          <line
            x1={xAt(trend.x1)}
            y1={yAt(trend.y1)}
            x2={xAt(trend.x2)}
            y2={yAt(trend.y2)}
            stroke="#fb8c00"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.9}
          />
        )}

        {pts.map((p, i) => (
          <circle
            key={`${p.label || i}-${p.x}-${p.y}`}
            cx={xAt(p.x)}
            cy={yAt(p.y)}
            r={4}
            fill="#1565c0"
            fillOpacity={0.65}
            stroke="#0d47a1"
            strokeWidth={0.6}
          >
            <title>{`${p.label || 'image'}: ${featureLabel}=${fmt(p.x)}, ${scoreLabel}=${fmt(p.y)}`}</title>
          </circle>
        ))}

        <text x={padL + plotW / 2} y={chartH - 8} textAnchor="middle" fontSize={11} fill="#616161">
          {featureLabel}
        </text>
        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#616161"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          {scoreLabel}
        </text>
      </svg>
    </Box>
  );
}

function ExtremeThumb({ row, featureKey, getFeatureValue }) {
  const feat = featureKey && getFeatureValue ? getFeatureValue(row, featureKey) : null;
  return (
    <Box sx={{ width: 96 }}>
      {row.url ? (
        <Box
          component="img"
          src={row.url}
          alt={row.name || ''}
          loading="lazy"
          sx={{
            width: 96,
            height: 72,
            objectFit: 'cover',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            display: 'block',
            bgcolor: 'grey.100',
          }}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.removeAttribute('src');
          }}
        />
      ) : (
        <Box sx={{ width: 96, height: 72, borderRadius: 1, bgcolor: 'grey.100', border: '1px solid', borderColor: 'divider' }} />
      )}
      <Typography variant="caption" display="block" noWrap title={row.name} sx={{ mt: 0.25 }}>
        {row.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        score {row.mean_score != null ? row.mean_score.toFixed(2) : '—'}
        {Number.isFinite(feat) ? ` · ${feat.toFixed(2)}` : ''}
      </Typography>
    </Box>
  );
}

/**
 * Side-by-side galleries of highest / lowest scored images.
 */
export function ScoreExtremeGallery({
  rows,
  scoreLabel = 'Score',
  count = 8,
  featureKey = null,
  getFeatureValue = null,
  title = 'High / low score images',
}) {
  const scored = (rows || [])
    .filter((r) => r.mean_score != null && Number.isFinite(r.mean_score))
    .sort((a, b) => b.mean_score - a.mean_score);
  if (scored.length < 2) return null;

  const n = Math.min(count, Math.floor(scored.length / 2) || 1, scored.length);
  const high = scored.slice(0, n);
  const low = scored.slice(-n).reverse();

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Top and bottom {n} by {scoreLabel}
        {featureKey ? ` · caption shows ${featureKey}` : ''}.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'success.dark' }}>
            Highest {scoreLabel}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {high.map((r) => (
              <ExtremeThumb
                key={`hi-${r.media_id}`}
                row={r}
                featureKey={featureKey}
                getFeatureValue={getFeatureValue}
              />
            ))}
          </Box>
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'error.dark' }}>
            Lowest {scoreLabel}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {low.map((r) => (
              <ExtremeThumb
                key={`lo-${r.media_id}`}
                row={r}
                featureKey={featureKey}
                getFeatureValue={getFeatureValue}
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export { BAR_COLORS };
