import React, { useMemo, useState } from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Alert, Box, Button, Chip, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { mediaDisplayName, stimulusUnitLabel } from '../../lib/mediaIdentity';
import { objectsToCsv } from '../../lib/csvUtil';
import { downloadPerceptionFile } from '../../lib/imagePerceptionJoin';
import { COVERAGE_THRESHOLDS, aggregateByParam, annotationBaseImage, annotationNotes, choiceRetestKappa, comparisonCounts, coverageSummary, evaluativeMap, imageChoiceShares, longFormatRows, pairChoiceShares, pairwiseGroupComparison, pairwiseOutcomes, participantGroupMap, perStimulusStats, qScores, raterAgreement, ratingGroupComparison, ratingRetestKappa, responseGroups, robustStimulusStats, samePositionParticipants, scaleScores, splitHalfReliability, stimulusObservations, thresholdLabels, trueSkillScores, BFI10_KEY } from '../../lib/paperMethods';
import { isReverseCoded, pooledQuestions, recommendationsForQuestion, reverseCodingFor } from '../../lib/analysisRecommendation';
import { reverseCodedConditions } from '../../lib/surveyRuntimeContext';
import { computeQuestionTrueSkill, splitsTrueSkillByCategory, trueSkillBoards } from '../../lib/trueskill';
import { TrueSkillBoardStack, TrueSkillMuChart, TrueSkillTable, exportTrueSkillCsv } from './trueSkillAnalysisUi';
const NUMERIC = new Set(['rating', 'imagerating', 'mediarating', 'slidergroup', 'imageslidergroup', 'mediaslidergroup', 'matrix', 'imagematrix', 'mediamatrix', 'boolean', 'imageboolean', 'mediaboolean', 'number']);
const GROUPABLE = new Set(['radiogroup', 'dropdown', 'boolean', 'rating', 'text']);
const fmt = (v, d = 2) => v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d);
const nameOf = (key) => String(key).startsWith('[') ? stimulusUnitLabel(key) : mediaDisplayName(key) || key;
const csv = (rows, file) => {
  if (!rows.length) return;
  downloadPerceptionFile(objectsToCsv(Object.keys(rows[0]), rows), file, 'text/csv;charset=utf-8');
};
function flatQuestions(config) {
  const out = [];
  const walk = (els) => (els || []).forEach((e) => {
    out.push(e);
    if (e.elements) walk(e.elements);
  });
  (config?.pages || []).forEach((p) => walk(p.elements));
  return out;
}
function ScoreTable({
  rows,
  columns,
  limit = 30
}) {
  if (!rows.length) return null;
  return <Box sx={{
    overflowX: 'auto',
    mb: 1
  }}>
      <Table size="small">
        <TableHead><TableRow>{columns.map((c) => <TableCell key={c.key}>{c.label}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.slice(0, limit).map((r, i) => <TableRow key={i}>{columns.map((c) => <TableCell key={c.key} sx={{
            maxWidth: 260,
            overflowWrap: 'anywhere'
          }}>{c.render ? c.render(r) : r[c.key]}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
      {rows.length > limit && <Typography variant="caption">{rows.length - limit} more rows in the CSV export.</Typography>}
    </Box>;
}
function useGroupOptions(surveyConfig, responses, zh) {
  return useMemo(() => {
    const opts = [];
    if (Array.isArray(surveyConfig?.conditions) && surveyConfig.conditions.length > 1) opts.push({
      id: 'condition',
      label: uiPair(zh ? "zh" : "en", 'Condition', '被试间条件'),
      groupBy: {
        type: 'condition'
      }
    });
    const params = [...new Set((responses || []).flatMap((r) => Object.keys(r?.survey_metadata?.url_params || {})))];
    params.forEach((p) => opts.push({
      id: `url:${p}`,
      label: `URL: ${p}`,
      groupBy: {
        type: 'urlParam',
        name: p
      }
    }));
    const qs = flatQuestions(surveyConfig);
    qs.filter((q) => GROUPABLE.has(q.type) && !q.isAttentionCheck).forEach((q) => opts.push({
      id: `q:${q.name}`,
      label: q.title || q.name,
      groupBy: q.type === 'rating' ? {
        type: 'numeric',
        name: q.name,
        split: 'median'
      } : {
        type: 'question',
        name: q.name
      }
    }));
    const bfi = qs.filter((q) => /^personality_\d+$/.test(q.name)).sort((a, b) => Number(a.name.split('_')[1]) - Number(b.name.split('_')[1]));
    if (bfi.length === 10) Object.keys(BFI10_KEY).forEach((trait) => opts.push({
      id: `bfi:${trait}`,
      label: `BFI-10 ${trait} (median split)`,
      groupBy: {
        type: 'bfi',
        trait,
        items: bfi,
        split: 'median'
      }
    }));
    return opts;
  }, [surveyConfig, responses, zh]);
}
function GroupComparison({
  result,
  zh
}) {
  if (!result?.boards?.length) return <Typography variant="caption">{uiPair(zh ? "zh" : "en", 'No responses in these groups.', '没有可分组的回答。')}</Typography>;
  const t = result.test || {};
  return <Box>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{
      mb: 1
    }}>
        {result.boards.map((b) => <Chip key={b.group} size="small" color={b.lowCoverage ? 'warning' : 'default'} label={`${b.group}: ${b.participants} ${uiPair(zh ? "zh" : "en", 'participants', '人')}`} />)}
      </Stack>
      {result.correlations.map((c) => <Typography key={`${c.a}-${c.b}`} variant="body2">{`${c.a} vs ${c.b}: Spearman ρ = ${fmt(c.rho)} (${c.n} ${uiPair(zh ? "zh" : "en", 'images', '张图')})`}</Typography>)}
      {t.p != null && <Typography variant="body2">
          {t.kind === 'welch_t' ? `Welch t(${fmt(t.df, 1)}) = ${fmt(t.t)}, p = ${fmt(t.p, 3)}` : `Welch F(${fmt(t.df1, 0)}, ${fmt(t.df2, 1)}) = ${fmt(t.F)}, p = ${fmt(t.p, 3)}`}
        </Typography>}
      <Typography variant="caption" display="block">
        {uiPair(zh ? "zh" : "en", 'Tested on participant-level agreement with the pooled ranking (pairwise) or participant mean ratings (ratings). Exploratory.', '检验对象：每位参与者与总体排名一致的比例（两两比较），或参与者平均评分（评分题）。仅供探索。')}
      </Typography>
    </Box>;
}
function responsesForQuestion(questionName, responses) {
  return (responses || []).filter((row) => {
    if (row.survey_metadata?.practice_mode) return row.survey_metadata?.practice_question === questionName;
    return true;
  });
}

/** One ranking per category when the question shows a single category on each trial. */
function categoryGroups(outcomes, split) {
  if (!split || !(outcomes || []).some((outcome) => outcome.category)) {
    return [{
      category: null,
      label: null,
      outcomes: outcomes || []
    }];
  }
  const groups = new Map();
  outcomes.forEach((outcome) => {
    const key = outcome.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(outcome);
  });
  return [...groups.entries()].sort(([a], [b]) => {
    if (!a && b) return 1;
    if (a && !b) return -1;
    return String(a).localeCompare(String(b));
  }).map(([category, list]) => ({
    category: category || null,
    label: category || 'Uncategorized',
    outcomes: list
  }));
}

/** Choice share inside one set of outcomes. Ties count as shown, not chosen. */
function choiceSharesFromOutcomes(outcomes) {
  const trials = new Map();
  (outcomes || []).forEach((outcome) => {
    const key = `${outcome.participant}|${outcome.question}|${outcome.trial}`;
    if (!trials.has(key)) trials.set(key, {
      shown: new Set(),
      chosen: new Set(),
      tie: false
    });
    const trial = trials.get(key);
    [outcome.a, outcome.b, outcome.winner, outcome.loser].forEach((image) => {
      if (image) trial.shown.add(image);
    });
    if (outcome.tie) trial.tie = true;
    else if (outcome.winner) trial.chosen.add(outcome.winner);
  });
  const stats = new Map();
  trials.forEach((trial) => {
    trial.shown.forEach((image) => {
      if (!stats.has(image)) stats.set(image, {
        shown: 0,
        chosen: 0
      });
      const row = stats.get(image);
      row.shown += 1;
      if (!trial.tie && trial.chosen.has(image)) row.chosen += 1;
    });
  });
  return [...stats.entries()].map(([imageKey, row]) => ({
    imageKey,
    ...row,
    share: row.shown ? row.chosen / row.shown : null,
    score: row.shown ? row.chosen / row.shown : null
  })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** The histogram always uses a within-board 0–5 relative score. The table's second column is that score, or the selected scale in the same place. */
function chartRankings(rows) {
  return scaleScores(rows, 'score', '0-5', 'muStd5').map((row) => ({
    ...row,
    mu: row.score,
    games: row.comparisons ?? row.shown ?? row.games,
    wins: row.wins ?? row.W ?? row.chosen,
    losses: row.losses ?? row.L,
    ties: row.ties ?? 0,
    mark: Number.isFinite(row.label) ? row.label : row.mark,
    sigma: row.sigma ?? null,
    conservative: Number.isFinite(row.conservative) ? row.conservative : Number.isFinite(row.score) && Number.isFinite(row.sigma) ? row.score - 3 * row.sigma : null
  }));
}

function scaleColumn(method, scale) {
  if (scale === 'none') {
    return {
      id: 'muStd5',
      label: method === 'trueskill' ? 'Relative μ (0–5)' : 'Relative (0–5)',
      align: 'right'
    };
  }
  const label = scale === '0-10' ? '0–10' : scale === '0-5' ? '0–5' : scale === '0-1' ? '0–1' : scale;
  return {
    id: 'scaled',
    label,
    align: 'right'
  };
}

function analysisColumns(method, scale, runs, tieHandling, threshold) {
  const scaled = scaleColumn(method, scale);
  if (method === 'share') {
    return [{
      id: 'mu',
      label: 'Choice share',
      align: 'right'
    }, scaled, {
      id: 'games',
      label: 'Shown',
      align: 'right'
    }, {
      id: 'wins',
      label: 'Chosen',
      align: 'right'
    }, {
      id: 'mark',
      label: `≥${threshold}`,
      align: 'right'
    }];
  }
  if (method === 'qscore') {
    return [{
      id: 'mu',
      label: 'Q-score',
      align: 'right'
    }, scaled, {
      id: 'games',
      label: 'Comparisons',
      align: 'right'
    }, {
      id: 'wins',
      label: 'Wins',
      align: 'right'
    }, {
      id: 'losses',
      label: 'Losses',
      align: 'right'
    }, {
      id: 'ties',
      label: 'Ties',
      align: 'right'
    }];
  }
  const cols = [{
    id: 'mu',
    label: 'μ',
    align: 'right'
  }, scaled, {
    id: 'sigma',
    label: 'σ',
    align: 'right'
  }, {
    id: 'conservative',
    label: 'μ−3σ',
    align: 'right'
  }, {
    id: 'games',
    label: 'Games',
    align: 'right'
  }];
  if (tieHandling === 'draw') cols.push({
    id: 'ties',
    label: 'Ties',
    align: 'right'
  });
  if (Number(runs) > 1) cols.push({
    id: 'muSd',
    label: 'SD(μ)',
    align: 'right'
  });
  return cols;
}

const sectionTitleSx = {
  fontWeight: 600,
  mb: 1
};

function PairwiseMethods({
  question,
  responses,
  surveyConfig,
  zh,
  analysis = false
}) {
  const rec = recommendationsForQuestion(surveyConfig, question.name)[0] || {};
  const defaultMethod = rec.method === 'qscore_pairwise' ? 'qscore' : rec.method === 'choice_share' ? 'share' : 'trueskill';
  // The question chart stays on the existing TrueSkill ranking until a control changes.
  const [method, setMethod] = useState(analysis ? 'trueskill' : defaultMethod);
  const [tieHandling, setTieHandling] = useState(analysis ? 'exclude' : rec.tieHandling || 'exclude');
  const [runs, setRuns] = useState(analysis ? 1 : rec.runs || 1);
  const [scale, setScale] = useState(analysis ? 'none' : rec.scale || 'none');
  const [minComparisons, setMinComparisons] = useState(rec.minPerImage ?? (defaultMethod === 'qscore' ? 4 : 0));
  const [threshold, setThreshold] = useState(rec.threshold || 3);
  const [coverageMin, setCoverageMin] = useState(rec.minPerImage || (defaultMethod === 'qscore' ? COVERAGE_THRESHOLDS.qscore : COVERAGE_THRESHOLDS.trueskill));
  const pool = pooledQuestions(surveyConfig, question.name);
  const [pooled, setPooled] = useState(analysis ? false : pool.length > 1);
  const [groupId, setGroupId] = useState('');
  const [split, setSplit] = useState(null);
  const groupOptions = useGroupOptions(surveyConfig, responses, zh);
  const questionsByName = useMemo(() => Object.fromEntries(flatQuestions(surveyConfig).map((q) => [q.name, q])), [surveyConfig]);
  const outcomes = useMemo(() => {
    const names = pooled ? pool : [question.name];
    return names.flatMap((name) => pairwiseOutcomes(responses, name, {
      reverseCoded: reverseCodingFor(surveyConfig, questionsByName[name] || {
        name
      })
    }));
  }, [responses, pooled, pool, question.name, surveyConfig, questionsByName]);
  const options = useMemo(() => method === 'qscore' ? {
    minComparisons
  } : {
    tieHandling,
    runs,
    seed: 1
  }, [method, minComparisons, tieHandling, runs]);
  const splitCategories = splitsTrueSkillByCategory(question) && !pooled;
  const pooledShares = useMemo(() => {
    if (method !== 'share' || splitCategories) return [];
    const names = pooled ? pool : [question.name];
    const merged = new Map();
    names.forEach((name) => imageChoiceShares(responses, name, {
      reverseCoded: reverseCodingFor(surveyConfig, questionsByName[name] || {
        name
      })
    }).forEach((row) => {
      const current = merged.get(row.imageKey) || {
        imageKey: row.imageKey,
        shown: 0,
        chosen: 0
      };
      current.shown += row.shown;
      current.chosen += row.chosen;
      merged.set(row.imageKey, current);
    }));
    return [...merged.values()].map((row) => ({
      ...row,
      share: row.shown ? row.chosen / row.shown : null,
      score: row.shown ? row.chosen / row.shown : null
    }));
  }, [method, splitCategories, pooled, pool, question.name, responses, surveyConfig, questionsByName]);
  const coverage = useMemo(() => coverageSummary(comparisonCounts(outcomes), Number(coverageMin) || 0), [outcomes, coverageMin]);
  const retest = useMemo(() => choiceRetestKappa(outcomes), [outcomes]);
  const samePos = useMemo(() => samePositionParticipants(outcomes), [outcomes]);
  const pairs = useMemo(() => pairChoiceShares(outcomes), [outcomes]);
  const fixedPairs = pairs.length > 0 && pairs.length <= Math.max(1, outcomes.length / 3);
  const groupResult = useMemo(() => {
    const opt = groupOptions.find((o) => o.id === groupId);
    if (!opt) return null;
    const map = participantGroupMap(responses, responseGroups(responses, opt.groupBy, questionsByName));
    return pairwiseGroupComparison(outcomes, map, {
      method,
      options,
      minPerImage: Number(coverageMin) || 0
    });
  }, [groupId, groupOptions, responses, outcomes, method, options, questionsByName, coverageMin]);
  const official = analysis && method === 'trueskill' && tieHandling === 'exclude' && Number(runs) === 1 && scale === 'none' && !pooled;
  const officialResult = useMemo(() => {
    if (!official || !responses?.length || !question?.name) return null;
    return computeQuestionTrueSkill(responsesForQuestion(question.name, responses), question.name, question);
  }, [official, responses, question]);
  const boards = useMemo(() => {
    if (official) return officialResult ? trueSkillBoards(officialResult) : [];
    const scoreList = (list) => {
      if (method === 'qscore') return qScores(list, options).map((row) => ({
        ...row,
        score: row.qScore
      }));
      if (method === 'share') {
        const shares = splitCategories ? choiceSharesFromOutcomes(list) : pooledShares;
        return thresholdLabels(shares, threshold).map((row) => ({
          ...row,
          score: row.score ?? row.share
        }));
      }
      return trueSkillScores(list, options).rows.map((row) => ({
        ...row,
        score: row.mu
      }));
    };
    return categoryGroups(outcomes, splitCategories).map((group) => {
      const scored = scoreList(group.outcomes);
      const scaled = scale === 'none' ? scored : scaleScores(scored, 'score', scale);
      return {
        ...group,
        rankings: chartRankings(scaled)
      };
    }).filter((board) => board.rankings.length);
  }, [official, officialResult, method, options, outcomes, splitCategories, pooledShares, threshold, scale]);
  const columns = analysisColumns(method, scale, runs, tieHandling, threshold);
  const exportBoard = (board) => csv((board?.rankings || []).map((row) => ({
    category: board.category || '',
    image: row.imageKey,
    score: row.mu,
    relative_0_5: row.muStd5 ?? '',
    scaled: row.scaled ?? '',
    wins: row.wins ?? '',
    losses: row.losses ?? '',
    ties: row.ties ?? '',
    comparisons: row.games ?? '',
    mu_sd_across_runs: row.muSd ?? '',
    sigma: row.sigma ?? '',
    label: row.mark ?? ''
  })), `${question.name}${board.category ? `_${board.category}` : ''}_${method}_scores.csv`);
  const exportLong = () => csv((pooled ? pool : [question.name]).flatMap((name) => longFormatRows(responses, surveyConfig, name, {
    reverseCoded: reverseCodingFor(surveyConfig, questionsByName[name] || {
      name
    })
  })), `${question.name}_long_format.csv`);
  return <Stack gap={2}>
      <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
        <FormControl size="small" sx={{
        minWidth: 170
      }}>
          <InputLabel>{uiPair(zh ? "zh" : "en", 'Score', '计分方法')}</InputLabel>
          <Select label={uiPair(zh ? "zh" : "en", 'Score', '计分方法')} value={method} onChange={(e) => setMethod(e.target.value)}>
            <MenuItem value="trueskill">TrueSkill</MenuItem>
            <MenuItem value="qscore">Q-score (Salesses 2013)</MenuItem>
            <MenuItem value="share">{uiPair(zh ? "zh" : "en", 'Choice share', '选择比例')}</MenuItem>
          </Select>
        </FormControl>
        {method === 'trueskill' && <>
          <FormControl size="small" sx={{
          minWidth: 150
        }}>
            <InputLabel>{uiPair(zh ? "zh" : "en", 'Ties', '平局')}</InputLabel>
            <Select label={uiPair(zh ? "zh" : "en", 'Ties', '平局')} value={tieHandling} onChange={(e) => setTieHandling(e.target.value)}>
              <MenuItem value="exclude">{uiPair(zh ? "zh" : "en", 'Exclude (default)', '排除（默认）')}</MenuItem>
              <MenuItem value="draw">{uiPair(zh ? "zh" : "en", 'Treat as draws', '视为打平')}</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" type="number" label={uiPair(zh ? "zh" : "en", 'Runs', '重排次数')} value={runs} onChange={(e) => setRuns(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} sx={{
          width: 100
        }} />
        </>}
        {method === 'qscore' && <TextField size="small" type="number" label={uiPair(zh ? "zh" : "en", 'Min comparisons', '最少比较次数')} value={minComparisons} onChange={(e) => setMinComparisons(Math.max(0, Number(e.target.value) || 0))} sx={{
        width: 150
      }} />}
        {method === 'share' && <TextField size="small" type="number" label={uiPair(zh ? "zh" : "en", 'Label threshold k', '标签阈值 k')} value={threshold} onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} sx={{
        width: 140
      }} />}
        <FormControl size="small" sx={{
        minWidth: 120
      }}>
          <InputLabel>{uiPair(zh ? "zh" : "en", 'Scale', '缩放')}</InputLabel>
          <Select label={uiPair(zh ? "zh" : "en", 'Scale', '缩放')} value={scale} onChange={(e) => setScale(e.target.value)}>
            <MenuItem value="none">{uiPair(zh ? "zh" : "en", 'None', '不缩放')}</MenuItem>
            <MenuItem value="0-10">0–10</MenuItem><MenuItem value="0-5">0–5</MenuItem><MenuItem value="0-1">0–1</MenuItem>
          </Select>
        </FormControl>
        {pool.length > 1 && <FormControlLabel control={<Switch checked={pooled} onChange={(e) => setPooled(e.target.checked)} />} label={`${uiPair(zh ? "zh" : "en", 'Pool', '合并')} ${pool.join(' + ')}`} />}
        {analysis && rec.method === 'qscore_pairwise' && <Chip size="small" variant="outlined" label={uiPair(zh ? "zh" : "en", 'Template recommends Q-score', '模板推荐 Q-score')} />}
        {analysis && rec.method === 'choice_share' && <Chip size="small" variant="outlined" label={uiPair(zh ? "zh" : "en", 'Template recommends choice share', '模板推荐选择比例')} />}
      </Stack>
      {isReverseCoded(surveyConfig, question) && <Alert severity="info">{uiPair(zh ? "zh" : "en", 'Reverse-coded wording: the chosen image counts as the loser.', '本题为反向措辞：被选中的图计为输家。')}</Alert>}
      {reverseCodedConditions(question).length > 0 && <Alert severity="info">{zh ? `条件 ${reverseCodedConditions(question).join('、')} 使用反向措辞：这些参与者选中的图计为输家，再与其他条件合并。可用"分组比较 → 实验条件"分别查看。` : `Condition ${reverseCodedConditions(question).join(', ')} uses reversed wording: the chosen image counts as the loser before pooling with the other conditions. Use group comparison → Condition to see them separately.`}</Alert>}
      {scale !== 'none' && <Typography variant="caption">{splitCategories ? uiPair(zh ? "zh" : "en", 'The scale column is min–maxed inside each category. It is not comparable across categories or studies.', '缩放列在每个类别内部做最小–最大缩放，不能跨类别或跨研究比较。') : uiPair(zh ? "zh" : "en", 'The scale column replaces the relative 0–5 column. It is min–maxed within this question and not comparable across studies.', '缩放列替换原来的相对 0–5 列，只在本题内做最小–最大缩放，不能跨研究比较。')}</Typography>}

      <Box>
          <Typography variant="subtitle2" sx={sectionTitleSx}>
            {method === 'qscore' ? 'Q-score (Salesses 2013)' : method === 'share' ? uiPair(zh ? "zh" : "en", 'Choice share', '选择比例') : 'TrueSkill (pairwise from selections vs non-selected shown images)'}
          </Typography>
          {boards.some((board) => board.rankings?.length) ? <TrueSkillBoardStack boards={boards} renderBoard={board => {
            const scoreName = method === 'qscore' ? 'Q-score' : method === 'share' ? (zh ? '选择比例' : 'Choice share') : 'TrueSkill';
            const inside = board.label ? uiPair(zh ? "zh" : "en", `Rank and scale stay inside ${board.label}.`, `排名和缩放都只在${board.label}内部计算。`) : null;
            const chartTitle = board.label ? official ? `Relative μ in ${board.label} (0–5)` : `Relative score in ${board.label} (0–5)` : method === 'trueskill' ? undefined : `Within-question relative ${scoreName} (0–5)`;
            return <>
              <TrueSkillMuChart rankings={board.rankings} title={chartTitle} caption={board.label ? official ? 'Min-max of μ inside this category. Blue: density histogram. Orange: fitted normal PDF.' : 'Min-max inside this category. Blue: density histogram. Orange: fitted normal PDF.' : undefined} xLabel={chartTitle} />
              <TrueSkillTable key={`${method}-${scale}-${tieHandling}-${runs}-${board.label || 'all'}`} rankings={board.rankings} columns={official ? undefined : columns} title={board.label ? official ? `TrueSkill — ${board.label}` : `${scoreName} — ${board.label}` : method === 'trueskill' ? 'TrueSkill image rankings' : `${scoreName} image rankings`} caption={board.label ? official ? 'Rank and relative μ stay inside this category. Each selection counts as a win over every non-selected image in that trial.' : inside : method === 'trueskill' ? 'Each selection counts as a win over every non-selected image shown in that trial. Click a column header to sort (default: μ descending).' : 'Click a column header to sort. The second column is the within-question relative score, or the selected scale.'} onExport={official ? () => exportTrueSkillCsv(question.name, board.rankings, 'mu', 'desc', [], board.category) : () => exportBoard(board)} />
            </>;
          }} /> : <Alert severity="warning">{method === 'trueskill' ? 'Not enough pairwise comparisons for TrueSkill (need participants to select among shown images).' : uiPair(zh ? "zh" : "en", 'Not enough comparisons for this scoring method.', '这种计分方法的比较次数不够。')}</Alert>}
        </Box>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button size="small" variant="outlined" onClick={exportLong}>{uiPair(zh ? "zh" : "en", 'Export long format (one row per choice)', '导出长表（每次选择一行）')}</Button>
        {fixedPairs && <Button size="small" variant="outlined" onClick={() => csv(pairs.map((p) => ({
        group: p.group,
        first: p.first,
        second: p.second,
        first_chosen: p.firstChosen,
        second_chosen: p.secondChosen,
        ties: p.ties,
        share_first: p.share,
        wilson_low: p.low,
        wilson_high: p.high
      })), `${question.name}_pair_shares.csv`)}>{uiPair(zh ? "zh" : "en", 'Export pair shares', '导出配对选择比例')}</Button>}
      </Stack>

      <Box>
        <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Coverage and reliability', '覆盖度与可靠性')}</Typography>
        <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" sx={{
        my: 1
      }}>
          <TextField size="small" type="number" label={uiPair(zh ? "zh" : "en", 'Min per image', '每图最少比较')} value={coverageMin} onChange={(e) => setCoverageMin(Number(e.target.value) || 0)} sx={{
          width: 140
        }} />
          <Typography variant="caption">{uiPair(zh ? "zh" : "en", 'Gu 2025: 22 for Q-score, 29 for TrueSkill.', 'Gu 2025 建议：Q-score 22，TrueSkill 29。')}</Typography>
        </Stack>
        <Typography variant="body2">
          {`${coverage.images} ${uiPair(zh ? "zh" : "en", 'images; comparisons per image', '张图；每图比较次数')} ${coverage.min ?? '—'} / ${fmt(coverage.median, 1)} / ${coverage.max ?? '—'} (min / median / max); `}
          {`${coverage.below} ${uiPair(zh ? "zh" : "en", 'below threshold', '张低于阈值')} (${fmt((coverage.shareBelow || 0) * 100, 0)}%)`}
        </Typography>
        {retest.pairs > 0 && <Typography variant="body2">{`${uiPair(zh ? "zh" : "en", 'Repeated-pair agreement', '重复配对一致性')}: Cohen κ = ${fmt(retest.kappa)} (${retest.pairs})`}</Typography>}
        {samePos.length > 0 && <Typography variant="body2" color="warning.main">{`${samePos.length} ${uiPair(zh ? "zh" : "en", 'participant(s) always chose the same side (≥5 trials)', '位参与者始终选同一侧（≥5 次）')}`}</Typography>}
        <Button size="small" sx={{
        mt: 1
      }} onClick={() => setSplit(splitHalfReliability(outcomes, {
        method,
        options,
        splits: 100,
        seed: 1
      }))}>{uiPair(zh ? "zh" : "en", 'Compute split-half reliability (100 splits)', '计算折半信度（100 次）')}</Button>
        {split && <Typography variant="body2">{split.mean == null ? uiPair(zh ? "zh" : "en", 'Too few participants.', '参与者太少。') : `Spearman–Brown ρ = ${fmt(split.mean)} [${fmt(split.low)}, ${fmt(split.high)}] (${split.valid} splits)`}</Typography>}
      </Box>

      {groupOptions.length > 0 && <Box>
          <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Group comparison', '分组比较')}</Typography>
          <FormControl size="small" sx={{
        minWidth: 240,
        mb: 1
      }}>
            <InputLabel>{uiPair(zh ? "zh" : "en", 'Group by', '分组依据')}</InputLabel>
            <Select label={uiPair(zh ? "zh" : "en", 'Group by', '分组依据')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <MenuItem value="">{uiPair(zh ? "zh" : "en", 'None', '不分组')}</MenuItem>
              {groupOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          {groupResult && <GroupComparison result={groupResult} zh={zh} />}
        </Box>}
    </Stack>;
}
function NumericMethods({
  question,
  responses,
  surveyConfig,
  zh
}) {
  const rec = recommendationsForQuestion(surveyConfig, question.name)[0] || {};
  const dims = ['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(question.type) ? (question.dimensions || []).map((d) => ({
    id: d.id,
    label: d.label || d.name || d.id
  })) : [];
  const rows = ['matrix', 'imagematrix', 'mediamatrix'].includes(question.type) ? (question.rows || []).map((r) => typeof r === 'object' ? {
    id: r.value,
    label: r.text || r.value
  } : {
    id: r,
    label: r
  }) : [];
  const parts = dims.length ? dims : rows;
  const [part, setPart] = useState(parts[0]?.id ?? '');
  const [robust, setRobust] = useState(rec.method === 'robust_median');
  const [madK, setMadK] = useState(rec.madThreshold || 3);
  const [minRatings, setMinRatings] = useState(rec.minPerImage || COVERAGE_THRESHOLDS.likert);
  const qs = useMemo(() => flatQuestions(surveyConfig), [surveyConfig]);
  const raterCandidates = qs.filter((q) => q.type === 'text' && /rater|coder|expert|id/i.test(`${q.name} ${q.title || ''}`));
  const [rater, setRater] = useState(rec.raterQuestion || raterCandidates[0]?.name || '');
  const [groupId, setGroupId] = useState('');
  const groupOptions = useGroupOptions(surveyConfig, responses, zh);
  const questionsByName = useMemo(() => Object.fromEntries(qs.map((q) => [q.name, q])), [qs]);
  const params = useMemo(() => [...new Set((responses || []).flatMap((r) => Object.keys(r?.survey_metadata?.url_params || {})))], [responses]);
  const [param, setParam] = useState(rec.param || '');
  const opts = dims.length ? {
    dimension: part
  } : rows.length ? {
    row: part
  } : {};
  const obs = useMemo(() => stimulusObservations(responses, question, opts), [responses, question, part]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => robust ? robustStimulusStats(obs, {
    threshold: madK
  }) : perStimulusStats(obs), [obs, robust, madK]);
  const below = stats.filter((s) => (s.n ?? s.nAfter) < minRatings).length;
  const agreement = useMemo(() => {
    const raterOf = rater ? (o) => {
      const v = o.row?.responses?.[rater];
      const x = v && typeof v === 'object' && 'answer' in v ? v.answer : v;
      return x ? String(x).trim() : null;
    } : undefined;
    return raterAgreement(obs, {
      raterOf,
      categorical: ['boolean', 'imageboolean', 'mediaboolean'].includes(question.type)
    });
  }, [obs, rater, question.type]);
  const retest = useMemo(() => ratingRetestKappa(obs), [obs]);
  const byParam = useMemo(() => param ? aggregateByParam(obs, param) : [], [obs, param]);
  const groupResult = useMemo(() => {
    const opt = groupOptions.find((o) => o.id === groupId);
    if (!opt) return null;
    return ratingGroupComparison(obs, participantGroupMap(responses, responseGroups(responses, opt.groupBy, questionsByName)));
  }, [groupId, groupOptions, obs, responses, questionsByName]);
  if (!obs.length) return <Typography variant="caption">{uiPair(zh ? "zh" : "en", 'No numeric answers.', '没有数值型回答。')}</Typography>;
  return <Stack gap={2}>
      <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Per stimulus', '按刺激物')}</Typography>
      <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
        {parts.length > 0 && <FormControl size="small" sx={{
        minWidth: 200
      }}>
            <InputLabel>{dims.length ? uiPair(zh ? "zh" : "en", 'Dimension', '维度') : uiPair(zh ? "zh" : "en", 'Row', '行')}</InputLabel>
            <Select label={dims.length ? uiPair(zh ? "zh" : "en", 'Dimension', '维度') : uiPair(zh ? "zh" : "en", 'Row', '行')} value={part} onChange={(e) => setPart(e.target.value)}>
              {parts.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
            </Select>
          </FormControl>}
        <FormControlLabel control={<Switch checked={robust} onChange={(e) => setRobust(e.target.checked)} />} label={uiPair(zh ? "zh" : "en", 'Median with MAD screening', '中位数 + MAD 剔除')} />
        {robust && <TextField size="small" type="number" label="k × MAD" value={madK} onChange={(e) => setMadK(Math.max(0.5, Number(e.target.value) || 3))} sx={{
        width: 100
      }} />}
        <TextField size="small" type="number" label={uiPair(zh ? "zh" : "en", 'Min ratings', '每图最少评分')} value={minRatings} onChange={(e) => setMinRatings(Number(e.target.value) || 0)} sx={{
        width: 130
      }} />
      </Stack>
      <Typography variant="body2">{`${stats.length} ${uiPair(zh ? "zh" : "en", 'stimuli', '个刺激物')}; ${below} ${uiPair(zh ? "zh" : "en", 'below the minimum number of ratings', '个低于最少评分数')}`}</Typography>
      <ScoreTable rows={stats} columns={robust ? [{
      key: 'stimulus',
      label: uiPair(zh ? "zh" : "en", 'Stimulus', '刺激物'),
      render: (r) => nameOf(r.stimulus)
    }, {
      key: 'median',
      label: uiPair(zh ? "zh" : "en", 'Median', '中位数'),
      render: (r) => fmt(r.median)
    }, {
      key: 'nBefore',
      label: uiPair(zh ? "zh" : "en", 'n before', '剔除前')
    }, {
      key: 'nAfter',
      label: uiPair(zh ? "zh" : "en", 'n after', '剔除后')
    }, {
      key: 'mad',
      label: 'MAD',
      render: (r) => fmt(r.mad)
    }] : [{
      key: 'stimulus',
      label: uiPair(zh ? "zh" : "en", 'Stimulus', '刺激物'),
      render: (r) => nameOf(r.stimulus)
    }, {
      key: 'mean',
      label: uiPair(zh ? "zh" : "en", 'Mean', '均值'),
      render: (r) => fmt(r.mean)
    }, {
      key: 'sd',
      label: 'SD',
      render: (r) => fmt(r.sd)
    }, {
      key: 'median',
      label: uiPair(zh ? "zh" : "en", 'Median', '中位数'),
      render: (r) => fmt(r.median)
    }, {
      key: 'n',
      label: 'n'
    }]} />
      <Button size="small" variant="outlined" sx={{
      alignSelf: 'flex-start'
    }} onClick={() => csv(stats.map((s) => ({
      ...s,
      stimulus: s.stimulus,
      name: nameOf(s.stimulus)
    })), `${question.name}${part ? `_${part}` : ''}_per_stimulus.csv`)}>{uiPair(zh ? "zh" : "en", 'Export per-stimulus CSV', '导出每图统计 CSV')}</Button>

      <Box>
        <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Rater agreement', '评分者一致性')}</Typography>
        <FormControl size="small" sx={{
        minWidth: 220,
        mb: 1
      }}>
          <InputLabel>{uiPair(zh ? "zh" : "en", 'Rater', '评分者')}</InputLabel>
          <Select label={uiPair(zh ? "zh" : "en", 'Rater', '评分者')} value={rater} onChange={(e) => setRater(e.target.value)}>
            <MenuItem value="">{uiPair(zh ? "zh" : "en", 'Participant ID', '参与者 ID')}</MenuItem>
            {qs.filter((q) => q.type === 'text').map((q) => <MenuItem key={q.name} value={q.name}>{q.title || q.name}</MenuItem>)}
          </Select>
        </FormControl>
        <Typography variant="body2">
          {agreement.icc ? `ICC(2,1) = ${fmt(agreement.icc.icc1)} [${fmt(agreement.icc.icc1Low)}, ${fmt(agreement.icc.icc1High)}]; ICC(2,k) = ${fmt(agreement.icc.iccK)} [${fmt(agreement.icc.iccKLow)}, ${fmt(agreement.icc.iccKHigh)}]; ${agreement.raters} ${uiPair(zh ? "zh" : "en", 'raters', '位评分者')} × ${agreement.stimuli}/${agreement.totalStimuli} ${uiPair(zh ? "zh" : "en", 'complete stimuli', '个完整刺激物')}` : agreement.fleissKappa != null ? `Fleiss κ = ${fmt(agreement.fleissKappa)}` : uiPair(zh ? "zh" : "en", 'Needs at least 2 raters who rated the same 2+ stimuli.', '需要至少 2 位评分者共同评过至少 2 个刺激物。')}
        </Typography>
        {agreement.weightedKappa != null && <Typography variant="body2">{`${uiPair(zh ? "zh" : "en", 'Weighted', '加权')} κ = ${fmt(agreement.weightedKappa)}`}</Typography>}
        {retest.pairs > 0 && <Typography variant="body2">{`${uiPair(zh ? "zh" : "en", 'Test–retest', '重测一致性')}: ${uiPair(zh ? "zh" : "en", 'weighted', '加权')} κ = ${fmt(retest.kappa)} (${retest.pairs})`}</Typography>}
      </Box>

      {params.length > 0 && <Box>
          <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'By URL parameter', '按链接参数汇总')}</Typography>
          <FormControl size="small" sx={{
        minWidth: 160,
        mb: 1
      }}>
            <InputLabel>{uiPair(zh ? "zh" : "en", 'Parameter', '参数')}</InputLabel>
            <Select label={uiPair(zh ? "zh" : "en", 'Parameter', '参数')} value={param} onChange={(e) => setParam(e.target.value)}>
              <MenuItem value="">{uiPair(zh ? "zh" : "en", 'None', '不汇总')}</MenuItem>
              {params.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <ScoreTable rows={byParam} columns={[{
        key: 'value',
        label: param
      }, {
        key: 'n',
        label: 'n'
      }, {
        key: 'mean',
        label: uiPair(zh ? "zh" : "en", 'Mean', '均值'),
        render: (r) => fmt(r.mean)
      }, {
        key: 'sd',
        label: 'SD',
        render: (r) => fmt(r.sd)
      }, {
        key: 'ci',
        label: '95% CI',
        render: (r) => r.low == null ? '—' : `[${fmt(r.low)}, ${fmt(r.high)}]`
      }]} />
          {byParam.length > 0 && <Button size="small" variant="outlined" onClick={() => csv(byParam, `${question.name}_by_${param}.csv`)}>{uiPair(zh ? "zh" : "en", 'Export CSV', '导出 CSV')}</Button>}
        </Box>}

      {groupOptions.length > 0 && <Box>
          <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Group comparison', '分组比较')}</Typography>
          <FormControl size="small" sx={{
        minWidth: 240,
        mb: 1
      }}>
            <InputLabel>{uiPair(zh ? "zh" : "en", 'Group by', '分组依据')}</InputLabel>
            <Select label={uiPair(zh ? "zh" : "en", 'Group by', '分组依据')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <MenuItem value="">{uiPair(zh ? "zh" : "en", 'None', '不分组')}</MenuItem>
              {groupOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          {groupResult && <GroupComparison result={groupResult} zh={zh} />}
        </Box>}
    </Stack>;
}
function AnnotationMethods({
  question,
  responses,
  surveyConfig,
  zh
}) {
  const rec = recommendationsForQuestion(surveyConfig, question.name).find((r) => r.method === 'evaluative_map') || {};
  const others = flatQuestions(surveyConfig).filter((q) => q.type === 'imageannotation' && q.name !== question.name);
  const [other, setOther] = useState(rec.dislikedQuestion && rec.dislikedQuestion !== question.name ? rec.dislikedQuestion : rec.likedQuestion && rec.likedQuestion !== question.name ? rec.likedQuestion : others[0]?.name || '');
  const thisIsLiked = rec.dislikedQuestion ? rec.dislikedQuestion !== question.name : true;
  const grid = 40;
  const map = useMemo(() => other ? evaluativeMap(responses, thisIsLiked ? question.name : other, thisIsLiked ? other : question.name, {
    grid
  }) : null, [responses, other, question.name, thisIsLiked]);
  const notes = useMemo(() => annotationNotes(responses, question.name), [responses, question.name]);
  const base = useMemo(() => question.annotationImageUrl || annotationBaseImage(responses, question.name), [question.annotationImageUrl, question.name, responses]);
  const maxAbs = map ? Math.max(1e-9, ...map.cells.map((c) => Math.abs(c.diff))) : 1;
  return <Stack gap={2}>
      {others.length > 0 ? <>
          <Typography variant="subtitle2" sx={sectionTitleSx}>{uiPair(zh ? "zh" : "en", 'Evaluative map', '综合评价地图')}</Typography>
          <FormControl size="small" sx={{
        minWidth: 260
      }}>
            <InputLabel>{thisIsLiked ? uiPair(zh ? "zh" : "en", '"Disliked" question', '"不喜欢"标注题') : uiPair(zh ? "zh" : "en", '"Liked" question', '"喜欢"标注题')}</InputLabel>
            <Select label="pair" value={other} onChange={(e) => setOther(e.target.value)}>
              {others.map((q) => <MenuItem key={q.name} value={q.name}>{q.title || q.name}</MenuItem>)}
            </Select>
          </FormControl>
          {map && <Box>
              <Typography variant="body2" sx={{
          mb: 1
        }}>{zh ? `综合评价地图：红色 = 喜欢多于不喜欢，蓝色 = 相反（${map.likedUnits} / ${map.dislikedUnits} 份标注）。` : `Evaluative map: red = more liked than disliked, blue = the reverse (${map.likedUnits} / ${map.dislikedUnits} annotation sets).`}</Typography>
              <Box sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 640,
          aspectRatio: '4 / 3',
          bgcolor: 'grey.100',
          backgroundImage: base ? `url("${base}")` : undefined,
          backgroundSize: '100% 100%'
        }}>
                {map.cells.map((c) => <Box key={`${c.row}-${c.col}`} sx={{
            position: 'absolute',
            left: `${c.col / grid * 100}%`,
            top: `${c.row / grid * 100}%`,
            width: `${100 / grid}%`,
            height: `${100 / grid}%`,
            bgcolor: c.diff >= 0 ? 'rgba(211,47,47,1)' : 'rgba(25,118,210,1)',
            opacity: 0.15 + 0.6 * (Math.abs(c.diff) / maxAbs)
          }} />)}
              </Box>
              <Button size="small" variant="outlined" sx={{
          mt: 1
        }} onClick={() => csv(map.cells, `${question.name}_evaluative_map.csv`)}>{uiPair(zh ? "zh" : "en", 'Export grid CSV', '导出网格 CSV')}</Button>
            </Box>}
        </> : <Typography variant="caption">{uiPair(zh ? "zh" : "en", 'Add a second annotation question (e.g. "disliked") to build an evaluative map.', '需要另一道标注题（如"不喜欢"）才能生成综合评价地图。')}</Typography>}
      {notes.length > 0 && <Box>
          <Typography variant="subtitle2" sx={sectionTitleSx}>{zh ? `标注理由（${notes.length}）` : `Annotation notes (${notes.length})`}</Typography>
          {notes.slice(0, 8).map((n, i) => <Typography key={i} variant="body2">{`${n.label ? `[${n.label}] ` : ''}${n.note}`}</Typography>)}
          <Button size="small" variant="outlined" sx={{
        mt: 1
      }} onClick={() => csv(notes, `${question.name}_notes.csv`)}>{uiPair(zh ? "zh" : "en", 'Export notes CSV', '导出理由 CSV')}</Button>
        </Box>}
    </Stack>;
}

/** Pairwise scoring rendered with the question's TrueSkill chart and table. */
export function PairwiseAnalysis({
  question,
  responses,
  surveyConfig
}) {
  const {
    language
  } = useRegion();
  return <PairwiseMethods analysis question={question} responses={responses} surveyConfig={surveyConfig} zh={isChineseLanguage(language)} />;
}

/** Numeric and annotation checks that used to sit in a separate accordion. */
export default function PaperMethodsPanel({
  question,
  allResponses,
  surveyConfig
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const type = question?.type;
  const kind = NUMERIC.has(type) ? 'numeric' : type === 'imageannotation' ? 'annotation' : null;
  if (!kind || !allResponses?.length) return null;
  return <Box sx={{
    mt: 2
  }}>
      {kind === 'numeric' && <NumericMethods question={question} responses={allResponses} surveyConfig={surveyConfig} zh={zh} />}
      {kind === 'annotation' && <AnnotationMethods question={question} responses={allResponses} surveyConfig={surveyConfig} zh={zh} />}
    </Box>;
}