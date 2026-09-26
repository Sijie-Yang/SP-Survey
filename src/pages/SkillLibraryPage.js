import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Button, Paper, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton,
  Chip, Stack, CircularProgress, Alert, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Tooltip, Accordion, AccordionSummary, AccordionDetails, useMediaQuery,
} from '@mui/material';
import {
  Add, Edit, Delete, Publish, Refresh, Download, Visibility,
  Image, Videocam, Palette, Code, ContentCopy, GraphicEq, ExpandMore,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  listMySkills, deleteSkill, submitSkillForReview, getSkillStatus,
  importPresetSkill, listImportedPresetIds, PRESET_SKILLS,
} from '../lib/skillManager';
import { listPreviewMedia, pickPreviewMedia } from '../lib/previewMediaLibrary';
import SkillPreviewPanel from '../components/admin/SkillPreviewPanel';
import { useRegion } from '../contexts/RegionContext';
import AdminShell from '../components/layout/AdminShell';
import ConfirmDialog from '../components/layout/ConfirmDialog';

const STATUS_LABELS = {
  draft: { en: 'Draft', zh: '草稿', color: 'default' },
  pending: { en: 'In Review', zh: '审核中', color: 'warning' },
  approved: { en: 'Public', zh: '公开', color: 'success' },
};

const CATEGORY_META = {
  image: { en: 'Image', zh: '图片', icon: Image, color: '#1976d2' },
  video: { en: 'Video', zh: '视频', icon: Videocam, color: '#ed6c02' },
  audio: { en: 'Audio', zh: '音频', icon: GraphicEq, color: '#2e7d32' },
  media: { en: 'Multimedia', zh: '多媒体', icon: Palette, color: '#9c27b0' },
};

