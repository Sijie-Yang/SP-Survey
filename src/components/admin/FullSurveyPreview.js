import StudioMediaPanel from './StudioMediaPanel';
import StudioImageHandles from './StudioImageHandles';
import StudioThemePanel from './StudioThemePanel';
import { normalizeMediaLayout, savedMediaLayout, setMediaLayout } from '../../lib/mediaLayout';
import CanvasDescriptionEditor from './CanvasDescriptionEditor';
import { findSelectedTextHost } from '../../lib/textSelectionPresentation';
import { selectedTextTarget } from '../../lib/selectedTextStyles';
import { descriptionSourceOffset } from '../../lib/descriptionFormatting';
import DescriptionMarkdownEditor from './DescriptionMarkdownEditor';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery } from '@mui/material';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import Undo from '@mui/icons-material/Undo';
import Redo from '@mui/icons-material/Redo';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ViewSidebarOutlined from '@mui/icons-material/ViewSidebarOutlined';
import Add from '@mui/icons-material/Add';
import Notes from '@mui/icons-material/Notes';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import PreviewQuestionFields from './PreviewQuestionFields';
import PreviewTypographyFields from './PreviewTypographyFields';
import PreviewTextSelectionToolbar from './PreviewTextSelectionToolbar';
import { insertPreviewContent, removePreviewContent, PREVIEW_QUESTION_TYPES } from '../../lib/previewContentEditing';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import { setViewportLayoutField, setQuestionLayoutField, questionLayoutSlot, updateSurveyText, updatePageText, updateQuestionText, VIEWPORT_LAYOUT_LIMITS, viewportSlot } from '../../lib/viewportLayout';
import { startPreviewResize } from '../../lib/previewResize';
import PreviewOutline from './PreviewOutline';
import { previewStudioI18n } from './previewStudioI18n';
import SurveyPreview from './SurveyPreview';
import './previewStudio.css';

