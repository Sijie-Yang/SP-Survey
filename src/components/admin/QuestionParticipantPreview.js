import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { getTrialCount } from '../../lib/trialNavigation';
import { isCuratedMediaMode, isRandomMediaQuestion, resolveMediaFolderTags, resolveSkillQuestions } from '../../lib/surveyMediaInjection';
import { adaptQuestionForPreviewLibrary, resolvePreviewMediaContextCached } from '../../lib/previewMediaLibrary';
import { useRegion } from '../../contexts/RegionContext';
import { conditionVariants, normalizeConditions, withConditionWording } from '../../lib/surveyRuntimeContext';
import { isPreviewMessage, previewAppearance, PREVIEW_DEVICES, PREVIEW_FAILED, PREVIEW_READY, PREVIEW_RENDERED, PREVIEW_UPDATE, QUESTION_PREVIEW_PATH } from '../../lib/questionPreviewProtocol';

/** An actual independent viewport, scaled only after participant layout has run. */
export default function QuestionParticipantPreview({
  question,
  currentProject,
  surveyConfig = null
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const [device, setDevice] = useState('desktop');
  const [expanded, setExpanded] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [host, setHost] = useState(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [usingPreviewLibrary, setUsingPreviewLibrary] = useState(false);
  const conditions = normalizeConditions(surveyConfig);
  const showConditions = conditions.length > 1 && conditionVariants(question).length > 0;
  const conditionIds = conditions.map(c => c.id).join('|');
  // Like a participant: each load or reset draws a random condition.
  const activeCondition = useMemo(() => {
    const ids = conditionIds ? conditionIds.split('|') : [];
    return showConditions && ids.length ? ids[Math.floor(Math.random() * ids.length)] : '';
  }, [showConditions, conditionIds, resetCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const iframeRef = useRef(null);
  const sequence = useRef(0);
  // Watch the full draft so new settings (including allowTie/tieLabel) cannot be omitted.
  const questionKey = JSON.stringify(question || {});
  const preloadedImages = currentProject?.preloadedImages;
  const imageDatasetConfig = currentProject?.imageDatasetConfig;
  const mediaSourceKey = useMemo(() => JSON.stringify({
    images: (preloadedImages || []).map(img => img.key || img.url || img.logicalFolder || img.folder || ''),
    tags: imageDatasetConfig || {}
  }), [preloadedImages, imageDatasetConfig]);
  // Read the latest project inside the effect without rebuilding whenever
  // its object identity changes (autosave/polls replace it often).
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;
  const builtOnce = useRef(false);
  const appearanceKey = JSON.stringify(previewAppearance(surveyConfig || currentProject?.config, currentProject?.theme));
  const appearance = useMemo(() => JSON.parse(appearanceKey), [appearanceKey]);
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    // Build right away the first time, then debounce while the researcher types:
    // each build creates a fresh SurveyJS model in the preview frame.
    const delay = builtOnce.current ? 350 : 0;
    builtOnce.current = true;
    const timer = setTimeout(async () => {
      const currentProject = projectRef.current;
      try {
        let draft = withConditionWording(JSON.parse(questionKey), activeCondition);
        if (!draft.type) return;
        const media = await resolvePreviewMediaContextCached(currentProject || {});
        if (cancelled) return;
        if (media.fromPreviewLibrary) draft = adaptQuestionForPreviewLibrary(draft, media.images);
        const questionConfig = {
          pages: [{
            elements: [draft]
          }]
        };
        await resolveSkillQuestions(questionConfig);
        if (cancelled) return;
        const folderHost = media.fromPreviewLibrary ? {
          imageDatasetConfig: media.imageDatasetConfig
        } : currentProject;
        const folderTags = resolveMediaFolderTags(folderHost, {
          pages: [{
            elements: [draft]
          }]
        });
        const {
          surveyJson,
          shownImages,
          shownImagesByTrial
        } = buildSingleQuestionSurvey({
          question: questionConfig.pages[0].elements[0],
          projectImages: media.images,
          randomMedia: true,
          showNavigationButtons: false,
          folderTags
        });
        if (isRandomMediaQuestion(draft) && !isCuratedMediaMode(draft) && (!shownImages.length || shownImagesByTrial?.some(items => !items.length))) {
          throw new Error(uiPair(language, 'Not enough matching media for all trials. Check folders, sets, categories and reuse settings.', '当前抽图规则没有足够的匹配媒体完成所有轮次，请检查文件夹、分组、分类或去重设置。'));
        }
        setUsingPreviewLibrary(media.fromPreviewLibrary);
        setSnapshot({
          payload: {
            surveyJson,
            appearance
          },
          revision: ++sequence.current
        });
        setError('');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Preview failed');
          setPending(false);
        }
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [questionKey, mediaSourceKey, currentProject?.id, appearance, zh, resetCount, activeCondition]);
  const sendSnapshot = useCallback(() => {
    if (snapshot) iframeRef.current?.contentWindow?.postMessage({
      type: PREVIEW_UPDATE,
      ...snapshot
    }, window.location.origin);
  }, [snapshot]);
  useEffect(() => {
    const receive = event => {
      const source = iframeRef.current?.contentWindow;
      if (isPreviewMessage(event, source, PREVIEW_READY)) sendSnapshot();
      if (isPreviewMessage(event, source, PREVIEW_RENDERED) && event.data.revision === snapshot?.revision) setPending(false);
      if (isPreviewMessage(event, source, PREVIEW_FAILED) && event.data.revision === snapshot?.revision) {
        setError(uiPair(language, 'Preview could not load. Edit the question or reopen the preview.', '预览加载失败，请修改题目或重新打开预览。'));
        setPending(false);
      }
    };
    window.addEventListener('message', receive);
    sendSnapshot();
    return () => window.removeEventListener('message', receive);
  }, [sendSnapshot, snapshot, zh]);
  useEffect(() => {
    if (!host) return undefined;
    const measure = () => setHostWidth(host.clientWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [host]);
  const viewport = PREVIEW_DEVICES[device];
  const scale = hostWidth > 0 ? Math.min(1, hostWidth / viewport.width) : 1;
  const preview = <>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center" sx={{
      mb: 1
    }}>
      <ToggleButtonGroup size="small" exclusive value={device} onChange={(_, next) => next && setDevice(next)} aria-label={uiPair(language, 'Preview device', '预览设备')}>
        <ToggleButton value="desktop"><DesktopWindowsIcon fontSize="small" sx={{
            mr: 0.75
          }} />{uiPair(language, 'Desktop', 'PC 端')}</ToggleButton>
        <ToggleButton value="mobile"><SmartphoneIcon fontSize="small" sx={{
            mr: 0.75
          }} />{uiPair(language, 'Mobile', '手机端')}</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary">{viewport.width} × {viewport.height} · {Math.round(scale * 100)}%</Typography>
      <Stack direction="row" spacing={0.5} sx={{
        ml: 'auto'
      }}>
        <Button size="small" startIcon={<RestartAltIcon />} onClick={() => setResetCount(count => count + 1)} title={uiPair(language, 'Clear answers and restart at the first trial. Random media is resampled; manual selections stay fixed.', '清空试答并回到第一轮；随机题重新抽图，手动指定的图片保持不变。')}>
          {uiPair(language, 'Reset preview', '重置预览')}
        </Button>
        <Button size="small" onClick={() => setExpanded(!expanded)}>{expanded ? uiPair(language, 'Close expanded preview', '收起') : uiPair(language, 'Expand preview', '放大预览')}</Button>
      </Stack>
    </Stack>
    <Typography variant="caption" color="text.secondary" sx={{
      display: 'block',
      mb: 1
    }}>
      {uiPair(language, 'Rendered at device width, then scaled to fit. Scroll and try answers inside; editing resets preview answers. Results are not saved.', '按设备实际宽度排版，缩放仅用于适应此面板；可在预览内滚动和试答。修改设置会重置试答，不保存结果。')}
    </Typography>
    {showConditions && <Typography variant="caption" color="info.main" sx={{
      display: 'block',
      mb: 1
    }}>
        {zh ? `实验条件随机抽取，本次为「${conditions.find(c => c.id === activeCondition)?.label || activeCondition}」。点「重置预览」重新抽取。` : `Condition drawn at random, like a participant: ${conditions.find(c => c.id === activeCondition)?.label || activeCondition}. Reset preview to draw again.`}
      </Typography>}
    {error && <Alert severity="warning" sx={{
      mb: 1
    }}>{error}</Alert>}
    <Box ref={setHost} sx={{
      width: '100%',
      minWidth: 0,
      bgcolor: 'grey.100',
      borderRadius: 2,
      overflow: 'hidden',
      position: 'relative',
      display: error ? 'none' : 'block'
    }}>
      <Box sx={{
        width: viewport.width * scale,
        height: viewport.height * scale,
        mx: 'auto'
      }}>
        <iframe ref={iframeRef} src={QUESTION_PREVIEW_PATH} title={uiPair(language, 'Survey device preview', '问卷设备预览')} onLoad={sendSnapshot} style={{
          display: 'block',
          border: 0,
          background: 'white',
          width: viewport.width,
          height: viewport.height,
          maxWidth: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }} />
      </Box>
      {pending && <Box role="status" sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        p: 0.75,
        bgcolor: 'background.paper',
        borderRadius: 2,
        display: 'flex',
        gap: 1,
        alignItems: 'center'
      }}>
        <CircularProgress size={16} /><Typography variant="caption">{uiPair(language, 'Updating preview…', '更新预览…')}</Typography>
      </Box>}
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{
      display: 'block',
      mt: 1
    }}>
      {zh ? `媒体：手动指定时保持固定；随机模式按当前规则从${usingPreviewLibrary ? '平台预览媒体库' : '项目媒体库'}为每轮抽取。返回上一轮保留原图与答案。` : `Media: manual selections stay fixed; random mode samples each trial from the ${usingPreviewLibrary ? 'platform preview library' : 'project media pool'} using the current rules. Returning to a trial keeps its media and answers.`}
      {getTrialCount(question) > 1 ? zh ? ` · ${getTrialCount(question)} 轮` : ` · ${getTrialCount(question)} trials` : ''}
    </Typography>
  </>;
  return expanded ? <Dialog open fullScreen onClose={() => setExpanded(false)}>
    <DialogTitle>{uiPair(language, 'Participant preview', '参与者预览')}</DialogTitle>
    <DialogContent>{preview}</DialogContent>
  </Dialog> : <Box>{preview}</Box>;
}