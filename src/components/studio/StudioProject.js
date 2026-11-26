import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { Check, EditOutlined, PhoneIphone, SettingsOutlined, SwapHoriz, ViewListOutlined, DesktopWindowsOutlined } from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import SurveyPreview from '../admin/SurveyPreview';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { useToast } from '../layout/ToastProvider';
import { buildSpSchemeText } from '../../lib/spScheme';
import { setActiveProject } from '../../lib/projectManager';
import { adminProjectPath, studioPathForProject } from '../../lib/adminDeepLink';
import {
  isStudioAiAvailable,
  isStudioLocalMode,
  loadStudioProject,
  loadStudioRelease,
  publishStudioProject,
  removeStudioProject,
  writeStudioProject,
} from '../../lib/studioData';
import {
  libraryFolders,
  pageForAiText,
  pageHtmlForAi,
  projectConfig,
  projectKind,
  projectStatus,
} from '../../lib/studioProject';
import { studioPublishProblems } from '../../lib/studioPublish';
import { classicHasUnsavedEdits } from '../../lib/studioState';
import StudioImportFlow, { CopySpecButton } from './StudioImport';
import StudioMediaCard from './StudioMediaCard';
import StudioAssistant from './StudioAssistant';
import StudioLinkCard from './StudioLinkCard';
import StudioResultsCard from './StudioResultsCard';
import StudioSettingsDialog from './StudioSettingsDialog';
import { StatusChip, StudioCard, useL, useWriteQueue } from './studioUi';

function timeAgo(value, L) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '';
  const minutes = Math.round((Date.now() - t) / 60000);
  if (minutes < 1) return L('just now', '刚刚');
  if (minutes < 60) return L(`${minutes} min ago`, `${minutes} 分钟前`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return L(`${hours} h ago`, `${hours} 小时前`);
  return new Date(t).toLocaleDateString();
}

/** The project name; click to rename, saved on Enter or when leaving the field. */
function ProjectName({ name, onRename, disabled = false }) {
  const L = useL();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => { if (!editing) setValue(name); }, [name, editing]);

  const finish = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== name) onRename(next);
    else setValue(name);
  };
  const start = () => { if (!disabled) setEditing(true); };

  if (editing) {
    return (
      <TextField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.querySelector('input')?.blur();
          if (e.key === 'Escape') { setValue(name); setEditing(false); }
        }}
        autoFocus
        size="small"
        inputProps={{ 'aria-label': L('Study name', '研究名称'), maxLength: 120 }}
        sx={{ maxWidth: 480, width: '100%', '& input': { fontSize: 20, fontWeight: 700, py: 0.5 } }}
      />
    );
  }
  return (
    <Tooltip title={disabled ? '' : L('Click to rename', '点击改名')}>
      <Typography
        component="h1"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={start}
        onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
        data-testid="studio-project-name"
        sx={{
          fontSize: { xs: 20, sm: 22 },
          fontWeight: 700,
          lineHeight: 1.3,
          cursor: disabled ? 'default' : 'text',
          overflowWrap: 'anywhere',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          '& .studio-rename': { opacity: 0, transition: 'opacity .15s' },
          '&:hover .studio-rename, &:focus-visible .studio-rename': { opacity: disabled ? 0 : 1 },
        }}
      >
        {name || L('Untitled study', '未命名研究')}
        <EditOutlined className="studio-rename" fontSize="small" color="action" />
      </Typography>
    </Tooltip>
  );
}

function problemText(problem, L) {
  switch (problem.code) {
    case 'empty':
      return L('There is no survey yet. Drop the page your AI built, or build questions in the classic editor.', '还没有问卷。先把 AI 做好的页面拖进来，或者用经典编辑器搭题。');
    case 'folder-empty':
      return L(`The page uses the folder ${problem.folder}, but it has no images yet. Upload images first.`, `页面要用 ${problem.folder} 文件夹，但里面还没有图片。请先上传图片。`);
    case 'folder-unlinked':
      return L(`The page uses the folder ${problem.folder}, but the folder is not linked to the page yet. Click "Link" in the image library.`, `页面要用 ${problem.folder} 文件夹，但它还没有连接到页面。请在图片库里点「连接」。`);
    case 'slots-empty':
      return L("The page's image list is still empty. Upload images first.", '页面的图片列表还是空的。请先上传图片。');
    case 'media':
      return L(`The question "${problem.question}" does not have enough images. Add images in the image library.`, `题目「${problem.question}」的图片不够。请在图片库里补充图片。`);
    case 'config':
      return L(`The survey settings have an error: ${problem.message}`, `问卷设置有错：${problem.message}`);
    default:
      return problem.message || '';
  }
}