function Dimension({ label, value, min, max, unit = 'px', onChange, onStart, onEnd }) {
  return <Box sx={{ mb: 1.75 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="caption" fontWeight={600}>{label}</Typography>
      <TextField type="number" size="small" value={value} onFocus={onStart} onBlur={() => onEnd(false)}
        onChange={(e) => { if (e.target.value !== '') onChange(Math.max(min, Math.min(max, Number(e.target.value)))); }}
        inputProps={{ min, max, 'aria-label': `${label} (${unit})` }} sx={{ width: 82, '& input': { py: 0.6, px: 1, fontSize: 12 } }} />
    </Stack>
    <Slider size="small" aria-label={label} value={value} min={min} max={max} step={1}
      onPointerDown={onStart} onChange={(_e, next) => onChange(next)} onChangeCommitted={() => onEnd(false)} sx={{ mt: 0.5, mb: -1 }} />
    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{value} {unit}</Typography>
  </Box>;
}

/** A bounded edit history; pointer gestures and focused inputs commit as one edit. */
export default function FullSurveyPreview({ config, currentProject, onConfigChange, onSave, saveStatus, onOpenRelease }) {
  const { t, language } = useRegion();
  const copy = previewStudioI18n[language] || previewStudioI18n.en;
  const [viewport, setViewport] = useState('desktop');
  const [selection, setSelection] = useState({ kind: 'survey' });
  const [addAnchor, setAddAnchor] = useState(null);
  const [visiblePageName, setVisiblePageName] = useState(null);
  const [guides, setGuides] = useState(true);
  const [zoom, setZoom] = useState('fit');
  const [inspectorTab, setInspectorTab] = useState('layout');
  const compactWorkspace = useMediaQuery('(max-width: 1100px)');
  const [outlinePreference, setOutlinePreference] = useState(null);
  const outlineOpen = outlinePreference ?? !compactWorkspace;
  const inspectorRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [sampleRevision, setSampleRevision] = useState(0);
  const [previewOrder, setPreviewOrder] = useState({});
  useEffect(() => { setSelectedImage(0); }, [selection.name, viewport, sampleRevision]);
  const [canvasWidth, setCanvasWidth] = useState(900);
  const canvasRef = useRef(null);
  const descriptionEditorRef = useRef(null);
  const [inlineDescription, setInlineDescription] = useState(null);
  useEffect(() => {
    setInlineDescription((active) => active && active.target.kind === selection.kind && (active.target.name || '') === (selection.name || '') ? active : null);
  }, [selection]);
  useEffect(() => { setInlineDescription(null); }, [viewport, guides]);
  const configRef = useRef(config);
  const expectedRef = useRef(config);
  const history = useRef({ past: [], future: [], group: null });
  const [, refreshHistory] = useState(0);
  configRef.current = config;
  const notify = useRef(onConfigChange);
  notify.current = onConfigChange;
  const commit = useCallback((next) => {
    if (!next || next === configRef.current) return;
    const h = history.current;
    if (!h.group || !h.group.recorded) {
      h.past = [...h.past.slice(-79), configRef.current];
      if (h.group) h.group.recorded = true;
    }
    h.future = [];
    configRef.current = next;
    expectedRef.current = next;
    notify.current?.(next);
    refreshHistory((n) => n + 1);
  }, []);
  const begin = useCallback(() => {
    if (!history.current.group) history.current.group = { baseline: configRef.current, recorded: false, future: history.current.future };
  }, []);
  const end = useCallback((cancelled = false) => {
    const h = history.current;
    if (cancelled && h.group?.recorded) {
      h.past.pop();
      h.future = h.group.future;
      configRef.current = h.group.baseline;
      expectedRef.current = h.group.baseline;
      notify.current?.(h.group.baseline);
    }
    h.group = null;
    refreshHistory((n) => n + 1);
  }, []);
  const travel = useCallback((redo = false) => {
    const h = history.current;
    h.group = null;
    const source = redo ? h.future : h.past;
    const target = redo ? h.past : h.future;
    if (!source.length) return;
    target.push(configRef.current);
    const next = source.pop();
    configRef.current = next;
    expectedRef.current = next;
    notify.current?.(next);
    refreshHistory((n) => n + 1);
  }, []);
  useEffect(() => {
    if (config !== expectedRef.current) {
      history.current = { past: [], future: [], group: null };
      expectedRef.current = config;
      refreshHistory((n) => n + 1);
    }
  }, [config]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  const cancelResize = useRef(null);
  useEffect(() => () => cancelResize.current?.(), []);
  const slot = viewportSlot(config, viewport);
  const limits = VIEWPORT_LAYOUT_LIMITS[viewport];
  const scale = zoom === 'fit' ? Math.min(1, Math.max(0.25, (canvasWidth - 64) / slot.contentWidth)) : Number(zoom);
  const page = config?.pages?.find((p) => p.name === selection.pageName);
  const question = selection.kind === 'question' ? page?.elements?.find((q) => q.name === selection.name) : null;
  const questionSlot = questionLayoutSlot(config, viewport, question?.name);
  useEffect(() => {
    if (selection.kind === 'question') {
      const owner = config?.pages?.find((p) => p.elements?.some((q) => q.name === selection.name));
      if (!owner) setSelection({ kind: 'survey' });
      else if (owner.name !== selection.pageName) setSelection({ ...selection, pageName: owner.name });
    } else if (selection.kind === 'page' && !config?.pages?.some((p) => p.name === selection.name)) {
      setSelection({ kind: 'survey' });
    }
  }, [config, selection]);
  const selectContent = useCallback((next) => {
    setSelection(next);
    setInspectorTab(tab => tab === 'theme' ? 'layout' : tab);
    if (compactWorkspace) setOutlinePreference(false);
  }, [compactWorkspace]);
  useEffect(() => { inspectorRef.current?.scrollTo?.({ top: 0 }); }, [selection.kind, selection.name, inspectorTab]);
  const zh = language === 'zh';
  const tr = (en, cn) => zh ? cn : en;
  const hasImages = question && /image|media/.test(question.type) && !/ranking/.test(question.type);
  const hasMedia = question && /image|media|video|audio/.test(question.type);
  const selectedTitle = question?.title || page?.title || (selection.kind === 'survey' ? config.title : '') || selection.name || copy.global;
  const setField = (field, value) => commit(question && ['questionWidth', 'mediaMaxHeight', 'mediaWidth'].includes(field)
    ? setQuestionLayoutField(configRef.current, viewport, question.name, field, value)
    : setViewportLayoutField(configRef.current, viewport, field, value));
  const resize = (event, field, name = null) => {
    const imageRule = name && savedMediaLayout(configRef.current, viewport, name);
    if (imageRule && field === 'mediaMaxHeight' && imageRule.mode !== 'free') {
      cancelResize.current?.();
      cancelResize.current = startPreviewResize(event, { value: normalizeMediaLayout(imageRule).height, min: 40, max: 800, scale, axis: 'y', onStart: begin, onEnd: end,
        onChange: height => commit(setMediaLayout(configRef.current, viewport, name, { ...imageRule, height })) });
      return;
    }
    const active = name ? questionLayoutSlot(configRef.current, viewport, name) : viewportSlot(configRef.current, viewport);
    const [min, maximum] = field === 'mediaWidth' ? [20, 100] : limits[field];
    const max = field === 'questionWidth' ? Math.min(maximum, slot.contentWidth) : maximum;
    const root = event.currentTarget?.closest?.('[data-sp-question-name]') || event.target?.closest?.('[data-sp-question-name]');
    const mediaFactor = 200 / Math.max(1, root?.clientWidth || slot.questionWidth);
    const media = root?.querySelector('.sd-image img, .sp-image-gallery img, .sd-imagepicker img, .sp-media-player, video, canvas');
    const measured = field === 'questionWidth' ? root?.offsetWidth : field === 'mediaMaxHeight' ? (media?.getBoundingClientRect().height || 0) / scale : 0;
    const startValue = measured > 0 ? Math.min(active[field], measured) : active[field];
    cancelResize.current?.();
    cancelResize.current = startPreviewResize(event, {
      value: startValue, min, max, scale, axis: field === 'mediaMaxHeight' ? 'y' : 'x', factor: field === 'mediaMaxHeight' ? 1 : field === 'mediaWidth' ? mediaFactor : 2,
      onStart: begin, onEnd: end,
      onChange: (value) => commit(name ? setQuestionLayoutField(configRef.current, viewport, name, field, value) : setViewportLayoutField(configRef.current, viewport, field, value)),
    });
  };
  const resizeKey = (event, field, name = null) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = name ? questionLayoutSlot(configRef.current, viewport, name) : viewportSlot(configRef.current, viewport);
    const delta = (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 1);
    const rule = name && savedMediaLayout(configRef.current, viewport, name);
    if (rule && field === 'mediaMaxHeight' && rule.mode !== 'free') commit(setMediaLayout(configRef.current, viewport, name, { ...rule, height: rule.height + delta }));
    else commit(name ? setQuestionLayoutField(configRef.current, viewport, name, field, current[field] + delta) : setViewportLayoutField(configRef.current, viewport, field, current[field] + delta));
  };
  const labels = useMemo(() => ({
    editDescriptionHint: copy.editDescriptionHint,
    questionText: t.previewQuestionText, questionDescription: t.previewQuestionDescription,
    pageTitle: t.previewPageTitle, pageDescription: t.previewPageDescription, surveyTitle: t.previewSurveyTitle,
    surveyDescription: t.previewSurveyDescription, editSurveyTitle: t.previewEditSurveyTitle, editSurveyDescription: t.previewEditSurveyDescription,
    moveUp: t.previewMoveUp, moveDown: t.previewMoveDown, reorderQuestion: t.previewReorderQuestion, reorderPage: t.previewReorderPage,
    moveQuestionUp: t.previewMoveQuestionUp, moveQuestionDown: t.previewMoveQuestionDown, movePageUp: t.previewMovePageUp, movePageDown: t.previewMovePageDown,
    mediaAssignment: t.previewMediaAssignment, resizeQuestion: copy.resizeQuestion, resizeMedia: copy.resizeMedia, resizeMediaWidth: copy.resizeMediaWidth, resizeHelp: copy.resizeHelp,
  }), [t, copy]);
  const editDescription = (target) => {
    const ownerPage = configRef.current.pages?.find((p) => target.kind === 'page' ? p.name === target.name : p.elements?.some((q) => q.name === target.name));
    setSelection({ kind: target.kind, name: target.name, pageName: ownerPage?.name });
    const host = findSelectedTextHost(canvasRef.current, target);
    if (host) {
      const selected = selectedTextTarget(window.getSelection(), canvasRef.current, true);
      const sameText = selected?.kind === target.kind && selected?.name === (target.name || '') && selected?.field === 'description';
      const owner = target.kind === 'survey' ? configRef.current : target.kind === 'page' ? ownerPage : ownerPage?.elements?.find((q) => q.name === target.name);
      const initialOffset = descriptionSourceOffset(owner?.description || '', target.start ?? (sameText ? selected.start : 0));
      window.getSelection()?.removeAllRanges();
      end(false); setInlineDescription({ host, target, initialOffset });
    }
    else { setInspectorTab('content'); requestAnimationFrame(() => descriptionEditorRef.current?.focus()); }
  };
  const textField = (field, label, target = 'survey') => {
    const value = target === 'question' ? question?.[field] : target === 'page' ? page?.[field] : config?.[field];
    const change = (next) => commit(target === 'question' ? updateQuestionText(configRef.current, question.name, field, next) : target === 'page' ? updatePageText(configRef.current, page.name, field, next) : updateSurveyText(configRef.current, field, next));
    const key = `${target}-${selection.name || ''}-${field}`;
    if (field === 'description') return <DescriptionMarkdownEditor key={key} ref={descriptionEditorRef} label={label} value={value} onFocus={begin} onBlur={() => end(false)} onChange={change} />;
    return <TextField key={key} fullWidth size="small" label={label} value={typeof value === 'string' ? value : ''} onFocus={begin} onBlur={() => end(false)} onChange={(event) => change(event.target.value)} />;
  };
  const dimension = (field, label, value = slot[field], range = limits[field], unit) => <Dimension key={field} label={label} value={value} min={range[0]} max={range[1]} unit={unit} onChange={(next) => setField(field, next)} onStart={begin} onEnd={end} />;
  const addContent = (type) => {
    end(false);
    const result = insertPreviewContent(configRef.current, type, selection, visiblePageName, copy);
    commit(result.config);
    selectContent(result.selection);
    setInspectorTab('content');
    setGuides(true);
    setAddAnchor(null);
  };
  const preset = (kind) => {
    const values = viewport === 'mobile'
      ? { compact: [320, 280, 220, 12, 12], balanced: [390, 350, 320, 16, 20], spacious: [430, 390, 400, 24, 24] }
      : { compact: [760, 640, 280, 16, 20], balanced: [1000, 840, 420, 24, 32], spacious: [1280, 1120, 560, 40, 40] };
    let next = configRef.current;
    ['contentWidth', 'questionWidth', 'mediaMaxHeight', 'questionGap', 'cardPadding'].forEach((field, index) => { next = setViewportLayoutField(next, viewport, field, values[kind][index]); });
    commit(next);
  };
  return (
    <Box className="sp-preview-studio" data-guides={guides ? 'on' : 'off'} data-outline={outlineOpen ? 'open' : 'closed'} onKeyDown={(event) => {
      if (!(event.metaKey || event.ctrlKey) || !['z', 'y'].includes(event.key.toLowerCase()) || event.target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y');
    }}>
      <Stack className="sp-studio-toolbar" direction="row" useFlexGap flexWrap="wrap" alignItems="center" gap={1}>
        <Tooltip title={copy.outline}><IconButton aria-label={copy.outline} aria-pressed={outlineOpen} onClick={() => setOutlinePreference(!outlineOpen)}><ViewSidebarOutlined fontSize="small" /></IconButton></Tooltip>
        <ToggleButtonGroup exclusive size="small" value={viewport} onChange={(_event, next) => { if (next) { cancelResize.current?.(); end(false); setViewport(next); } }} aria-label={t.previewDevice}>
          <ToggleButton value="desktop"><DesktopWindowsIcon fontSize="small" sx={{ mr: 0.75 }} />{t.previewDesktop}</ToggleButton>
          <ToggleButton value="mobile"><SmartphoneIcon fontSize="small" sx={{ mr: 0.75 }} />{t.previewMobile}</ToggleButton>
        </ToggleButtonGroup>
        <Divider orientation="vertical" flexItem />
        <Tooltip title={copy.insertHelp} describeChild><Button size="small" startIcon={<Add />} onClick={(event) => setAddAnchor(event.currentTarget)} aria-haspopup="menu" aria-expanded={!!addAnchor}>{copy.addQuestion}</Button></Tooltip>
        <Button size="small" startIcon={<Notes />} onClick={() => addContent('expression')}>{copy.addText}</Button>
        <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)}>
          {PREVIEW_QUESTION_TYPES.map((type) => <MenuItem key={type} onClick={() => addContent(type)}>{copy.typeLabels[type]}</MenuItem>)}
        </Menu>
        <Box sx={{ flex: 1 }} />
        {onSave && <Button size="small" variant="contained" disableElevation startIcon={<SaveOutlined />} disabled={saveStatus === 'saving'} onClick={() => { end(false); onSave(); }}>{saveStatus === 'saving' ? copy.saving : copy.save}</Button>}
        <Tooltip title={copy.undo}><span><IconButton aria-label={copy.undo} disabled={!history.current.past.length} onClick={() => travel()}><Undo fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title={copy.redo}><span><IconButton aria-label={copy.redo} disabled={!history.current.future.length} onClick={() => travel(true)}><Redo fontSize="small" /></IconButton></span></Tooltip>
        <Divider orientation="vertical" flexItem />
        <TextField select size="small" value={zoom} onChange={(event) => setZoom(event.target.value)} SelectProps={{ inputProps: { 'aria-label': copy.zoom } }} sx={{ minWidth: 96, '& .MuiSelect-select': { py: 0.8, fontSize: 12 } }}>
          <MenuItem value="fit">{copy.fit}</MenuItem>{[0.5, 0.75, 1, 1.25].map((n) => <MenuItem key={n} value={String(n)}>{n * 100}%</MenuItem>)}
        </TextField>
        <Tooltip title={guides ? copy.clean : copy.edit}><Button size="small" aria-label={guides ? copy.clean : copy.edit} startIcon={guides ? <VisibilityOutlined fontSize="small" /> : <EditOutlined fontSize="small" />} onClick={() => setGuides(!guides)}>{guides ? tr('Hide guides', '隐藏辅助线') : tr('Show guides', '显示辅助线')}</Button></Tooltip>
        <PreviewTextSelectionToolbar selectionScope={selection} onEditDescription={editDescription} canvasRef={canvasRef} config={config} viewport={viewport} labels={copy} onChange={commit} onStart={begin} onEnd={end} enabled={guides && !inlineDescription} editingText={!!inlineDescription} />
      </Stack>
      <Box className="sp-studio-workspace">
        <Box component="nav" hidden={!outlineOpen} aria-label={copy.outline} className="sp-studio-outline">
          <Typography component="div" className="sp-studio-section-title">{copy.outline}<Chip size="small" label={config?.pages?.length || 0} sx={{ height: 19, fontSize: 10 }} /></Typography>
          <Button fullWidth variant={selection.kind === 'survey' ? 'contained' : 'text'} size="small" onClick={() => selectContent({ kind: 'survey' })} sx={{ mb: 1.5, justifyContent: 'flex-start', boxShadow: 'none' }}>{copy.global}</Button>
          <PreviewOutline config={config} selection={selection} onSelect={selectContent} onChange={commit} labels={copy} />
          <Button fullWidth size="small" startIcon={<Add />} onClick={() => addContent('page')} sx={{ mt: 1 }}>{copy.addPage}</Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, fontSize: 11 }}>{copy.select}</Typography>
        </Box>
        <Box ref={canvasRef} className="sp-studio-canvas" role="region" aria-label={copy.canvas}>
          <Stack direction="row" justifyContent="space-between" className="sp-studio-canvas-caption"><span>{tf(t.previewSizing, { viewport: viewport === 'mobile' ? t.previewMobile : t.previewDesktop })}</span><span>{slot.contentWidth} px · {Math.round(scale * 100)}%</span></Stack>
          <Box sx={{ width: slot.contentWidth, zoom: scale, mx: 'auto', position: 'relative' }}>
            {guides && <button type="button" className="sp-studio-content-handle" aria-label={copy.resizeContent} title={copy.resizeHelp} onPointerDown={(event) => resize(event, 'contentWidth')} onKeyDown={(event) => resizeKey(event, 'contentWidth')}><span>⋮</span></button>}
            {config?.pages?.length ? <SurveyPreview key={sampleRevision} interactive config={config} currentProject={currentProject} onConfigChange={commit} viewport={viewport}
              contentWidth={slot.contentWidth} questionWidth={slot.questionWidth} mediaMaxHeight={slot.mediaMaxHeight} labels={labels}
              studio={{ previewOrder, editingDescription: inlineDescription?.target, onEditDescription: editDescription, selection, onSelect: selectContent, onPageChange: setVisiblePageName, resize, resizeKey, guides }} /> : <Typography sx={{ p: 4 }}>{copy.noPages}</Typography>}
          </Box>
        </Box>
        <StudioImageHandles canvasRef={canvasRef} config={config} viewport={viewport} name={question?.name} enabled={guides && !inlineDescription && savedMediaLayout(config, viewport, question?.name)?.mode === 'free'} selected={selectedImage} onSelect={setSelectedImage} onChange={commit} onStart={begin} onEnd={end} zh={language === 'zh'} />
        {inlineDescription && <CanvasDescriptionEditor host={inlineDescription.host} initialOffset={inlineDescription.initialOffset} labels={copy} label={copy.editWholeDescription}
          value={(inlineDescription.target.kind === 'survey' ? config : inlineDescription.target.kind === 'page' ? config.pages?.find((p) => p.name === inlineDescription.target.name) : config.pages?.flatMap((p) => p.elements || []).find((q) => q.name === inlineDescription.target.name))?.description || ''}
          onChange={(value) => commit(inlineDescription.target.kind === 'survey' ? updateSurveyText(configRef.current, 'description', value) : inlineDescription.target.kind === 'page' ? updatePageText(configRef.current, inlineDescription.target.name, 'description', value) : updateQuestionText(configRef.current, inlineDescription.target.name, 'description', value))}
          onStart={begin} onEnd={() => end(false)} onClose={() => setInlineDescription(null)} />}
        <Box component="aside" aria-label={copy.properties} className="sp-studio-inspector">
          <Box className="sp-inspector-header">
            <Typography className="sp-selection-heading" title={typeof selectedTitle === 'string' ? selectedTitle : selection.name}>
              {inspectorTab === 'theme' ? tr('Survey theme', '问卷主题') : `${tr('Editing', '正在编辑')} · ${typeof selectedTitle === 'string' ? selectedTitle : selection.name}`}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
              <Chip size="small" label={inspectorTab === 'theme' ? copy.global : question ? copy.question : selection.kind === 'page' ? copy.page : copy.global} />
              <Chip size="small" variant="outlined" label={inspectorTab === 'theme' ? tr('Colors · All devices', '颜色 · 所有设备') : viewport === 'mobile' ? t.previewMobile : t.previewDesktop} />
            </Stack>
            <ToggleButtonGroup className="sp-inspector-tabs" exclusive size="small" fullWidth value={inspectorTab} aria-label={tr('Inspector sections', '属性分区')} onChange={(_, value) => { if (value) { end(false); setInspectorTab(value); } }}>
              <ToggleButton value="content">{copy.content}</ToggleButton>
              <ToggleButton value="layout">{copy.layout}</ToggleButton>
              <ToggleButton value="theme">{tr('Global theme', '全局主题')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box ref={inspectorRef} className="sp-inspector-body" key={`${selection.kind}-${selection.name || ''}-${inspectorTab}`}>
          {inspectorTab === 'theme' ? <>
            <StudioThemePanel config={config} onChange={commit} onStart={begin} onEnd={end} zh={zh} />
            <details className="sp-studio-section" open><summary>{tr('Global typography', '全局字体与字号')} · {viewport === 'mobile' ? t.previewMobile : t.previewDesktop}</summary>
              <PreviewTypographyFields config={config} viewport={viewport} labels={copy} onChange={commit} onStart={begin} onEnd={end} />
            </details>
          </> : inspectorTab === 'content' ? <>
            <Typography className="sp-scope-note">{tr('Text and question settings are shared across devices.', '文字与题目设置在电脑、手机端同步。')}</Typography>
            <Stack spacing={2}>
              {question ? <>{textField('title', question.type === 'expression' ? copy.blockHeading : t.previewQuestionText, 'question')}{textField('description', question.type === 'expression' ? copy.blockBody : t.previewQuestionDescription, 'question')}<PreviewQuestionFields question={question} labels={copy} onStart={begin} onEnd={() => end(false)} onChange={(field, value) => commit(updateQuestionText(configRef.current, question.name, field, value))} /></> : selection.kind === 'page' && page ? <>{textField('title', t.previewPageTitle, 'page')}{textField('description', t.previewPageDescription, 'page')}</> : <>{textField('title', t.previewSurveyTitle)}{textField('description', t.previewSurveyDescription)}{textField('logo', t.previewLogoUrl)}</>}
            </Stack>
            {question && <Box className="sp-inspector-actions"><Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => {
              end(false); commit(removePreviewContent(configRef.current, question.name));
              selectContent({ kind: 'page', name: page.name, pageName: page.name });
            }}>{copy.removeContent}</Button><Typography variant="caption" color="text.secondary">{tr('You can undo this action.', '删除后可撤销。')}</Typography></Box>}
          </> : selection.kind === 'page' ? <>
            <Typography className="sp-scope-note">{tr('Pages share the survey layout. Select a question for its own layout, or edit the survey defaults.', '页面沿用问卷布局。选中题目可单独调整，或进入问卷设置修改默认布局。')}</Typography>
            <Button fullWidth variant="outlined" onClick={() => selectContent({ kind: 'survey' })}>{tr('Edit survey layout', '设置问卷布局')}</Button>
            <Button fullWidth sx={{ mt: 1 }} onClick={() => setInspectorTab('content')}>{tr('Edit page content', '编辑页面内容')}</Button>
          </> : <>
            <Typography className="sp-scope-note">{viewport === 'mobile' ? copy.mobileOnly : copy.desktopOnly} · {question ? copy.perQuestion : copy.allQuestions}</Typography>
            <Box className="sp-studio-section">
              <Typography className="sp-studio-section-title">{question ? tr('Question card', '题目卡片') : tr('Survey frame', '问卷整体')}</Typography>
              {!question && dimension('contentWidth', t.previewContentWidth)}
              {dimension('questionWidth', t.previewQuestionWidth, question ? questionSlot.questionWidth : slot.questionWidth, [limits.questionWidth[0], Math.min(limits.questionWidth[1], slot.contentWidth)])}
              {!question && <>{dimension('questionGap', copy.gap)}{dimension('cardPadding', copy.padding)}</>}
            </Box>
            {hasImages && <Box className="sp-studio-section">
              <StudioMediaPanel key={`${question.name}-${viewport}`} config={config} viewport={viewport} question={question} canvasRef={canvasRef} onChange={commit} onStart={begin} onEnd={end} zh={zh} selectedImage={selectedImage} onSelectImage={setSelectedImage}
                onSample={() => { setInlineDescription(null); setSampleRevision(v => v + 1); }} onReverse={() => setPreviewOrder(old => ({ ...old, [question.name]: !old[question.name] }))} />
            </Box>}
            {(!question || hasMedia) && !savedMediaLayout(config, viewport, question?.name) && <details className="sp-studio-section" open={!!question}>
              <summary>{question ? copy.media : tr('Default media sizing', '默认媒体尺寸')}</summary>
              {dimension('mediaMaxHeight', t.previewMediaSize, question ? questionSlot.mediaMaxHeight : slot.mediaMaxHeight)}
              {question && dimension('mediaWidth', copy.mediaWidth, questionSlot.mediaWidth, [20, 100], '%')}
              <Typography variant="caption" color="text.secondary">{copy.mediaHelp}</Typography>
            </details>}
            {question && savedMediaLayout(config, viewport, question.name) && <details className="sp-studio-section"><summary>{tr('Image group width', '整组图片宽度')}</summary>{dimension('mediaWidth', copy.mediaWidth, questionSlot.mediaWidth, [20, 100], '%')}</details>}
            <details className="sp-studio-section" open={!hasMedia}>
              <summary>{copy.typography}</summary>
              <PreviewTypographyFields config={config} viewport={viewport} questionName={question?.name} onSelectSurvey={() => { selectContent({ kind: 'survey' }); setInspectorTab('theme'); }} labels={copy} onChange={commit} onStart={begin} onEnd={end} />
            </details>
            <details className="sp-studio-section"><summary>{question ? tr('Reset layout', '恢复布局') : copy.presets}</summary>
              {question ? <><Typography variant="caption" color="text.secondary">{copy.inherited}</Typography><Button size="small" fullWidth sx={{ mt: 1 }} onClick={() => {
                let next = setMediaLayout(configRef.current, viewport, question.name, null);
                ['questionWidth', 'mediaMaxHeight', 'mediaWidth'].forEach((field) => { next = setQuestionLayoutField(next, viewport, question.name, field, null); });
                commit(next);
              }}>{copy.defaults}</Button></> : <>
                <Stack direction="row" spacing={0.5}>{['compact', 'balanced', 'spacious'].map((kind) => <Button key={kind} size="small" variant="outlined" onClick={() => preset(kind)} sx={{ flex: 1, minWidth: 0, fontSize: 11 }}>{copy[kind]}</Button>)}</Stack>
                <Button size="small" fullWidth sx={{ mt: 1 }} onClick={() => { const layout = { ...configRef.current.viewportLayout }; delete layout[viewport]; commit({ ...configRef.current, viewportLayout: layout }); }}>{copy.reset}</Button>
              </>}
            </details>
          </>}
          </Box>
        </Box>
      </Box>
      <Stack direction="row" justifyContent="space-between" useFlexGap flexWrap="wrap" gap={1} className="sp-studio-status"><span><span>{t.previewFormatOnly}</span></span><span role="status">{saveStatus === 'unsaved' ? `${tr('Unsaved changes', '有未保存的修改')} · ` : ''}{saveStatus === 'saved' ? `${copy.saved} · ` : saveStatus === 'error' ? `${copy.saveError} · ` : ''}{currentProject?.releaseManaged ? copy.releaseHint : onSave ? copy.liveHint : copy.draft}{onOpenRelease && currentProject?.releaseManaged && <Button size="small" onClick={onOpenRelease} sx={{ py: 0, fontSize: 11 }}>{copy.release}</Button>}</span></Stack>
    </Box>
  );
}
