import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { getProjectReleaseState, getProjectReleaseVersions, releaseProjectVersion } from '../../lib/projectRelease';
import { compareRelease, publicMediaConfig, sameReleaseValue } from '../../lib/releaseComparison';
import { validateSurveyConfig } from '../../lib/designProtocol/validate';
import { runSurveyPreflight } from '../../lib/surveyPreflight';

export default function ProjectVersions({ currentProject, hasUnsavedChanges, onReleased }) {
  const { language } = useRegion(); const zh = language === 'zh';
  const [state, setState] = useState(null); const [versions, setVersions] = useState([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); const [review, setReview] = useState(null);
  const [summary, setSummary] = useState(''); const [more, setMore] = useState(false);
  const request = useRef(0); const lock = useRef(false);
  const projectId = currentProject?.id;
  const fieldLabel = (field) => ({ rateMin: zh ? '评分下限' : 'Rating minimum', rateMax: zh ? '评分上限' : 'Rating maximum',
    title: zh ? '题目文字' : 'Question wording', description: zh ? '说明' : 'Description', choices: zh ? '选项' : 'Choices',
    trialCount: zh ? '轮数' : 'Trials', imageCount: zh ? '媒体数量' : 'Media count', mediaSlots: zh ? '媒体分配' : 'Media assignment',
    skillConfig: zh ? '自定义交互设置' : 'Custom interaction settings', isRequired: zh ? '必答设置' : 'Required answer',
    rateStep: zh ? '评分步长' : 'Rating step', visibleIf: zh ? '显示条件' : 'Visibility rule',
  }[field] || field);
  const load = useCallback(async () => {
    if (!projectId) return;
    const seq = ++request.current; setLoading(true); setError(''); setState(null); setReview(null);
    try {
      const [latest, history] = await Promise.all([getProjectReleaseState(projectId), getProjectReleaseVersions(projectId)]);
      if (seq !== request.current) return;
      setState(latest); setVersions(history); setMore(history.length === 20);
    } catch (e) { if (seq === request.current) setError(e.message); }
    finally { if (seq === request.current) setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load, currentProject?.draftUpdatedAt, currentProject?.lastModified]);
  const config = state?.survey_config_draft;
  const validation = validateSurveyConfig(config || {});
  const diff = state && compareRelease(state.survey_config_published, config, state.published_media?.preloadedImages || [], state.preloaded_images || []);
  const dirty = !state?.release_managed || diff?.configChanged || diff?.mediaAdded || diff?.mediaRemoved || diff?.mediaChanged
    || !sameReleaseValue(state?.published_media?.imageDatasetConfig, publicMediaConfig(state?.image_dataset_config));
  const startReview = async (version = null) => {
    if (lock.current || !state) return;
    const seq = request.current; lock.current = true; setBusy(true); setError('');
    try {
      const report = await runSurveyPreflight(version?.config || config, {
        preloadedImages: version?.media_snapshot?.preloadedImages || state.preloaded_images || [],
        imageDatasetConfig: version?.media_snapshot?.imageDatasetConfig || state.image_dataset_config || {},
      }, { participants: 1 });
      if (seq !== request.current) return;
      if (report.validation.errors.length || report.questions.some((q) => q.missing)) {
        throw new Error(zh
          ? '配置错误或媒体不足，不能发布。请先修复分享页试运行报告中的问题。'
          : 'Configuration errors or missing media prevent release. Fix the Share Survey check first.');
      }
      setReview(version || { version: null });
    } catch (e) { if (seq === request.current) setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const release = async () => {
    if (lock.current || hasUnsavedChanges || !review || !state) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await releaseProjectVersion(projectId, state.draft_updated_at, { summary, restoreVersion: review.version || null });
      setReview(null); setSummary(''); await load(); await onReleased?.(projectId);
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const showDiff = (d) => <Box sx={{ overflowWrap: 'anywhere' }}>
    <Typography variant="body2">{zh ? `新增 ${d.added.length} 题 · 修改 ${d.changed.length} 题 · 删除 ${d.removed.length} 题` : `${d.added.length} questions added · ${d.changed.length} changed · ${d.removed.length} removed`}</Typography>
    {[['+', d.added], ['~', d.changed], ['−', d.removed]].filter(([, names]) => names.length).map(([label, names]) => <Typography key={label} variant="caption" component="p">{label} {names.join(', ')}</Typography>)}
    {d.changedDetails.map((q) => <Typography key={q.name} variant="caption" component="p">{q.title}: {q.fields.map(fieldLabel).join(', ')}</Typography>)}
    <Typography variant="body2">{zh ? `媒体：新增 ${d.mediaAdded} · 修改 ${d.mediaChanged} · 移除 ${d.mediaRemoved}` : `Media: ${d.mediaAdded} added · ${d.mediaChanged} changed · ${d.mediaRemoved} removed`}</Typography>
    {d.configChanged && <Typography variant="caption">{zh ? '题目顺序、分页或问卷设置也可能发生变化。' : 'Question order, pages or survey settings may also differ.'}</Typography>}
  </Box>;
  return <Box sx={{ p: { xs: 2, sm: 3 }, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography variant="h6">{zh ? '问卷版本管理' : 'Survey versions'}</Typography>
    {loading && <Typography>{zh ? '正在读取版本…' : 'Loading versions…'}</Typography>}
    {!!error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
    <Button onClick={load} disabled={busy || loading}>{zh ? '刷新版本' : 'Refresh versions'}</Button>
    {state && <>
      <Alert severity="info" sx={{ my: 1 }}>{state.release_managed
        ? (zh ? `参与者当前使用本地 v${state.published_version}。保存只更新草稿；发布后请再自行部署参与者站。` : `Participants use local v${state.published_version}. Saving changes the draft; release updates the participant snapshot. You still deploy the participant site yourself.`)
        : (zh ? '尚未启用：保存仍立即影响本地预览与未发布的参与者配置。首次发布后草稿与正式版本分离。' : 'Not enabled: saves still update the live local snapshot. Your first release separates drafts from the participant version.')}</Alert>
      {hasUnsavedChanges && <Alert severity="warning" sx={{ my: 1 }}>{zh ? '请先保存草稿，再发布。' : 'Save the draft before releasing.'}</Alert>}
      {validation.errors?.length > 0 && <Alert severity="warning" sx={{ my: 1 }}>{zh ? '草稿校验未通过，不能发布。' : 'Draft validation failed; release is blocked.'}</Alert>}
      {dirty && <Box sx={{ my: 1 }}>{showDiff(diff || { added: [], changed: [], removed: [], changedDetails: [], mediaAdded: 0, mediaChanged: 0, mediaRemoved: 0, configChanged: false })}</Box>}
      <Button variant="contained" disabled={busy || hasUnsavedChanges || validation.errors?.length > 0} onClick={() => startReview()}>
        {zh ? '发布当前草稿' : 'Release current draft'}
      </Button>
      {versions.length > 0 && <Accordion sx={{ mt: 2 }} expanded={more} onChange={() => setMore((v) => !v)}>
        <AccordionSummary expandIcon={<ExpandMore />}><Typography>{zh ? '历史版本' : 'Version history'}</Typography></AccordionSummary>
        <AccordionDetails>
          {versions.map((row) => (
            <Box key={row.version} sx={{ mb: 1 }}>
              <Typography variant="body2">v{row.version} · {row.releasedAt}{row.summary ? ` · ${row.summary}` : ''}</Typography>
              <Button size="small" disabled={busy || hasUnsavedChanges} onClick={() => startReview(row)}>{zh ? '恢复此版本' : 'Restore this version'}</Button>
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>}
    </>}
    <Dialog open={!!review} onClose={() => !busy && setReview(null)} fullWidth>
      <DialogTitle>{zh ? '确认发布' : 'Confirm release'}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{review?.version
          ? (zh ? `将把 v${review.version} 重新发布为参与者快照。` : `This restores v${review.version} as the participant snapshot.`)
          : (zh ? '发布后，本地 Live Survey 使用该快照。你仍需自行部署参与者站。' : 'After release, the local Live Survey uses this snapshot. You still deploy the participant site yourself.')}</Typography>
        <TextField fullWidth label={zh ? '版本说明（可选）' : 'Release note (optional)'} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setReview(null)} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button>
        <Button variant="contained" onClick={release} disabled={busy || hasUnsavedChanges}>{zh ? '发布' : 'Release'}</Button>
      </DialogActions>
    </Dialog>
  </Box>;
}
