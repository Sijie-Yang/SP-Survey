import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Download, Leaderboard } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { listSiliconResponses, listSiliconRuns } from '../../lib/agentApi';
import { agreementExportFiles, siliconAgreement, siliconGroups } from '../../lib/siliconAgreement';
import { downloadZip } from '../../lib/zipDownload';
import { downloadTextFile } from '../../lib/methodsExport';
import {
  SUBMISSIONS_NEW_FILE_URL, buildSubmission, predictionsFromRows, submissionFileName, tasksFromProjectMetadata,
} from '../../lib/benchHumanTrack';
import { ImageResolverContext } from './imageResolverContext';

const fmt = (v, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits));

function headline(row, L) {
  switch (row.comparison) {
    case 'item_scores':
      return { label: L('Kendall τ of the TrueSkill ranking', 'TrueSkill 排名的 Kendall τ'), value: fmt(row.value) };
    case 'item_means':
      return { label: L('Spearman ρ of per-image means', '逐图均值的 Spearman ρ'), value: fmt(row.value) };
    case 'answer_distribution': {
      const parts = [];
      if (row.mean_diff != null) parts.push(`${L('mean diff', '均值差')} ${fmt(row.mean_diff)}`);
      parts.push(`JS ${fmt(row.value)}`);
      let label = L('Answer distribution, JS divergence (0 = same)', '答案分布的 JS 散度（0 = 一致）');
      if (row.mean_diff != null) label = L('Mean difference (silicon − human) and JS divergence', '均值差（硅样本 − 真人）和 JS 散度');
      if (row.top_choice_match != null) {
        parts.push(row.n_units === 1
          ? (row.top_choice_match === 1 ? L('same top answer', '最多选项相同') : L('different top answer', '最多选项不同'))
          : `${L('same top answer', '最多选项相同')} ${Math.round(row.top_choice_match * 100)}%`);
      }
      return { label, value: parts.join(' · ') };
    }
    case 'overall_mean':
      return { label: L('Mean difference (silicon − human)', '均值差（硅样本 − 真人）'), value: fmt(row.value) };
    default:
      return { label: row.metric, value: fmt(row.value) };
  }
}

/** "human ≈ 1.20 + 0.85 × silicon · R² 0.71 · LOO error ±0.42" */
function calibrationLine(cal, L) {
  if (!cal) return '';
  const sign = cal.slope < 0 ? '−' : '+';
  const parts = [`${L('human', '真人')} ≈ ${fmt(cal.intercept)} ${sign} ${fmt(Math.abs(cal.slope))} × ${L('silicon', '硅')}`];
  if (cal.r2 != null) parts.push(`R² ${fmt(cal.r2)}`);
  if (cal.loo_rmse != null) parts.push(`${L('LOO error', '留一误差')} ±${fmt(cal.loo_rmse)}`);
  return parts.join(' · ');
}

const COLLAPSED_ROWS = 8;

function Thumb({ src, label }) {
  const [failed, setFailed] = useState(false);
  const box = { width: 96, height: 64, borderRadius: 1, bgcolor: 'action.hover', display: 'block' };
  if (!src || failed) return <Box sx={box} />;
  return <Box component="img" src={src} alt={label} loading="lazy" onError={() => setFailed(true)} sx={{ ...box, objectFit: 'cover' }} />;
}

function runLabel(run, L) {
  const when = run.created_at ? new Date(run.created_at).toLocaleDateString() : '';
  return [run.model || L('Silicon run', '硅样本运行'), when, run.status].filter(Boolean).join(' · ');
}

/**
 * Overview card comparing a silicon-sample run with the human answers in the
 * current filter. Renders nothing until the project has at least one run.
 * `onResult(files)` hands the CSV files to the full analysis pack.
 */
