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
import { API_ROOT } from '../../lib/apiConfig';
import AnnotationAnalysis from './AnnotationAnalysis';
import { getPresetSkill } from '../../lib/presetSkills';
import { ImageResolverContext } from './imageResolverContext';
import { summarizeQuality, evaluateResponseQuality, QUALITY_FLAG_LABELS } from '../../lib/quality';
import { computeQuestionIrr } from '../../lib/reliability';
import { computeQuestionTrueSkill } from '../../lib/trueskill';
import { average, pct, descriptiveStats, wilsonCI } from '../../lib/stats';
import { computeBordaScores, kendallW, interpretKendallW } from '../../lib/rankingStats';
import { wordFrequency, textLengthStats } from '../../lib/textStats';
import { generateMethodsText, downloadTextFile } from '../../lib/methodsExport';
import {
  DensityHistogramChart,
  DescriptiveStatsLine,
  SemanticProfileChart,
  WordFrequencyChart,
} from './analysisCharts';
import { getPresetSkillAnalysis } from './skillAnalysis';
import { enrichSkillAnswers, buildResponseMediaUrlMap, stripSkillAnswerContext, formatSkillAnswerForDisplay, filterAnswersForSkill } from '../../lib/skillMediaUtils';
import { saveProjectFull } from '../../lib/projectManager';
import { deleteSurveyResponse, responseRecordKey } from '../../lib/surveyResponses';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RATING_COLORS = ['#f44336', '#ff9800', '#ffc107', '#8bc34a', '#4caf50'];
const BAR_COLORS = [
  '#1976d2', '#2196f3', '#0288d1', '#0097a7', '#00838f',
  '#388e3c', '#689f38', '#f57c00', '#e64a19', '#7b1fa2'
];

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

