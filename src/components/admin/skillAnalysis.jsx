/** Preset skill specialized analysis components. */

import React, { useMemo, useContext, useState } from 'react';
import { Box, Typography, Button, Paper, Alert, Tabs, Tab } from '@mui/material';
import Download from '@mui/icons-material/Download';
import { ImageResolverContext } from './imageResolverContext';
import { descriptiveStats, pct } from '../../lib/stats';
import { computeMaxDiffScores } from '../../lib/maxdiff';
import {
  computeTrueSkillFromMatches,
  matchesFromForcedChoiceAnswer,
  matchesFromMaxDiffAnswer,
} from '../../lib/trueskill';
import {
  TrueSkillTable,
  TrueSkillMuChart,
  exportTrueSkillCsv,
  TRUESKILL_SORT_COLUMNS,
  MAXDIFF_EXTRA_COLUMNS,
} from './trueSkillAnalysisUi';
import {
  aggregateSegmentTimelineByVideo,
  aggregateContinuousRatingByVideo,
} from '../../lib/videoStats';
import { wordFrequency } from '../../lib/textStats';
import { downloadTextFile } from '../../lib/methodsExport';
import { mediaFilenameKey, imageStimulusKey } from '../../lib/skillMediaUtils';
import { resolveEmotionIntensity, getEmotionPalette, nearestPaletteOption } from '../../lib/emotionColor';
import {
  DensityHistogramChart,
  DescriptiveStatsLine,
  TimelineAreaChart,
  ContinuousRatingChart,
  HueWheelChart,
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

function SkillMediaRanking({ title, items, resolveUrl, maxValue, minValue, formatLabel }) {
  if (!items?.length) return null;
  const values = items.map((i) => i.value);
  const lo = minValue ?? Math.min(0, ...values);
  const hi = maxValue ?? Math.max(...values, 0.001);
  const signed = lo < 0;
  const absPeak = Math.max(Math.abs(lo), Math.abs(hi), 0.001);

  return (
    <Box sx={{ mb: 3 }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>
      )}
      {items.map(({ key, url, value, label }, idx) => {
        const color = BAR_COLORS[idx % BAR_COLORS.length];
        const negColor = '#c62828';
        const posColor = color;
        let bar;
        if (signed) {
          const pctWidth = Math.min(50, (Math.abs(value) / absPeak) * 50);
          bar = (
            <Box sx={{ height: 12, bgcolor: 'grey.100', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
              <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', bgcolor: 'grey.400', zIndex: 1 }} />
              {value < 0 ? (
                <Box
                  sx={{
                    position: 'absolute',
                    right: '50%',
                    width: `${pctWidth}%`,
                    height: '100%',
                    bgcolor: negColor,
                    borderRadius: 1,
                  }}
                />
              ) : value > 0 ? (
                <Box
                  sx={{
                    position: 'absolute',
                    left: '50%',
                    width: `${pctWidth}%`,
                    height: '100%',
                    bgcolor: posColor,
                    borderRadius: 1,
                  }}
                />
              ) : null}
            </Box>
          );
        } else {
          const widthPct = Math.max(0, Math.min(100, Math.round((value / absPeak) * 100)));
          bar = (
            <Box sx={{ height: 12, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${widthPct}%`, bgcolor: color, borderRadius: 1 }} />
            </Box>
          );
        }
        return (
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
              {bar}
            </Box>
          </Box>
        );
      })}
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

/** Forced-Choice A/B — same TrueSkill view as Image Choice (winner ≻ other shown). */
export function ForcedChoicePreferenceAnalysis({ answers, question }) {
  const { matches, rankings } = useMemo(() => {
    const allMatches = [];
    for (const { answer, shown_images: shown } of answers || []) {
      if (!answer || typeof answer !== 'object') continue;
      allMatches.push(...matchesFromForcedChoiceAnswer(answer, shown));
    }
    return computeTrueSkillFromMatches(allMatches);
  }, [answers]);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        TrueSkill (pairwise from forced-choice A/B)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Each trial: the chosen image beats the other shown image
        ({matches.length} pairwise outcome{matches.length === 1 ? '' : 's'}).
      </Typography>
      {matches.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Not enough pairwise comparisons for TrueSkill (need participants to pick A or B
          among two shown images).
        </Alert>
      ) : (
        <>
          <TrueSkillMuChart rankings={rankings} />
          <TrueSkillTable
            rankings={rankings}
            caption="Forced choice: selected image wins over the other shown image. Click a column header to sort (default: μ descending)."
            onExport={() => exportTrueSkillCsv(
              question?.name || 'forced_choice',
              rankings,
              'mu',
              'desc',
            )}
          />
        </>
      )}
    </Box>
  );
}

export function PairwisePreferenceAnalysis({ answers }) {
  const resolveUrl = useMediaResolver();
  const prefs = answers.map((a) => Number(a.answer?.preference)).filter((n) => !Number.isNaN(n));
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

  return (
    <Box>
      <DescriptiveStatsLine nums={prefs} unit="" />
      <DensityHistogramChart
        scores={prefs}
        domainMin={-100}
        domainMax={100}
        title="Preference distribution"
        xLabel="Preference (−100 = A, +100 = B)"
      />
      <SkillMediaRanking
        title="Preference score by image (−100 = least preferred, +100 = most preferred)"
        items={perImage}
        resolveUrl={resolveUrl}
        minValue={-100}
        maxValue={100}
        formatLabel={(value, label) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} · ${label}`}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Hard to decide: {hardCount} / {answers.length} ({pct(hardCount, answers.length)}%)
      </Typography>
    </Box>
  );
}

export function MaxDiffAnalysis({ answers, question, mediaCount = 4 }) {
  const count = question?.skillConfig?.mediaCount || mediaCount;

  const { rankings, matches, tsMerged } = useMemo(() => {
    const bwsRows = computeMaxDiffScores(answers, count);
    const allMatches = [];
    for (const { answer, shown_images: shown } of answers || []) {
      if (!answer || typeof answer !== 'object') continue;
      if (answer.bestIndex == null || answer.worstIndex == null) continue;
      allMatches.push(...matchesFromMaxDiffAnswer(answer, shown?.length ? shown : answer.shownUrls));
    }
    const { matches: m, rankings: tsRows } = computeTrueSkillFromMatches(allMatches);
    const byKey = new Map((tsRows || []).map((r) => [r.imageKey, r]));
    const merged = bwsRows.map((row) => {
      const ts = byKey.get(row.imageKey) || {};
      return {
        imageKey: row.imageKey,
        displayUrl: row.imageUrl || null,
        bws: row.bws,
        scoreStd5: row.scoreStd5,
        best: row.best,
        worst: row.worst,
        appearances: row.appearances,
        mu: ts.mu ?? null,
        muStd5: ts.muStd5 ?? null,
        sigma: ts.sigma ?? null,
        conservative: ts.conservative ?? null,
        wins: ts.wins ?? 0,
        losses: ts.losses ?? 0,
        games: ts.games ?? 0,
      };
    });
    byKey.forEach((ts, key) => {
      if (!merged.some((r) => r.imageKey === key)) {
        merged.push({
          imageKey: key,
          displayUrl: null,
          bws: null,
          scoreStd5: null,
          best: 0,
          worst: 0,
          appearances: 0,
          ...ts,
        });
      }
    });
    return { rankings: bwsRows, matches: m, tsMerged: merged };
  }, [answers, count]);

  if (!rankings.length) {
    return <Typography variant="body2" color="text.secondary">No complete MaxDiff selections yet.</Typography>;
  }

  const maxDiffColumns = [...MAXDIFF_EXTRA_COLUMNS, ...TRUESKILL_SORT_COLUMNS];
  const bwsStdScores = tsMerged.map((r) => r.scoreStd5).filter((v) => v != null && !Number.isNaN(v));
  const muStdScores = tsMerged.map((r) => r.muStd5).filter((v) => v != null && !Number.isNaN(v));

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        MaxDiff — TrueSkill
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        From each trial: best beats every other shown image; each middle image beats worst
        ({matches.length} pairwise outcomes).
      </Typography>
      {matches.length === 0 ? (
        <Alert severity="warning">Not enough MaxDiff comparisons for TrueSkill yet.</Alert>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 2,
              mb: 1,
            }}
          >
            <DensityHistogramChart
              scores={bwsStdScores}
              domainMin={0}
              domainMax={5}
              title="BWS std (0–5)"
              xLabel="Standardized BWS (0–5)"
              padB={36}
            />
            <DensityHistogramChart
              scores={muStdScores}
              domainMin={0}
              domainMax={5}
              title="μ std (0–5)"
              xLabel="Standardized μ (0–5)"
              padB={36}
            />
          </Box>
          <TrueSkillTable
            rankings={tsMerged}
            columns={maxDiffColumns}
            title="MaxDiff TrueSkill + BWS stats"
            caption="Best ≻ others; middles ≻ worst. BWS columns are classical MaxDiff summaries. Default sort: μ descending."
            onExport={() => exportTrueSkillCsv(
              question?.name || 'maxdiff',
              tsMerged,
              'mu',
              'desc',
              MAXDIFF_EXTRA_COLUMNS,
            )}
          />
        </>
      )}
    </Box>
  );
}

export function VideoMomentAnalysis({ answers, questionName }) {
  const resolveUrl = useMediaResolver();
  const byVideo = useMemo(() => aggregateSegmentTimelineByVideo(answers), [answers]);
  const [tab, setTab] = useState(0);
  const safeTab = Math.min(tab, Math.max(0, byVideo.length - 1));
  const current = byVideo[safeTab];

  if (!byVideo.length) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  const exportCsv = () => {
    const lines = ['video,time_s,participant_count,proportion'];
    byVideo.forEach(({ videoKey, agg }) => {
      agg.timeline.forEach((p) => {
        lines.push(`${JSON.stringify(videoKey)},${p.t},${p.count},${p.proportion.toFixed(4)}`);
      });
    });
    downloadTextFile(lines.join('\n'), `${questionName}_video_moments_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const segCounts = (current?.answers || []).map((a) => (a.answer?.segments || []).length);
  const stats = descriptiveStats(segCounts);
  const durations = (current?.answers || [])
    .map((a) => Number(a.answer?.duration))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const previewUrl = current?.answers?.find((a) => a.answer?.posterUrl)?.answer?.posterUrl
    || current?.videoUrl;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Key moments by video
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Each tab is one video stimulus. Timeline shows overlap among participants who saw that video.
      </Typography>
      {byVideo.length > 1 && (
        <Tabs
          value={safeTab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            mb: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
          }}
        >
          {byVideo.map((g) => (
            <Tab
              key={g.videoKey}
              label={`${shortName(g.videoKey)} (${g.answers.length})`}
            />
          ))}
        </Tabs>
      )}
      {current && (
        <>
          <StimulusPreview url={previewUrl} resolveUrl={resolveUrl} label={current.videoKey} />
          {byVideo.length === 1 && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Video: {shortName(current.videoKey)}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Responses: {current.answers.length}
            {' · '}
            Segments: mean {stats.mean?.toFixed(1) ?? '—'}
            {' · '}
            total {segCounts.reduce((a, b) => a + b, 0)}
            {durations.length
              ? ` · video duration ~${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)}s`
              : ''}
          </Typography>
          <TimelineAreaChart
            timeline={current.agg.timeline}
            title={`Key moment overlap — ${shortName(current.videoKey)}`}
            duration={current.agg.duration}
          />
          {current.agg.peakTime != null && (
            <Alert severity="info" sx={{ mb: 1 }}>
              Peak tagging at t={current.agg.peakTime}s
              {' '}
              ({(current.agg.peakProportion * 100).toFixed(0)}% of participants for this video)
            </Alert>
          )}
        </>
      )}
      <Button size="small" variant="outlined" startIcon={<Download />} onClick={exportCsv}>
        Export timeline CSV{byVideo.length > 1 ? ' (all videos)' : ''}
      </Button>
    </Box>
  );
}

export function ContinuousVideoRatingAnalysis({ answers, questionName }) {
  const resolveUrl = useMediaResolver();
  const byVideo = useMemo(() => aggregateContinuousRatingByVideo(answers), [answers]);
  const [tab, setTab] = useState(0);
  const safeTab = Math.min(tab, Math.max(0, byVideo.length - 1));
  const current = byVideo[safeTab];

  if (!byVideo.length) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  const exportCsv = () => {
    const lines = ['video,time_s,mean,sd,n'];
    byVideo.forEach(({ videoKey, agg }) => {
      agg.timeline.forEach((p) => {
        lines.push(`${JSON.stringify(videoKey)},${p.t},${p.mean.toFixed(2)},${(p.sd || 0).toFixed(2)},${p.n}`);
      });
    });
    downloadTextFile(lines.join('\n'), `${questionName}_video_rating_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Continuous rating by video
      </Typography>
      {byVideo.length > 1 && (
        <Tabs
          value={safeTab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            mb: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
          }}
        >
          {byVideo.map((g) => (
            <Tab key={g.videoKey} label={`${shortName(g.videoKey)} (${g.answers.length})`} />
          ))}
        </Tabs>
      )}
      {current && (
        <>
          <StimulusPreview
            url={current.videoUrl}
            resolveUrl={resolveUrl}
            label={current.videoKey}
          />
          {byVideo.length === 1 && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Video: {shortName(current.videoKey)}
            </Typography>
          )}
          <DescriptiveStatsLine nums={current.means} unit="" />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {current.answers.length} response(s) · {current.agg.sampleCount} timeline samples
            · mean {current.agg.globalMean?.toFixed(1) ?? '—'}
          </Typography>
          <ContinuousRatingChart
            timeline={current.agg.timeline}
            title={`Mean rating over time — ${shortName(current.videoKey)}`}
          />
        </>
      )}
      <Button size="small" variant="outlined" startIcon={<Download />} onClick={exportCsv}>
        Export timeline CSV{byVideo.length > 1 ? ' (all videos)' : ''}
      </Button>
    </Box>
  );
}

function circularMeanHue(hues) {
  if (!hues?.length) return null;
  const sin = hues.reduce((s, h) => s + Math.sin((h * Math.PI) / 180), 0);
  const cos = hues.reduce((s, h) => s + Math.cos((h * Math.PI) / 180), 0);
  return ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
}

/** Circular SD in degrees — higher means respondents disagreed on hue for the same image. */
function circularHueSd(hues) {
  if (!hues || hues.length < 2) return 0;
  const sin = hues.reduce((s, h) => s + Math.sin((h * Math.PI) / 180), 0);
  const cos = hues.reduce((s, h) => s + Math.cos((h * Math.PI) / 180), 0);
  const r = Math.sqrt(sin * sin + cos * cos) / hues.length;
  if (r >= 1 - 1e-9) return 0;
  if (r < 1e-9) return 180;
  return Math.sqrt(-2 * Math.log(r)) * (180 / Math.PI);
}

function resolveColorOption(color, paletteId) {
  if (color?.optionId) {
    const palette = getEmotionPalette(paletteId);
    const hit = palette.options.find((o) => o.id === color.optionId);
    if (hit) return hit;
  }
  return nearestPaletteOption(paletteId, color?.hue, color?.s, color?.l);
}

function majorityOptionId(colors, paletteId) {
  const counts = {};
  colors.forEach((c) => {
    const opt = resolveColorOption(c, paletteId);
    if (!opt) return;
    counts[opt.id] = (counts[opt.id] || 0) + 1;
  });
  let bestId = null;
  let bestN = -1;
  Object.entries(counts).forEach(([id, n]) => {
    if (n > bestN) {
      bestN = n;
      bestId = id;
    }
  });
  return bestId;
}

export function EmotionColorAnalysis({ answers, question }) {
  const resolveUrl = useMediaResolver();
  const [selectedOptionId, setSelectedOptionId] = useState(null);

  const paletteId = question?.skillConfig?.palette || 'hue12';
  const responseMode = question?.skillConfig?.responseMode || 'palette';
  const palette = useMemo(() => getEmotionPalette(paletteId), [paletteId]);

  const { colors, intensities, optionBuckets, byStimulus, n, imagesPerOption } = useMemo(() => {
    const colorList = [];
    const byImg = {};

    for (const { answer, shown_images: shown } of answers || []) {
      const c = answer?.color;
      if (!c || typeof c !== 'object') continue;
      colorList.push(c);

      const stimUrl = answer?.imageUrl
        || (shown?.length ? (typeof shown[0] === 'string' ? shown[0] : shown[0]?.url) : null);
      const key = stimUrl ? mediaFilenameKey(stimUrl) : '_unknown';
      if (!byImg[key]) byImg[key] = { key, url: stimUrl, colors: [], intensities: [] };
      byImg[key].colors.push(c);
      const inten = resolveEmotionIntensity(c);
      if (inten != null) byImg[key].intensities.push(inten);
      if (stimUrl && !byImg[key].url) byImg[key].url = stimUrl;
    }

    const buckets = palette.options.map((opt) => ({
      id: opt.id,
      label: opt.label,
      hue: opt.hue,
      color: opt.hex,
      count: 0,
    }));
    const bucketIndex = Object.fromEntries(buckets.map((b, i) => [b.id, i]));
    colorList.forEach((c) => {
      const opt = resolveColorOption(c, paletteId);
      if (opt && bucketIndex[opt.id] != null) buckets[bucketIndex[opt.id]].count += 1;
    });

    const inten = colorList
      .map((c) => resolveEmotionIntensity(c))
      .filter((v) => v != null);

    const stimulusRows = Object.values(byImg)
      .filter((row) => row.key !== '_unknown')
      .map((row) => {
        const hues = row.colors.map((c) => Number(c.hue)).filter((h) => !Number.isNaN(h));
        const meanHue = circularMeanHue(hues);
        const meanInt = row.intensities.length
          ? row.intensities.reduce((a, b) => a + b, 0) / row.intensities.length
          : null;
        const majId = majorityOptionId(row.colors, paletteId);
        const majOpt = palette.options.find((o) => o.id === majId)
          || nearestPaletteOption(paletteId, meanHue, 50, 50);
        const hueSd = circularHueSd(hues);
        const pickHexes = row.colors.map((c) => c.hex).filter(Boolean);
        const optionIds = [...new Set(row.colors.map((c) => resolveColorOption(c, paletteId)?.id).filter(Boolean))];
        return {
          ...row,
          n: row.colors.length,
          meanHue,
          meanInt,
          meanHex: majOpt?.hex || row.colors[0]?.hex || '#9e9e9e',
          optionId: majOpt?.id || null,
          optionLabel: majOpt?.label || null,
          hueSd,
          pickHexes,
          optionIds,
        };
      });

    const perOption = Object.fromEntries(palette.options.map((o) => [o.id, 0]));
    stimulusRows.forEach((row) => {
      if (row.optionId && perOption[row.optionId] != null) perOption[row.optionId] += 1;
    });

    return {
      colors: colorList,
      intensities: inten,
      optionBuckets: buckets,
      byStimulus: stimulusRows,
      n: colorList.length,
      imagesPerOption: perOption,
    };
  }, [answers, palette, paletteId]);

  const effectiveOptionId = useMemo(() => {
    if (selectedOptionId && imagesPerOption[selectedOptionId] != null) return selectedOptionId;
    let best = palette.options[0]?.id || null;
    let bestN = -1;
    Object.entries(imagesPerOption).forEach(([id, count]) => {
      if (count > bestN) {
        bestN = count;
        best = id;
      }
    });
    return best;
  }, [selectedOptionId, imagesPerOption, palette.options]);

  if (!n) {
    return <Typography variant="body2" color="text.secondary">No emotion color responses yet.</Typography>;
  }

  const overallMeanHue = circularMeanHue(
    colors.map((c) => Number(c.hue)).filter((h) => !Number.isNaN(h)),
  );
  const effectiveOpt = palette.options.find((o) => o.id === effectiveOptionId);
  const filteredRows = byStimulus
    .filter((row) => row.optionId === effectiveOptionId)
    .sort((a, b) => {
      if (a.meanInt != null && b.meanInt != null) return b.meanInt - a.meanInt;
      if (a.meanInt != null) return -1;
      if (b.meanInt != null) return 1;
      return (b.n || 0) - (a.n || 0) || String(a.key).localeCompare(String(b.key));
    });

  const showIntensity = intensities.length > 0
    && (responseMode === 'wheel' || responseMode === 'image_or_wheel'
      || (Math.max(...intensities) - Math.min(...intensities) > 1));

  // HueWheelChart expects { hue, count, color } — reuse option buckets shaped similarly
  const hueBucketsForChart = optionBuckets.map((b) => ({
    hue: b.hue ?? 0,
    count: b.count,
    color: b.color,
  }));

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Emotion color responses
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        {n} color pick{n === 1 ? '' : 's'}
        {' · '}palette: {palette.label}
        {' · '}mode: {responseMode}
        {overallMeanHue != null && (
          <>
            {' · '}circular mean hue {Math.round(overallMeanHue)}°
          </>
        )}
      </Typography>
      {palette.note && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          {palette.note}
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: showIntensity ? '1fr 1fr' : '1fr' },
          gap: 2,
          mb: 2,
        }}
      >
        {showIntensity ? (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Vividness (from color)</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              From saturation × mid-lightness for wheel/image picks. Hue alone does not change this —
              same radius on the wheel ≈ same vividness. Palette-chip answers have no vividness score.
            </Typography>
            <DescriptiveStatsLine nums={intensities} unit="" />
            <DensityHistogramChart
              scores={intensities}
              domainMin={0}
              domainMax={100}
              title="Vividness distribution (0–100)"
              xLabel="Vividness"
              padB={36}
              chartH={220}
            />
          </Box>
        ) : (
          <Alert severity="info" sx={{ mb: 0 }}>
            Palette mode records a color <em>category</em>, not vividness. Intensity/vividness only applies
            when participants use the hue wheel or sample from the image (where saturation/lightness vary).
          </Alert>
        )}
        <Box>
          <HueWheelChart hueBuckets={hueBucketsForChart} />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Counts mapped onto the survey palette categories.
          </Typography>
        </Box>
      </Box>

      {byStimulus.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Images in “{effectiveOpt?.label || effectiveOptionId}”
            {showIntensity ? ' (by vividness)' : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Select one palette category. Multi-respondent images use majority category
            {showIntensity ? '; sorted by mean vividness.' : '.'}
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
            {optionBuckets.map((b) => {
              const on = effectiveOptionId === b.id;
              const imgN = imagesPerOption[b.id] || 0;
              return (
                <Box
                  key={b.id}
                  component="button"
                  type="button"
                  onClick={() => setSelectedOptionId(b.id)}
                  title={`${b.label} · ${imgN} image(s) · ${b.count} pick(s)`}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: 0.75,
                    bgcolor: b.color,
                    border: '2px solid',
                    borderColor: on ? 'text.primary' : 'divider',
                    opacity: on ? 1 : (imgN ? 0.55 : 0.22),
                    cursor: 'pointer',
                    p: 0,
                    transform: on ? 'scale(1.12)' : 'none',
                  }}
                />
              );
            })}
          </Box>

          {filteredRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No images in “{effectiveOpt?.label || effectiveOptionId}”.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {filteredRows.map((row) => (
                <Box
                  key={row.key}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  {resolveUrl(row.url) ? (
                    <Box
                      component="img"
                      src={resolveUrl(row.url)}
                      alt={row.key}
                      sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
                    />
                  ) : (
                    <Box sx={{ width: 40, height: 40, bgcolor: 'grey.100', borderRadius: 0.5, flexShrink: 0 }} />
                  )}
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: 0.5,
                      bgcolor: row.meanHex,
                      border: '1px solid',
                      borderColor: 'divider',
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" noWrap display="block">{shortName(row.key)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.meanInt != null ? `vividness ${row.meanInt.toFixed(0)} · ` : ''}
                      {row.optionLabel ? `${row.optionLabel} · ` : ''}
                      n={row.n}
                      {row.optionIds?.length > 1 ? ` · categories vary (${row.optionIds.length})` : ''}
                    </Typography>
                    {row.n > 1 && row.pickHexes.length > 0 && (
                      <Box sx={{ display: 'flex', gap: 0.4, mt: 0.5, flexWrap: 'wrap' }}>
                        {row.pickHexes.slice(0, 12).map((hex, i) => (
                          <Box
                            key={`${hex}-${i}`}
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: 0.25,
                              bgcolor: hex,
                              border: '1px solid',
                              borderColor: 'divider',
                            }}
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export function CompositeBlocksAnalysis({ answers }) {
  const resolveUrl = useMediaResolver();
  const { tabs, nResp } = useMemo(() => {
    const dimMap = new Map(); // dimId → { id, left, right, label, values, byImage }
    const words = [];
    const choices = [];
    const texts = [];
    let n = 0;

    for (const entry of answers || []) {
      const answer = entry?.answer;
      if (!answer || typeof answer !== 'object') continue;
      n += 1;
      const imgKey = imageStimulusKey(answer, entry.shown_images);
      const imgUrl = answer.imageUrl || entry.shown_images?.[0] || null;

      (answer.ratings || []).forEach((d) => {
        const id = d.id || d.label || `${d.left}/${d.right}` || 'dim';
        if (!dimMap.has(id)) {
          dimMap.set(id, {
            id,
            left: d.left,
            right: d.right,
            label: d.label || id,
            values: [],
            byImage: new Map(),
          });
        }
        const dim = dimMap.get(id);
        if (d.left && !dim.left) dim.left = d.left;
        if (d.right && !dim.right) dim.right = d.right;
        const num = Number(d.value);
        if (Number.isNaN(num)) return;
        dim.values.push(num);
        if (!dim.byImage.has(imgKey)) {
          dim.byImage.set(imgKey, { key: imgKey, url: imgUrl, values: [] });
        }
        const row = dim.byImage.get(imgKey);
        if (!row.url && imgUrl) row.url = imgUrl;
        row.values.push(num);
      });

      (answer.words || []).forEach((w) => {
        if (w != null && w !== '') words.push(String(w));
      });
      if (answer.choice != null && answer.choice !== '') choices.push(String(answer.choice));
      if (answer.text) texts.push(String(answer.text));
    }

    const attrTabs = [];
    [...dimMap.values()]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach((dim) => {
        const ranking = [...dim.byImage.values()]
          .map((row) => ({
            key: row.key,
            url: row.url,
            value: row.values.reduce((s, v) => s + v, 0) / row.values.length,
            label: `n=${row.values.length}`,
            n: row.values.length,
          }))
          .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
        const tabLabel = dim.left && dim.right
          ? `${dim.left} → ${dim.right}`
          : (dim.label || dim.id);
        attrTabs.push({
          kind: 'dimension',
          key: `dim:${dim.id}`,
          label: tabLabel,
          dim,
          ranking,
        });
      });

    if (words.length) {
      attrTabs.push({
        kind: 'words',
        key: 'words',
        label: `Words (${words.length})`,
        wordFreq: wordFrequency(words, 20),
        nWords: words.length,
      });
    }
    if (choices.length) {
      const choiceFreq = {};
      choices.forEach((c) => { choiceFreq[c] = (choiceFreq[c] || 0) + 1; });
      attrTabs.push({
        kind: 'choice',
        key: 'choice',
        label: `Choice (${choices.length})`,
        choiceFreq,
        nChoices: choices.length,
      });
    }
    if (texts.length) {
      attrTabs.push({
        kind: 'text',
        key: 'text',
        label: `Text (${texts.length})`,
        texts,
      });
    }

    return { tabs: attrTabs, nResp: n };
  }, [answers]);

  const [tab, setTab] = useState(0);
  const safeTab = Math.min(tab, Math.max(0, tabs.length - 1));
  const current = tabs[safeTab];

  if (!nResp || !tabs.length) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Composite results by attribute
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {nResp} response{nResp === 1 ? '' : 's'} · tabs are rating dimensions / blocks (images ranked within each)
      </Typography>
      {tabs.length > 1 && (
        <Tabs
          value={safeTab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            mb: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
          }}
        >
          {tabs.map((t) => (
            <Tab key={t.key} label={t.label} />
          ))}
        </Tabs>
      )}
      {tabs.length === 1 && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Attribute: {current.label}
        </Typography>
      )}

      {current?.kind === 'dimension' && (
        <Box>
          <DescriptiveStatsLine nums={current.dim.values} unit="" />
          <SkillMediaRanking
            title={`Images by mean (${current.label})`}
            items={current.ranking}
            resolveUrl={resolveUrl}
            formatLabel={(v, label) => `${Number(v).toFixed(2)}${label ? ` · ${label}` : ''}`}
          />
        </Box>
      )}
      {current?.kind === 'words' && (
        <WordFrequencyChart words={current.wordFreq} totalResponses={nResp} />
      )}
      {current?.kind === 'choice' && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Choice frequency</Typography>
          {Object.entries(current.choiceFreq)
            .sort((a, b) => b[1] - a[1])
            .map(([val, count], idx) => (
              <HorizontalBar
                key={val}
                label={String(val)}
                count={count}
                total={current.nChoices}
                index={idx}
              />
            ))}
        </Box>
      )}
      {current?.kind === 'text' && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Text responses</Typography>
          {current.texts.slice(0, 12).map((t, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1, mb: 0.5, bgcolor: 'grey.50' }}>
              <Typography variant="body2">{t}</Typography>
            </Paper>
          ))}
          {current.texts.length > 12 && (
            <Typography variant="caption" color="text.secondary">
              Showing 12 of {current.texts.length}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

export function getPresetSkillAnalysis(skillId) {
  const id = skillId?.replace(/^preset_/, '');
  const map = {
    image_preference_slider: PairwisePreferenceAnalysis,
    image_preference_forced: ForcedChoicePreferenceAnalysis,
    best_worst_choice: MaxDiffAnalysis,
    video_moment_tag: VideoMomentAnalysis,
    video_continuous_rating: ContinuousVideoRatingAnalysis,
    emotion_color_picker: EmotionColorAnalysis,
    composite_blocks: CompositeBlocksAnalysis,
  };
  return map[id] || null;
}
