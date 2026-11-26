import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Alert, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { getProjectReleaseState, getProjectReleaseVersions, releaseProjectVersion } from '../../lib/projectRelease';
import { compareRelease, publicMediaConfig, sameReleaseValue } from '../../lib/releaseComparison';
import { validateSurveyConfig } from '../../lib/designProtocol/validate';
import { runSurveyPreflight } from '../../lib/surveyPreflight';
import { TranslationPublishNotice } from './TranslationEditor';
export default function ProjectVersions({
  currentProject,
  hasUnsavedChanges,
  onReleased
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const [state, setState] = useState(null);
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [summary, setSummary] = useState('');
  const [more, setMore] = useState(false);
  const request = useRef(0);
  const lock = useRef(false);
  const projectId = currentProject?.id;
  const fieldLabel = field => ({
    rateMin: uiPair(language, 'Rating minimum', '评分下限'),
    rateMax: uiPair(language, 'Rating maximum', '评分上限'),
    title: uiPair(language, 'Question wording', '题目文字'),
    description: uiPair(language, 'Description', '说明'),
    choices: uiPair(language, 'Choices', '选项'),
    trialCount: uiPair(language, 'Trials', '轮数'),
    imageCount: uiPair(language, 'Media count', '媒体数量'),
    mediaSlots: uiPair(language, 'Media assignment', '媒体分配'),
    skillConfig: uiPair(language, 'Custom interaction settings', '自定义交互设置'),
    isRequired: uiPair(language, 'Required answer', '必答设置'),
    rateStep: uiPair(language, 'Rating step', '评分步长'),
    visibleIf: uiPair(language, 'Visibility rule', '显示条件')
  })[field] || field;
  const load = useCallback(async () => {
    if (!projectId) return;
    const seq = ++request.current;
    setLoading(true);
    setError('');
    setState(null);
    setReview(null);
    try {
      const [latest, history] = await Promise.all([getProjectReleaseState(projectId), getProjectReleaseVersions(projectId)]);
      if (seq !== request.current) return;
      setState(latest);
      setVersions(history);
      setMore(history.length === 20);
    } catch (e) {
      if (seq === request.current) setError(e.message);
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load, currentProject?.draftUpdatedAt]);
  const config = state?.survey_config_draft;
  const validation = validateSurveyConfig(config || {});
  const diff = state && compareRelease(state.survey_config_published, config, state.published_media?.preloadedImages || [], state.preloaded_images || []);
  const dirty = !state?.release_managed || diff?.configChanged || diff?.mediaAdded || diff?.mediaRemoved || diff?.mediaChanged || !sameReleaseValue(state?.published_media?.imageDatasetConfig, publicMediaConfig(state?.image_dataset_config));
  const startReview = async (version = null) => {
    if (lock.current || !state) return;
    const seq = request.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const report = await runSurveyPreflight(version?.config || config, {
        preloadedImages: version?.media_snapshot?.preloadedImages || state.preloaded_images || [],
        imageDatasetConfig: version?.media_snapshot?.imageDatasetConfig || state.image_dataset_config || {}
      }, {
        participants: 1
      });
      if (seq !== request.current) return;
      if (report.validation.errors.length || report.questions.some((q) => q.missing)) {
        throw new Error(zh ? '配置错误或媒体不足，不能发布。请先修复分享页试运行报告中的问题。' : 'Configuration errors or missing media prevent release. Fix the Share Survey check first.');
      }
      setReview(version || {
        version: null
      });
    } catch (e) {
      if (seq === request.current) setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const release = async () => {
    if (lock.current || hasUnsavedChanges || !review || !state) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await releaseProjectVersion(projectId, state.draft_updated_at, {
        summary,
        restoreVersion: review.version || null
      });
      setReview(null);
      setSummary('');
      await load();
      await onReleased?.(projectId);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const showDiff = d => <Box sx={{
    overflowWrap: 'anywhere'
  }}>
    <Typography variant="body2">{zh ? `新增 ${d.added.length} 题 · 修改 ${d.changed.length} 题 · 删除 ${d.removed.length} 题` : `${d.added.length} questions added · ${d.changed.length} changed · ${d.removed.length} removed`}</Typography>
    {[['+', d.added], ['~', d.changed], ['−', d.removed]].filter(([, names]) => names.length).map(([label, names]) => <Typography key={label} variant="caption" component="p">{label} {names.join(', ')}</Typography>)}
    {d.changedDetails.map(q => <Typography key={q.name} variant="caption" component="p">{q.title}: {q.fields.map(fieldLabel).join(', ')}</Typography>)}
    <Typography variant="body2">{zh ? `媒体：新增 ${d.mediaAdded} · 修改 ${d.mediaChanged} · 移除 ${d.mediaRemoved}` : `Media: ${d.mediaAdded} added · ${d.mediaChanged} changed · ${d.mediaRemoved} removed`}</Typography>
    {d.configChanged && <Typography variant="caption">{uiPair(language, 'Question order, pages or survey settings may also differ.', '题目顺序、分页或问卷设置也可能发生变化。')}</Typography>}
  </Box>;
  return <Box sx={{
    p: {
      xs: 2,
      sm: 3
    },
    mb: 3,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 2
  }}>
    <Typography variant="h6">{uiPair(language, 'Survey versions', '问卷版本管理')}</Typography>
    {loading && <Typography>{uiPair(language, 'Loading versions…', '正在读取版本…')}</Typography>}
    {!!error && <Alert severity="error" sx={{
      my: 1
    }}>{error}<Typography variant="caption" component="p">{uiPair(language, 'If a column or function is missing, apply research_releases.sql first. For other errors, refresh and retry.', '若提示列或函数不存在，请先应用 research_releases.sql；其他错误请刷新重试。')}</Typography></Alert>}
    <Button onClick={load} disabled={busy || loading}>{uiPair(language, 'Refresh versions', '刷新版本')}</Button>
    {state && <>
      <Alert severity="info" sx={{
        my: 1
      }}>{state.release_managed ? zh ? `参与者当前使用 v${state.published_version}。保存只更新草稿；发布后分享链接才会更新。` : `Participants use v${state.published_version}. Saving changes the draft; publishing updates the share link.` : uiPair(language, 'Not enabled: saves still update the share link. Your first release separates drafts from the participant version.', '尚未启用：保存仍立即影响分享链接。首次发布后启用草稿与正式版本分离。')}</Alert>
      {diff && showDiff(diff)}
      {hasUnsavedChanges && <Alert severity="warning">{uiPair(language, 'Save your current changes, then refresh versions.', '请先保存当前修改，再刷新版本。')}</Alert>}
      {validation.errors.length > 0 && <Alert severity="warning" sx={{
        my: 1
      }}>{uiPair(language, 'Fix draft configuration errors in Survey Builder before releasing.', '草稿存在配置错误，请先在题目设置中修复。')}</Alert>}
      <TranslationPublishNotice config={config} language={language} />
      <Button variant="contained" disabled={busy || loading || hasUnsavedChanges || !dirty || !validation.valid} sx={{
        my: 2,
        minHeight: 44
      }} onClick={() => startReview()}>
        {zh ? state.release_managed ? '检查并发布草稿' : '启用版本管理并发布' : state.release_managed ? 'Review and release draft' : 'Enable versions and release'}
      </Button>
      {versions.map((v, i) => <Accordion key={v.version} disableGutters>
        <AccordionSummary expandIcon={<ExpandMore />}><Typography sx={{
            overflowWrap: 'anywhere'
          }}>v{v.version} · {new Date(v.published_at).toLocaleString()} {v.version === state.published_version && state.release_managed ? uiPair(language, '· Live', '· 当前正式版') : ''}</Typography></AccordionSummary>
        <AccordionDetails>
          <Typography>{v.change_summary || uiPair(language, 'No release note', '未填写版本说明')}</Typography>
          {showDiff(compareRelease(versions[i + 1]?.config, v.config, versions[i + 1]?.media_snapshot?.preloadedImages || [], v.media_snapshot?.preloadedImages || []))}
          <Typography variant="caption" component="p">{versions[i + 1] ? uiPair(language, 'Compared with previous version', '与上一版本比较') : uiPair(language, 'No earlier version loaded; compared with an empty baseline', '当前列表无上一版本，按空白基线显示')}</Typography>
          {!v.media_snapshot && <Alert severity="info">{uiPair(language, 'Legacy snapshot has no media manifest; it can be inspected but not fully restored.', '历史快照未记录媒体清单，仅可查看，不能完整恢复。')}</Alert>}
          <Button disabled={busy || hasUnsavedChanges || !v.media_snapshot || v.version === state.published_version} onClick={() => startReview(v)} sx={{
            mt: 1,
            minHeight: 44
          }}>{uiPair(language, 'Restore as new version…', '恢复为新版本…')}</Button>
        </AccordionDetails>
      </Accordion>)}
      {more && <Button disabled={busy || loading} onClick={async () => {
        const seq = request.current;
        setLoading(true);
        try {
          const next = await getProjectReleaseVersions(projectId, versions.length);
          if (seq === request.current) {
            setVersions(old => [...old, ...next]);
            setMore(next.length === 20);
          }
        } catch (e) {
          if (seq === request.current) setError(e.message);
        } finally {
          if (seq === request.current) setLoading(false);
        }
      }}>{uiPair(language, 'Load earlier versions', '加载更早版本')}</Button>}
    </>}
    <Dialog open={!!review} onClose={() => {
      if (!busy) setReview(null);
    }} fullWidth maxWidth="sm">
      <DialogTitle>{zh ? review?.version ? `恢复 v${review.version} 并发布新版本` : '发布到参与者链接' : review?.version ? `Restore v${review.version} as a new release` : 'Release to participant link'}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{
          mb: 2
        }}>{uiPair(language, 'New participants will receive this version. Started responses keep their existing questions and media; history is retained.', '这会更新新参与者看到的问卷。已经开始的答卷继续使用原有题目与媒体；历史记录会保留。')}
          {!!review?.version && <Typography variant="body2">{uiPair(language, 'Restoring also replaces the current draft and media organization.', '恢复还会替换当前草稿和媒体分类。')}</Typography>}
        </Alert>
        {review?.version && state ? showDiff(compareRelease(config, review.config, state.preloaded_images || [], review.media_snapshot?.preloadedImages || [])) : diff && showDiff(diff)}
        <TranslationPublishNotice config={review?.version ? review.config : config} language={language} />
        <TextField fullWidth multiline minRows={2} label={uiPair(language, 'Release note', '版本说明')} value={summary} onChange={e => setSummary(e.target.value)} sx={{
          mt: 2
        }} />
        {!!error && <Alert severity="error" sx={{
          mt: 1
        }}>{error}</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setReview(null)}>{uiPair(language, 'Cancel', '取消')}</Button><Button variant="contained" disabled={busy || hasUnsavedChanges} onClick={release}>{busy ? uiPair(language, 'Releasing…', '发布中…') : uiPair(language, 'Confirm release', '确认发布')}</Button></DialogActions>
    </Dialog>
  </Box>;
}