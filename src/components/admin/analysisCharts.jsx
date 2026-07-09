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

export { BAR_COLORS };
