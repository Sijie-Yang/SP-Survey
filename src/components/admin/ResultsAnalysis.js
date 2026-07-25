import React, { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Button,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Tooltip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  TextField,
  InputAdornment,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Refresh,
  Download,
  Assessment,
  People,
  ExpandMore,
  ExpandLess,
  Storage,
  Cloud,
  Search,
  QuestionAnswer,
  Image as ImageIcon,
  TextFields,
  Star,
  CheckBox,
  RadioButtonChecked,
  LinearScale,
  TableChart,
  VerifiedUser,
  Description,
  DeleteOutline,
} from '@mui/icons-material';
import { supabase as platformSupabase } from '../../lib/supabase';
import AnnotationAnalysis from './AnnotationAnalysis';
import ImagePerceptionPanel from './ImagePerceptionPanel';
import { getPresetSkill } from '../../lib/presetSkills';
import { ImageResolverContext } from './imageResolverContext';
import {
  summarizeQuality,
  QUALITY_FLAG_LABELS,
  attentionCheckQuestionStats,
} from '../../lib/quality';
import { computeQuestionIrr } from '../../lib/reliability';
import { expandQuestionAnswerUnits } from '../../lib/responseAnswerUnits';
import { supportsTrialCount } from '../../lib/questionTypeConstraints';
import {
  computeQuestionTrueSkill,
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
} from '../../lib/trueskill';
import { average, pct, wilsonCI } from '../../lib/stats';
import { computeBordaScores, kendallW, interpretKendallW } from '../../lib/rankingStats';
import { wordFrequency, textLengthStats } from '../../lib/textStats';
import { generateMethodsText, downloadTextFile } from '../../lib/methodsExport';
import { buildResponsesWideCsv, downloadResponsesWideCsv } from '../../lib/responsesWideExport';
import {
  downloadQuestionExportZip,
  downloadResultsExportZip,
  downloadDataQualityCsv,
} from '../../lib/questionSummaryExport';
import {
  DensityHistogramChart,
  DescriptiveStatsLine,
  SemanticProfileChart,
  WordFrequencyChart,
} from './analysisCharts';
import { getPresetSkillAnalysis } from './skillAnalysis';
import {
  TrueSkillMuChart,
  TrueSkillTable,
  TRUESKILL_SORT_COLUMNS,
  RANKING_EXTRA_COLUMNS,
} from './trueSkillAnalysisUi';
import {
  enrichSkillAnswers,
  buildResponseMediaUrlMap,
  stripSkillAnswerContext,
  formatSkillAnswerForDisplay,
  filterAnswersForSkill,
  imageStimulusKey,
  mediaFilenameKey,
} from '../../lib/skillMediaUtils';
import SkillArchetypeFieldSummary from './SkillArchetypeFieldSummary';
import {
  ARCHETYPE_SKILL_RESULT_TYPES,
  canonicalizeSkillResultType,
  checkAnswerAgainstResultSchema,
} from '../../lib/skillResultTypes';
import { getSkillById } from '../../lib/skillManager';
import { saveProjectFull } from '../../lib/projectManager';
import { deleteSurveyResponse, responseRecordKey } from '../../lib/surveyResponses';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  adaptResponsesForSkillField,
  adaptSkillAnswerEntries,
  skillFieldNativeQuestion,
} from '../../lib/skillNativeAdapter.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RATING_COLORS = ['#f44336', '#ff9800', '#ffc107', '#8bc34a', '#4caf50'];
const BAR_COLORS = [
  '#1976d2', '#2196f3', '#0288d1', '#0097a7', '#00838f',
  '#388e3c', '#689f38', '#f57c00', '#e64a19', '#7b1fa2'
];
/** High-contrast palette for matrix stacked distributions (avoid similar blues). */
const MATRIX_DIST_COLORS = [
  '#1565c0', '#c62828', '#2e7d32', '#f9a825', '#6a1b9a',
  '#00838f', '#ef6c00', '#ad1457', '#4527a0', '#558b2f',
];

function matrixDistColor(index) {
  return MATRIX_DIST_COLORS[index % MATRIX_DIST_COLORS.length];
}

function columnKeysAreNumeric(colKeys) {
  return (colKeys || []).length > 0
    && colKeys.every((c) => c !== '' && c != null && !Number.isNaN(Number(c)));
}

/** Weighted mean from column-value → count map when column keys are numeric. */
function meanFromColumnCounts(cols, colKeys) {
  let sum = 0;
  let n = 0;
  (colKeys || []).forEach((c) => {
    const count = cols?.[c] || 0;
    if (!count) return;
    sum += Number(c) * count;
    n += count;
  });
  return n > 0 ? sum / n : null;
}

/** Questions that show content only — excluded from coverage stats. */
const DISPLAY_ONLY_QUESTION_TYPES = new Set([
  'expression', // Text Instruction
  'image',
  'html',
  'mediadisplay',
]);

function isDisplayOnlyQuestion(question) {
  return DISPLAY_ONLY_QUESTION_TYPES.has(question?.type);
}

function isAnswerableQuestion(question) {
  return !!question?.name && !isDisplayOnlyQuestion(question);
}

/**
 * Responses that count toward a question's completion denominator / analysis pool.
 * Full survey submissions count for every question; researcher practice rows only
 * count for the single question they practiced (survey_metadata.practice_question).
 */
export function responsesEligibleForQuestion(questionName, responses) {
  return (responses || []).filter((row) => {
    if (row.survey_metadata?.practice_mode) {
      return row.survey_metadata?.practice_question === questionName;
    }
    return true;
  });
}

// Collect answers for a question from all responses.
// Multi-trial → one analysis unit per answered trial (paired with that trial's media).
// Single-answer → one unit (legacy + enriched).
export function collectAnswers(questionName, responses) {
  const result = [];
  for (const row of responsesEligibleForQuestion(questionName, responses)) {
    result.push(...expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }));
  }
  return result;
}

/** Collect shown_media even when there is no answer (e.g. mediadisplay). */
export function collectShownMedia(questionName, responses) {
  const result = [];
  for (const row of responsesEligibleForQuestion(questionName, responses)) {
    result.push(...expandQuestionAnswerUnits(row, questionName, { requireAnswer: false }));
  }
  return result;
}

/**
 * One canonical input contract for QuestionCard. Results Analysis and
 * Researcher Practice both use this so answer units, denominators, Skill
 * adapters, media context, and per-question exports cannot drift.
 */
export function buildQuestionCardProps(
  question,
  responses,
  { questionNumber = null, surveyConfig = null, exportResponses = responses } = {},
) {
  if (!question?.name) return null;
  const pool = responsesEligibleForQuestion(question.name, responses);
  const answers = question.type === 'mediadisplay'
    ? collectShownMedia(question.name, responses)
    : collectAnswers(question.name, responses);
  return {
    question: { ...question, _allResponses: pool },
    answers,
    totalResponses: pool.length,
    questionNumber,
    allResponses: pool,
    exportResponses,
    surveyConfig,
  };
}

// Frequency map: { choice: count }
function frequencyMap(answers, getValue) {
  const freq = {};
  for (const { answer } of answers) {
    const vals = Array.isArray(answer) ? answer : [answer];
    for (const v of vals) {
      const key = getValue ? getValue(v) : String(v);
      freq[key] = (freq[key] || 0) + 1;
    }
  }
  return freq;
}

function imageKeyFromShown(entry) {
  if (!entry) return '';
  const s = typeof entry === 'string' ? entry : (entry.url || entry.name || '');
  return s.split('?')[0].split('/').pop() || s;
}

/** Map image/media picker·ranking choice values (image_N / media_N or URL) to a filename key. */
function resolveImageChoiceKey(value, shownImages) {
  if (value == null || value === '') return '';
  const str = String(value);
  const match = str.match(/^(?:image|media)_(\d+)$/);
  if (match && Array.isArray(shownImages) && shownImages.length) {
    const img = shownImages[Number(match[1])];
    if (img != null) return imageKeyFromShown(img) || String(img);
  }
  return imageKeyFromShown(str) || str;
}

/** Best-effort display URL for a choice value given that trial's shown_images. */
function resolveImageChoiceUrl(value, shownImages) {
  if (value == null || value === '') return null;
  const str = String(value);
  const match = str.match(/^(?:image|media)_(\d+)$/);
  if (match && Array.isArray(shownImages) && shownImages.length) {
    const img = shownImages[Number(match[1])];
    if (img == null) return null;
    return typeof img === 'string' ? img : (img.url || img.name || null);
  }
  if (str.startsWith('http') || str.startsWith('/')) return str;
  const fromShown = (shownImages || []).find((s) => imageKeyFromShown(s) === imageKeyFromShown(str));
  if (fromShown) return typeof fromShown === 'string' ? fromShown : (fromShown.url || null);
  return str;
}

function typeIcon(type) {
  const icons = {
    rating: <Star fontSize="small" />,
    text: <TextFields fontSize="small" />,
    comment: <TextFields fontSize="small" />,
    radiogroup: <RadioButtonChecked fontSize="small" />,
    checkbox: <CheckBox fontSize="small" />,
    dropdown: <RadioButtonChecked fontSize="small" />,
    boolean: <CheckBox fontSize="small" />,
    matrix: <TableChart fontSize="small" />,
    image_rating: <ImageIcon fontSize="small" />,
    image_ranking: <ImageIcon fontSize="small" />,
    image_boolean: <ImageIcon fontSize="small" />,
    image_matrix: <ImageIcon fontSize="small" />,
    slidergroup: <LinearScale fontSize="small" />,
    imageslidergroup: <ImageIcon fontSize="small" />,
    imagepointallocation: <ImageIcon fontSize="small" />,
  };
  return icons[type] || <QuestionAnswer fontSize="small" />;
}


function HorizontalBar({ label, count, total, color, index }) {
  const width = pct(count, total);
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography variant="body2" sx={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {count} ({width}%)
        </Typography>
      </Box>
      <Box sx={{ height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            width: `${width}%`,
            bgcolor: color || BAR_COLORS[index % BAR_COLORS.length],
            borderRadius: 1,
            transition: 'width 0.6s ease'
          }}
        />
      </Box>
    </Box>
  );
}

function RatingDistribution({ answers, rateMin = 1, rateMax = 5 }) {
  const nums = answers.map(a => Number(a.answer)).filter(n => !isNaN(n));
  const avg = average(nums);
  const freq = {};
  for (let i = rateMin; i <= rateMax; i++) freq[i] = 0;
  nums.forEach(n => { if (freq[n] !== undefined) freq[n]++; });
  const colorStops = RATING_COLORS.slice(0, rateMax - rateMin + 1);

  return (
    <Box>
      {avg !== null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            {avg.toFixed(2)}
          </Typography>
          <Typography variant="body2" color="text.secondary">/ {rateMax} average</Typography>
        </Box>
      )}
      <DescriptiveStatsLine nums={nums} />
      {nums.length >= 3 && (
        <DensityHistogramChart
          scores={nums}
          domainMin={rateMin}
          domainMax={rateMax}
          title="Rating distribution"
          xLabel={`Rating (${rateMin}–${rateMax})`}
          padB={48}
          chartH={220}
        />
      )}
      {Object.entries(freq).map(([score, count], idx) => (
        <HorizontalBar
          key={score}
          label={`${score} star${Number(score) !== 1 ? 's' : ''}`}
          count={count}
          total={nums.length}
          color={colorStops[idx]}
        />
      ))}
    </Box>
  );
}