// Collect answers for a question from all responses.
// Handles two formats:
//   New: responses[name] = { type, answer, shown_images }
//   Old: responses[name] = <raw_answer>, displayed_images[name] = [...]
function collectAnswers(questionName, responses) {
  const result = [];
  for (const row of responses) {
    const qData = row.responses?.[questionName];
    if (qData === undefined || qData === null) continue;

    let ans, shown;

    if (qData !== null && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
      // New enriched format: { type, answer, shown_images }
      ans = qData.answer;
      shown = qData.shown_images?.length
        ? qData.shown_images
        : (row.displayed_images?.[questionName] || []);
    } else {
      // Old raw format: the value IS the answer
      ans = qData;
      shown = row.displayed_images?.[questionName] || [];
    }

    if (ans === null || ans === undefined || ans === '') continue;
    result.push({ answer: ans, shown_images: shown });
  }
  return result;
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

function TrueSkillMuChart({ rankings, getImageUrl }) {
  if (!rankings?.length) return null;
  const items = [...rankings].sort((a, b) => (b.muStd5 ?? 0) - (a.muStd5 ?? 0));
  const scores = items.map((r) => r.muStd5 ?? 0);
  return (
    <DensityHistogramChart
      scores={scores}
      domainMin={0}
      domainMax={5}
      title="Standardized μ distribution (0–5)"
      caption="Blue bars: histogram of standardized μ (density = count / n / bin width). Orange curve: fitted normal PDF."
      xLabel="Standardized μ (0–5)"
      bottomMarkers={items.map((item) => ({
        key: item.imageKey,
        value: item.muStd5 ?? 0,
        imageUrl: getImageUrl?.(item.imageKey),
        label: item.imageKey.length > 10 ? `${item.imageKey.slice(0, 9)}…` : item.imageKey,
        subLabel: (item.muStd5 ?? 0).toFixed(2),
      }))}
    />
  );
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

function TrueSkillTable({ rankings, onExport }) {
  const resolvedUrl = useContext(ImageResolverContext);
  if (!rankings?.length) return null;

  const resolveImg = (key) => {
    if (key?.startsWith('http')) return key;
    return resolvedUrl?.get(key) || null;
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>TrueSkill image rankings</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Each selection counts as a win over every non-selected image shown in that trial (supports multi-select).
        </Typography>
        {onExport && (
          <Button size="small" variant="outlined" startIcon={<Download />} onClick={onExport}>
            Export scores CSV
          </Button>
        )}
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Image</TableCell>
              <TableCell align="right">μ</TableCell>
              <TableCell align="right">Std. μ (0–5)</TableCell>
              <TableCell align="right">σ</TableCell>
              <TableCell align="right">Conservative (μ−3σ)</TableCell>
              <TableCell align="right">Games</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rankings.map((row) => (
              <TableRow key={row.imageKey}>
                <TableCell>{row.rank}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {resolveImg(row.imageKey) && (
                      <Box
                        component="img"
                        src={resolveImg(row.imageKey)}
                        alt={row.imageKey}
                        sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5 }}
                      />
                    )}
                    <Typography variant="caption">{row.imageKey}</Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">{row.mu.toFixed(2)}</TableCell>
                <TableCell align="right">{(row.muStd5 ?? 0).toFixed(2)}</TableCell>
                <TableCell align="right">{row.sigma.toFixed(2)}</TableCell>
                <TableCell align="right">{row.conservative.toFixed(2)}</TableCell>
                <TableCell align="right">{row.games}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function exportTrueSkillCsv(questionName, rankings) {
  const headers = ['rank', 'image', 'mu', 'mu_std5', 'sigma', 'conservative', 'wins', 'losses', 'games'];
  const rows = rankings.map((r) => [
    r.rank, r.imageKey, r.mu.toFixed(4), (r.muStd5 ?? 0).toFixed(4), r.sigma.toFixed(4),
    r.conservative.toFixed(4), r.wins, r.losses, r.games,
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadTextFile(csv, `${questionName}_trueskill_${new Date().toISOString().slice(0, 10)}.csv`);
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

function ImagePickerDistribution({ answers, choices, question, allResponses }) {
  const resolvedUrl = useContext(ImageResolverContext);

  const choiceMap = {};
  if (choices) {
    for (const c of choices) {
      const val = typeof c === 'object' ? String(c.value ?? '') : String(c);
      const imgLink = typeof c === 'object' ? (c.imageLink || c.value || '') : c;
      choiceMap[val] = { imageUrl: imgLink };
    }
  }

  const getImageUrl = (value) => {
    if (choiceMap[value]?.imageUrl) return choiceMap[value].imageUrl;
    if (value && (value.startsWith('http') || value.startsWith('/'))) return value;
    if (resolvedUrl?.has(value)) return resolvedUrl.get(value);
    return null;
  };

  const trueskillResult = useMemo(() => {
    if (!allResponses?.length || !question?.name) return { matches: [], rankings: [] };
    return computeQuestionTrueSkill(allResponses, question.name);
  }, [allResponses, question?.name]);

  const { matches, rankings } = trueskillResult;

  return (
    <Box>
      {matches.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Not enough pairwise comparisons for TrueSkill (need participants to select among shown images).
        </Alert>
      ) : (
        <>
          <TrueSkillMuChart rankings={rankings} getImageUrl={getImageUrl} />
          <TrueSkillTable
            rankings={rankings}
            onExport={() => exportTrueSkillCsv(question.name, rankings)}
          />
        </>
      )}
    </Box>
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

  const allNumeric = colKeys.every((c) => !Number.isNaN(Number(c)));
  const rowMeans = allNumeric ? rowKeys.map((row) => {
    const counts = rowData[row] || {};
    let sum = 0; let n = 0;
    for (const [col, count] of Object.entries(counts)) {
      sum += Number(col) * count;
      n += count;
    }
    return { row, mean: n > 0 ? sum / n : null, n };
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
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Question Row</TableCell>
              {colKeys.map(col => (
                <TableCell key={col} align="center" sx={{ fontWeight: 'bold' }}>{col}</TableCell>
              ))}
              <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 120 }}>Distribution</TableCell>
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
                    <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', bgcolor: 'grey.100' }}>
                      {colKeys.map((col, idx) => {
                        const count = rowData[row]?.[col] || 0;
                        const w = total > 0 ? (count / total) * 100 : 0;
                        return w > 0 ? (
                          <Box key={col} sx={{ width: `${w}%`, bgcolor: BAR_COLORS[idx % BAR_COLORS.length] }} />
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

function ImageQuestionAnalysis({ answers, type, question }) {
  const resolvedUrl = useContext(ImageResolverContext);
  const getImageUrl = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'))) return value;
    const key = imageKeyFromShown(value);
    return resolvedUrl?.get(key) || resolvedUrl?.get(value) || null;
  };

  // ── image_ranking ─────────────────────────────────────────────────────────
  if (type === 'image_ranking' || type === 'imageranking' || type === 'mediaranking') {
    const imageRankPositions = {};
    const rankingLists = [];
    for (const { answer } of answers) {
      const ranked = Array.isArray(answer) ? answer : [];
      if (ranked.length) rankingLists.push(ranked);
      ranked.forEach((url, rankIdx) => {
        if (!imageRankPositions[url]) imageRankPositions[url] = [];
        imageRankPositions[url].push(rankIdx + 1);
      });
    }

    const items = Object.keys(imageRankPositions);
    const nItems = items.length;
    const w = kendallW(rankingLists, items);
    const maxRank = Math.max(nItems, 1);

    const rankedItems = Object.entries(imageRankPositions)
      .map(([url, ranks]) => {
        const avg = average(ranks);
        return {
          key: url,
          url,
          value: maxRank > 0 ? (maxRank - (avg ?? maxRank) + 1) / maxRank : 0,
          label: `avg rank ${avg?.toFixed(2) ?? '–'} · n=${ranks.length}`,
        };
      })
      .sort((a, b) => b.value - a.value);

    return (
      <Box>
        {w != null && (
          <Alert severity={w >= 0.5 ? 'success' : 'info'} sx={{ mb: 2 }}>
            Kendall&apos;s W = {w.toFixed(3)} — {interpretKendallW(w)}
          </Alert>
        )}
        <CompactImageRanking
          title="Image ranking (rank 1 = most preferred)"
          items={rankedItems}
          getImageUrl={getImageUrl}
          maxValue={1}
          formatLabel={(v, label) => label}
        />
        {rankedItems.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
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

    return (
      <Box>
        <CompactImageRanking
          title="Average rating by image"
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

    return (
      <Box>
        <CompactImageRanking
          title="Yes rate by image"
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

  // ── image_matrix ──────────────────────────────────────────────────────────
  if (type === 'image_matrix' || type === 'imagematrix') {
    const perImage = {};
    for (const { answer, shown_images } of answers) {
      if (typeof answer !== 'object' || !answer || !shown_images?.length) continue;
      const img = shown_images[0];
      const key = imageKeyFromShown(img) || img;
      if (!perImage[key]) perImage[key] = { url: img, rows: {} };
      for (const [row, val] of Object.entries(answer)) {
        if (!perImage[key].rows[row]) perImage[key].rows[row] = {};
        const colKey = String(val);
        perImage[key].rows[row][colKey] = (perImage[key].rows[row][colKey] || 0) + 1;
      }
    }

    const rowDefs = question.rows || [];
    const colDefs = question.columns || [];
    const rowKeys = rowDefs.length
      ? rowDefs.map((r) => (typeof r === 'object' ? r.value : r))
      : [...new Set(Object.values(perImage).flatMap((d) => Object.keys(d.rows)))];
    const colKeys = colDefs.length
      ? colDefs.map((c) => (typeof c === 'object' ? c.value : c))
      : [...new Set(Object.values(perImage).flatMap((d) => Object.values(d.rows).flatMap((r) => Object.keys(r))))];

    if (!rowKeys.length || !Object.keys(perImage).length) {
      return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
    }

    const lastCol = colKeys[colKeys.length - 1];

    return (
      <Box>
        {rowKeys.map((row) => {
          const rowDef = rowDefs.find((r) => (typeof r === 'object' ? r.value : r) === row);
          const rowLabel = rowDef ? (typeof rowDef === 'object' ? (rowDef.text || rowDef.value) : rowDef) : row;

          const imageStats = Object.entries(perImage).map(([key, data]) => {
            const cols = data.rows[row] || {};
            const total = Object.values(cols).reduce((s, v) => s + v, 0);
            return { key, url: data.url, cols, total };
          }).filter((s) => s.total > 0);

          const sorted = [...imageStats].sort((a, b) => compareByColumnProportions(a, b, colKeys));
          const rankedItems = sorted.map(({ key, url, cols, total }) => {
            const colParts = colKeys.map((c) => {
              const colDef = colDefs.find((col) => (typeof col === 'object' ? col.value : col) === c);
              const colLabel = colDef ? (typeof colDef === 'object' ? (colDef.text || colDef.value) : colDef) : c;
              return `${colLabel}: ${pct(cols[c] || 0, total)}%`;
            });
            return {
              key,
              url,
              value: total > 0 ? (cols[lastCol] || 0) / total : 0,
              label: colParts.join(' · '),
            };
          });

          return (
            <CompactImageRanking
              key={row}
              title={rowLabel}
              items={rankedItems}
              getImageUrl={getImageUrl}
              maxValue={1}
              formatLabel={(_, label) => label}
            />
          );
        })}
      </Box>
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
// Without a schema we auto-infer one from the answer shape, so results are
// never shown as raw JSON dumps.

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function SkillFieldSummary({ field, answers }) {
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

  let body = null;

  if (field.type === 'number') {
    const nums = values.map(Number).filter((n) => !isNaN(n));
    const avg = average(nums);
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
    const lengths = values.map((v) => (Array.isArray(v) ? v.length : 0));
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
    // value = [{ id, left, right, label?, value }] — average each dimension
    const dims = {}; // id → { left, right, label, values: [] }
    for (const v of values) {
      if (!Array.isArray(v)) continue;
      for (const d of v) {
        if (!d || d.value === undefined) continue;
        const id = d.id || d.label || `${d.left}/${d.right}`;
        if (!dims[id]) dims[id] = { left: d.left, right: d.right, label: d.label, values: [] };
        const n = Number(d.value);
        if (!isNaN(n)) dims[id].values.push(n);
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
      if (Array.isArray(v)) return { key: k, label: k, type: 'count' };
      if (typeof v === 'string') return { key: k, label: k, type: 'choice' };
      return null;
    })
    .filter(Boolean);
}

function SkillRawResponses({ answers, maxVisible = 10 }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? answers : answers.slice(0, maxVisible);

  if (!answers.length) {
    return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Answer fields only — shown media is listed separately per response.
      </Typography>
      {visible.map((entry, idx) => {
        const shown = entry.shown_images?.length ? entry.shown_images : [];
        return (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Response {idx + 1}
            </Typography>
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
            {shown.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Shown media: {shown.map((u) => shortName(u)).join(' · ')}
              </Typography>
            )}
          </Paper>
        );
      })}
      {answers.length > maxVisible && (
        <Button size="small" onClick={() => setShowAll((v) => !v)} sx={{ mt: 0.5 }}>
          {showAll ? 'Show less' : `Show all ${answers.length} responses`}
        </Button>
      )}
    </Box>
  );
}

function SkillQuestionAnalysis({ question, answers, allResponses }) {
  const [showRaw, setShowRaw] = useState(false);

  const enrichedAnswers = useMemo(
    () => filterAnswersForSkill(enrichSkillAnswers(answers), question.skillId),
    [answers, question.skillId],
  );
  const droppedCount = answers.length - enrichedAnswers.length;
  const objAnswers = enrichedAnswers.filter((a) => a.answer && typeof a.answer === 'object');
  const PresetAnalysis = getPresetSkillAnalysis(question.skillId);

  if (PresetAnalysis) {
    if (!objAnswers.length) {
      return <Typography variant="body2" color="text.secondary">No responses yet.</Typography>;
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
        <Button size="small" onClick={() => setShowRaw((s) => !s)} sx={{ mt: 1 }}>
          {showRaw ? 'Hide raw responses' : 'View raw responses'}
        </Button>
        {showRaw && <SkillRawResponses answers={enrichedAnswers} maxVisible={10} />}
      </Box>
    );
  }

  let schema = question.skillResultSchema;
  if (!schema?.length && question.skillId?.startsWith('preset_')) {
    schema = getPresetSkill(question.skillId.replace(/^preset_/, ''))?.resultSchema;
  }
  if (!schema?.length && objAnswers.length) {
    schema = inferSkillResultSchema(objAnswers[0].answer);
  }

  if (!schema?.length || !objAnswers.length) {
    return (
      <SkillRawResponses answers={enrichedAnswers} maxVisible={10} />
    );
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
      {schema.map((field) => (
        <SkillFieldSummary key={field.key} field={field} answers={objAnswers} />
      ))}
      <Button size="small" onClick={() => setShowRaw((s) => !s)}>
        {showRaw ? 'Hide raw responses' : 'View raw responses'}
      </Button>
      {showRaw && <SkillRawResponses answers={enrichedAnswers} maxVisible={10} />}
    </Box>
  );
}

// ─── Text ranking analysis ────────────────────────────────────────────────────
// answer = [choiceValue_rank1, choiceValue_rank2, ...]
function exportRankingCsv(questionName, sorted, kendallWVal, items) {
  const headers = ['rank', 'item', 'avg_rank', 'borda_score', 'n'];
  const rows = sorted.map(({ val, avg, borda, n }, idx) => [
    idx + 1,
    val,
    avg != null ? avg.toFixed(4) : '',
    borda != null ? borda.toFixed(4) : '',
    n,
  ]);
  const meta = [`kendall_w,${kendallWVal != null ? kendallWVal.toFixed(4) : ''}`, ''];
  const csv = [...meta, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadTextFile(csv, `${questionName}_ranking_${new Date().toISOString().slice(0, 10)}.csv`);
}

function RankingDistribution({ answers, choices, questionName }) {
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
          Average rank (1 = top) · Borda score · SD
        </Typography>
        {questionName && sorted.length > 0 && (
          <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => exportRankingCsv(questionName, sorted, w, items)}>
            Export ranking CSV
          </Button>
        )}
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

/** Per-dimension compact image ranking (imageslidergroup). */
function ImageSliderGroupAnalysis({ question, answers }) {
  const getImageUrl = useImageUrlResolver();
  const dims = question.dimensions || [];
  const scaleMin = question.scaleMin ?? 1;
  const scaleMax = question.scaleMax ?? 7;

  if (!dims.length) {
    return <Typography variant="body2" color="text.secondary">No dimensions configured.</Typography>;
  }

  return (
    <Box>
      {dims.map((d) => {
        const perImage = {};
        for (const { answer, shown_images } of answers) {
          if (!shown_images?.length || typeof answer !== 'object') continue;
          const val = Number(answer[d.id]);
          if (Number.isNaN(val)) continue;
          for (const img of shown_images) {
            const key = imageKeyFromShown(img) || img;
            if (!perImage[key]) perImage[key] = { url: img, vals: [] };
            perImage[key].vals.push(val);
          }
        }

        const dimTitle = d.label || `${d.left} ↔ ${d.right}`;
        const rankedItems = Object.entries(perImage)
          .map(([key, { url, vals }]) => {
            const avg = average(vals);
            return {
              key,
              url,
              value: avg ?? scaleMin,
              label: `${avg?.toFixed(2) ?? '–'} / ${scaleMax} · n=${vals.length}`,
            };
          })
          .sort((a, b) => b.value - a.value);

        return (
          <CompactImageRanking
            key={d.id}
            title={dimTitle}
            items={rankedItems}
            getImageUrl={getImageUrl}
            maxValue={scaleMax}
            formatLabel={(_, label) => label}
          />
        );
      })}
    </Box>
  );
}

/** Per-choice compact image ranking (imagepointallocation). */
function ImagePointAllocationAnalysis({ question, answers }) {
  const getImageUrl = useImageUrlResolver();
  const choices = (question.choices || []).map((c) => (typeof c === 'object' ? c : { value: c, text: c }));
  const budget = question.budget || 100;

  let compliant = 0;
  answers.forEach(({ answer }) => {
    if (!answer || typeof answer !== 'object') return;
    const sum = Object.values(answer).reduce((s, v) => s + (Number(v) || 0), 0);
    if (Math.abs(sum - budget) < 0.01) compliant += 1;
  });

  if (!choices.length) {
    return <Typography variant="body2" color="text.secondary">No allocation choices configured.</Typography>;
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Budget compliance: {compliant}/{answers.length} ({pct(compliant, answers.length)}%)
      </Typography>
      {choices.map((c) => {
        const perImage = {};
        for (const { answer, shown_images } of answers) {
          if (!shown_images?.length || typeof answer !== 'object') continue;
          const pts = Number(answer[c.value]);
          if (Number.isNaN(pts)) continue;
          for (const img of shown_images) {
            const key = imageKeyFromShown(img) || img;
            if (!perImage[key]) perImage[key] = { url: img, vals: [] };
            perImage[key].vals.push(pts);
          }
        }

        const rankedItems = Object.entries(perImage)
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

        return (
          <CompactImageRanking
            key={c.value}
            title={c.text || c.value}
            items={rankedItems}
            getImageUrl={getImageUrl}
            maxValue={budget}
            formatLabel={(_, label) => label}
          />
        );
      })}
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

function QuestionCard({ question, answers, totalResponses, questionNumber, allResponses }) {
  const [expanded, setExpanded] = useState(false);
  const type = question.type || 'text';
  const responseCount = answers.length;

  const renderAnalysis = () => {
    switch (type) {
      case 'rating':
        return (
          <>
            <IrrSummary responses={allResponses} question={question} />
            <RatingDistribution
              answers={answers}
              rateMin={question.rateMin ?? 1}
              rateMax={question.rateMax ?? 5}
            />
          </>
        );

      case 'radiogroup':
      case 'dropdown':
        return <ChoiceDistribution answers={answers} choices={question.choices} />;

      case 'checkbox':
        return <ChoiceDistribution answers={answers} choices={question.choices} isCheckbox />;

      case 'boolean':
        return <BooleanDistribution answers={answers} />;

      case 'text':
      case 'comment':
        return <TextAnswers answers={answers} />;

      case 'matrix':
        return (
          <MatrixDistribution
            answers={answers}
            rows={question.rows}
            columns={question.columns}
          />
        );

      case 'ranking':
        return <RankingDistribution answers={answers} choices={question.choices} questionName={question.name} />;

      case 'expression':
      case 'image':
      case 'html':
        return (
          <Typography variant="body2" color="text.secondary">
            Display-only question — no participant answers are collected.
            {type === 'image' ? ' The shown image is exported in the __shown_images CSV column.' : ''}
          </Typography>
        );

      case 'imagepicker':
        return (
          <>
            <IrrSummary responses={allResponses} question={question} />
            <ImagePickerDistribution
              answers={answers}
              choices={question.choices}
              question={question}
              allResponses={allResponses}
            />
          </>
        );

      case 'image_rating':
      case 'imagerating':
      case 'image_ranking':
      case 'imageranking':
      case 'mediaranking':
      case 'image_boolean':
      case 'imageboolean':
      case 'image_matrix':
      case 'imagematrix':
      case 'mediarating':
      case 'mediaboolean':
        return (
          <>
            {['imagerating', 'image_rating', 'mediarating'].includes(type) && (
              <IrrSummary responses={allResponses} question={question} />
            )}
            <ImageQuestionAnalysis answers={answers} type={type} question={question} />
          </>
        );

      case 'mediadisplay':
        return (
          <Typography variant="body2" color="text.secondary">
            Display-only question — no participant answers are collected.
            The shown media files are exported in the __shown_images / __shown_media_group /
            __shown_media_categories CSV columns.
          </Typography>
        );

      case 'slidergroup':
        return (
          <>
            <IrrSummary responses={allResponses} question={question} />
            <SliderGroupAnalysis question={question} answers={answers} />
          </>
        );

      case 'imageslidergroup':
        return (
          <>
            <IrrSummary responses={allResponses} question={question} />
            <ImageSliderGroupAnalysis question={question} answers={answers} />
          </>
        );

      case 'pointallocation':
        return <PointAllocationAnalysis question={question} answers={answers} />;

      case 'imagepointallocation':
        return <ImagePointAllocationAnalysis question={question} answers={answers} />;

      case 'imageannotation':
        return <AnnotationAnalysis answers={answers} questionName={question.name} responses={question._allResponses} />;

      case 'skillquestion':
        return <SkillQuestionAnalysis question={question} answers={answers} allResponses={allResponses} />;

      default:
        return (
          <Typography variant="body2" color="text.secondary">
            Unrecognized or unsupported question type &quot;{type}&quot; — no dedicated analysis view.
            Check CSV export for raw answer data.
          </Typography>
        );
    }
  };

  const responseRate = pct(responseCount, totalResponses);
  const displayOnly = isDisplayOnlyQuestion(question);

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
            {displayOnly ? (
              <Typography variant="caption" color="text.secondary">
                Display / instruction
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {responseCount} / {totalResponses} responses ({responseRate}%)
              </Typography>
            )}
          </Box>
        </Box>

        <IconButton size="small">
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Divider />
        <CardContent>
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

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV(responses, allQuestions, surveyConfig) {
  if (!responses.length) return;

  const questionNames = allQuestions.map(q => q.name);

  // For each image question, add a companion "shown_images" column.
  // NOTE: SurveyJS's built-in display-only "image" question has no answer
  // value in survey.data, but its randomly-selected image is still tracked
  // in row.displayed_images (saved to Supabase). Including 'image' here
  // ensures the CSV exposes that filename via the __shown_images column.
  const imageTypes = new Set([
    'imagerating', 'image_rating',
    'imageranking', 'image_ranking',
    'imageboolean', 'image_boolean',
    'imagematrix', 'image_matrix',
    'imagepicker',
    'image',
    'mediadisplay', 'mediarating', 'mediaboolean',
    'imageannotation',
    'skillquestion',
    'imageslidergroup',
    'imagepointallocation',
  ]);
  const isImageQuestion = q => imageTypes.has(q.type);

  // Per-dimension / per-choice / per-schema-key sub-columns for structured answer types
  const subKeysFor = (q) => {
    if (q.type === 'slidergroup' || q.type === 'imageslidergroup') {
      return (q.dimensions || []).map((d) => d.id).filter(Boolean);
    }
    if (q.type === 'pointallocation' || q.type === 'imagepointallocation') {
      return (q.choices || []).map((c) => (typeof c === 'object' ? c.value : c)).filter(Boolean);
    }
    if (q.type === 'skillquestion') {
      let schema = q.skillResultSchema;
      if (!schema?.length && q.skillId?.startsWith('preset_')) {
        schema = getPresetSkill(q.skillId.replace(/^preset_/, ''))?.resultSchema;
      }
      return (schema || []).map((f) => f.key).filter(Boolean);
    }
    return null;
  };

  // Build header columns: answer column + shown_images column (for image questions)
  const headerCols = [];
  for (const q of allQuestions) {
    headerCols.push(q.name);
    const subKeys = subKeysFor(q);
    if (subKeys) {
      subKeys.forEach((k) => headerCols.push(`${q.name}__${String(k).replace(/\./g, '_')}`));
    }
    if (isImageQuestion(q)) {
      headerCols.push(`${q.name}__shown_images`);
      headerCols.push(`${q.name}__shown_media_group`);
      headerCols.push(`${q.name}__shown_media_categories`);
    }
  }

  const headers = ['participant_id', 'created_at', 'completion_code', 'session_id', 'attempt_index', 'quality_flags', ...headerCols];

  const rows = responses.map(row => {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    const cols = [
      row.participant_id || '',
      row.created_at || row.survey_metadata?.completion_time || '',
      row.survey_metadata?.completion_code || '',
      row.survey_metadata?.session_id || '',
      row.survey_metadata?.attempt_index ?? '',
      flags.join('|'),
    ];
    for (const q of allQuestions) {
      const qName = q.name;
      const qData = row.responses?.[qName];

      // Answer value
      let ans, shownImgs;
      if (qData !== null && qData !== undefined && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
        ans = qData.answer;
        shownImgs = qData.shown_images?.length ? qData.shown_images : (row.displayed_images?.[qName] || []);
      } else {
        ans = qData ?? '';
        shownImgs = row.displayed_images?.[qName] || [];
      }

      // For image questions, convert URL answers to filenames
      let ansForCsv = ans;
      if (q.type === 'skillquestion' && ans && typeof ans === 'object' && !Array.isArray(ans)) {
        ansForCsv = stripSkillAnswerContext(ans);
      }
      if (isImageQuestion(q)) {
        const urlToName = v => (v && typeof v === 'string') ? v.split('?')[0].split('/').pop() : v;
        if (Array.isArray(ans)) ansForCsv = ans.map(urlToName);
        else if (typeof ans === 'string') ansForCsv = urlToName(ans);
      }
      cols.push(typeof ansForCsv === 'object' ? JSON.stringify(ansForCsv) : String(ansForCsv ?? ''));

      // Per-dimension / per-choice / per-schema-key sub-columns
      const subKeys = subKeysFor(q);
      if (subKeys) {
        const rawObj = (ans && typeof ans === 'object' && !Array.isArray(ans)) ? ans : {};
        const obj = q.type === 'skillquestion' ? stripSkillAnswerContext(rawObj) : rawObj;
        subKeys.forEach((k) => {
          const v = getPath(obj, k);
          cols.push(v === undefined || v === null
            ? ''
            : (typeof v === 'object' ? JSON.stringify(v) : v));
        });
      }

      // Shown images column (only for image questions) — use filenames, not full URLs
      if (isImageQuestion(q)) {
        const imgNames = Array.isArray(shownImgs)
          ? shownImgs.map(v => v ? v.split('?')[0].split('/').pop() : v)
          : [shownImgs ?? ''];
        cols.push(imgNames.join('|'));
        const mediaGroup = (typeof qData === 'object' && qData && 'shown_media_group' in qData)
          ? (qData.shown_media_group || '')
          : (row.displayed_media_groups?.[qName] || '');
        cols.push(mediaGroup || '');
        const mediaCategories = (typeof qData === 'object' && qData && qData.shown_media_categories)
          ? (Array.isArray(qData.shown_media_categories) ? qData.shown_media_categories.join('|') : qData.shown_media_categories)
          : (Array.isArray(row.displayed_media_categories?.[qName])
            ? row.displayed_media_categories[qName].join('|')
            : (row.displayed_media_categories?.[qName] || ''));
        cols.push(mediaCategories || '');
      }
    }
    return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `survey_responses_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

function readExcludeFlaggedFromConfig(surveyConfig) {
  return typeof surveyConfig?.excludeFlaggedFromAnalysis === 'boolean'
    ? surveyConfig.excludeFlaggedFromAnalysis
    : true;
}

export default function ResultsAnalysis({ currentProject, surveyConfig, onSurveyConfigChange }) {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [excludeFlagged, setExcludeFlagged] = useState(() => readExcludeFlaggedFromConfig(surveyConfig));
  const [savingExcludePref, setSavingExcludePref] = useState(false);
  const [excludePrefError, setExcludePrefError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    setExcludeFlagged(readExcludeFlaggedFromConfig(surveyConfig));
  }, [currentProject?.id, surveyConfig?.excludeFlaggedFromAnalysis]);

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

  const fetchResponses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (platformSupabase && currentProject?.id) {
        // Platform mode: query responses for this specific project
        const { data, error: sbError } = await platformSupabase
          .from('survey_responses')
          .select('*')
          .eq('project_id', currentProject.id)
          .order('created_at', { ascending: false });
        if (sbError) throw sbError;
        setResponses(data || []);
        setDataSource('supabase');
      } else {
        // Self-hosted fallback: local file server
        const resp = await fetch(`${API_ROOT}/responses`);
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
      return true;
    });
  }, [responses, currentProject?.id, dateFrom, dateTo, sessionFilter]);

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

  // Pre-collect answers per question
  const questionAnswers = useMemo(() => {
    const map = {};
    for (const q of allQuestions) {
      map[q.name] = collectAnswers(q.name, filteredResponses);
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
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          mb: 3,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
            📊 Results Analysis
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Analyze survey responses per question for project:{' '}
            <strong>{currentProject?.name}</strong>.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <Tooltip title="Refresh responses">
            <IconButton onClick={fetchResponses} disabled={loading} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<Download />}
            disabled={!filteredResponses.length}
            onClick={() => exportToCSV(filteredResponses, allQuestions, surveyConfig)}
            size="small"
          >
            Export CSV
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
            Export Methods
          </Button>
        </Box>
      </Box>

      {/* Data source badge */}
      {dataSource && (
        <Box sx={{ mb: 2 }}>
          <Chip
            icon={dataSource === 'supabase' ? <Cloud /> : <Storage />}
            label={dataSource === 'supabase' ? 'Connected to Supabase' : 'Reading local response files'}
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
            SelectProps={{ native: true }}
            sx={{ minWidth: 180 }}
          >
            <option value="">All sessions</option>
            {sessionOptions.map((sid) => (
              <option key={sid} value={sid}>{sid.slice(-8)}</option>
            ))}
          </TextField>
        )}
      </Box>

      {sessionStats.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Research sessions: {sessionStats.length} ({sessionStats.map(([sid, s]) => `${sid.slice(-6)}: ${s.count} rounds`).join(', ')})
        </Alert>
      )}

      {/* Data quality panel */}
      {!loading && dateFilteredResponses.length > 0 && surveyConfig && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <VerifiedUser color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Data Quality</Typography>
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
              label="Exclude flagged responses from analysis"
            />
          </Box>
          {excludePrefError && (
            <Alert severity="warning" sx={{ mb: 1, py: 0 }}>{excludePrefError}</Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <Chip label={`${qualitySummary.clean} clean`} color="success" size="small" variant="outlined" />
            <Chip label={`${qualitySummary.flagged} flagged`} color="warning" size="small" variant="outlined" />
            <Chip label={`${filteredResponses.length} in analysis`} size="small" variant="outlined" />
          </Box>
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
        </Paper>
      )}

      {/* Overview cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <People sx={{ fontSize: 32, color: 'primary.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading ? '–' : totalResponses}
            </Typography>
            <Typography variant="body2" color="text.secondary">Total Responses</Typography>
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
            <Typography variant="body2" color="text.secondary">Answerable Questions</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {answeredQuestions} with responses
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
            <Typography variant="body2" color="text.secondary">Question Coverage</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              answerable questions with ≥1 response
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Response records — view & delete */}
      {!loading && dateFilteredResponses.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Response records
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Remove individual submissions from this project. Deletion is permanent.
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
        </Paper>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
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
          No responses collected yet. Share your survey link and come back here to view results.
        </Alert>
      )}

      {/* Per-question analysis */}
      {!loading && surveyConfig && allQuestions.length > 0 && (
        <>
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
                    question={{ ...question, _allResponses: filteredResponses }}
                    answers={questionAnswers[question.name] || []}
                    totalResponses={totalResponses}
                    questionNumber={answerableNumberByName.get(question.name) ?? null}
                    allResponses={filteredResponses}
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