export default function SiliconAgreementCard({ projectId, projectName = '', questions, humanRows, language, numberByName, benchTasks, onResult }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const resolve = useContext(ImageResolverContext);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState('');
  const [groupId, setGroupId] = useState('all');
  const [siliconRows, setSiliconRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [benchFile, setBenchFile] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRuns([]);
    setRunId('');
    setSiliconRows(null);
    if (!projectId) return undefined;
    listSiliconRuns(projectId).then((res) => {
      if (cancelled || !res?.success) return;
      const usable = (res.runs || []).filter((r) => (r.progress_valid ?? 1) > 0 && !['draft', 'queued'].includes(r.status));
      setRuns(usable);
      if (usable.length) setRunId(usable[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setSiliconRows(null);
    setGroupId('all');
    setError('');
    if (!runId) return undefined;
    setLoading(true);
    listSiliconResponses(runId).then((res) => {
      if (cancelled) return;
      if (!res?.success) throw new Error(res?.error || 'Could not load the silicon answers');
      setSiliconRows((res.responses || []).map((row) => ({
        ...row,
        source: 'silicon',
        survey_metadata: { ...(row.survey_metadata || {}), silicon_run_id: runId },
      })));
    }).catch((err) => { if (!cancelled) setError(err?.message || String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  const groups = useMemo(() => siliconGroups(siliconRows || []), [siliconRows]);
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const result = useMemo(() => {
    if (!siliconRows?.length || !humanRows?.length || !group) return null;
    return siliconAgreement(questions, humanRows, group.rows, { siliconRunId: runId, siliconGroup: group.id });
  }, [questions, humanRows, group, runId, siliconRows]);
  const allGroupsFiles = useMemo(() => {
    if (!siliconRows?.length || !humanRows?.length) return [];
    // The export always holds every group, so the CSV is a complete table.
    const rows = [];
    const gaps = [];
    const calibration = [];
    for (const g of groups) {
      const r = siliconAgreement(questions, humanRows, g.rows, { siliconRunId: runId, siliconGroup: g.id, gapLimit: Infinity });
      rows.push(...r.rows);
      gaps.push(...r.gaps.map((x) => ({ ...x, silicon_group: g.id })));
      calibration.push(...r.calibration);
    }
    return agreementExportFiles({ rows, calibration }, { allGaps: gaps });
  }, [groups, questions, humanRows, runId, siliconRows]);

  useEffect(() => {
    onResult?.(allGroupsFiles);
  }, [allGroupsFiles, onResult]);

  // SP-Bench: the selected run's per-image answers as a leaderboard submission.
  const tasks = useMemo(() => tasksFromProjectMetadata(benchTasks), [benchTasks]);
  const benchPredictions = useMemo(
    () => (tasks.length && group?.rows?.length ? predictionsFromRows(tasks, questions, group.rows) : {}),
    [tasks, questions, group],
  );
  const downloadBenchSubmission = () => {
    const run = runs.find((r) => r.id === runId);
    const sub = buildSubmission({
      model: `${run?.model || 'Silicon sample'}${group && group.id !== 'all' ? ` (${group.label})` : ''}`,
      kind: 'silicon',
      notes: `SP-Survey silicon-sample run ${runId}; personas: ${group?.id === 'all' ? 'all' : group?.label || ''}.`,
      predictions: benchPredictions,
    });
    const name = submissionFileName(sub);
    downloadTextFile(`${JSON.stringify(sub, null, 2)}\n`, name);
    setBenchFile(name);
  };

  if (!runs.length) return null;

  const thumbUrl = (key, label) => resolve?.get(key) || resolve?.get(label) || (/^(https?:)?\//.test(key) ? key : null);
  const qLabel = (name) => (numberByName?.get(name) ? `Q${numberByName.get(name)}` : name);

  return (
    <Card variant="outlined" sx={{ mb: 3 }} data-testid="silicon-agreement">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>{L('Silicon vs human', '硅样本 vs 真人')}</Typography>
          <TextField select size="small" label={L('Silicon run', '硅样本运行')} value={runId} onChange={(e) => setRunId(e.target.value)} sx={{ minWidth: 220 }}>
            {runs.map((r) => <MenuItem key={r.id} value={r.id}>{runLabel(r, L)}</MenuItem>)}
          </TextField>
          {groups.length > 1 && (
            <TextField select size="small" label={L('Personas', '人设')} value={group?.id || 'all'} onChange={(e) => setGroupId(e.target.value)} sx={{ minWidth: 160 }}>
              {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.id === 'all' ? L('All personas', '全部人设') : g.label}</MenuItem>)}
            </TextField>
          )}
          <Button size="small" startIcon={<Download />} disabled={!allGroupsFiles.length}
            onClick={() => downloadZip(`${(projectName || 'survey').replace(/[^\w.-]+/g, '_')}_silicon_agreement.zip`, allGroupsFiles)}>
            CSV
          </Button>
          {tasks.length > 0 && (
            <Tooltip title={L('Download this run as an SP-Bench submission for the tasks this project published', '把这次运行导出为 SP-Bench 提交文件（针对本项目已发布的任务）')}>
              <span>
                <Button size="small" startIcon={<Leaderboard />} disabled={!Object.keys(benchPredictions).length} onClick={downloadBenchSubmission}>
                  SP-Bench
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
        {benchFile && (
          <Alert severity="success" onClose={() => setBenchFile('')} sx={{ mb: 1.5 }}>
            {L(`Saved ${benchFile}. To put it on the leaderboard, add the file to `, `已保存 ${benchFile}。要上榜，把这个文件添加到 `)}
            <a href={`${SUBMISSIONS_NEW_FILE_URL}?filename=${encodeURIComponent(benchFile)}`} target="_blank" rel="noopener noreferrer">public/bench/submissions</a>
            {L(' by pull request and list it in index.json.', '（通过 pull request），并在 index.json 里加上文件名。')}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {L(
            `Compares ${group?.rows?.length ?? 0} silicon answers with the ${humanRows?.length || 0} human submissions in the current filter. Computed by the platform, not by a model. Silicon samples help pretest a survey; they do not replace people.`,
            `把 ${group?.rows?.length ?? 0} 份硅样本回答和当前筛选下的 ${humanRows?.length || 0} 份真人回答对比。数字由平台直接计算，不经过模型。硅样本只用于预测试，不能代替真人。`,
          )}
        </Typography>
        {loading && <CircularProgress size={20} />}
        {error && <Alert severity="warning">{error}</Alert>}
        {!loading && !error && siliconRows && !result?.rows?.length && (
          <Alert severity="info">{L('No question has answers from both sides yet.', '还没有两边都回答过的题目。')}</Alert>
        )}
        {result?.summary?.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{L('Question and measure', '题目和指标')}</TableCell>
                  <TableCell align="right">{L('Agreement', '一致性')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(showAll ? result.summary : result.summary.slice(0, COLLAPSED_ROWS)).map((row) => {
                  const h = headline(row, L);
                  return (
                    <TableRow key={`${row.question_name}-${row.attribute_key}-${row.comparison}`}>
                      <TableCell>
                        <Typography variant="body2">{qLabel(row.question_name)}{row.attribute_label ? ` · ${row.attribute_label}` : ''}</Typography>
                        <Typography variant="caption" color="text.secondary">{h.label}</Typography>
                        {row.calibration && (
                          <Tooltip title={L(
                            'Linear calibration of the silicon scores onto the human scale. LOO error = typical error for an image the fit did not see, the number to quote if silicon scores stand in for new images. Full table: silicon_calibration.csv.',
                            '把硅样本分数线性映射到真人尺度。留一误差 = 对拟合没见过的图的典型误差，用硅样本分数代替新图打分时应报告这个数。完整表格见 silicon_calibration.csv。',
                          )}>
                            <Typography variant="caption" color="text.secondary" display="block" data-testid="silicon-calibration">
                              {L('Calibration: ', '校准：')}{calibrationLine(row.calibration, L)}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title={L(`${row.n_units} shared items · ${row.n_human} human · ${row.n_silicon} silicon`, `${row.n_units} 个共同项目 · 真人 ${row.n_human} 份 · 硅样本 ${row.n_silicon} 份`)}>
                          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{h.value}</Typography>
                        </Tooltip>
                        {row.n_units > 1 && <Typography variant="caption" color="text.secondary">{L(`${row.n_units} items`, `${row.n_units} 项`)}</Typography>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {result.summary.length > COLLAPSED_ROWS && (
              <Button size="small" onClick={() => setShowAll((v) => !v)} sx={{ mt: 0.5 }}>
                {showAll ? L('Show fewer', '收起') : L(`Show all ${result.summary.length}`, `显示全部 ${result.summary.length} 行`)}
              </Button>
            )}
          </Box>
        )}
        {result?.gaps?.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{L('Where they disagree most', '分歧最大的图')}</Typography>
            <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1 }}>
              {result.gaps.map((g) => (
                <Box key={`${g.question_name}-${g.attribute_key}-${g.unit_key}`} sx={{ flex: '0 0 auto', width: 112 }}>
                  <Thumb src={thumbUrl(g.unit_key, g.unit_label)} label={g.unit_label} />
                  <Typography variant="caption" display="block" noWrap title={g.unit_label}>{g.unit_label}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {qLabel(g.question_name)}{g.attribute_label ? ` · ${g.attribute_label}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {L(`rank ${g.human_rank} → ${g.silicon_rank}`, `排名 真人 ${g.human_rank} · 硅 ${g.silicon_rank}`)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