function ChoiceDistribution({ answers, choices, isCheckbox = false }) {
  const freq = frequencyMap(answers);
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const respondentCount = answers.length;
  const totalSelections = sorted.reduce((s, [, c]) => s + c, 0);

  const labelMap = {};
  if (choices) {
    for (const c of choices) {
      const val = typeof c === 'object' ? c.value : c;
      const text = typeof c === 'object' ? (c.text || c.value) : c;
      labelMap[String(val)] = String(text);
    }
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        n={respondentCount} responses
        {isCheckbox && totalSelections > 0 && (
          <> · {totalSelections} total selections · avg {(totalSelections / respondentCount).toFixed(1)} per person</>
        )}
      </Typography>
      {sorted.map(([value, count], idx) => (
        <HorizontalBar
          key={value}
          label={`${labelMap[value] || value}${isCheckbox ? ` (${pct(count, totalSelections)}% of selections)` : ''}`}
          count={count}
          total={isCheckbox ? respondentCount : respondentCount}
          index={idx}
        />
      ))}
      {sorted.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
    </Box>
  );
}

// ── imagepicker distribution ──────────────────────────────────────────────────
// Choices: { value, imageLink?, text? }. Answer = value (may be a URL or filename).
function IrrSummary({ responses, question }) {
  const { alpha, agreement, interpretation } = computeQuestionIrr(responses, question);
  if (alpha == null && agreement == null) return null;
  return (
    <Alert severity={alpha != null && alpha >= 0.667 ? 'success' : 'info'} sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Inter-rater reliability</Typography>
      {alpha != null && (
        <Typography variant="body2">Krippendorff&apos;s α = {alpha.toFixed(3)} — {interpretation}</Typography>
      )}
      {agreement != null && (
        <Typography variant="caption" color="text.secondary" display="block">
          Percent agreement (same-image units): {(agreement * 100).toFixed(1)}%
        </Typography>
      )}
    </Alert>
  );
}

function CompactImageRanking({ title, items, getImageUrl, formatLabel, maxValue }) {
  if (!items?.length) return null;
  const peak = maxValue ?? Math.max(...items.map((i) => i.value), 0.001);

  return (
    <Box sx={{ mb: 3 }}>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>
      )}
      {items.map(({ key, url, value, label }, idx) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          {getImageUrl?.(url || key) ? (
            <Box component="img" src={getImageUrl(url || key)} alt={key} sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }} />
          ) : (
            <Box sx={{ width: 48, height: 48, bgcolor: 'grey.100', borderRadius: 1 }} />
          )}
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: '50%' }}>{shortName(url || key)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatLabel ? formatLabel(value, label) : `${(value * 100).toFixed(0)}%`}
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

function compareByColumnProportions(a, b, colKeys) {
  for (let i = colKeys.length - 1; i >= 0; i -= 1) {
    const col = colKeys[i];
    const pa = a.total > 0 ? (a.cols[col] || 0) / a.total : 0;
    const pb = b.total > 0 ? (b.cols[col] || 0) / b.total : 0;
    if (Math.abs(pa - pb) > 1e-9) return pb - pa;
  }
  return 0;
}

/** One bottom tab per matrix attribute (row); ranking inside is by image only. */
function ImageMatrixAttributeTabs({ question, answers, getImageUrl }) {
  const perImage = useMemo(() => {
    const map = {};
    for (const { answer, shown_images } of answers || []) {
      if (typeof answer !== 'object' || !answer || !shown_images?.length) continue;
      const img = shown_images[0];
      const key = imageKeyFromShown(img) || img;
      if (!map[key]) map[key] = { url: img, rows: {} };
      for (const [row, val] of Object.entries(answer)) {
        if (!map[key].rows[row]) map[key].rows[row] = {};
        const colKey = String(val);
        map[key].rows[row][colKey] = (map[key].rows[row][colKey] || 0) + 1;
      }
    }
    return map;
  }, [answers]);

  const rowDefs = question.rows || [];
  const colDefs = question.columns || [];
  const rowKeys = rowDefs.length
    ? rowDefs.map((r) => (typeof r === 'object' ? r.value : r))
    : [...new Set(Object.values(perImage).flatMap((d) => Object.keys(d.rows)))];
  const colKeys = colDefs.length
    ? colDefs.map((c) => (typeof c === 'object' ? c.value : c))
    : [...new Set(Object.values(perImage).flatMap((d) => Object.values(d.rows).flatMap((r) => Object.keys(r))))];

  const [tab, setTab] = useState(0);
  const safeTab = Math.min(tab, Math.max(0, rowKeys.length - 1));

  if (!rowKeys.length || !Object.keys(perImage).length) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  const lastCol = colKeys[colKeys.length - 1];
  const numericCols = columnKeysAreNumeric(colKeys);
  const row = rowKeys[safeTab];
  const rowDef = rowDefs.find((r) => (typeof r === 'object' ? r.value : r) === row);
  const rowLabel = rowDef ? (typeof rowDef === 'object' ? (rowDef.text || rowDef.value) : rowDef) : row;

  const imageStats = Object.entries(perImage).map(([key, data]) => {
    const cols = data.rows[row] || {};
    const total = Object.values(cols).reduce((s, v) => s + v, 0);
    const mean = numericCols ? meanFromColumnCounts(cols, colKeys) : null;
    return { key, url: data.url, cols, total, mean };
  }).filter((s) => s.total > 0);

  const sorted = [...imageStats].sort((a, b) => {
    if (numericCols) {
      const diff = (b.mean ?? -Infinity) - (a.mean ?? -Infinity);
      if (Math.abs(diff) > 1e-9) return diff;
    }
    return compareByColumnProportions(a, b, colKeys);
  });

  const maxMean = numericCols
    ? Math.max(...sorted.map((s) => s.mean ?? 0), Number(colKeys[colKeys.length - 1]) || 1)
    : 1;

  const rankedItems = sorted.map(({ key, url, cols, total, mean }) => {
    const colParts = colKeys.map((c) => {
      const colDef = colDefs.find((col) => (typeof col === 'object' ? col.value : col) === c);
      const cLabel = colDef ? (typeof colDef === 'object' ? (colDef.text || colDef.value) : colDef) : c;
      return `${cLabel}: ${pct(cols[c] || 0, total)}%`;
    });
    const meanPart = numericCols && mean != null ? `avg ${mean.toFixed(2)} · ` : '';
    return {
      key,
      url,
      value: numericCols
        ? (mean ?? 0)
        : (total > 0 ? (cols[lastCol] || 0) / total : 0),
      label: `${meanPart}${colParts.join(' · ')}`,
    };
  });

  return (
    <Box>
      {numericCols && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Column values are numeric — images ranked by mean on this attribute.
        </Typography>
      )}
      <CompactImageRanking
        title={null}
        items={rankedItems}
        getImageUrl={getImageUrl}
        maxValue={numericCols ? maxMean : 1}
        formatLabel={(_, label) => label}
      />
      <Tabs
        value={safeTab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          mt: 1,
          borderTop: 1,
          borderColor: 'divider',
          minHeight: 40,
          '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
        }}
      >
        {rowKeys.map((rk) => {
          const def = rowDefs.find((r) => (typeof r === 'object' ? r.value : r) === rk);
          const label = def ? (typeof def === 'object' ? (def.text || def.value) : def) : rk;
          return <Tab key={rk} label={label} />;
        })}
      </Tabs>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        Attribute: {rowLabel}
      </Typography>
    </Box>
  );
}

function ImagePickerDistribution({ question, allResponses }) {
  const trueskillResult = useMemo(() => {
    if (!allResponses?.length || !question?.name) return { matches: [], rankings: [] };
    const eligible = responsesEligibleForQuestion(question.name, allResponses);
    return computeQuestionTrueSkill(eligible, question.name);
  }, [allResponses, question?.name]);

  const { matches, rankings } = trueskillResult;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        TrueSkill (pairwise from selections vs non-selected shown images)
      </Typography>
      {matches.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Not enough pairwise comparisons for TrueSkill (need participants to select among shown images).
        </Alert>
      ) : (
        <>
          <TrueSkillMuChart rankings={rankings} />
          <TrueSkillTable
            rankings={rankings}
            caption="Each selection counts as a win over every non-selected image shown in that trial. Click a column header to sort (default: μ descending)."
          />
        </>
      )}
    </Box>
  );
}

function NumberDistribution({ answers, question }) {
  const nums = answers.map((a) => Number(a.answer)).filter((n) => !Number.isNaN(n));
  if (!nums.length) {
    return <Typography variant="body2" color="text.secondary">No numeric responses yet.</Typography>;
  }
  const domainMin = question?.min != null && question.min !== ''
    ? Number(question.min)
    : Math.min(...nums);
  const domainMax = question?.max != null && question.max !== ''
    ? Number(question.max)
    : Math.max(...nums);
  const lo = Number.isFinite(domainMin) ? domainMin : Math.min(...nums);
  const hi = Number.isFinite(domainMax) && domainMax > lo ? domainMax : Math.max(...nums, lo + 1);
  return (
    <Box>
      <DescriptiveStatsLine nums={nums} unit="" />
      <DensityHistogramChart
        scores={nums}
        domainMin={lo}
        domainMax={hi}
        title="Numeric response distribution"
        xLabel={question?.title || 'Value'}
      />
    </Box>
  );
}

function AttentionCheckPassRate({ question, allResponses }) {
  if (!question?.isAttentionCheck) return null;
  const stats = attentionCheckQuestionStats(question, allResponses || []);
  if (stats.answered === 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Attention check — no answered responses yet (expected: {String(question.expectedAnswer)}).
      </Alert>
    );
  }
  const ratePct = Math.round((stats.passRate || 0) * 100);
  const severity = ratePct >= 80 ? 'success' : ratePct >= 50 ? 'warning' : 'error';
  return (
    <Alert severity={severity} sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Attention check pass rate</Typography>
      <Typography variant="body2">
        {stats.passed} / {stats.answered} passed ({ratePct}%) · {stats.failed} failed
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        Expected answer: {String(question.expectedAnswer)}
      </Typography>
    </Alert>
  );
}

function TextAnswers({ answers, maxVisible = 5, showWordFreq = true }) {
  const [showAll, setShowAll] = useState(false);
  const texts = answers.map(a => String(a.answer)).filter(Boolean);
  const visible = showAll ? texts : texts.slice(0, maxVisible);
  const lenStats = textLengthStats(texts);
  const words = showWordFreq ? wordFrequency(texts, 20) : [];

  return (
    <Box>
      {lenStats.n > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Length: mean {lenStats.mean?.toFixed(0)} chars · median {lenStats.median?.toFixed(0)} chars · n={lenStats.n}
        </Typography>
      )}
      {words.length > 0 && <WordFrequencyChart words={words} totalResponses={texts.length} />}
      {visible.map((text, idx) => (
        <Paper
          key={idx}
          variant="outlined"
          sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50', borderRadius: 1 }}
        >
          <Typography variant="body2">{text}</Typography>
        </Paper>
      ))}
      {texts.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
      {texts.length > maxVisible && (
        <Button size="small" onClick={() => setShowAll(v => !v)} sx={{ mt: 0.5 }}>
          {showAll ? `Show less` : `Show all ${texts.length} responses`}
        </Button>
      )}
    </Box>
  );
}

function BooleanDistribution({ answers, showWilson = true }) {
  const trueCount = answers.filter(a => a.answer === true || a.answer === 'true').length;
  const falseCount = answers.filter(a => a.answer === false || a.answer === 'false').length;
  const total = trueCount + falseCount;
  const ci = wilsonCI(trueCount, total);

  return (
    <Box>
      {showWilson && total > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Yes rate: {(ci.p * 100).toFixed(1)}% · 95% CI [{(ci.low * 100).toFixed(1)}%, {(ci.high * 100).toFixed(1)}%] · n={total}
        </Typography>
      )}
      <HorizontalBar label="Yes / True" count={trueCount} total={total} color="#4caf50" />
      <HorizontalBar label="No / False" count={falseCount} total={total} color="#f44336" />
    </Box>
  );
}

