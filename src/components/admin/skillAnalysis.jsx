/** Preset skill specialized analysis components. */

import React, { useMemo, useContext } from 'react';
import { Box, Typography, Button, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper, Alert } from '@mui/material';
import Download from '@mui/icons-material/Download';
import { ImageResolverContext } from './imageResolverContext';
import { descriptiveStats, pct } from '../../lib/stats';
import { computeMaxDiffScores, exportMaxDiffCsv } from '../../lib/maxdiff';
import { aggregateSegmentTimeline, aggregateContinuousRating } from '../../lib/videoStats';
import { wordFrequency } from '../../lib/textStats';
import { downloadTextFile } from '../../lib/methodsExport';
import { mediaFilenameKey } from '../../lib/skillMediaUtils';
import {
  DensityHistogramChart,
  DescriptiveStatsLine,
  TimelineAreaChart,
  ContinuousRatingChart,
  HueWheelChart,
  SemanticProfileChart,
  WordFrequencyChart,
  BAR_COLORS,
} from './analysisCharts';

function shortName(str) {
  if (!str) return '(unknown)';
  return str.split('?')[0].split('/').pop() || str;
}

function resolveImageKey(key, resolvedUrl) {
  if (!key) return null;
  if (key.startsWith('http') || key.startsWith('/') || key.startsWith('data:')) return key;
  return resolvedUrl?.get(key) || resolvedUrl?.get(shortName(key)) || null;
}

function useMediaResolver() {
  const resolvedUrl = useContext(ImageResolverContext);
  return (value) => resolveImageKey(typeof value === 'string' ? value : mediaFilenameKey(value), resolvedUrl);
}

function SkillMediaRanking({ title, items, resolveUrl, maxValue, formatLabel }) {
  if (!items?.length) return null;
  const peak = maxValue ?? Math.max(...items.map((i) => i.value), 0.001);

  return (
    <Box sx={{ mb: 3 }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>
      )}
      {items.map(({ key, url, value, label }, idx) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          {resolveUrl?.(url || key) ? (
            <Box component="img" src={resolveUrl(url || key)} alt={key} sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }} />
          ) : (
            <Box sx={{ width: 48, height: 48, bgcolor: 'grey.100', borderRadius: 1 }} />
          )}
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: '50%' }}>{shortName(url || key)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatLabel ? formatLabel(value, label) : `${value.toFixed(1)}`}
              </Typography>
            </Box>
            <Box sx={{ height: 12, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${Math.round((value / peak) * 100)}%`, bgcolor: BAR_COLORS[idx % BAR_COLORS.length], borderRadius: 1 }} />
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function StimulusPreview({ url, resolveUrl, label }) {
  const src = resolveUrl?.(url);
  if (!src) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box component="img" src={src} alt={label || 'stimulus'} sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }} />
      <Typography variant="caption" color="text.secondary">
        Stimulus: {shortName(url)}
      </Typography>
    </Box>
  );
}

function HorizontalBar({ label, count, total, color, index }) {
  const width = pct(count, total);
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography variant="body2" sx={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        <Typography variant="body2" color="text.secondary">{count} ({width}%)</Typography>
      </Box>
      <Box sx={{ height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${width}%`, bgcolor: color || BAR_COLORS[index % BAR_COLORS.length], borderRadius: 1 }} />
      </Box>
    </Box>
  );
}

function resolveImageKeyFromContext(key, resolvedUrl) {
  return resolveImageKey(key, resolvedUrl);
}