export default function SkillLibraryPage() {
  const navigate = useNavigate();
  const { language } = useRegion();
  const zh = language === 'zh';
  const mobile = useMediaQuery('(max-width:600px)');
  const [skills, setSkills] = useState([]);
  const [importedPresets, setImportedPresets] = useState([]);
  const [previewMediaPool, setPreviewMediaPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(null);
  const [preview, setPreview] = useState(null);
  const [codeView, setCodeView] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [confirmDialog, setConfirmDialog] = useState(null);
  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    const [mine, presets] = await Promise.all([listMySkills(), listImportedPresetIds()]);
    setSkills(mine);
    setImportedPresets(presets);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Admin-maintained shared media library used to preview skills with real media
  useEffect(() => {
    listPreviewMedia().then(setPreviewMediaPool).catch(() => {});
  }, []);

  const handleDelete = (id, name) => {
    setConfirmDialog({
      title: 'Delete Skill',
      message: `Delete skill "${name}"?`,
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteSkill(id);
          showSnack('Deleted');
          load();
        } catch (err) { showSnack(err.message, 'error'); }
      },
    });
  };

  const handleSubmit = (id, name) => {
    setConfirmDialog({
      title: 'Submit for Review',
      message: `Submit "${name}" for admin review and make it public for everyone?`,
      confirmLabel: 'Submit',
      confirmColor: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await submitSkillForReview(id);
          showSnack(zh ? '已提交审核' : 'Submitted for review');
          load();
        } catch (err) { showSnack(err.message, 'error'); }
      },
    });
  };

  const handleImportPreset = async (presetId) => {
    setImporting(presetId);
    try {
      const result = await importPresetSkill(presetId);
      showSnack(result.updated
        ? (zh ? '已更新到最新版本' : 'Preset updated to the latest version')
        : (zh ? '已加入你的交互库' : 'Added to your library'));
      load();
    } catch (err) { showSnack(err.message, 'error'); }
    finally { setImporting(null); }
  };

  // Platform preview media library only (no SVG demos).
  const mediaForSkill = (skillLike) => {
    const count = skillLike.defaultConfig?.mediaCount ?? 1;
    const mediaType = skillLike.defaultConfig?.mediaType || 'image';
    return count === 0 ? [] : pickPreviewMedia(previewMediaPool, mediaType, count);
  };

  // Pick media once when the dialog opens so re-renders don't reshuffle
  const openPreview = (skillLike, presetId = null) =>
    setPreview({ skill: skillLike, presetId, media: mediaForSkill(skillLike) });

  const copyCode = async (html) => {
    try {
      await navigator.clipboard.writeText(html);
      showSnack('Source code copied to clipboard');
    } catch {
      showSnack('Copy failed — select and copy manually', 'error');
    }
  };

  return (
    <AdminShell
      title={zh ? '我的自定义交互' : 'My custom interactions'}
      backTo="/admin"
      maxWidth="lg"
      actions={(
        <>
          <Button variant="contained" startIcon={<Add />} onClick={() => navigate('/skill-editor')} size="small">
            {zh ? '新建自定义交互' : 'New custom interaction'}
          </Button>
        </>
      )}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {zh ? '常用题型和内置交互可在问卷编辑器直接选择，无需导入。本页保存你定制的交互，可私有复用，也可选择申请公开。' : 'Use built-in tasks directly in Survey Builder; no import is needed. This page stores your custom interactions for private reuse or optional public review.'}
      </Typography>

      <Accordion sx={{ mb: 2 }}><AccordionSummary expandIcon={<ExpandMore />}>{zh ? '从内置交互创建可编辑副本（可选）' : 'Create an editable copy of a built-in task (optional)'}</AccordionSummary><AccordionDetails>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700} color="primary.dark">{zh ? '内置交互' : 'Preset Gallery'}</Typography>
        {previewMediaPool.length > 0 && (
          <Chip size="small" variant="outlined" color="success"
            label={`Preview media library: ${previewMediaPool.length} files`} sx={{ height: 22, fontSize: '0.7rem' }} />
        )}
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>{zh ? '名称' : 'Name'}</TableCell>
              <TableCell>{zh ? '类型' : 'Type'}</TableCell>
              <TableCell>{zh ? '说明' : 'Description'}</TableCell>
              <TableCell>{zh ? '媒体' : 'Media'}</TableCell>
              <TableCell align="center">{zh ? '操作' : 'Actions'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {PRESET_SKILLS.map((preset) => {
              const cat = CATEGORY_META[preset.category] || CATEGORY_META.image;
              const catLabel = zh ? cat.zh : cat.en;
              const CatIcon = cat.icon;
              const imported = importedPresets.includes(preset.id);
              return (
                <TableRow key={preset.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <CatIcon sx={{ fontSize: 16, color: cat.color }} />
                      <Typography variant="body2" fontWeight={600}>{preset.name}</Typography>
                      {imported && (
                        <Chip size="small" label={zh ? '已导入' : 'Imported'} color="success" variant="outlined"
                          sx={{ height: 20, fontSize: '0.68rem' }} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={catLabel} sx={{ height: 22, fontSize: '0.7rem' }} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 320 }}
                      title={preset.description}>
                      {preset.description}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {preset.defaultConfig?.mediaCount || 1} {preset.defaultConfig?.mediaType === 'video'
                        ? (zh ? '个视频' : 'video(s)')
                        : preset.defaultConfig?.mediaType === 'audio'
                          ? (zh ? '个音频' : 'audio(s)')
                          : preset.defaultConfig?.mediaType === 'any'
                            ? (zh ? '个媒体' : 'media')
                            : (zh ? '张图片' : 'image(s)')}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title={zh ? '预览' : 'Preview'}>
                      <IconButton size="small" onClick={() => openPreview(preset, preset.id)}>
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={zh ? '查看源码' : 'View source code'}>
                      <IconButton size="small" onClick={() => setCodeView({ name: preset.name, html: preset.sourceHtml })}>
                        <Code fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={imported
                      ? (zh ? '更新到最新版本' : 'Update to latest version')
                      : (zh ? '加入我的交互库' : 'Add to my library')}>
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={importing === preset.id}
                          onClick={() => handleImportPreset(preset.id)}
                        >
                          {importing === preset.id
                            ? <CircularProgress size={16} />
                            : <Download fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      </AccordionDetails></Accordion>
      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
        <Typography variant="subtitle1" fontWeight={700} color="primary.dark">{zh ? '已保存的自定义交互' : 'Saved custom interactions'}</Typography>
        <Box flex={1} />
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>{zh ? '刷新' : 'Refresh'}</Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>{zh ? '名称' : 'Name'}</TableCell>
                <TableCell>{zh ? '状态' : 'Status'}</TableCell>
                <TableCell>{zh ? '说明' : 'Description'}</TableCell>
                <TableCell>{zh ? '更新时间' : 'Updated'}</TableCell>
                <TableCell align="center">{zh ? '操作' : 'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {skills.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    {zh ? '还没有自定义交互。常规问卷直接使用内置题型即可。' : 'No custom interactions yet. Built-in question types are ready to use in Survey Builder.'}
                  </TableCell>
                </TableRow>
              )}
              {skills.map((s) => {
                const status = getSkillStatus(s);
                const meta = STATUS_LABELS[status];
                return (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{s.id}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={zh ? meta.zh : meta.en} color={meta.color} variant={status === 'draft' ? 'outlined' : 'filled'} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 280 }}>
                        {s.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {s.updatedAt ? new Date(s.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title={zh ? '预览' : 'Preview'}>
                        <IconButton size="small" onClick={() => openPreview(s)}>
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={zh ? '编辑' : 'Edit'}>
                        <IconButton size="small" onClick={() => navigate(`/skill-editor/${s.id}`)}>
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {status === 'draft' && (
                        <Tooltip title={zh ? '提交公开审核' : 'Submit for public review'}>
                          <IconButton size="small" color="primary" onClick={() => handleSubmit(s.id, s.name)}>
                            <Publish fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={zh ? '删除' : 'Delete'}>
                        <IconButton size="small" color="error" onClick={() => handleDelete(s.id, s.name)}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Preview dialog — works for both presets and personal skills */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="md" fullWidth fullScreen={mobile}>
        <DialogTitle>
          {preview?.skill?.name}
          {preview && previewMediaPool.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {zh ? '（使用预览媒体库）' : '(using platform preview media library)'}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{preview?.skill?.description}</Typography>
          {preview && !preview.media?.length && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {zh ? '预览媒体库还没有文件。请先在管理端添加媒体。' : 'No media in the preview media library. Add files in Admin first.'}
            </Alert>
          )}
          {preview && (
            <SkillPreviewPanel key={preview.skill.id || preview.presetId} skill={preview.skill} images={preview.media} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>{zh ? '关闭' : 'Close'}</Button>
          {preview?.presetId && (
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={() => { handleImportPreset(preview.presetId); setPreview(null); }}
            >
              {zh ? '加入我的交互库' : 'Add to My Library'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Source code dialog */}
      <Dialog open={!!codeView} onClose={() => setCodeView(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { height: '85vh' } }}>
        <DialogTitle>
          {zh ? '源码 — ' : 'Source Code — '}{codeView?.name}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {zh ? '（在沙箱 iframe 中运行的独立 HTML）' : '(self-contained HTML running in a sandboxed iframe)'}
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
          <Box
            component="pre"
            sx={{
              m: 0, p: 2, flex: 1, overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.75rem', lineHeight: 1.55,
              bgcolor: '#1e1e2e', color: '#e4e4ef',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {codeView?.html}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<ContentCopy />} onClick={() => copyCode(codeView?.html || '')}>
            {zh ? '复制代码' : 'Copy Code'}
          </Button>
          <Button onClick={() => setCodeView(null)}>{zh ? '关闭' : 'Close'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
        <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>{snack.msg}</Alert>
      </Snackbar>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </AdminShell>
  );
}