function MatrixDistribution({ answers, rows, columns }) {
  const rowData = {};
  for (const { answer } of answers) {
    if (typeof answer !== 'object' || !answer) continue;
    for (const [row, val] of Object.entries(answer)) {
      if (!rowData[row]) rowData[row] = {};
      const key = String(val);
      rowData[row][key] = (rowData[row][key] || 0) + 1;
    }
  }

  const rowKeys = rows ? rows.map(r => (typeof r === 'object' ? r.value : r)) : Object.keys(rowData);
  const colKeys = columns ? columns.map(c => (typeof c === 'object' ? c.value : c)) : [];

  if (!colKeys.length) {
    const seen = new Set();
    for (const row of Object.values(rowData)) {
      Object.keys(row).forEach(k => seen.add(k));
    }
    colKeys.push(...seen);
  }

  const colLabel = (col) => {
    if (!columns) return String(col);
    const def = columns.find((c) => (typeof c === 'object' ? c.value : c) === col);
    if (!def) return String(col);
    return typeof def === 'object' ? (def.text || def.value) : def;
  };

  const allNumeric = columnKeysAreNumeric(colKeys);
  const rowMeans = allNumeric ? rowKeys.map((row) => {
    const counts = rowData[row] || {};
    const mean = meanFromColumnCounts(counts, colKeys);
    const n = Object.values(counts).reduce((s, v) => s + v, 0);
    return { row, mean, n };
  }).sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0)) : [];

  if (!rowKeys.length) return <Typography variant="body2" color="text.secondary">No data.</Typography>;

  return (
    <Box>
      {allNumeric && rowMeans.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Row means (numeric columns)</Typography>
          {rowMeans.map(({ row, mean, n }) => {
            const rowLabel = rows
              ? (rows.find(r => (typeof r === 'object' ? r.value : r) === row) || row)
              : row;
            const label = typeof rowLabel === 'object' ? (rowLabel.text || rowLabel.value) : rowLabel;
            return (
              <Box key={row} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                <Typography variant="body2" sx={{ width: 140, flexShrink: 0 }} noWrap>{label}</Typography>
                <Typography variant="body2" color="primary.main" sx={{ width: 60 }}>{mean?.toFixed(2) ?? '—'}</Typography>
                <Typography variant="caption" color="text.secondary">n={n}</Typography>
              </Box>
            );
          })}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        {colKeys.map((col, idx) => (
          <Box key={col} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: matrixDistColor(idx), flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary">{colLabel(col)}</Typography>
          </Box>
        ))}
      </Box>
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Question Row</TableCell>
              {colKeys.map(col => (
                <TableCell key={col} align="center" sx={{ fontWeight: 'bold' }}>{colLabel(col)}</TableCell>
              ))}
              <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 160 }}>Distribution</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rowKeys.map(row => {
              const rowLabel = rows
                ? (rows.find(r => (typeof r === 'object' ? r.value : r) === row) || row)
                : row;
              const label = typeof rowLabel === 'object' ? (rowLabel.text || rowLabel.value) : rowLabel;
              const total = Object.values(rowData[row] || {}).reduce((a, b) => a + b, 0);
              return (
                <TableRow key={row}>
                  <TableCell>{label}</TableCell>
                  {colKeys.map(col => {
                    const count = rowData[row]?.[col] || 0;
                    return (
                      <TableCell key={col} align="center">
                        <Typography variant="body2">{count}</Typography>
                        {total > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {pct(count, total)}%
                          </Typography>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="center">
                    <Box
                      sx={{
                        display: 'flex',
                        height: 16,
                        borderRadius: 1,
                        overflow: 'hidden',
                        bgcolor: 'grey.200',
                        border: '1px solid',
                        borderColor: 'grey.300',
                      }}
                    >
                      {colKeys.map((col, idx) => {
                        const count = rowData[row]?.[col] || 0;
                        const w = total > 0 ? (count / total) * 100 : 0;
                        return w > 0 ? (
                          <Tooltip key={col} title={`${colLabel(col)}: ${pct(count, total)}% (${count})`}>
                            <Box sx={{ width: `${w}%`, bgcolor: matrixDistColor(idx), minWidth: w > 0 ? 2 : 0 }} />
                          </Tooltip>
                        ) : null;
                      })}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// Context: carries a resolver function (filename | url) → displayable URL
// value is a Map<name, url> built from currentProject.preloadedImages
// (lives in its own module so AnnotationAnalysis can import it without cycles)

// Detect whether a string is a usable URL
function isUrl(str) {
  return str && (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('/'));
}

// Extract a short display name from a URL or filename
function shortName(str) {
  if (!str) return '(unknown)';
  const base = str.split('?')[0].split('/').pop();
  return base || str;
}

// Resolve a value (URL or filename) to a displayable image URL
function useResolvedUrl(value) {
  const nameToUrl = useContext(ImageResolverContext);
  if (!value) return null;
  if (isUrl(value)) return value;
  // Look up from preloadedImages name→url map
  if (nameToUrl && nameToUrl.has(value)) return nameToUrl.get(value);
  return null; // can't resolve → show as text chip
}

// Single image item — thumbnail if resolvable, name chip otherwise
function ImageItem({ value, badge }) {
  const resolvedUrl = useResolvedUrl(value);
  const [hover, setHover] = useState(false);
  const [imgError, setImgError] = useState(false);
  const name = shortName(value);

  if (resolvedUrl && !imgError) {
    return (
      <Box sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        <Box
          component="img"
          src={resolvedUrl}
          alt={name}
          onError={() => setImgError(true)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          sx={{
            width: 100, height: 100, objectFit: 'cover', borderRadius: 1.5,
            border: '2px solid', borderColor: hover ? 'primary.main' : 'divider',
            cursor: 'zoom-in', transition: 'all 0.2s',
            boxShadow: hover ? 3 : 1,
            transform: hover ? 'scale(1.05)' : 'scale(1)',
          }}
        />
        {badge !== undefined && (
          <Chip label={badge} size="small" color="primary" sx={{ fontSize: '0.7rem', height: 20 }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{
          maxWidth: 100, textOverflow: 'ellipsis', overflow: 'hidden',
          whiteSpace: 'nowrap', fontSize: '0.65rem', textAlign: 'center'
        }}>
          {name}
        </Typography>
      </Box>
    );
  }

  // Fallback: display as labelled name chip (when URL can't be resolved or image fails)
  return (
    <Chip
      icon={<ImageIcon fontSize="small" />}
      label={badge !== undefined ? `${badge} ${name}` : name}
      size="small"
      variant="outlined"
      color="primary"
      sx={{ maxWidth: 220, fontSize: '0.72rem' }}
    />
  );
}

// Image group header — shows all images in a set, with an optional title
function ShownImagesContext({ imageUrls, label }) {
  if (!imageUrls || imageUrls.length === 0) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {label || 'Image(s) shown:'}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
        {imageUrls.map((v, i) => (
          <ImageItem key={v + i} value={v} index={i} />
        ))}
      </Box>
    </Box>
  );
}

function ImageRankingTrueSkillAnalysis({ answers, question, type }) {
  const mediaLabel = type === 'mediaranking' ? 'Media' : 'Image';

  const { matches, rankings, kendallWVal } = useMemo(() => {
    const imageRankPositions = {};
    const imageUrls = {};
    const rankingLists = [];
    const allMatches = [];

    for (const { answer, shown_images: shown } of answers || []) {
      const ranked = Array.isArray(answer) ? answer : [];
      if (!ranked.length) continue;
      const keys = ranked
        .map((val) => {
          const key = resolveImageChoiceKey(val, shown);
          if (!key) return null;
          const url = resolveImageChoiceUrl(val, shown);
          if (url && !imageUrls[key]) imageUrls[key] = url;
          return key;
        })
        .filter(Boolean);
      if (keys.length < 2) continue;
      rankingLists.push(keys);
      allMatches.push(...matchesFromOrderedRanking(keys));
      keys.forEach((key, rankIdx) => {
        if (!imageRankPositions[key]) imageRankPositions[key] = [];
        imageRankPositions[key].push(rankIdx + 1);
      });
    }

    const items = Object.keys(imageRankPositions);
    const nItems = items.length;
    const w = kendallW(rankingLists, items);
    const bordaMap = computeBordaScores(imageRankPositions, nItems);
    const { matches: m, rankings: tsRows } = computeTrueSkillFromMatches(allMatches);

    const byKey = new Map((tsRows || []).map((r) => [r.imageKey, r]));
    // Include images that only appear in rank stats (edge case: single-item lists)
    items.forEach((key) => {
      if (!byKey.has(key)) {
        byKey.set(key, {
          imageKey: key,
          mu: null,
          muStd5: null,
          sigma: null,
          conservative: null,
          wins: 0,
          losses: 0,
          games: 0,
        });
      }
    });

    const merged = [...byKey.values()].map((row) => {
      const ranks = imageRankPositions[row.imageKey] || [];
      const avg = ranks.length ? average(ranks) : null;
      const sd = ranks.length > 1
        ? Math.sqrt(ranks.reduce((s, r) => s + (r - avg) ** 2, 0) / ranks.length)
        : 0;
      return {
        ...row,
        displayUrl: imageUrls[row.imageKey] || null,
        avgRank: avg,
        rankSd: sd,
        borda: bordaMap[row.imageKey]?.borda ?? null,
        nRanks: ranks.length,
      };
    });

    return { matches: m, rankings: merged, kendallWVal: w };
  }, [answers]);

  if (!answers?.length || (!rankings.length && !matches.length)) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  const rankingColumns = [...RANKING_EXTRA_COLUMNS, ...TRUESKILL_SORT_COLUMNS];

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {mediaLabel} ranking — TrueSkill
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        From each full ranking, every higher-ranked image beats every lower-ranked image
        ({matches.length} pairwise outcomes).
      </Typography>
      {kendallWVal != null && (
        <Alert severity={kendallWVal >= 0.5 ? 'success' : 'info'} sx={{ mb: 2 }}>
          Kendall&apos;s W = {kendallWVal.toFixed(3)} — {interpretKendallW(kendallWVal)}
        </Alert>
      )}
      {matches.length === 0 ? (
        <Alert severity="warning">Not enough ranking comparisons for TrueSkill yet.</Alert>
      ) : (
        <>
          <TrueSkillMuChart rankings={rankings.filter((r) => r.mu != null)} />
          <TrueSkillTable
            rankings={rankings}
            columns={rankingColumns}
            title={`${mediaLabel} TrueSkill + ranking stats`}
            caption="Higher rank beats lower rank in each trial. Avg rank / Borda / n are classical ranking summaries. Default sort: μ descending."
          />
        </>
      )}
    </Box>
  );
}

function ImageQuestionAnalysis({ answers, type, question }) {
  const resolvedUrl = useContext(ImageResolverContext);
  const getImageUrl = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'))) return value;
    const key = imageKeyFromShown(value);
    return resolvedUrl?.get(key) || resolvedUrl?.get(value) || null;
  };

  // ── image_ranking / media_ranking → TrueSkill (+ avg rank / Borda columns) ─
  if (type === 'image_ranking' || type === 'imageranking' || type === 'mediaranking') {
    return <ImageRankingTrueSkillAnalysis answers={answers} question={question} type={type} />;
  }

  // ── image_rating / media_rating ───────────────────────────────────────────
  if (type === 'image_rating' || type === 'imagerating' || type === 'mediarating') {
    const rateMax = question.rateMax ?? 5;
    const rateMin = question.rateMin ?? 1;
    const perImage = {};

    for (const { answer, shown_images } of answers) {
      const rating = Number(answer);
      if (Number.isNaN(rating) || !shown_images?.length) continue;
      for (const img of shown_images) {
        const key = imageKeyFromShown(img) || img;
        if (!perImage[key]) perImage[key] = { url: img, ratings: [] };
        perImage[key].ratings.push(rating);
      }
    }

    const rankedItems = Object.entries(perImage)
      .map(([key, { url, ratings }]) => {
        const avg = average(ratings);
        return {
          key,
          url,
          value: avg ?? rateMin,
          label: `${avg?.toFixed(2) ?? '–'} / ${rateMax} · n=${ratings.length}`,
        };
      })
      .sort((a, b) => b.value - a.value);

    const mediaNoun = type === 'mediarating' ? 'media' : 'image';
    return (
      <Box>
        <CompactImageRanking
          title={`Average rating by ${mediaNoun}`}
          items={rankedItems}
          getImageUrl={getImageUrl}
          maxValue={rateMax}
          formatLabel={(_, label) => label}
        />
        {rankedItems.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── image_boolean / media_boolean ─────────────────────────────────────────
  if (type === 'image_boolean' || type === 'imageboolean' || type === 'mediaboolean') {
    const perImage = {};

    for (const { answer, shown_images } of answers) {
      if (!shown_images?.length) continue;
      for (const img of shown_images) {
        const key = imageKeyFromShown(img) || img;
        if (!perImage[key]) perImage[key] = { url: img, yes: 0, no: 0 };
        if (answer === true || answer === 'true') perImage[key].yes += 1;
        else perImage[key].no += 1;
      }
    }

    const rankedItems = Object.entries(perImage)
      .map(([key, { url, yes, no }]) => {
        const total = yes + no;
        const rate = total > 0 ? yes / total : 0;
        return {
          key,
          url,
          value: rate,
          label: `${pct(yes, total)}% yes (${yes}/${total})`,
        };
      })
      .sort((a, b) => b.value - a.value);

    const mediaNoun = type === 'mediaboolean' ? 'media' : 'image';
    return (
      <Box>
        <CompactImageRanking
          title={`Yes rate by ${mediaNoun}`}
          items={rankedItems}
          getImageUrl={getImageUrl}
          maxValue={1}
          formatLabel={(_, label) => label}
        />
        {rankedItems.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── imagecheckbox / mediacheckbox: stimulus × text-tag select rates ────────
  if (type === 'image_checkbox' || type === 'imagecheckbox' || type === 'mediacheckbox') {
    const choiceMeta = {};
    (question?.choices || []).forEach((c) => {
      const v = typeof c === 'object' ? String(c.value ?? c.text ?? '') : String(c);
      if (!v) return;
      choiceMeta[v] = typeof c === 'object' ? String(c.text ?? c.label ?? c.value ?? v) : v;
    });
    const perImage = {};
    for (const { answer, shown_images } of answers) {
      const selected = Array.isArray(answer) ? answer.map(String)
        : (answer == null || answer === '' ? [] : [String(answer)]);
      const stims = shown_images?.length ? shown_images : ['(no_media)'];
      for (const img of stims) {
        const key = imageKeyFromShown(img) || String(img);
        if (!perImage[key]) perImage[key] = { url: img, n: 0, counts: {} };
        perImage[key].n += 1;
        selected.forEach((opt) => {
          perImage[key].counts[opt] = (perImage[key].counts[opt] || 0) + 1;
          if (!choiceMeta[opt]) choiceMeta[opt] = opt;
        });
      }
    }
    const mediaNoun = type === 'mediacheckbox' ? 'media' : 'image';
    const blocks = Object.entries(perImage).map(([key, block]) => {
      const items = Object.keys(choiceMeta).map((opt) => {
        const count = block.counts[opt] || 0;
        const rate = block.n > 0 ? count / block.n : 0;
        return {
          key: opt,
          url: null,
          value: rate,
          label: `${choiceMeta[opt]} · ${pct(count, block.n)}% (${count}/${block.n})`,
        };
      }).sort((a, b) => b.value - a.value);
      return { key, url: block.url, n: block.n, items };
    }).sort((a, b) => String(a.key).localeCompare(String(b.key)));

    if (!blocks.length) {
      return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
    }
    return (
      <Box>
        {blocks.map((block) => (
          <Box key={block.key} sx={{ mb: 2.5 }}>
            {(typeof block.url === 'string' && (block.url.startsWith('http') || block.url.startsWith('/'))) ? (
              <Box
                component="img"
                src={getImageUrl(block.url) || block.url}
                alt=""
                sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, mb: 1, display: 'block' }}
              />
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {block.key}
              </Typography>
            )}
            <CompactImageRanking
              title={`Select rate by tag · ${mediaNoun} n=${block.n}`}
              items={block.items}
              getImageUrl={() => null}
              maxValue={1}
              formatLabel={(_, label) => label}
            />
          </Box>
        ))}
      </Box>
    );
  }

  // ── image_matrix / mediamatrix ────────────────────────────────────────────
  if (type === 'image_matrix' || type === 'imagematrix' || type === 'mediamatrix') {
    return (
      <ImageMatrixAttributeTabs
        question={question}
        answers={answers}
        getImageUrl={getImageUrl}
      />
    );
  }

  // ── fallback ──────────────────────────────────────────────────────────────
  const allShownImages = [...new Set(answers.flatMap((a) => a.shown_images || []))];
  return (
    <Box>
      <ShownImagesContext imageUrls={allShownImages} />
      <ChoiceDistribution answers={answers} />
    </Box>
  );
}

// ─── Skill question analysis ──────────────────────────────────────────────────
// Skills declare a resultSchema ([{ key, label, type }]) describing how each
// answer field should be summarized. Supported types:
//   number | boolean | choice | text | count | color | scaleGroup
//   points | path | allocation | rankedList  (reuse native analyses)
// Without a schema we auto-infer one from the answer shape, so results are
// never shown as raw JSON dumps.

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function skillFieldStimulusMeta(entry) {
  const key = skillAnswerStimulusKey(entry);
  if (!key || key === '(no_media)') return null;
  const answer = entry?.answer;
  const shown = entry?.shown_images || [];
  const url = answer?.imageUrl || answer?.videoUrl
    || (typeof shown[0] === 'string' ? shown[0] : shown[0]?.url)
    || key;
  return { key, url };
}

function SkillFieldSummary({ field, answers }) {
  const resolvedUrl = useContext(ImageResolverContext);
  const getImageUrl = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'))) return value;
    const key = imageKeyFromShown(value);
    return resolvedUrl?.get(key) || resolvedUrl?.get(value) || null;
  };

  const values = answers
    .map((a) => getPath(a.answer, field.key))
    .filter((v) => v !== undefined && v !== null);

  const header = (
    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
      {field.label || field.key}
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        n={values.length}
      </Typography>
    </Typography>
  );

  if (!values.length) {
    return (
      <Box sx={{ mb: 2.5 }}>
        {header}
        <Typography variant="body2" color="text.secondary">No data.</Typography>
      </Box>
    );
  }

  const archetypeBody = (
    <SkillArchetypeFieldSummary field={field} answers={answers} />
  );
  if (archetypeBody && ARCHETYPE_SKILL_RESULT_TYPES.includes(canonicalizeSkillResultType(field.type))) {
    return (
      <Box sx={{ mb: 2.5 }}>
        {header}
        {archetypeBody}
      </Box>
    );
  }

  // Media-native ranking (same pattern as imagerating / mediaboolean), not text histograms.
  const perMedia = {};
  answers.forEach((entry) => {
    const stim = skillFieldStimulusMeta(entry);
    if (!stim) return;
    const raw = getPath(entry.answer, field.key);
    if (raw === undefined || raw === null) return;
    if (!perMedia[stim.key]) perMedia[stim.key] = { url: stim.url, vals: [] };
    perMedia[stim.key].vals.push(raw);
  });
  const mediaKeys = Object.keys(perMedia);

  let body = null;

  if (mediaKeys.length > 1 && (field.type === 'number' || field.type === 'count')) {
    const rankedItems = mediaKeys.map((key) => {
      const { url, vals } = perMedia[key];
      const nums = field.type === 'count'
        ? vals.map((v) => (Array.isArray(v) ? v.length : Number(v))).filter((n) => !Number.isNaN(n))
        : vals.map(Number).filter((n) => !Number.isNaN(n));
      const avg = average(nums);
      return {
        key,
        url,
        value: avg ?? 0,
        label: `${avg?.toFixed(2) ?? '–'} · n=${nums.length}`,
      };
    }).sort((a, b) => b.value - a.value);
    const maxValue = Math.max(...rankedItems.map((i) => i.value), 1);
    body = (
      <CompactImageRanking
        title={`${field.label || field.key} by media`}
        items={rankedItems}
        getImageUrl={getImageUrl}
        maxValue={maxValue}
        formatLabel={(_, label) => label}
      />
    );
  } else if (mediaKeys.length > 1 && field.type === 'boolean') {
    const rankedItems = mediaKeys.map((key) => {
      const { url, vals } = perMedia[key];
      const yes = vals.filter((v) => v === true || v === 'true').length;
      const total = vals.length;
      const rate = total > 0 ? yes / total : 0;
      return {
        key,
        url,
        value: rate,
        label: `${pct(yes, total)}% yes (${yes}/${total})`,
      };
    }).sort((a, b) => b.value - a.value);
    body = (
      <CompactImageRanking
        title={`${field.label || field.key} — yes rate by media`}
        items={rankedItems}
        getImageUrl={getImageUrl}
        maxValue={1}
        formatLabel={(_, label) => label}
      />
    );
  } else if (field.type === 'number') {
    const nums = values.map(Number).filter((n) => !isNaN(n));
    const distinct = [...new Set(nums)].sort((a, b) => a - b);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    body = (
      <Box>
        <DescriptiveStatsLine nums={nums} />
        {nums.length >= 3 && (
          <DensityHistogramChart scores={nums} domainMin={min} domainMax={max} padB={40} chartH={180} />
        )}
        {distinct.length > 1 && distinct.length <= 10 && distinct.map((v, idx) => (
          <HorizontalBar
            key={v}
            label={String(v)}
            count={nums.filter((n) => n === v).length}
            total={nums.length}
            index={idx}
          />
        ))}
      </Box>
    );
  } else if (field.type === 'boolean') {
    const yes = values.filter((v) => v === true || v === 'true').length;
    body = (
      <Box>
        <HorizontalBar label="Yes" count={yes} total={values.length} color="#4caf50" />
        <HorizontalBar label="No" count={values.length - yes} total={values.length} color="#f44336" />
      </Box>
    );
  } else if (field.type === 'count') {
    const lengths = values.map((v) => (Array.isArray(v) ? v.length : Number(v))).filter((n) => !Number.isNaN(n));
    const avg = average(lengths);
    body = (
      <Typography variant="body2" color="text.secondary">
        {lengths.reduce((a, b) => a + b, 0)} items total · avg {avg !== null ? avg.toFixed(1) : '—'} per participant
      </Typography>
    );
  } else if (field.type === 'color') {
    const freq = {};
    for (const v of values) {
      const hex = typeof v === 'string' ? v : v?.hex;
      if (hex) freq[hex] = (freq[hex] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    body = (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {sorted.map(([hex, count]) => (
          <Chip
            key={hex}
            size="small"
            label={`${hex} × ${count}`}
            sx={{
              bgcolor: hex,
              color: '#fff',
              textShadow: '0 0 3px rgba(0,0,0,0.7)',
              fontFamily: 'monospace',
            }}
          />
        ))}
      </Box>
    );
  } else if (field.type === 'scaleGroup') {
    // value = [{ id, left, right, label?, value }] OR { dimensionId: number }
    const dims = {}; // id → { left, right, label, values: [] }
    for (const v of values) {
      if (Array.isArray(v)) {
        for (const d of v) {
          if (!d || d.value === undefined) continue;
          const id = d.id || d.label || `${d.left}/${d.right}`;
          if (!dims[id]) dims[id] = { left: d.left, right: d.right, label: d.label, values: [] };
          const n = Number(d.value);
          if (!isNaN(n)) dims[id].values.push(n);
        }
      } else if (v && typeof v === 'object') {
        Object.entries(v).forEach(([id, raw]) => {
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (!dims[id]) dims[id] = { label: id, values: [] };
          dims[id].values.push(n);
        });
      }
    }
    const allVals = Object.values(dims).flatMap((d) => d.values);
    const scaleMax = Math.max(7, ...allVals);
    body = (
      <Box>
        {Object.entries(dims).map(([id, d]) => {
          const avg = average(d.values);
          const w = avg !== null ? Math.round(((avg - 1) / (scaleMax - 1)) * 100) : 0;
          return (
            <Box key={id} sx={{ mb: 1.2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography variant="body2">
                  {d.label || `${d.left || ''} ↔ ${d.right || ''}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {avg !== null ? avg.toFixed(2) : '—'} / {scaleMax}
                </Typography>
              </Box>
              <Box sx={{ height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${w}%`, bgcolor: 'primary.main', borderRadius: 1 }} />
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  } else if (field.type === 'text') {
    body = <TextAnswers answers={values.map((v) => ({ answer: String(v) }))} />;
  } else {
    // 'choice' and anything else: frequency distribution of stringified values
    const freq = {};
    for (const v of values) {
      const key = typeof v === 'object' ? JSON.stringify(v) : String(v);
      freq[key] = (freq[key] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    body = (
      <Box>
        {sorted.map(([value, count], idx) => (
          <HorizontalBar key={value} label={value} count={count} total={values.length} index={idx} />
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2.5 }}>
      {header}
      {body}
    </Box>
  );
}

// Keys that carry media context rather than measurements — excluded from
// the auto-inferred schema.
function inferSkillResultSchema(sampleAnswer) {
  if (!sampleAnswer || typeof sampleAnswer !== 'object') return [];
  return Object.entries(stripSkillAnswerContext(sampleAnswer))
    .map(([k, v]) => {
      if (typeof v === 'number') return { key: k, label: k, type: 'number' };
      if (typeof v === 'boolean') return { key: k, label: k, type: 'boolean' };
      if (Array.isArray(v)) {
        if (v.length >= 1 && v.every((p) => p && typeof p === 'object'
          && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))) {
          const kl = k.toLowerCase();
          if (/bbox|bounding|\brect\b|\bbox\b/.test(kl) || /(^|_)box(_|$)/.test(kl)) {
            return { key: k, label: k, type: 'bbox' };
          }
          if (/polygon|poly|region|area|mask/.test(kl)) {
            return { key: k, label: k, type: 'polygon' };
          }
          if (v.some((p) => p.t != null) || /path|route|trace|line/.test(kl)) {
            return { key: k, label: k, type: 'path' };
          }
          if (v.length >= 3) return { key: k, label: k, type: 'polygon' };
          if (v.length === 2) return { key: k, label: k, type: 'bbox' };
          return { key: k, label: k, type: 'points' };
        }
        if (v.length >= 1 && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
          if (/rank|order|priority/i.test(k) || v.length >= 3) {
            return { key: k, label: k, type: 'rankedList' };
          }
        }
        return { key: k, label: k, type: 'count' };
      }
      if (v && typeof v === 'object') {
        const vals = Object.values(v);
        if (vals.length && vals.every((x) => Number.isFinite(Number(x)))) {
          if (/alloc|budget|weight|points/i.test(k)) {
            return { key: k, label: k, type: 'allocation' };
          }
          return { key: k, label: k, type: 'scaleGroup' };
        }
      }
      if (typeof v === 'string') {
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          return { key: k, label: k, type: 'color' };
        }
        return { key: k, label: k, type: 'choice' };
      }
      return null;
    })
    .filter(Boolean);
}

function inferSkillResultSchemaFromAnswers(answers) {
  const votes = new Map();
  (answers || []).forEach((entry) => {
    inferSkillResultSchema(entry?.answer).forEach((field) => {
      if (!votes.has(field.key)) votes.set(field.key, new Map());
      const byType = votes.get(field.key);
      byType.set(field.type, (byType.get(field.type) || 0) + 1);
    });
  });
  let winningVotes = 0;
  let totalVotes = 0;
  const schema = [...votes.entries()].map(([key, byType]) => {
    const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    winningVotes += sorted[0][1];
    totalVotes += sorted.reduce((sum, [, count]) => sum + count, 0);
    return { key, label: key, type: sorted[0][0] };
  });
  return { schema, confidence: totalVotes ? winningVotes / totalVotes : 0 };
}

function SkillRawResponses({ answers, maxVisible = 10 }) {
  const { t } = useRegion();
  const [showAll, setShowAll] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const visible = showAll ? answers : answers.slice(0, maxVisible);

  if (!answers.length) {
    return <Typography variant="body2" color="text.secondary">{t.resultsSkillNoResponses}</Typography>;
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t.resultsSkillRawHint}
      </Typography>
      {showJson && visible.map((entry, idx) => {
        const shown = entry.shown_images?.length ? entry.shown_images : [];
        return (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {tf(t.resultsSkillResponseN, { n: idx + 1 })}
            </Typography>
            {showJson && (
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  m: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                }}
              >
                {formatSkillAnswerForDisplay(entry.answer)}
              </Typography>
            )}
            {shown.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t.resultsSkillStimulusMedia}{' '}
                {shown.map((u) => shortName(u)).join(' · ')}
              </Typography>
            )}
          </Paper>
        );
      })}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
        <Button size="small" onClick={() => setShowJson((v) => !v)}>
          {showJson ? t.resultsSkillHideRawJson : t.resultsSkillShowRawJson}
        </Button>
        {showJson && answers.length > maxVisible && (
          <Button size="small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? t.resultsSkillShowLess : tf(t.resultsSkillShowAllN, { n: answers.length })}
          </Button>
        )}
      </Box>
    </Box>
  );
}

function skillAnswerStimulusKey(entry) {
  const answer = entry?.answer;
  const shown = entry?.shown_images || [];
  const key = imageStimulusKey(answer, shown);
  if (key && key !== '(unknown_image)') return key;
  const video = answer?.videoUrl || answer?.video_url;
  if (video) return mediaFilenameKey(typeof video === 'string' ? video : video?.url || '');
  return '(no_media)';
}

/** The single native analysis renderer used by native questions and Skill fields. */
function renderNativeQuestionAnalysisBody(question, answers, allResponses) {
  const type = question?.type || 'text';
  if (type === 'rating') return (
    <><IrrSummary responses={allResponses} question={question} /><RatingDistribution answers={answers} rateMin={question.rateMin ?? 1} rateMax={question.rateMax ?? 5} /></>
  );
  if (type === 'number') return <NumberDistribution answers={answers} question={question} />;
  if (type === 'radiogroup' || type === 'dropdown') return <ChoiceDistribution answers={answers} choices={question.choices} />;
  if (type === 'checkbox') return <ChoiceDistribution answers={answers} choices={question.choices} isCheckbox />;
  if (type === 'boolean' || type === 'consent') return <BooleanDistribution answers={answers} />;
  if (type === 'comment' || type === 'text') return question.inputType === 'number'
    ? <NumberDistribution answers={answers} question={question} />
    : <TextAnswers answers={answers} />;
  if (type === 'matrix') return <MatrixDistribution answers={answers} rows={question.rows} columns={question.columns} />;
  if (type === 'ranking') return <RankingDistribution answers={answers} choices={question.choices} />;
  if (type === 'slidergroup') return <><IrrSummary responses={allResponses} question={question} /><SliderGroupAnalysis question={question} answers={answers} /></>;
  if (type === 'imageslidergroup' || type === 'mediaslidergroup') return <><IrrSummary responses={allResponses} question={question} /><ImageSliderGroupAnalysis question={question} answers={answers} /></>;
  if (type === 'pointallocation') return <PointAllocationAnalysis question={question} answers={answers} />;
  if (type === 'imagepointallocation' || type === 'mediapointallocation') return <ImagePointAllocationAnalysis question={question} answers={answers} />;
  if (type === 'imageannotation') return <AnnotationAnalysis answers={answers} questionName={question.name} responses={allResponses} />;
  if (type === 'imagepicker' || type === 'mediapicker') return (
    <><IrrSummary responses={allResponses} question={question} /><ImagePickerDistribution question={question} allResponses={allResponses} /></>
  );
  if (['image_rating', 'imagerating', 'image_ranking', 'imageranking', 'mediaranking', 'image_boolean', 'imageboolean', 'image_checkbox', 'imagecheckbox', 'mediacheckbox', 'image_matrix', 'imagematrix', 'mediamatrix', 'mediarating', 'mediaboolean'].includes(type)) return (
    <>
      {['imagerating', 'image_rating', 'mediarating'].includes(type) && <IrrSummary responses={allResponses} question={question} />}
      <ImageQuestionAnalysis answers={answers} type={type} question={question} />
    </>
  );
  return null;
}

/** Render an adapted Skill field through the same chart components as its native question type. */
function NativeSkillFieldAnalysis({ sourceQuestion, field, answers, allResponses, showHeader = true }) {
  const question = skillFieldNativeQuestion(sourceQuestion, field);
  const adaptedAnswers = adaptSkillAnswerEntries(sourceQuestion, field, answers);
  const adaptedStored = adaptResponsesForSkillField(sourceQuestion, field, allResponses || []);
  const type = question?.type;
  let body = null;
  if (question && adaptedAnswers.length) {
    body = renderNativeQuestionAnalysisBody(question, adaptedAnswers, adaptedStored.responses);
    if (!body && type === 'skillquestion') {
      const PresetAnalysis = getPresetSkillAnalysis(question.skillId);
      body = PresetAnalysis ? <PresetAnalysis answers={adaptedAnswers} question={question} /> : null;
    }
  }
  // Adapter miss / unsupported native mapping → archetype summary (never silent blank).
  if (!body) {
    body = <SkillArchetypeFieldSummary field={field} answers={answers} />;
  }
  if (!showHeader) return body;
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {field.label || field.key}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {(type || field.type || 'field')} · n={adaptedAnswers.length || answers.length}
        </Typography>
      </Typography>
      {body}
    </Box>
  );
}

function SkillQuestionAnalysis({ question, answers, allResponses }) {
  const { t } = useRegion();
  const [resolvedSchema, setResolvedSchema] = useState(
    () => (Array.isArray(question.skillResultSchema) ? question.skillResultSchema : []),
  );

  useEffect(() => {
    let cancelled = false;
    const skillId = question.skillId;
    if (!skillId || skillId.startsWith('preset_')) {
      return undefined;
    }
    (async () => {
      try {
        const skill = await getSkillById(skillId, question.skillRevision || null);
        if (!cancelled) {
          if (!question.skillResultSchema?.length) setResolvedSchema(skill?.resultSchema || []);
        }
      } catch {
        // The frozen schema/raw answer remains usable if the library entry is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [question.skillId, question.skillRevision, question.skillResultSchema]);

  const enrichedAnswers = useMemo(
    () => filterAnswersForSkill(enrichSkillAnswers(answers), question.skillId),
    [answers, question.skillId],
  );
  const droppedCount = answers.length - enrichedAnswers.length;
  // Historical contracts allowed scalar/array answers. Preserve the raw value,
  // but wrap it in memory so typed analysis can use the normal object pipeline.
  const objAnswers = enrichedAnswers.map((entry) => ({
    ...entry,
    originalAnswer: entry.answer,
    answer: (entry.answer && typeof entry.answer === 'object' && !Array.isArray(entry.answer))
      ? entry.answer
      : { value: entry.answer },
  }));
  const PresetAnalysis = getPresetSkillAnalysis(question.skillId);

  if (PresetAnalysis) {
    if (!objAnswers.length) {
      return <Typography variant="body2" color="text.secondary">{t.resultsSkillNoResponses}</Typography>;
    }
    return (
      <Box>
        <IrrSummary responses={allResponses} question={question} />
        {droppedCount > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Ignored {droppedCount} response{droppedCount === 1 ? '' : 's'} with the wrong answer shape
            (cross-contamination from an older bug when multiple skills shared one page).
          </Alert>
        )}
        <PresetAnalysis answers={objAnswers} question={question} />
      </Box>
    );
  }

  if (!objAnswers.length) {
    return <Typography variant="body2" color="text.secondary">{t.resultsSkillNoResponses}</Typography>;
  }

  let schema = resolvedSchema;
  if (!schema?.length && question.skillId?.startsWith('preset_')) {
    schema = getPresetSkill(question.skillId.replace(/^preset_/, ''))?.resultSchema;
  }
  let inferredContract = null;
  if (!schema?.length && objAnswers.length) {
    inferredContract = inferSkillResultSchemaFromAnswers(objAnswers);
    schema = inferredContract.schema;
  }
  if (Array.isArray(schema)) {
    schema = schema.filter((f) => f.key !== 'mode');
  }
  const contractMismatchCount = objAnswers.filter(({ answer }) => {
    const check = checkAnswerAgainstResultSchema(answer, schema || []);
    return !check.recorded || check.fields.some((field) => !field.ok);
  }).length;

  // Like imagerating / preset skills: charts rank or overlay by media inside each field.
  // No text-style "response list / readable summary" subsections.
  const chartSchema = (schema || []).filter((f) => {
    if (!f?.key) return false;
    if (skillFieldNativeQuestion(question, f)) return true;
    if (['path', 'points', 'polygon', 'bbox', 'box', 'weights', 'allocations'].includes(f.key)
      && f.type === 'count') return false;
    return true;
  });
  const nativeParityContract = !inferredContract
    && chartSchema.length === 1
    && !!skillFieldNativeQuestion(question, chartSchema[0]);

  return (
    <Box>
      {droppedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Ignored {droppedCount} response{droppedCount === 1 ? '' : 's'} with the wrong answer shape
          (cross-contamination from an older bug when multiple skills shared one page).
        </Alert>
      )}
      {contractMismatchCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          contract_mismatch: {contractMismatchCount} response{contractMismatchCount === 1 ? '' : 's'} did not match the frozen Skill result schema. Raw JSON is preserved below.
        </Alert>
      )}
      {inferredContract && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Missing historical contract: inferred from {objAnswers.length} responses with {Math.round(inferredContract.confidence * 100)}% field-type agreement. This inference is read-only and was not written back.
        </Alert>
      )}
      {chartSchema.length > 0 ? (
        <Box sx={{ mb: 1 }}>
          {chartSchema.map((field) => (
            <NativeSkillFieldAnalysis
              key={field.key}
              sourceQuestion={question}
              field={field}
              answers={objAnswers}
              allResponses={allResponses}
              showHeader={chartSchema.length > 1}
            />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t.resultsSkillNoResponses}
        </Typography>
      )}
      {!nativeParityContract && <SkillRawResponses answers={enrichedAnswers} maxVisible={10} />}
    </Box>
  );
}

// ─── Text ranking analysis ────────────────────────────────────────────────────
// answer = [choiceValue_rank1, choiceValue_rank2, ...]
function RankingDistribution({ answers, choices }) {
  const labelMap = {};
  (choices || []).forEach((c) => {
    if (typeof c === 'object' && c !== null) labelMap[c.value] = c.text || c.value;
    else labelMap[c] = c;
  });
  const rankPositions = {};
  const rankingLists = [];
  for (const { answer } of answers) {
    const ranked = Array.isArray(answer) ? answer : [];
    if (ranked.length) rankingLists.push(ranked);
    ranked.forEach((val, idx) => {
      if (!rankPositions[val]) rankPositions[val] = [];
      rankPositions[val].push(idx + 1);
    });
  }
  const items = Object.keys(rankPositions);
  const nItems = items.length;
  const bordaMap = computeBordaScores(rankPositions, nItems);
  const sorted = Object.entries(rankPositions)
    .map(([val, ranks]) => ({
      val,
      avg: average(ranks),
      sd: ranks.length > 1 ? Math.sqrt(ranks.reduce((s, r) => s + (r - average(ranks)) ** 2, 0) / ranks.length) : 0,
      borda: bordaMap[val]?.borda,
      n: ranks.length,
    }))
    .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
  const maxRank = sorted.length;
  const w = kendallW(rankingLists, items);

  return (
    <Box>
      {w != null && (
        <Alert severity={w >= 0.5 ? 'success' : 'info'} sx={{ mb: 2 }}>
          Kendall&apos;s W = {w.toFixed(3)} — {interpretKendallW(w)}
        </Alert>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Average rank (1 = top) · Borda score · SD · use card Export for CSV
        </Typography>
      </Box>
      {sorted.map(({ val, avg, sd, borda, n }, idx) => (
        <Box key={val} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Chip size="small" label={`#${idx + 1}`} color={idx === 0 ? 'primary' : 'default'} sx={{ width: 44 }} />
          <Typography variant="body2" sx={{ width: 160, flexShrink: 0 }} noWrap>
            {labelMap[val] || val}
          </Typography>
          <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{
              height: '100%',
              width: `${pct(maxRank - (avg ?? maxRank) + 1, maxRank)}%`,
              bgcolor: BAR_COLORS[idx % BAR_COLORS.length],
            }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ width: 150, textAlign: 'right' }}>
            avg {avg?.toFixed(2) ?? '–'} ±{sd?.toFixed(2)} · Borda {borda?.toFixed(1)} · n={n}
          </Typography>
        </Box>
      ))}
      {sorted.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
    </Box>
  );
}

// ─── Native slider group / point allocation analysis ─────────────────────────

function useImageUrlResolver() {
  const resolvedUrl = useContext(ImageResolverContext);
  return (value) => {
    if (!value) return null;
    if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'))) return value;
    const key = imageKeyFromShown(value);
    return resolvedUrl?.get(key) || resolvedUrl?.get(value) || null;
  };
}

/**
 * Bottom tab per slider dimension (attribute); ranking inside is by image only
 * (imageslidergroup / mediaslidergroup).
 */
function ImageSliderGroupAnalysis({ question, answers }) {
  const getImageUrl = useImageUrlResolver();
  const dims = question.dimensions || [];
  const scaleMin = question.scaleMin ?? 1;
  const scaleMax = question.scaleMax ?? 7;
  const [tab, setTab] = useState(0);

  const dimKeys = dims.length
    ? dims.map((d) => d.id)
    : [...new Set(
      (answers || []).flatMap(({ answer }) => (
        answer && typeof answer === 'object' ? Object.keys(answer) : []
      )),
    )];
  const safeTab = Math.min(tab, Math.max(0, dimKeys.length - 1));
  const dimId = dimKeys[safeTab];
  const dimDef = dims.find((d) => d.id === dimId);
  const dimTitle = dimDef
    ? (dimDef.label || `${dimDef.left} ↔ ${dimDef.right}`)
    : dimId;

  const { allVals, rankedItems } = useMemo(() => {
    if (!dimId) return { allVals: [], rankedItems: [] };
    const vals = [];
    const perImage = {};
    for (const { answer, shown_images } of answers || []) {
      if (!shown_images?.length || typeof answer !== 'object' || !answer) continue;
      const val = Number(answer[dimId]);
      if (Number.isNaN(val)) continue;
      vals.push(val);
      const img = shown_images[0];
      const key = imageKeyFromShown(img) || img;
      if (!perImage[key]) perImage[key] = { url: img, vals: [] };
      perImage[key].vals.push(val);
    }
    const ranked = Object.entries(perImage)
      .map(([key, { url, vals: imgVals }]) => {
        const avg = average(imgVals);
        return {
          key,
          url,
          value: avg ?? scaleMin,
          label: `${avg?.toFixed(2) ?? '–'} / ${scaleMax} · n=${imgVals.length}`,
        };
      })
      .sort((a, b) => b.value - a.value);
    return { allVals: vals, rankedItems: ranked };
  }, [answers, dimId, scaleMin, scaleMax]);

  if (!dimKeys.length) {
    return <Typography variant="body2" color="text.secondary">No dimensions configured.</Typography>;
  }

  const mean = average(allVals);
  const sd = allVals.length > 1
    ? Math.sqrt(allVals.reduce((s, v) => s + (v - mean) ** 2, 0) / allVals.length)
    : 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{dimDef?.left || ''}</Typography>
        <Typography variant="caption" fontWeight={700}>
          {mean != null
            ? `avg ${mean.toFixed(2)} ± ${sd.toFixed(2)} (n=${allVals.length})`
            : 'no data'}
        </Typography>
        <Typography variant="caption" color="text.secondary">{dimDef?.right || ''}</Typography>
      </Box>
      {allVals.length > 0 && <DescriptiveStatsLine nums={allVals} />}
      {allVals.length >= 3 && (
        <DensityHistogramChart
          scores={allVals}
          domainMin={scaleMin}
          domainMax={scaleMax}
          title={`${dimTitle} — score distribution`}
          caption="Blue bars: histogram (density). Orange curve: fitted normal PDF."
          xLabel={`Score (${scaleMin}–${scaleMax})`}
          padB={40}
          chartH={200}
        />
      )}
      {rankedItems.length > 0 && (
        <CompactImageRanking
          title={null}
          items={rankedItems}
          getImageUrl={getImageUrl}
          maxValue={scaleMax}
          formatLabel={(_, label) => label}
        />
      )}
      {allVals.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
      <Tabs
        value={safeTab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          mt: 1,
          borderTop: 1,
          borderColor: 'divider',
          minHeight: 40,
          '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
        }}
      >
        {dimKeys.map((id) => {
          const def = dims.find((d) => d.id === id);
          const label = def
            ? (def.label || `${def.left || ''} ↔ ${def.right || ''}`.trim() || id)
            : id;
          return <Tab key={id} label={label} />;
        })}
      </Tabs>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        Attribute: {dimTitle}
      </Typography>
    </Box>
  );
}

/**
 * Bottom tab per allocation choice (attribute); ranking inside is by image only
 * (imagepointallocation / mediapointallocation).
 */
function ImagePointAllocationAnalysis({ question, answers }) {
  const getImageUrl = useImageUrlResolver();
  const choices = (question.choices || []).map((c) => (typeof c === 'object' ? c : { value: c, text: c }));
  const budget = question.budget || 100;
  const [tab, setTab] = useState(0);

  const choiceKeys = choices.length
    ? choices.map((c) => c.value)
    : [...new Set(
      (answers || []).flatMap(({ answer }) => (
        answer && typeof answer === 'object' ? Object.keys(answer) : []
      )),
    )];
  const safeTab = Math.min(tab, Math.max(0, choiceKeys.length - 1));
  const choiceKey = choiceKeys[safeTab];
  const choiceDef = choices.find((c) => c.value === choiceKey);
  const choiceLabel = choiceDef ? (choiceDef.text || choiceDef.value) : choiceKey;

  let compliant = 0;
  (answers || []).forEach(({ answer }) => {
    if (!answer || typeof answer !== 'object') return;
    const sum = Object.values(answer).reduce((s, v) => s + (Number(v) || 0), 0);
    if (Math.abs(sum - budget) < 0.01) compliant += 1;
  });

  const rankedItems = useMemo(() => {
    if (!choiceKey) return [];
    const perImage = {};
    for (const { answer, shown_images } of answers || []) {
      if (!shown_images?.length || typeof answer !== 'object' || !answer) continue;
      const pts = Number(answer[choiceKey]);
      if (Number.isNaN(pts)) continue;
      const img = shown_images[0];
      const key = imageKeyFromShown(img) || img;
      if (!perImage[key]) perImage[key] = { url: img, vals: [] };
      perImage[key].vals.push(pts);
    }
    return Object.entries(perImage)
      .map(([key, { url, vals }]) => {
        const avg = average(vals);
        return {
          key,
          url,
          value: avg ?? 0,
          label: `${avg?.toFixed(1) ?? '–'} / ${budget} pts · n=${vals.length}`,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [answers, choiceKey, budget]);

  if (!choiceKeys.length) {
    return <Typography variant="body2" color="text.secondary">No allocation choices configured.</Typography>;
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Budget compliance: {compliant}/{answers.length} ({pct(compliant, answers.length)}%)
      </Typography>
      {rankedItems.length > 0 ? (
        <CompactImageRanking
          title={null}
          items={rankedItems}
          getImageUrl={getImageUrl}
          maxValue={budget}
          formatLabel={(_, label) => label}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
      <Tabs
        value={safeTab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          mt: 1,
          borderTop: 1,
          borderColor: 'divider',
          minHeight: 40,
          '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 13 },
        }}
      >
        {choiceKeys.map((ck) => {
          const def = choices.find((c) => c.value === ck);
          return <Tab key={ck} label={def ? (def.text || def.value) : ck} />;
        })}
      </Tabs>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        Attribute: {choiceLabel}
      </Typography>
    </Box>
  );
}

function SliderGroupAnalysis({ question, answers }) {
  const dims = question.dimensions || [];
  const scaleMin = question.scaleMin ?? 1;
  const scaleMax = question.scaleMax ?? 7;
  const stats = dims.map((d) => {
    const vals = answers
      .map((a) => (a.answer && typeof a.answer === 'object' ? Number(a.answer[d.id]) : NaN))
      .filter((v) => !Number.isNaN(v));
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) : 0;
    return { ...d, mean, sd, n: vals.length, vals };
  });

  return (
    <Box>
      <SemanticProfileChart dimensions={stats} scaleMin={scaleMin} scaleMax={scaleMax} />
      {stats.map((s) => (
        <Box key={s.id} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary">{s.left}</Typography>
            <Typography variant="caption" fontWeight={700}>
              {s.mean !== null ? `avg ${s.mean.toFixed(2)} ± ${s.sd.toFixed(2)} (n=${s.n})` : 'no data'}
            </Typography>
            <Typography variant="caption" color="text.secondary">{s.right}</Typography>
          </Box>
          {s.vals?.length >= 3 && (
            <DensityHistogramChart
              scores={s.vals}
              domainMin={scaleMin}
              domainMax={scaleMax}
              title={`${s.label || s.id} distribution`}
              padB={40}
              chartH={180}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}

function PointAllocationAnalysis({ question, answers }) {
  const choices = (question.choices || []).map((c) => (typeof c === 'object' ? c : { value: c, text: c }));
  const budget = question.budget || 100;
  let compliant = 0;
  const stats = choices.map((c) => {
    const vals = answers
      .map((a) => (a.answer && typeof a.answer === 'object' ? Number(a.answer[c.value]) || 0 : 0));
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) : 0;
    return { ...c, mean, sd, vals };
  });
  answers.forEach(({ answer }) => {
    if (!answer || typeof answer !== 'object') return;
    const sum = Object.values(answer).reduce((s, v) => s + (Number(v) || 0), 0);
    if (Math.abs(sum - budget) < 0.01) compliant += 1;
  });
  const maxMean = Math.max(...stats.map((s) => s.mean), 1);
  const allInOne = answers.filter(({ answer }) => {
    if (!answer || typeof answer !== 'object') return false;
    const vals = Object.values(answer).map(Number);
    const max = Math.max(...vals);
    return max >= budget * 0.99;
  }).length;

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Budget compliance: {compliant}/{answers.length} ({pct(compliant, answers.length)}%) ·
        All-in-one allocation: {allInOne} ({pct(allInOne, answers.length)}%)
      </Typography>
      {stats.map((s) => (
        <Box key={s.value} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography variant="caption" sx={{ width: 140, flexShrink: 0 }} noWrap>{s.text}</Typography>
          <Box sx={{ flex: 1, height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ width: `${(s.mean / maxMean) * 100}%`, height: '100%', bgcolor: 'primary.main' }} />
          </Box>
          <Typography variant="caption" fontWeight={700} sx={{ width: 110, textAlign: 'right' }}>
            {s.mean.toFixed(1)} ± {s.sd.toFixed(1)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

export function QuestionCard({ question, answers, totalResponses, questionNumber, allResponses, surveyConfig, exportResponses }) {
  const [expanded, setExpanded] = useState(false);
  const type = question.type || 'text';
  const trialUnitCount = answers.length;
  const participantCount = useMemo(() => {
    const ids = new Set();
    (answers || []).forEach((a, i) => {
      ids.add(a.participant_id || `row_${i}`);
    });
    return ids.size;
  }, [answers]);
  // Completion rate is per participant; charts/stats use per-trial units in `answers`.
  const responseCount = participantCount;

  const renderAnalysis = () => {
    if (type === 'skillquestion') {
      return <SkillQuestionAnalysis question={question} answers={answers} allResponses={allResponses} />;
    }
    const nativeBody = renderNativeQuestionAnalysisBody(question, answers, allResponses);
    if (nativeBody) return nativeBody;
    if (isDisplayOnlyQuestion(question) || ['expression', 'image', 'html', 'mediadisplay'].includes(type)) {
      return (
        <Typography variant="body2" color="text.secondary">
          Display-only question — no participant answers are collected.
        </Typography>
      );
    }
    return (
      <Typography variant="body2" color="text.secondary">
        Unrecognized or unsupported question type &quot;{type}&quot; — no dedicated analysis view.
        Check CSV export for raw answer data.
      </Typography>
    );
  };

  const responseRate = pct(responseCount, totalResponses);
  const displayOnly = isDisplayOnlyQuestion(question);
  const canExport = !displayOnly && responseCount > 0;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'grey.50' }
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            bgcolor: displayOnly ? 'grey.300' : 'primary.main',
            color: displayOnly ? 'text.secondary' : 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mr: 1.5,
            flexShrink: 0,
            fontSize: displayOnly ? '1rem' : '0.85rem',
            fontWeight: 'bold'
          }}
        >
          {displayOnly ? <TextFields sx={{ fontSize: 18 }} /> : questionNumber}
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.3 }}>
            {question.title || question.name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              icon={typeIcon(type)}
              label={type}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.7rem' }}
            />
            {question.isAttentionCheck && (
              <Chip label="Attention check" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            )}
            {displayOnly ? (
              <Typography variant="caption" color="text.secondary">
                Display / instruction
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {responseCount} / {totalResponses} responses ({responseRate}%)
                {supportsTrialCount(type) && (
                  <> · {trialUnitCount} trial ratings</>
                )}
              </Typography>
            )}
          </Box>
        </Box>

        {canExport && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download />}
            sx={{ mr: 1, flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              downloadQuestionExportZip(
                question,
                exportResponses || allResponses,
                surveyConfig,
              );
            }}
          >
            Export
          </Button>
        )}

        <IconButton size="small">
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Divider />
        <CardContent>
          <AttentionCheckPassRate question={question} allResponses={allResponses} />
          {responseCount === 0 && !isDisplayOnlyQuestion(question) ? (
            <Typography variant="body2" color="text.secondary">No responses for this question yet.</Typography>
          ) : (
            renderAnalysis()
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
}

// Wide CSV lives in src/lib/responsesWideExport.js

// ─── Main Component ───────────────────────────────────────────────────────────

function readExcludeFlaggedFromConfig(surveyConfig) {
  return typeof surveyConfig?.excludeFlaggedFromAnalysis === 'boolean'
    ? surveyConfig.excludeFlaggedFromAnalysis
    : false; // default OFF for new projects
}

function readIncludePracticeFromConfig(surveyConfig) {
  return typeof surveyConfig?.includeResearcherPractice === 'boolean'
    ? surveyConfig.includeResearcherPractice
    : true; // default ON for new projects
}

export default function ResultsAnalysis({ currentProject, surveyConfig, onSurveyConfigChange }) {
  const { t } = useRegion();
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(null);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [includePractice, setIncludePractice] = useState(() => readIncludePracticeFromConfig(surveyConfig));
  const [excludeFlagged, setExcludeFlagged] = useState(() => readExcludeFlaggedFromConfig(surveyConfig));
  const [savingExcludePref, setSavingExcludePref] = useState(false);
  const [savingPracticePref, setSavingPracticePref] = useState(false);
  const [excludePrefError, setExcludePrefError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    setExcludeFlagged(readExcludeFlaggedFromConfig(surveyConfig));
  }, [currentProject?.id, surveyConfig?.excludeFlaggedFromAnalysis]);

  useEffect(() => {
    setIncludePractice(readIncludePracticeFromConfig(surveyConfig));
  }, [currentProject?.id, surveyConfig?.includeResearcherPractice]);

  const handleExcludeFlaggedChange = async (checked) => {
    const previous = excludeFlagged;
    setExcludeFlagged(checked);
    setExcludePrefError(null);
    if (!currentProject?.id || !surveyConfig) return;

    const nextConfig = { ...surveyConfig, excludeFlaggedFromAnalysis: checked };
    setSavingExcludePref(true);
    try {
      const result = await saveProjectFull(currentProject, nextConfig);
      if (!result.success) throw new Error(result.error || 'Failed to save preference');
      onSurveyConfigChange?.(nextConfig);
    } catch (err) {
      setExcludeFlagged(previous);
      setExcludePrefError(err.message || 'Could not save analysis preference');
    } finally {
      setSavingExcludePref(false);
    }
  };

  const handleIncludePracticeChange = async (checked) => {
    const previous = includePractice;
    setIncludePractice(checked);
    setExcludePrefError(null);
    if (!currentProject?.id || !surveyConfig) return;

    const nextConfig = { ...surveyConfig, includeResearcherPractice: checked };
    setSavingPracticePref(true);
    try {
      const result = await saveProjectFull(currentProject, nextConfig);
      if (!result.success) throw new Error(result.error || 'Failed to save preference');
      onSurveyConfigChange?.(nextConfig);
    } catch (err) {
      setIncludePractice(previous);
      setExcludePrefError(err.message || 'Could not save analysis preference');
    } finally {
      setSavingPracticePref(false);
    }
  };

  const fetchResponses = useCallback(async () => {
    setLoading(true);
    setLoadProgress(null);
    setError(null);
    try {
      if (platformSupabase && currentProject?.id) {
        // Page through all rows — PostgREST default max is 1000.
        const pageSize = 1000;
        const all = [];
        let offset = 0;
        for (;;) {
          const from = offset;
          const to = offset + pageSize - 1;
          setLoadProgress({ loaded: all.length, page: Math.floor(offset / pageSize) + 1 });
          const { data, error: sbError } = await platformSupabase
            .from('survey_responses')
            .select('*')
            .eq('project_id', currentProject.id)
            .order('created_at', { ascending: false })
            .range(from, to);
          if (sbError) throw sbError;
          const batch = data || [];
          all.push(...batch);
          if (batch.length < pageSize) break;
          offset += pageSize;
          if (offset > 500000) break;
        }
        setResponses(all);
        setDataSource('supabase');
      } else {
        // Self-hosted fallback: local file server
        const resp = await fetch('http://localhost:3001/api/responses');
        if (resp.ok) {
          const json = await resp.json();
          setResponses(json.responses || []);
          setDataSource('file');
        } else {
          setError('No data source available. Configure Supabase environment variables.');
          setDataSource(null);
        }
      }
    } catch (err) {
      setError(`Failed to load responses: ${err.message}`);
    } finally {
      setLoading(false);
      setLoadProgress(null);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject) fetchResponses();
  }, [currentProject?.id, fetchResponses]);

  // Flatten all questions from survey pages
  const allQuestions = useMemo(() => {
    if (!surveyConfig?.pages) return [];
    return surveyConfig.pages.flatMap(page => page.elements || []);
  }, [surveyConfig]);

  const answerableQuestions = useMemo(
    () => allQuestions.filter(isAnswerableQuestion),
    [allQuestions],
  );

  const displayOnlyQuestionCount = allQuestions.length - answerableQuestions.length;

  const answerableNumberByName = useMemo(() => {
    const map = new Map();
    let n = 0;
    for (const q of allQuestions) {
      if (isAnswerableQuestion(q)) {
        n += 1;
        map.set(q.name, n);
      }
    }
    return map;
  }, [allQuestions]);

  const dateFilteredResponses = useMemo(() => {
    return responses.filter((row) => {
      if (currentProject?.id && row.project_id && row.project_id !== currentProject.id) return false;
      const ts = row.created_at || row.survey_metadata?.completion_time || row.saved_at;
      if (dateFrom && ts && new Date(ts) < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && ts && new Date(ts) > new Date(`${dateTo}T23:59:59`)) return false;
      if (sessionFilter && row.survey_metadata?.session_id !== sessionFilter) return false;
      if (!includePractice && row.survey_metadata?.practice_mode) return false;
      return true;
    });
  }, [responses, currentProject?.id, dateFrom, dateTo, sessionFilter, includePractice]);

  const handleDeleteResponse = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSurveyResponse({
        id: deleteTarget.id,
        filename: deleteTarget._filename,
        projectId: currentProject?.id,
      });
      setResponses((prev) => prev.filter((r) => responseRecordKey(r) !== responseRecordKey(deleteTarget)));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete response');
    } finally {
      setDeleting(false);
    }
  };

  const formatResponseTime = (row) => {
    const ts = row.created_at || row.survey_metadata?.completion_time || row.saved_at;
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const qualitySummary = useMemo(
    () => summarizeQuality(dateFilteredResponses, surveyConfig || {}),
    [dateFilteredResponses, surveyConfig],
  );

  const filteredResponses = useMemo(() => {
    if (!excludeFlagged || !surveyConfig) return dateFilteredResponses;
    return dateFilteredResponses.filter((row) => {
      const key = row.id ?? row.participant_id;
      return !(qualitySummary.perResponse[key]?.length);
    });
  }, [dateFilteredResponses, excludeFlagged, surveyConfig, qualitySummary]);

  const sessionOptions = useMemo(() => {
    const ids = new Set();
    responses.forEach((r) => {
      if (r.survey_metadata?.session_id) ids.add(r.survey_metadata.session_id);
    });
    return [...ids];
  }, [responses]);

  const practiceCount = useMemo(
    () => responses.filter((r) => r.survey_metadata?.practice_mode).length,
    [responses],
  );

  // Filter questions by search
  const filteredQuestions = useMemo(() => {
    if (!searchText.trim()) return allQuestions;
    const lower = searchText.toLowerCase();
    return allQuestions.filter(
      q =>
        (q.title || '').toLowerCase().includes(lower) ||
        (q.name || '').toLowerCase().includes(lower)
    );
  }, [allQuestions, searchText]);

  // Pre-collect answers + per-question denominators (practice only inflates that question)
  const questionAnswers = useMemo(() => {
    const map = {};
    for (const q of allQuestions) {
      map[q.name] = q.type === 'mediadisplay'
        ? collectShownMedia(q.name, filteredResponses)
        : collectAnswers(q.name, filteredResponses);
    }
    return map;
  }, [allQuestions, filteredResponses]);

  // Stats
  const totalResponses = filteredResponses.length;
  const sessionStats = useMemo(() => {
    const sessions = {};
    filteredResponses.forEach((r) => {
      const sid = r.survey_metadata?.session_id;
      if (!sid) return;
      if (!sessions[sid]) sessions[sid] = { count: 0, participant: r.participant_id };
      sessions[sid].count += 1;
    });
    return Object.entries(sessions);
  }, [filteredResponses]);
  const answeredQuestions = answerableQuestions.filter(
    (q) => (questionAnswers[q.name]?.length || 0) > 0,
  ).length;

  const dateRange = useMemo(() => {
    if (!filteredResponses.length) return null;
    const dates = filteredResponses
      .map(r => r.created_at || r.survey_metadata?.completion_time)
      .filter(Boolean)
      .map(d => new Date(d))
      .sort((a, b) => a - b);
    if (!dates.length) return null;
    const fmt = d => d.toLocaleDateString();
    return dates.length === 1
      ? fmt(dates[0])
      : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
  }, [filteredResponses]);

  // Build name → URL lookup from preloadedImages + media URLs stored in responses
  const imageNameToUrl = useMemo(() => {
    const map = new Map();
    const imgs = currentProject?.preloadedImages || [];
    for (const img of imgs) {
      if (img.name && img.url) map.set(img.name, img.url);
    }
    for (const [key, url] of buildResponseMediaUrlMap(filteredResponses)) {
      if (!map.has(key)) map.set(key, url);
    }
    return map;
  }, [currentProject?.preloadedImages, filteredResponses]);

  return (
    <ImageResolverContext.Provider value={imageNameToUrl}>
    <Box>
      <AdminPageHeader
        icon={<Assessment />}
        title={t.resultsTitle}
        description={(
          <>
            {t.resultsDescriptionPrefix}{' '}
            <strong>{currentProject?.name}</strong>.
          </>
        )}
        actions={(
          <>
          <Tooltip title={t.resultsRefresh}>
            <IconButton onClick={fetchResponses} disabled={loading} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<Download />}
            disabled={!filteredResponses.length}
            onClick={() => downloadResponsesWideCsv(filteredResponses, allQuestions, surveyConfig)}
            size="small"
          >
            {t.resultsExportCsv}
          </Button>
          <Button
            variant="contained"
            startIcon={<Download />}
            disabled={!filteredResponses.length || !surveyConfig}
            onClick={() => {
              const wideCsv = buildResponsesWideCsv(filteredResponses, allQuestions, surveyConfig);
              downloadResultsExportZip({
                project: currentProject,
                surveyConfig,
                questions: allQuestions,
                filteredResponses,
                dateFilteredResponses,
                excludeFlagged,
                wideCsv,
                filters: {
                  date_from: dateFrom || null,
                  date_to: dateTo || null,
                  session_id: sessionFilter || null,
                  include_practice: includePractice,
                  exclude_flagged: excludeFlagged,
                },
              });
            }}
            size="small"
          >
            {t.resultsExportAll}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Description />}
            disabled={!filteredResponses.length || !surveyConfig}
            onClick={() => {
              const { methodsText, bibtex } = generateMethodsText({
                project: currentProject,
                surveyConfig,
                responses: dateFilteredResponses,
                templateMeta: currentProject?.templateMeta || null,
                excludeFlagged,
              });
              downloadTextFile(methodsText, `methods_${currentProject?.id || 'survey'}.txt`);
              if (bibtex) {
                downloadTextFile(bibtex, `references_${currentProject?.id || 'survey'}.bib`);
              }
            }}
            size="small"
          >
            {t.resultsExportMethods}
          </Button>
          </>
        )}
      />

      {/* Data source badge */}
      {dataSource && (
        <Box sx={{ mb: 2 }}>
          <Chip
            icon={dataSource === 'supabase' ? <Cloud /> : <Storage />}
            label={dataSource === 'supabase' ? t.resultsConnectedSupabase : t.resultsLocalFiles}
            color={dataSource === 'supabase' ? 'success' : 'info'}
            variant="outlined"
            size="small"
          />
        </Box>
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField
          type="date"
          label="From"
          size="small"
          InputLabelProps={{ shrink: true }}
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <TextField
          type="date"
          label="To"
          size="small"
          InputLabelProps={{ shrink: true }}
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
        {sessionOptions.length > 0 && (
          <TextField
            select
            label="Session"
            size="small"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ native: true }}
            sx={{ minWidth: 180 }}
          >
            <option value="">All sessions</option>
            {sessionOptions.map((sid) => (
              <option key={sid} value={sid}>{sid.slice(-8)}</option>
            ))}
          </TextField>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={includePractice}
              onChange={(e) => handleIncludePracticeChange(e.target.checked)}
              disabled={savingPracticePref}
              size="small"
            />
          }
          label={
            practiceCount > 0
              ? `Include researcher practice (${practiceCount})`
              : 'Include researcher practice'
          }
        />
      </Box>

      {sessionStats.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Research sessions: {sessionStats.length} ({sessionStats.map(([sid, s]) => `${sid.slice(-6)}: ${s.count} rounds`).join(', ')})
        </Alert>
      )}

      {/* Data quality panel */}
      {!loading && dateFilteredResponses.length > 0 && surveyConfig && (
        <Accordion defaultExpanded={false} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: '100%', pr: 1 }}>
              <VerifiedUser color="primary" fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.resultsDataQuality}</Typography>
              <Chip label={tf(t.resultsClean, { n: qualitySummary.clean })} color="success" size="small" variant="outlined" />
              <Chip label={tf(t.resultsFlagged, { n: qualitySummary.flagged })} color="warning" size="small" variant="outlined" />
              <Chip label={tf(t.resultsInAnalysis, { n: filteredResponses.length })} size="small" variant="outlined" />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                onClick={() => {
                  const includedKeys = new Set(
                    (filteredResponses || []).map((r) => String(r.id ?? `${r.participant_id}|${r.created_at}|${r.survey_metadata?.session_id}`)),
                  );
                  downloadDataQualityCsv(dateFilteredResponses, surveyConfig, {
                    excludeFlagged,
                    includedKeys,
                  });
                }}
              >
                {t.resultsExportCsv}
              </Button>
              <Box flex={1} />
              <FormControlLabel
                control={
                  <Switch
                    checked={excludeFlagged}
                    onChange={(e) => handleExcludeFlaggedChange(e.target.checked)}
                    disabled={savingExcludePref}
                    size="small"
                  />
                }
                label={t.resultsExcludeFlagged}
              />
            </Box>
            {excludePrefError && (
              <Alert severity="warning" sx={{ mb: 1, py: 0 }}>{excludePrefError}</Alert>
            )}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Flags: {Object.entries(QUALITY_FLAG_LABELS).map(([k, v]) => `${k} (${v})`).join(' · ')}
            </Typography>
            {qualitySummary.flagged > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Participant</TableCell>
                      <TableCell>Flags</TableCell>
                      <TableCell>Duration (s)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dateFilteredResponses
                      .filter((r) => (qualitySummary.perResponse[r.id ?? r.participant_id] || []).length)
                      .slice(0, 20)
                      .map((r) => {
                        const key = r.id ?? r.participant_id;
                        const flags = qualitySummary.perResponse[key] || [];
                        return (
                          <TableRow key={key}>
                            <TableCell>{r.participant_id}</TableCell>
                            <TableCell>
                              {flags.map((f) => (
                                <Chip key={f} label={QUALITY_FLAG_LABELS[f] || f} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                              ))}
                            </TableCell>
                            <TableCell>{r.survey_metadata?.timing?.total_seconds ?? '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Overview cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <People sx={{ fontSize: 32, color: 'primary.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading ? '–' : totalResponses}
            </Typography>
            <Typography variant="body2" color="text.secondary">{t.resultsTotalResponses}</Typography>
            {dateRange && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {dateRange}
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Assessment sx={{ fontSize: 32, color: 'success.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading ? '–' : answerableQuestions.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">{t.resultsAnswerableQuestions}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {answeredQuestions} {t.resultsWithResponses}
              {displayOnlyQuestionCount > 0
                ? ` · ${displayOnlyQuestionCount} display/instruction excluded`
                : ''}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <QuestionAnswer sx={{ fontSize: 32, color: 'warning.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading || !totalResponses || !answerableQuestions.length
                ? '–'
                : `${pct(answeredQuestions, answerableQuestions.length)}%`}
            </Typography>
            <Typography variant="body2" color="text.secondary">{t.resultsQuestionCoverage}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t.resultsCoverageHelp}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Response records — view & delete */}
      {!loading && dateFilteredResponses.length > 0 && (
        <Accordion defaultExpanded={false} sx={{ mb: 3 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {t.resultsResponseRecords}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={tf(t.resultsSubmissions, { n: dateFilteredResponses.length })}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t.resultsRecordsHelp}
            </Typography>
            {deleteError && (
              <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setDeleteError(null)}>
                {deleteError}
              </Alert>
            )}
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Participant</TableCell>
                    <TableCell>Submitted</TableCell>
                    <TableCell>Completion code</TableCell>
                    <TableCell>Quality</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dateFilteredResponses.map((row) => {
                    const key = responseRecordKey(row);
                    const qKey = row.id ?? row.participant_id;
                    const flags = surveyConfig
                      ? (qualitySummary.perResponse[qKey] || [])
                      : [];
                    return (
                      <TableRow key={key} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {row.participant_id || '—'}
                          {row.survey_metadata?.practice_mode && (
                            <Chip
                              size="small"
                              label={row.survey_metadata?.practice_question
                                ? `practice: ${row.survey_metadata.practice_question}`
                                : 'practice'}
                              color="secondary"
                              variant="outlined"
                              sx={{ ml: 1, height: 20, fontSize: '0.65rem' }}
                            />
                          )}
                        </TableCell>
                        <TableCell>{formatResponseTime(row)}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {row.survey_metadata?.completion_code || '—'}
                        </TableCell>
                        <TableCell>
                          {flags.length === 0 ? (
                            <Chip label="clean" color="success" size="small" variant="outlined" />
                          ) : (
                            flags.map((f) => (
                              <Chip
                                key={f}
                                label={QUALITY_FLAG_LABELS[f] || f}
                                color="warning"
                                size="small"
                                sx={{ mr: 0.5, mb: 0.5 }}
                              />
                            ))
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Delete this response">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(row);
                              }}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 6 }}>
          <CircularProgress />
          {loadProgress && (
            <Typography variant="body2" color="text.secondary">
              Loading responses… {loadProgress.loaded.toLocaleString()} so far
              {loadProgress.page > 1 ? ` (page ${loadProgress.page})` : ''}
            </Typography>
          )}
        </Box>
      )}

      {/* No survey config */}
      {!loading && !surveyConfig && (
        <Alert severity="info">
          No survey configured. Please set up your survey in Step 2 – Survey Builder first.
        </Alert>
      )}

      {/* No responses yet */}
      {!loading && surveyConfig && totalResponses === 0 && !error && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t.resultsEmpty}
        </Alert>
      )}

      {/* Per-question analysis */}
      {!loading && surveyConfig && allQuestions.length > 0 && (
        <>
          <ImagePerceptionPanel
            currentProject={currentProject}
            responses={filteredResponses}
            questions={allQuestions}
          />

          {/* Search */}
          <TextField
            size="small"
            placeholder="Search questions..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            sx={{ mb: 2, width: 320 }}
          />

          {filteredQuestions.length === 0 && (
            <Typography variant="body2" color="text.secondary">No questions match your search.</Typography>
          )}

          {surveyConfig.pages?.map(page => {
            const pageQuestions = filteredQuestions.filter(q =>
              (page.elements || []).some(e => e.name === q.name)
            );
            if (!pageQuestions.length) return null;
            return (
              <Box key={page.name} sx={{ mb: 3 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1.5, fontWeight: 'bold', letterSpacing: 1 }}
                >
                  {page.title || page.name}
                </Typography>
                {pageQuestions.map((question) => (
                  <QuestionCard
                    key={question.name}
                    {...buildQuestionCardProps(question, filteredResponses, {
                      questionNumber: answerableNumberByName.get(question.name) ?? null,
                      surveyConfig,
                      exportResponses: filteredResponses,
                    })}
                  />
                ))}
              </Box>
            );
          })}
        </>
      )}

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>Delete response?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Permanently delete the submission from{' '}
            <strong>{deleteTarget?.participant_id || 'this participant'}</strong>
            {deleteTarget?.survey_metadata?.completion_code
              ? ` (code: ${deleteTarget.survey_metadata.completion_code})`
              : ''}
            ? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDeleteResponse} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </ImageResolverContext.Provider>
  );
}