export function PairwisePreferenceAnalysis({ answers }) {
  const resolveUrl = useMediaResolver();
  const prefs = answers.map((a) => Number(a.answer?.preference)).filter((n) => !Number.isNaN(n));
  const preferA = prefs.filter((p) => p < -20).length;
  const preferB = prefs.filter((p) => p > 20).length;
  const neutral = prefs.length - preferA - preferB;
  const hardCount = answers.filter((a) => a.answer?.hardToDecide).length;

  const perImage = useMemo(() => {
    const stats = {};
    answers.forEach(({ answer }) => {
      const p = Number(answer?.preference);
      if (Number.isNaN(p)) return;
      const pairs = [
        { url: answer?.imageA, score: -p },
        { url: answer?.imageB, score: p },
      ];
      pairs.forEach(({ url, score }) => {
        if (!url) return;
        const key = mediaFilenameKey(url);
        if (!stats[key]) stats[key] = { key, url, scores: [] };
        stats[key].scores.push(score);
      });
    });
    return Object.values(stats)
      .map(({ key, url, scores }) => ({
        key,
        url,
        value: scores.reduce((s, v) => s + v, 0) / scores.length,
        label: `n=${scores.length}`,
      }))
      .sort((a, b) => b.value - a.value);
  }, [answers]);

  const pairPreview = answers.find((a) => a.answer?.imageA && a.answer?.imageB)?.answer;

  return (
    <Box>
      {pairPreview && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Option A</Typography>
            {resolveUrl(pairPreview.imageA) && (
              <Box component="img" src={resolveUrl(pairPreview.imageA)} alt="A" sx={{ display: 'block', width: 96, height: 96, objectFit: 'cover', borderRadius: 1, mt: 0.5 }} />
            )}
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Option B</Typography>
            {resolveUrl(pairPreview.imageB) && (
              <Box component="img" src={resolveUrl(pairPreview.imageB)} alt="B" sx={{ display: 'block', width: 96, height: 96, objectFit: 'cover', borderRadius: 1, mt: 0.5 }} />
            )}
          </Box>
        </Box>
      )}
      <SkillMediaRanking
        title="Preference score by image (−100 = least preferred, +100 = most preferred)"
        items={perImage}
        resolveUrl={resolveUrl}
        maxValue={100}
        formatLabel={(value, label) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} · ${label}`}
      />
      <DescriptiveStatsLine nums={prefs} unit="" />
      <DensityHistogramChart
        scores={prefs}
        domainMin={-100}
        domainMax={100}
        title="Preference distribution"
        xLabel="Preference (−100 = A, +100 = B)"
      />
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>A/B win rates (|preference| &gt; 20)</Typography>
      <HorizontalBar label="Prefer A" count={preferA} total={prefs.length} color="#1976d2" />
      <HorizontalBar label="Neutral" count={neutral} total={prefs.length} color="#9e9e9e" />
      <HorizontalBar label="Prefer B" count={preferB} total={prefs.length} color="#ed6c02" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Hard to decide: {hardCount} / {answers.length} ({pct(hardCount, answers.length)}%)
      </Typography>
    </Box>
  );
}

export function MaxDiffAnalysis({ answers, question, mediaCount = 4 }) {
  const resolvedUrl = useContext(ImageResolverContext);
  const resolveUrl = useMediaResolver();
  const rankings = useMemo(
    () => computeMaxDiffScores(answers, question?.skillConfig?.mediaCount || mediaCount),
    [answers, question?.skillConfig?.mediaCount, mediaCount],
  );

  if (!rankings.length) {
    return <Typography variant="body2" color="text.secondary">No complete MaxDiff selections yet.</Typography>;
  }

  const scores = rankings.map((r) => r.scoreStd5);
  const compactItems = rankings.map((r) => ({
    key: r.imageKey,
    url: r.imageUrl || r.imageKey,
    value: r.scoreStd5 ?? 0,
    label: `BWS ${r.bws.toFixed(2)} · n=${r.appearances}`,
  }));

  return (
    <Box>
      <SkillMediaRanking
        title="MaxDiff ranking by image (standardized 0–5)"
        items={compactItems}
        resolveUrl={resolveUrl}
        maxValue={5}
        formatLabel={(value, label) => `${value.toFixed(2)} · ${label}`}
      />
      <DensityHistogramChart
        scores={scores}
        domainMin={0}
        domainMax={5}
        title="BWS score distribution (0–5 standardized)"
        xLabel="Standardized BWS (0–5)"
        bottomMarkers={rankings.map((r) => ({
          key: r.imageKey,
          value: r.scoreStd5,
          imageUrl: resolveImageKeyFromContext(r.imageKey, resolvedUrl),
          subLabel: r.bws.toFixed(2),
        }))}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>MaxDiff rankings (BWS score)</Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Download />}
          onClick={() => downloadTextFile(exportMaxDiffCsv(question.name, rankings), `${question.name}_maxdiff_${new Date().toISOString().slice(0, 10)}.csv`)}
        >
          Export BWS CSV
        </Button>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Image</TableCell>
              <TableCell align="right">BWS</TableCell>
              <TableCell align="right">Std (0–5)</TableCell>
              <TableCell align="right">Best</TableCell>
              <TableCell align="right">Worst</TableCell>
              <TableCell align="right">Appearances</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rankings.map((r) => (
              <TableRow key={r.imageKey}>
                <TableCell>{r.rank}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {resolveImageKeyFromContext(r.imageKey, resolvedUrl) && (
                      <Box component="img" src={resolveImageKeyFromContext(r.imageKey, resolvedUrl)} alt={r.imageKey} sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 0.5 }} />
                    )}
                    <Typography variant="caption">{shortName(r.imageKey)}</Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">{r.bws.toFixed(3)}</TableCell>
                <TableCell align="right">{(r.scoreStd5 ?? 0).toFixed(2)}</TableCell>
                <TableCell align="right">{r.best}</TableCell>
                <TableCell align="right">{r.worst}</TableCell>
                <TableCell align="right">{r.appearances}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function VideoMomentAnalysis({ answers, questionName }) {
  const resolveUrl = useMediaResolver();
  const stimulusUrl = answers.find((a) => a.answer?.posterUrl || a.answer?.videoUrl)?.answer?.posterUrl
    || answers.find((a) => a.answer?.videoUrl)?.answer?.videoUrl
    || answers[0]?.shown_images?.[0];
  const agg = useMemo(() => aggregateSegmentTimeline(answers), [answers]);
  const segCounts = answers.map((a) => (a.answer?.segments || []).length);
  const stats = descriptiveStats(segCounts);
  const durations = answers.map((a) => Number(a.answer?.duration)).filter((n) => !Number.isNaN(n) && n > 0);

  const exportCsv = () => {
    const csv = ['time_s,participant_count,proportion', ...agg.timeline.map((p) => `${p.t},${p.count},${p.proportion.toFixed(4)}`)].join('\n');
    downloadTextFile(csv, `${questionName}_video_moments_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Box>
      <StimulusPreview url={stimulusUrl} resolveUrl={resolveUrl} label="Video stimulus" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Segments: mean {stats.mean?.toFixed(1) ?? '—'} · total {stats.n ? segCounts.reduce((a, b) => a + b, 0) : 0}
        {durations.length ? ` · video duration ~${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)}s` : ''}
      </Typography>
      <TimelineAreaChart
        timeline={agg.timeline}
        title="Key moment overlap (proportion of participants tagging each second)"
        duration={agg.duration}
      />
      {agg.peakTime != null && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Peak tagging at t={agg.peakTime}s ({(agg.peakProportion * 100).toFixed(0)}% of participants)
        </Alert>
      )}
      <Button size="small" variant="outlined" startIcon={<Download />} onClick={exportCsv}>Export timeline CSV</Button>
    </Box>
  );
}

