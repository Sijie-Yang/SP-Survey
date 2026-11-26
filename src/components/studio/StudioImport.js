import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  TextField,
  Typography,
} from '@mui/material';
import { AutoAwesome, ContentCopy, FileUploadOutlined, PlayCircleOutline } from '@mui/icons-material';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { SP_SCHEME_VERSION, buildSpSchemeText } from '../../lib/spScheme';
import { spSchemeProblems, spSchemeProblemsText, summarizeSpSchemeImport } from '../../lib/spSchemeImport';
import { createStudioProject, isStudioAiAvailable, isStudioLocalMode } from '../../lib/studioData';
import { copyOrDownload, useL } from './studioUi';
import useStudioImport from './useStudioImport';
import { StudioFirstRun } from './StudioAssistant';

const ACCEPT = '.html,.htm,.zip,text/html,application/zip';

/**
 * Copy SP-Scheme for an AI; download it when the clipboard is unavailable.
 * `text` (a string, or a function building it on click) replaces the plain spec.
 */
export function CopySpecButton({ text = null, label, filename = `sp-scheme-${SP_SCHEME_VERSION}.md`, variant = 'outlined', size = 'medium', sx = {} }) {
  const L = useL();
  const [done, setDone] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const value = typeof text === 'function' ? text() : text;
    const result = await copyOrDownload(value ?? buildSpSchemeText(), filename);
    setDone(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(''), 3000);
  };
  return (
    <Button variant={variant} size={size} startIcon={<ContentCopy />} onClick={copy} sx={sx}>
      {done === 'copied' ? L('Copied', '已复制') : done === 'downloaded' ? L('Downloaded as a file', '已下载为文件') : label}
    </Button>
  );
}

/** Dashed area to drop the page (or click to choose it). */
export function StudioDropZone({ onFiles, disabled = false, dense = false }) {
  const L = useL();
  const inputRef = useRef(null);
  const open = () => { if (!disabled) inputRef.current?.click(); };
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={L('Choose the page your AI built', '选择 AI 做好的问卷文件')}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      sx={{
        border: '2px dashed',
        borderColor: 'primary.light',
        borderRadius: '14px',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'action.hover' : '#f7fafe'),
        px: 2,
        py: dense ? 2.5 : { xs: 3, sm: 3.5 },
        textAlign: 'center',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'border-color .15s, background-color .15s',
        '&:hover, &:focus-visible': disabled ? {} : { borderColor: 'primary.main', bgcolor: 'action.hover', outline: 'none' },
      }}
    >
      <FileUploadOutlined color="primary" sx={{ fontSize: dense ? 28 : 34, mb: 0.5 }} />
      <Typography sx={{ fontWeight: 700, fontSize: dense ? 16 : 18, mb: 0.5 }}>
        {L('Drop the survey your AI built here', '把 AI 做好的问卷拖到这里')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {L('One .html or .zip (it may hold images). Images go into the image library. You can also click to choose.', '一个 .html 或 .zip（里面可以带图片），图片会自动放进图片库。也可以点这里选择文件。')}
      </Typography>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="studio-file"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </Box>
  );
}

