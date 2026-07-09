import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Container, Typography, AppBar, Toolbar, Button, Paper, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton,
  Chip, Stack, CircularProgress, Alert, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Tooltip,
} from '@mui/material';
import {
  ArrowBack, Add, Edit, Delete, Publish, Refresh, Download, Visibility,
  Image, Videocam, Palette, Code, ContentCopy, GraphicEq, AutoAwesome,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  listMySkills, deleteSkill, submitSkillForReview, getSkillStatus,
  importPresetSkill, listImportedPresetIds, PRESET_SKILLS,
} from '../lib/skillManager';
import { PRESET_SKILL_DEMO_IMAGES } from '../lib/presetSkills';
import { listSkillPreviewMedia, pickPreviewMedia } from '../lib/skillPreviewMedia';
import SkillQuestionFrame from '../components/SkillQuestionWidget';

const STATUS_LABELS = {
  draft: { label: 'Draft', color: 'default' },
  pending: { label: 'In Review', color: 'warning' },
  approved: { label: 'Public', color: 'success' },
};

const CATEGORY_META = {
  image: { label: 'Image', icon: Image, color: '#1976d2' },
  video: { label: 'Video', icon: Videocam, color: '#ed6c02' },
  audio: { label: 'Audio', icon: GraphicEq, color: '#2e7d32' },
  media: { label: 'Multimedia', icon: Palette, color: '#9c27b0' },
};

export default function SkillLibraryPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [importedPresets, setImportedPresets] = useState([]);
  const [previewMediaPool, setPreviewMediaPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(null);
  const [preview, setPreview] = useState(null);
  const [codeView, setCodeView] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
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
    listSkillPreviewMedia().then(setPreviewMediaPool).catch(() => {});
  }, []);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete skill "${name}"?`)) return;
    try {
      await deleteSkill(id);
      showSnack('Deleted');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  const handleSubmit = async (id, name) => {
    if (!window.confirm(`Submit "${name}" for admin review and make it public for everyone?`)) return;
    try {
      await submitSkillForReview(id);
      showSnack('Submitted for review');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  const handleImportPreset = async (presetId) => {
    setImporting(presetId);
    try {
      const result = await importPresetSkill(presetId);
      showSnack(result.updated ? 'Preset updated to the latest version' : 'Added to your library');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
    finally { setImporting(null); }
  };

  // Prefer real media from the admin preview library; fall back to built-in demos.
  const mediaForSkill = (skillLike) => {
    const count = skillLike.defaultConfig?.mediaCount || 1;
    const mediaType = skillLike.defaultConfig?.mediaType || 'image';
    const real = pickPreviewMedia(previewMediaPool, mediaType, count);
    if (real.length) return real;
    if (skillLike.defaultConfig?.demoImages?.length) {
      return skillLike.defaultConfig.demoImages;
    }
    return PRESET_SKILL_DEMO_IMAGES.slice(0, count);
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
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate('/admin')}><ArrowBack /></IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>My Skill Library</Typography>
          <Button variant="outlined" startIcon={<AutoAwesome />} onClick={() => navigate('/skill-editor')} sx={{ mr: 1 }}>
            New with AI
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => navigate('/skill-editor')}>
            New Skill
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Create and manage custom question types here. Use <strong>New with AI</strong> on the editor page
          to generate HTML skills, or import presets from the gallery. After importing a preset, click
          <strong> Update preset</strong> again later to sync new configurable fields.
          Test skills in Survey Builder, then submit for public review.
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="primary.dark">Preset Gallery</Typography>
          {previewMediaPool.length > 0 && (
            <Chip size="small" variant="outlined" color="success"
              label={`Preview media library: ${previewMediaPool.length} files`} sx={{ height: 22, fontSize: '0.7rem' }} />
          )}
        </Stack>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Media</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {PRESET_SKILLS.map((preset) => {
                const cat = CATEGORY_META[preset.category] || CATEGORY_META.image;
                const CatIcon = cat.icon;
                const imported = importedPresets.includes(preset.id);
                return (
                  <TableRow key={preset.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <CatIcon sx={{ fontSize: 16, color: cat.color }} />
                        <Typography variant="body2" fontWeight={600}>{preset.name}</Typography>
                        {imported && (
                          <Chip size="small" label="Imported" color="success" variant="outlined"
                            sx={{ height: 20, fontSize: '0.68rem' }} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={cat.label} sx={{ height: 22, fontSize: '0.7rem' }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 320 }}
                        title={preset.description}>
                        {preset.description}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {preset.defaultConfig?.mediaCount || 1} {preset.defaultConfig?.mediaType === 'video' ? 'video'
                          : preset.defaultConfig?.mediaType === 'audio' ? 'audio'
                          : preset.defaultConfig?.mediaType === 'any' ? 'media' : 'image'}(s)
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Preview">
                        <IconButton size="small" onClick={() => openPreview(preset, preset.id)}>
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="View source code">
                        <IconButton size="small" onClick={() => setCodeView({ name: preset.name, html: preset.sourceHtml })}>
                          <Code fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={imported ? 'Update to latest version' : 'Add to my library'}>
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

        <Divider sx={{ mb: 2 }} />
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
          <Typography variant="subtitle1" fontWeight={700} color="primary.dark">My Skills</Typography>
          <Box flex={1} />
          <Button startIcon={<Refresh />} onClick={load} disabled={loading}>Refresh</Button>
        </Stack>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {skills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      No skills yet — import one from the gallery above, or click "New Skill"
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
                        <Chip size="small" label={meta.label} color={meta.color} variant={status === 'draft' ? 'outlined' : 'filled'} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 280 }}>
                          {s.description || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {s.updatedAt ? new Date(s.updatedAt).toLocaleString('en-US') : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="Preview">
                          <IconButton size="small" onClick={() => openPreview(s)}>
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => navigate(`/skill-editor/${s.id}`)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {status === 'draft' && (
                          <Tooltip title="Submit for public review">
                            <IconButton size="small" color="primary" onClick={() => handleSubmit(s.id, s.name)}>
                              <Publish fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete">
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
      </Container>

      {/* Preview dialog — works for both presets and personal skills */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {preview?.skill?.name}
          {preview && previewMediaPool.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              (using admin preview media library)
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{preview?.skill?.description}</Typography>
          {preview && (
            <SkillQuestionFrame
              skillHtml={preview.skill.sourceHtml}
              config={preview.skill.defaultConfig || {}}
              images={preview.media}
              readOnly
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Close</Button>
          {preview?.presetId && (
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={() => { handleImportPreset(preview.presetId); setPreview(null); }}
            >
              Add to My Library
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Source code dialog */}
      <Dialog open={!!codeView} onClose={() => setCodeView(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { height: '85vh' } }}>
        <DialogTitle>
          Source Code — {codeView?.name}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            (self-contained HTML running in a sandboxed iframe)
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
            Copy Code
          </Button>
          <Button onClick={() => setCodeView(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
        <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