function publishErrorText(result, L) {
  if (result.code === 'site-pages-sql') {
    return L('To publish this page, run supabase/release_site_pages.sql once in Supabase first.', '这个页面要发布，需要先在 Supabase 里运行一次 supabase/release_site_pages.sql。');
  }
  if (result.code === 'site-pages-unsupported') {
    return L('This kind of page cannot be published yet. Please contact the administrator.', '暂时不能发布这种页面，请联系管理员。');
  }
  return L(`Publishing failed: ${result.error}`, `发布失败：${result.error}`);
}

function writeErrorText(result, L) {
  if (result.error === 'not found') return L('This study was not found.', '找不到这个研究。');
  return L(`Saving failed: ${result.error}`, `保存失败：${result.error}`);
}

function importedText(result, replaced, L) {
  const done = replaced ? L('The page was replaced.', '页面已替换。') : L('Imported.', '已导入。');
  const { uploaded = 0, unchanged = 0, replaced: swapped = 0 } = result || {};
  const parts = [
    uploaded ? L(`${uploaded} new image(s) uploaded.`, `新上传了 ${uploaded} 张图片。`) : '',
    swapped ? L(`${swapped} image(s) with the same name replaced the old ones.`, `${swapped} 张同名图片替换了旧的。`) : '',
    unchanged ? L(`${unchanged} image(s) were already in the image library and were not uploaded again.`, `图片库里已经有其中 ${unchanged} 张，没有重复上传。`) : '',
  ];
  return [done, ...parts.filter(Boolean)].join(' ');
}

/**
 * One study on one screen: what participants see, images, link, results.
 * Every write goes through one queue and works on a fresh read of the study;
 * Publish, Settings, rename and upload wait while a write runs.
 */