/** A short study name from the first line of the description. */
export function studyNameFromPrompt(text, fallback) {
  const first = String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
  if (!first) return fallback;
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

/**
 * The new-study box: describe the study (or paste an existing survey); the
 * built-in Assistant (SP-Scheme mode) writes the first version here, then the
 * study opens with the same conversation.
 */
export function StudioAiWriter({ dense = false, onStarted = () => {} }) {
  const L = useL();
  const [text, setText] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const start = async () => {
    const request = text.trim();
    if (!request || starting) return;
    setStarting(true);
    setError('');
    const result = await createStudioProject(studyNameFromPrompt(request, L('New study', '新研究')));
    setStarting(false);
    if (!result?.success) {
      setError(L(`The study could not be created: ${result?.error}`, `没能新建研究：${result?.error}`));
      return;
    }
    setCreated({ project: result.project, request });
  };
  if (created) {
    return (
      <StudioFirstRun
        project={created.project}
        request={created.request}
        onDone={() => onStarted({ projectId: created.project.id, created: true })}
      />
    );
  }
  return (
    <Box data-testid="studio-ai-writer" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        multiline
        minRows={dense ? 2 : 3}
        maxRows={10}
        fullWidth
        value={text}
        disabled={starting}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
        inputProps={{ 'aria-label': L('Describe your study', '描述你的研究'), maxLength: 20000 }}
        placeholder={L(
          'Describe your study, for example: participants compare two street photos and pick the one that looks safer for cycling, 20 pairs, then a few questions about themselves. You can also paste an existing survey.',
          '描述你的研究，例如：参与者两两比较街景照片，选出哪条看起来骑车更安全，做 20 组，最后问几道个人信息。也可以直接贴上已有问卷的题目。',
        )}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<AutoAwesome />} onClick={start} disabled={starting || !text.trim()}>
          {starting ? L('Creating…', '正在新建…') : L('Make it with AI', '让 AI 生成')}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {L('The AI writes a first version here; then the study opens and you can keep chatting to change it.', 'AI 先在这里写出第一版，然后打开研究，可以继续对话修改。')}
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}

function IssueList({ items, max = 8 }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {items.slice(0, max).map((item, i) => (
        <Typography component="li" variant="body2" key={`${item.path}-${i}`} sx={{ overflowWrap: 'anywhere' }}>
          {item.message}
        </Typography>
      ))}
      {items.length > max ? <Typography component="li" variant="body2" color="text.secondary">+ {items.length - max}</Typography> : null}
    </Box>
  );
}

function hostWhy(host, L) {
  if (host.source) return L("the page's own site (images, data)", '页面原来的网站（图片、数据）');
  const kinds = host.kinds || [];
  const parts = [];
  if (kinds.includes('script')) parts.push(L('loads code', '加载代码'));
  if (kinds.includes('style')) parts.push(L('loads styles', '加载样式'));
  if (kinds.includes('request')) parts.push(L('reads or sends data', '读取或发送数据'));
  return parts.join(L(', ', '、'));
}

function verdict(summary, L) {
  if (!summary.ok) {
    return {
      severity: 'error',
      text: L('This file cannot be imported yet. Send the problems below to your AI, then drop the fixed file here.', '这个文件现在导入不了。把下面的问题发给 AI 修改，再把改好的文件拖进来。'),
    };
  }
  if (summary.asIs) {
    return {
      severity: 'warning',
      text: L('Not fully SP-Scheme, so it is imported as it is: the platform only records what participants do and analyses nothing.', '不完全符合 SP-Scheme，会原样导入：平台只记录参与者的作答，不做分析。'),
    };
  }
  const n = summary.questionCount;
  if (summary.matchLevel === 'full') {
    return { severity: 'success', text: L(`Matches SP-Scheme: the platform records and analyses ${n} question(s).`, `符合 SP-Scheme：平台会记录并分析 ${n} 道题。`) };
  }
  if (summary.matchLevel === 'partial') {
    return {
      severity: 'success',
      text: L(
        `Matches SP-Scheme: ${summary.nativeCount} question(s) are recorded and analysed; ${summary.customCount} more are recorded but not analysed.`,
        `符合 SP-Scheme：${summary.nativeCount} 道题会记录并分析；另外 ${summary.customCount} 道题只记录，不分析。`,
      ),
    };
  }
  if (summary.matchLevel === 'custom') {
    return {
      severity: 'info',
      text: L(`Matches SP-Scheme: all ${n} question(s) are recorded the way the page sends them, and not analysed.`, `符合 SP-Scheme：全部 ${n} 道题按页面自己的格式记录，平台不做分析。`),
    };
  }
  return {
    severity: 'info',
    text: L('The page declares no questions: the platform records what it saves and sends, as it is, and analyses nothing.', '页面没有声明题目：平台原样记录页面保存和发出的数据，不做分析。'),
  };
}

function importErrorText(error, L) {
  if (!error) return '';
  const detail = error.message || String(error);
  switch (error.code) {
    case 'media': {
      const first = error.failures?.[0];
      const count = error.failures?.length || 1;
      return L(
        `${count} image(s) could not be uploaded (for example ${first?.name}: ${first?.error}). Nothing was imported. Try again.`,
        `${count} 张图片上传失败（例如 ${first?.name}：${first?.error}）。什么都没有导入，请再试一次。`,
      );
    }
    case 'save':
      return L(`Saving failed: ${detail}. Nothing was imported. Try again.`, `保存失败：${detail}。什么都没有导入，请再试一次。`);
    case 'create':
      return L(`The study could not be created: ${detail}`, `没能新建研究：${detail}`);
    case 'signin':
      return L('Sign in first to import a page with images.', '请先登录，再导入带图片的页面。');
    case 'missing':
      return L('This study was not found.', '找不到这个研究。');
    default:
      return L(`Import failed: ${detail}`, `导入失败：${detail}`);
  }
}