export function ContinuousVideoRatingAnalysis({ answers, questionName }) {
  const resolveUrl = useMediaResolver();
  const stimulusUrl = answers.find((a) => a.answer?.videoUrl)?.answer?.videoUrl
    || answers[0]?.shown_images?.[0];
  const agg = useMemo(() => aggregateContinuousRating(answers), [answers]);
  const means = answers.map((a) => Number(a.answer?.mean)).filter((n) => !Number.isNaN(n));

  const exportCsv = () => {
    const csv = ['time_s,mean,sd,n', ...agg.timeline.map((p) => `${p.t},${p.mean.toFixed(2)},${(p.sd || 0).toFixed(2)},${p.n}`)].join('\n');
    downloadTextFile(csv, `${questionName}_video_rating_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Box>
      <StimulusPreview url={stimulusUrl} resolveUrl={resolveUrl} label="Video stimulus" />
      <DescriptiveStatsLine nums={means} unit="" />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {agg.sampleCount} timeline samples aggregated · global mean {agg.globalMean?.toFixed(1) ?? '—'}
      </Typography>
      <ContinuousRatingChart timeline={agg.timeline} title="Mean rating over time (±1 SD band)" />
      <Button size="small" variant="outlined" startIcon={<Download />} onClick={exportCsv}>Export timeline CSV</Button>
    </Box>
  );
}

export function EmotionColorAnalysis({ answers }) {
  const resolveUrl = useMediaResolver();
  const stimulusUrl = answers.find((a) => a.answer?.imageUrl)?.answer?.imageUrl
    || answers[0]?.shown_images?.[0];
  const colors = answers.map((a) => a.answer?.color).filter(Boolean);
  const intensities = colors.map((c) => Number(c.intensity)).filter((n) => !Number.isNaN(n));
  const hueBuckets = Array.from({ length: 12 }, (_, i) => ({ hue: i * 30, count: 0, color: `hsl(${i * 30}, 70%, 50%)` }));

  colors.forEach((c) => {
    const h = Number(c.hue);
    if (!Number.isNaN(h)) {
      const bin = Math.min(11, Math.floor(((h % 360) + 15) / 30));
      hueBuckets[bin].count += 1;
    }
  });

  const hexFreq = {};
  colors.forEach((c) => {
    if (c.hex) hexFreq[c.hex] = (hexFreq[c.hex] || 0) + 1;
  });
  const topColors = Object.entries(hexFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <Box>
      <StimulusPreview url={stimulusUrl} resolveUrl={resolveUrl} label="Stimulus image" />
      <DescriptiveStatsLine nums={intensities} unit=" intensity" />
      <HueWheelChart hueBuckets={hueBuckets} />
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Top colors</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {topColors.map(([hex, count]) => (
          <Box key={hex} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 24, height: 24, borderRadius: 0.5, bgcolor: hex, border: '1px solid', borderColor: 'divider' }} />
            <Typography variant="caption">{hex} × {count}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function CompositeBlocksAnalysis({ answers }) {
  const resolveUrl = useMediaResolver();
  const stimulusUrl = answers.find((a) => a.answer?.imageUrl)?.answer?.imageUrl
    || answers[0]?.shown_images?.[0];
  const dims = {};
  for (const { answer } of answers) {
    (answer?.ratings || []).forEach((d) => {
      const id = d.id || d.label || `${d.left}/${d.right}`;
      if (!dims[id]) dims[id] = { id, left: d.left, right: d.right, label: d.label, values: [] };
      const n = Number(d.value);
      if (!Number.isNaN(n)) dims[id].values.push(n);
    });
  }
  const profileDims = Object.values(dims).map((d) => ({
    ...d,
    mean: d.values.length ? d.values.reduce((s, v) => s + v, 0) / d.values.length : null,
    sd: d.values.length > 1 ? Math.sqrt(d.values.reduce((s, v) => s + (v - d.values.reduce((a, b) => a + b, 0) / d.values.length) ** 2, 0) / d.values.length) : 0,
  }));

  const words = answers.flatMap((a) => a.answer?.words || []);
  const wordFreq = wordFrequency(words.map(String), 15);
  const choices = answers.map((a) => a.answer?.choice).filter((c) => c != null && c !== '');
  const choiceFreq = {};
  choices.forEach((c) => { choiceFreq[c] = (choiceFreq[c] || 0) + 1; });
  const texts = answers.map((a) => a.answer?.text).filter(Boolean);

  return (
    <Box>
      <StimulusPreview url={stimulusUrl} resolveUrl={resolveUrl} label="Stimulus media" />
      {profileDims.length > 0 && <SemanticProfileChart dimensions={profileDims} />}
      {Object.keys(choiceFreq).length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Choice frequency</Typography>
          {Object.entries(choiceFreq).sort((a, b) => b[1] - a[1]).map(([val, count], idx) => (
            <HorizontalBar key={val} label={String(val)} count={count} total={choices.length} index={idx} />
          ))}
        </Box>
      )}
      {wordFreq.length > 0 && <WordFrequencyChart words={wordFreq} totalResponses={answers.length} />}
      {texts.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Text responses</Typography>
          {texts.slice(0, 5).map((t, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1, mb: 0.5, bgcolor: 'grey.50' }}>
              <Typography variant="body2">{t}</Typography>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function getPresetSkillAnalysis(skillId) {
  const id = skillId?.replace(/^preset_/, '');
  const map = {
    image_preference_slider: PairwisePreferenceAnalysis,
    best_worst_choice: MaxDiffAnalysis,
    video_moment_tag: VideoMomentAnalysis,
    video_continuous_rating: ContinuousVideoRatingAnalysis,
    emotion_color_picker: EmotionColorAnalysis,
    composite_blocks: CompositeBlocksAnalysis,
  };
  return map[id] || null;
}