export default function StudioProject({ projectId, onProjectsChanged = () => {}, onProjectSaved = () => {} }) {
  const L = useL();
  const navigate = useNavigate();
  const auth = useOptionalAuth();
  const { toastSuccess, toastError } = useToast();
  const localMode = isStudioLocalMode();
  const { busy, queue } = useWriteQueue();
  const [project, setProject] = useState(null);
  // The version participants get: undefined while unknown or not release-managed, null when it could not be read.
  const [release, setRelease] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState('desktop');
  const [dialog, setDialog] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishIssue, setPublishIssue] = useState(null);
  const savedRef = useRef(onProjectSaved);
  savedRef.current = onProjectSaved;

  const refresh = useCallback(async () => {
    const next = await loadStudioProject(projectId);
    setProject(next);
    setLoading(false);
    setRelease(undefined);
    if (next?.releaseManaged && !localMode) setRelease(await loadStudioRelease(projectId));
    return next;
  }, [projectId, localMode]);

  useEffect(() => {
    setLoading(true);
    setProject(null);
    setDialog('');
    setPublishIssue(null);
    refresh();
  }, [refresh]);

  const config = useMemo(() => projectConfig(project), [project]);
  const kind = projectKind(config);
  const status = projectStatus(project, release || null);
  const releaseUnknown = Boolean(project?.releaseManaged) && release === null;
  // Read each render: the classic editor of this tab may hold edits Studio must not hide.
  const classicUnsaved = classicHasUnsavedEdits(projectId);
  // The built-in Assistant: one conversation per study, the same one the classic editor shows.
  const aiChat = isStudioAiAvailable();

  /** Apply one change to a fresh read and show the result. Run it inside `queue`. */
  const applyWrite = useCallback(async (change) => {
    const result = await writeStudioProject(projectId, change);
    if (result.success) {
      setProject(result.project);
      if (!result.unchanged) savedRef.current(result.project);
    }
    return result;
  }, [projectId]);

  // `quiet`: the caller shows the error itself (the settings dialog).
  const write = (change, { quiet = false } = {}) => queue(async () => {
    const result = await applyWrite(change);
    if (!result.success && !quiet) toastError(writeErrorText(result, L));
    return result.success ? result : { ...result, error: writeErrorText(result, L) };
  });
  const saveFields = (fields, options) => write(() => ({ fields }), options);
  const saveConfigPatch = (patch, options) => write((_, current) => ({ config: { ...current, ...patch } }), options);

  const runImport = (task) => queue(async () => {
    const result = await task();
    if (result) {
      const next = await refresh();
      if (next) savedRef.current(next);
    }
    return result;
  });

  const openClassic = (tab = null) => {
    setActiveProject(project.id);
    navigate(adminProjectPath(project.id, tab));
  };

  const publish = () => queue(async () => {
    setPublishing(true);
    setPublishIssue(null);
    try {
      // Check and publish what is stored now, after every write before this one.
      const fresh = await loadStudioProject(projectId);
      if (!fresh) {
        setPublishIssue({ error: L('This study was not found.', '找不到这个研究。') });
        return;
      }
      setProject(fresh);
      const problems = await studioPublishProblems(fresh, projectConfig(fresh));
      if (problems.length) {
        setPublishIssue({ problems });
        return;
      }
      const result = await publishStudioProject(projectId);
      if (!result.success) {
        setPublishIssue({ error: publishErrorText(result, L) });
        return;
      }
      const next = await refresh();
      if (next) savedRef.current(next);
      toastSuccess(L('Published. The participant link is ready.', '已发布，参与者链接已经可以用了。'));
    } catch (err) {
      setPublishIssue({ error: L(`Publishing failed: ${err?.message || err}`, `发布失败：${err?.message || err}`) });
    } finally {
      setPublishing(false);
    }
  });

  const remove = () => queue(async () => {
    const result = await removeStudioProject(project.id, { userId: project.userId || auth?.user?.id || null });
    if (!result.success) return result;
    onProjectsChanged();
    navigate(studioPathForProject(), { replace: true });
    return result;
  });

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress aria-label={L('Loading', '加载中')} /></Box>;
  }
  if (!project) {
    return (
      <Box sx={{ maxWidth: 520, mx: 'auto', px: 2, py: 8, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{L('This study was not found.', '找不到这个研究。')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {L('It may have been deleted, or it belongs to another account.', '它可能已经被删除，或者属于别的账号。')}
        </Typography>
        <Button component={RouterLink} to={studioPathForProject()} variant="contained">{L('New study', '新建研究')}</Button>
      </Box>
    );
  }

  const folderCount = libraryFolders(project).length;
  const meta = [
    { page: L('AI page', 'AI 页面'), classic: L('Question by question', '逐题问卷'), empty: L('No survey yet', '还没有问卷') }[kind],
    L(`${folderCount} image folder(s)`, `${folderCount} 个图片文件夹`),
    project.lastModified ? L(`changed ${timeAgo(project.lastModified, L)}`, `上次修改 ${timeAgo(project.lastModified, L)}`) : '',
  ].filter(Boolean).join(' · ');

  const upToDate = status.state === 'published' && !releaseUnknown;
  const publishLabel = publishing
    ? L('Publishing…', '正在发布…')
    : {
      live: L('Publish a fixed version', '发布正式版本'),
      pending: L('Publish new version', '发布新版本'),
      published: L('Publish new version', '发布新版本'),
    }[status.state] || L('Publish and get the link', '发布并获取链接');
  const publishHelp = status.state === 'live'
    ? L('After you publish, participants see only this version. Later changes take effect when you publish again.', '发布后参与者只看到这个版本，之后的修改要再发布才生效。')
    : '';
  // Self-hosted: changes save to the local file; releasing and deploying happen on the Host tab.
  const publishButton = localMode ? (
    <Tooltip title={L('Changes are saved on this computer. To send the survey to participants, release and deploy it on the Host tab.', '修改都保存在本机。要发给参与者，请在「部署」页发布并部署。')}>
      <Button variant="contained" onClick={() => openClassic('host')} data-testid="studio-local-note" sx={{ px: 2.5 }}>
        {L('Release and deploy', '发布并部署')}
      </Button>
    </Tooltip>
  ) : upToDate ? (
    <Button variant="contained" disabled startIcon={<Check />} data-testid="studio-publish">{L('Published', '已发布')}</Button>
  ) : (
    <Tooltip title={publishHelp}>
      <span>
        <Button variant="contained" onClick={publish} disabled={busy} data-testid="studio-publish" sx={{ px: 2.5 }}>
          {publishLabel}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box data-testid="studio-project" sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 3.5 },
          py: { xs: 2, sm: 2.25 },
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: { xs: 1.5, sm: 2 },
        }}
      >
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <ProjectName name={project.name} disabled={busy} onRename={(name) => saveFields({ name })} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{meta}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {!localMode && <StatusChip status={status} long size="medium" />}
          <Button
            variant="outlined"
            startIcon={<SettingsOutlined />}
            onClick={() => setDialog('settings')}
            disabled={busy}
            sx={{ color: 'text.primary', borderColor: 'divider' }}
          >
            {L('Settings', '设置')}
          </Button>
          {publishButton}
        </Box>
      </Box>

      {classicUnsaved && (
        <Alert severity="warning" sx={{ mx: { xs: 2, sm: 3.5 }, mt: { xs: 2, sm: 2.5 } }} data-testid="studio-classic-unsaved">
          {L('The classic editor still has changes that are not saved. ', '经典编辑器里还有未保存的修改，')}
          <Link component="button" type="button" onClick={() => openClassic()} sx={{ verticalAlign: 'baseline' }}>
            {L('Open the classic editor', '打开经典编辑器')}
          </Link>
          {L(' to save or drop them.', '保存或放弃。')}
        </Alert>
      )}

      <Box
        sx={{
          flex: 1,
          p: { xs: 2, sm: 3.5 },
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 360px' },
          gap: { xs: 2, sm: 2.75 },
          alignItems: 'start',
        }}
      >
        <StudioCard
          title={L('What participants see', '参与者看到的样子')}
          data-testid="studio-preview"
          action={kind !== 'empty' ? (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewport}
              onChange={(_, value) => value && setViewport(value)}
              aria-label={L('Preview size', '预览尺寸')}
            >
              <ToggleButton value="desktop" sx={{ px: 1.25, py: 0.25, gap: 0.5 }}>
                <DesktopWindowsOutlined sx={{ fontSize: 16 }} />{L('Computer', '电脑')}
              </ToggleButton>
              <ToggleButton value="mobile" sx={{ px: 1.25, py: 0.25, gap: 0.5 }}>
                <PhoneIphone sx={{ fontSize: 16 }} />{L('Phone', '手机')}
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        >
          {kind === 'empty' ? (
            <Box>
              <StudioImportFlow
                project={project}
                dense
                runImport={runImport}
                onImported={(result) => toastSuccess(importedText(result, false, L))}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {L('Or build it question by question: ', '也可以一题一题地搭：')}
                <Link component="button" type="button" onClick={() => openClassic('builder')} sx={{ verticalAlign: 'baseline' }}>
                  {L('open the classic editor', '打开经典编辑器')}
                </Link>
              </Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {kind === 'page' ? (
                  <>
                    <Button variant="outlined" size="small" startIcon={<SwapHoriz />} onClick={() => setDialog('replace')} disabled={busy}>
                      {L('Use another page', '换一个页面')}
                    </Button>
                    <CopySpecButton
                      size="small"
                      text={() => pageForAiText(buildSpSchemeText(), pageHtmlForAi(config.spSite))}
                      filename="sp-scheme-and-page.md"
                      label={L('Copy for your AI to edit', '复制给 AI 修改')}
                    />
                  </>
                ) : (
                  <Button variant="outlined" size="small" startIcon={<ViewListOutlined />} onClick={() => openClassic('builder')}>
                    {L('Edit in the classic editor', '在经典编辑器里编辑')}
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {L('Try it yourself. Nothing you enter here is saved as a response.', '自己填一遍试试。在这里填的内容不会算作回答。')}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <SurveyPreview
                  config={config}
                  currentProject={project}
                  interactive
                  viewport={viewport}
                  showMediaAssignment={false}
                  hideSiteImportNotice
                />
              </Box>
            </>
          )}
        </StudioCard>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, sm: 2.25 }, minWidth: 0 }}>
          {aiChat && (
            <StudioAssistant
              key={project.id}
              project={project}
              config={config}
              defaultMode={kind === 'classic' ? 'agent' : 'spscheme'}
              onSaved={() => queue(async () => {
                const next = await refresh();
                if (next) savedRef.current(next);
              })}
              onSaveConfig={(next) => write(() => ({ config: next }))}
            />
          )}
          <StudioMediaCard project={project} config={config} busy={busy} queue={queue} applyWrite={applyWrite} />
          <StudioLinkCard
            project={project}
            config={config}
            status={status}
            localMode={localMode}
            onSaveConfig={saveConfigPatch}
          />
          <StudioResultsCard
            project={project}
            config={config}
            status={status}
            localMode={localMode}
            onProjectUpdated={(patch) => setProject((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        </Box>
      </Box>

      <StudioSettingsDialog
        open={dialog === 'settings'}
        project={project}
        config={config}
        onClose={() => setDialog('')}
        onSaveProject={(fields) => saveFields(fields, { quiet: true })}
        onSaveConfig={(patch) => saveConfigPatch(patch, { quiet: true })}
        onDelete={remove}
      />

      <Dialog open={dialog === 'replace'} onClose={() => { if (!busy) setDialog(''); }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('Use another page', '换一个页面')}</DialogTitle>
        <DialogContent>
          {dialog === 'replace' && (
            <StudioImportFlow
              project={project}
              dense
              runImport={runImport}
              onImported={(result) => {
                setDialog('');
                toastSuccess(importedText(result, true, L));
              }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog('')} color="inherit" disabled={busy}>{L('Close', '关闭')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(publishIssue)} onClose={() => setPublishIssue(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('Not ready to publish yet', '还不能发布')}</DialogTitle>
        <DialogContent data-testid="studio-publish-problems">
          {publishIssue?.error && <Alert severity="error">{publishIssue.error}</Alert>}
          {publishIssue?.problems?.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {publishIssue.problems.map((problem, i) => (
                <Typography component="li" variant="body2" key={`${problem.code}-${i}`} sx={{ mb: 0.5, overflowWrap: 'anywhere' }}>
                  {problemText(problem, L)}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPublishIssue(null)} variant="contained">{L('OK', '知道了')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