/** What the dropped file becomes, in plain words, with 导入 / 取消. */
export function StudioImportResult({ importer, replacing = false, onImport, onCancel }) {
  const L = useL();
  const { prepared, report, allowed, readError, importError, importing, progress } = importer;
  const summary = useMemo(
    () => (prepared && report ? summarizeSpSchemeImport({ ...prepared, report, allowed }) : null),
    [prepared, report, allowed],
  );
  // The list of sites appears only when the page reaches a site that is not allowed by default.
  const showHosts = Boolean(prepared?.hosts?.some((h) => !prepared.allowed.includes(h.host)));
  const problems = summary?.problems || [];
  const fixText = () => buildSpSchemeText() + spSchemeProblemsText(spSchemeProblems(report, prepared.upload));

  if (readError) {
    return (
      <Box data-testid="studio-import-result">
        <Alert severity="error" sx={{ mb: 2 }}>
          {L(`This file could not be read: ${readError} Drop the .html or .zip your AI gave you.`, `读不出这个文件：${readError} 请拖入 AI 给你的 .html 或 .zip。`)}
        </Alert>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} color="inherit">{L('Back', '返回')}</Button>
        </Box>
      </Box>
    );
  }
  if (!summary) return null;
  const { severity, text } = verdict(summary, L);
  const folders = summary.media.folders;

  return (
    <Box data-testid="studio-import-result" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Alert severity={severity} data-testid="studio-import-verdict">
        {summary.title ? <Typography sx={{ fontWeight: 700, mb: 0.25, overflowWrap: 'anywhere' }}>{summary.title}</Typography> : null}
        {text}
      </Alert>

      {problems.length > 0 && (
        <Box data-testid="studio-import-problems">
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {summary.ok ? L('What your AI can fix so the platform can analyse it', '让 AI 修改下面这些，平台就能分析') : L('Problems to fix', '需要修改的问题')}
          </Typography>
          <IssueList items={problems} />
          <CopySpecButton
            text={fixText}
            size="small"
            label={L('Copy the instructions and these problems for your AI', '复制说明和这些问题给 AI 修改')}
            sx={{ mt: 1 }}
          />
        </Box>
      )}

      {summary.media.files > 0 && (
        <Typography variant="body2" color="text.secondary">
          {L(
            `${summary.media.files} image(s) in the file go into the image library: ${folders.map((f) => `${f.full} (${f.count})`).join(', ')}.`,
            `文件里的 ${summary.media.files} 张图片会放进图片库：${folders.map((f) => `${f.full}（${f.count}）`).join('、')}。`,
          )}
        </Typography>
      )}

      {showHosts && (
        <Box data-testid="studio-import-hosts">
          <Typography variant="subtitle2">{L('Other sites this page uses', '这个页面还会连接的网站')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {L('Only ticked sites can be reached by the page. If unsure, keep the defaults.', '勾选的网站页面才能连接。不确定就保持默认。')}
          </Typography>
          {summary.hosts.map((h) => (
            <FormControlLabel
              key={h.host}
              sx={{ display: 'flex', mr: 0 }}
              control={<Checkbox size="small" checked={h.allowed} onChange={() => importer.toggleHost(h.host)} disabled={importing} />}
              label={<Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{h.host} <Typography component="span" variant="caption" color="text.secondary">· {hostWhy(h, L)}</Typography></Typography>}
            />
          ))}
        </Box>
      )}

      {replacing && summary.ok && (
        <Alert severity="info">
          {L('Importing replaces the current survey page. Responses already collected are kept.', '导入会替换现在的问卷页面。已经收集的回答不受影响。')}
        </Alert>
      )}

      {importing && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {progress?.total
              ? L(`Uploading images ${progress.done}/${progress.total}…`, `正在上传图片 ${progress.done}/${progress.total}…`)
              : L('Importing…', '正在导入…')}
          </Typography>
          <LinearProgress
            variant={progress?.total ? 'determinate' : 'indeterminate'}
            value={progress?.total ? (100 * progress.done) / progress.total : undefined}
          />
        </Box>
      )}

      {importError && <Alert severity="error">{importErrorText(importError, L)}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={onCancel} color="inherit" disabled={importing}>{L('Cancel', '取消')}</Button>
        <Button variant="contained" onClick={onImport} disabled={!summary.ok || importing}>
          {importing ? L('Importing…', '正在导入…') : L('Import', '导入')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Drop zone, "copy instructions" and "start from the example"; after a drop,
 * the result in plain words and the import. `project` null creates a project.
 * `runImport(task)` runs the import (the project screen queues it behind its
 * other writes); it resolves to the task's result.
 */
export default function StudioImportFlow({ project = null, onImported, runImport = (task) => task(), showSteps = false, dense = false }) {
  const L = useL();
  const importer = useStudioImport();
  const auth = useOptionalAuth();
  const [dragging, setDragging] = useState(false);
  const active = Boolean(importer.prepared || importer.readError);
  const userId = auth?.user?.id || (isStudioLocalMode() ? 'local' : null);
  // The built-in AI runs on the server, so it needs a signed-in researcher.
  // Inside a study the AI assistant card does this, so the box is only on the new-study screen.
  const canUseAi = isStudioAiAvailable() && !project;
  const readFiles = (files) => importer.readFiles(files);

  const doImport = async () => {
    const result = await runImport(() => importer.runImport({ project, userId, fallbackName: L('New study', '新研究') }));
    if (result) {
      importer.reset();
      onImported?.(result);
    }
  };

  const dropProps = {
    onDragOver: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    },
    onDrop: (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (!importer.importing) readFiles(e.dataTransfer.files);
    },
  };

  return (
    <Box
      {...dropProps}
      data-testid="studio-import"
      sx={{ borderRadius: '14px', outline: dragging ? '3px solid' : 'none', outlineColor: 'primary.light', outlineOffset: 4 }}
    >
      {active ? (
        <StudioImportResult
          importer={importer}
          replacing={Boolean(project && (project._surveyConfig?.spSite?.html || (project._surveyConfig?.pages || []).some((p) => (p.elements || []).length)))}
          onImport={doImport}
          onCancel={importer.reset}
        />
      ) : (
        <>
          {canUseAi && (
            <>
              <StudioAiWriter dense={dense} onStarted={(result) => onImported?.(result)} />
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                {L('Or use your own AI (ChatGPT, Claude, …)', '或者用你自己的 AI（ChatGPT、Claude 等）')}
              </Typography>
            </>
          )}
          <StudioDropZone onFiles={readFiles} dense={dense || canUseAi} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            <CopySpecButton variant={canUseAi ? 'outlined' : 'contained'} label={L('Copy the instructions for your AI', '复制给 AI 的说明')} />
            <Button variant="outlined" startIcon={<PlayCircleOutline />} onClick={importer.startExample}>
              {L('Start from the example', '从示例开始')}
            </Button>
          </Box>
          {showSteps && !canUseAi && (
            <Box
              component="ol"
              sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, display: 'grid', gap: 0.75 }}
            >
              {[
                [L('Copy the instructions to your AI', '复制说明给 AI'), L('Add your idea or existing survey.', '再给它你的想法或已有调查。')],
                [L('Drop the page it built here', '把它做好的页面拖进来'), L('Try it yourself in the preview.', '在预览里自己填一遍。')],
                [L('Publish and get the link', '发布，拿链接'), L('Answers are saved for you.', '回答自动保存。')],
              ].map(([title, hint], i) => (
                <Box component="li" key={title} sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
                  <Box sx={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                    bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12, fontWeight: 700,
                  }}
                  >
                    {i + 1}
                  </Box>
                  <Typography variant="body2" sx={{ minWidth: 0, lineHeight: 1.45 }}>
                    <Box component="span" sx={{ fontWeight: 700 }}>{title}</Box>
                    <Box component="span" sx={{ color: 'text.secondary' }}>{` · ${hint}`}</Box>
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
