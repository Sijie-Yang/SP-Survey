import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Link, Stack, Typography,
} from '@mui/material';
import { Leaderboard } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import {
  MIN_HUMAN_RESPONSES, MIN_ITEMS, buildHumanTask, candidateTasks, isBenchableQuestion,
} from '../../lib/benchHumanTrack';
import { readBenchTasks, saveBenchTasks } from '../../lib/benchTaskStore';

function comparisonLabel(c, L) {
  return c === 'item_scores'
    ? L('Ranking of images (TrueSkill μ), scored by Kendall τ', '图片排名（TrueSkill μ），按 Kendall τ 打分')
    : L('Per-image mean, scored by Spearman ρ', '逐图均值，按 Spearman ρ 打分');
}

/**
 * Lets the project owner publish image questions as SP-Bench human-agreement
 * tasks. A task is frozen from the responses in the current filter; only
 * per-image aggregates and counts are published.
 */
export default function SpBenchTaskCard({ project, questions, humanRows, language, numberByName, onProjectUpdated }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const published = readBenchTasks(project);
  const publishedCount = Object.keys(published).length;
  const benchable = useMemo(() => (questions || []).filter(isBenchableQuestion), [questions]);
  const candidates = useMemo(
    () => (open ? candidateTasks(project?.id, benchable, humanRows) : []),
    [open, project?.id, benchable, humanRows],
  );

  if (!project?.id || !benchable.length) return null;

  const qLabel = (name) => (numberByName?.get(name) ? `Q${numberByName.get(name)}` : name);

  const change = async (candidate, publish) => {
    setBusy(candidate.task_id);
    setError('');
    try {
      const question = benchable.find((q) => q.name === candidate.question_name);
      const task = publish
        ? buildHumanTask({
          project,
          question,
          attributeKey: candidate.attribute_key,
          humanRows,
          publishedAt: new Date().toISOString(),
          doi: project.metadata?.datasetRelease?.doi || '',
          license: project.metadata?.datasetRelease?.license || '',
        })
        : null;
      const metadata = await saveBenchTasks(project.id, { [candidate.task_id]: task });
      onProjectUpdated?.({ metadata });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }} data-testid="sp-bench-task-card">
      <CardContent sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, alignItems: { sm: 'center' }, '&:last-child': { pb: 2 } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {L('SP-Bench: test AI models against your participants', 'SP-Bench：用你的被试数据测试 AI 模型')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {publishedCount
              ? L(`${publishedCount} question(s) published as benchmark tasks. Anyone can score a model on them.`, `已有 ${publishedCount} 道题发布为评测任务，任何人都能拿模型来测。`)
              : L('Publish an image question as a benchmark task. Only per-image averages and counts are shared, never individual answers.', '把图片题发布为评测任务。只公开每张图的平均值和人数，不公开任何个人回答。')}
          </Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<Leaderboard />} onClick={() => setOpen(true)}>
          {L('Choose questions', '选择题目')}
        </Button>
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{L('Publish to SP-Bench', '发布到 SP-Bench')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {L(
              `A task freezes the per-image result of one question from the responses in the current filter. Models are scored on how well they reproduce your participants' ranking. A task needs at least ${MIN_ITEMS} images and ${MIN_HUMAN_RESPONSES} responses. Publishing again replaces the frozen values with the current ones.`,
              `每个任务把一道题在当前筛选下的逐图结果冻结下来。模型按它能多大程度复现被试的排名来打分。一个任务至少要 ${MIN_ITEMS} 张图、${MIN_HUMAN_RESPONSES} 份回答。再次发布会用当前数据替换冻结的数值。`,
            )}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!candidates.length && <Alert severity="info">{L('No image question has per-image results yet.', '还没有能算出逐图结果的图片题。')}</Alert>}
          <Stack spacing={1.25}>
            {candidates.map((c) => {
              const stored = published[c.task_id];
              return (
                <Box key={c.task_id} data-testid={`bench-candidate-${c.task_id}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap title={c.question_title}>
                        {qLabel(c.question_name)}{c.attribute_label ? ` · ${c.attribute_label}` : ''} · {c.question_title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">{comparisonLabel(c.comparison, L)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {L(`${c.n_items} images · ${c.n_human} responses`, `${c.n_items} 张图 · ${c.n_human} 份回答`)}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {stored && <Chip size="small" color="success" variant="outlined" label={L(`Published ${stored.version}`, `已发布 ${stored.version}`)} />}
                      {busy === c.task_id ? <CircularProgress size={20} /> : (
                        <>
                          {stored && <Button size="small" color="inherit" onClick={() => change(c, false)}>{L('Remove', '撤下')}</Button>}
                          <Button size="small" variant={stored ? 'text' : 'contained'} disabled={!c.eligible || Boolean(busy)} onClick={() => change(c, true)}>
                            {stored ? L('Update', '更新') : L('Publish', '发布')}
                          </Button>
                        </>
                      )}
                    </Stack>
                  </Stack>
                  {!c.eligible && (
                    <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                      {c.reasons.includes('responses')
                        ? L(`Needs at least ${MIN_HUMAN_RESPONSES} responses.`, `至少需要 ${MIN_HUMAN_RESPONSES} 份回答。`)
                        : L(`Needs at least ${MIN_ITEMS} images.`, `至少需要 ${MIN_ITEMS} 张图。`)}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Stack direction="row" spacing={2} sx={{ mr: 'auto', ml: 1 }}>
            <Link href="https://sp-survey.org/bench" target="_blank" rel="noopener" sx={{ fontSize: 14 }}>{L('Open SP-Bench', '打开 SP-Bench')}</Link>
            <Link href="https://sp-survey.org/docs/sp-bench-human" target="_blank" rel="noopener" sx={{ fontSize: 14 }}>{L('How it works', '说明')}</Link>
          </Stack>
          <Button onClick={() => setOpen(false)}>{L('Close', '关闭')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
