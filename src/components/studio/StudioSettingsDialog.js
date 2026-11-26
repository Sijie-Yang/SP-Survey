import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import ConfirmDialog from '../layout/ConfirmDialog';
import { useL } from './studioUi';

function quotaValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? Math.max(1, n) : null;
}

/**
 * Name, description, response limit, delete. Each field saves when you leave
 * it. `onSaveProject(fields)` and `onSaveConfig(patch)` resolve to
 * `{ success, error }` with the error already worded for the researcher.
 */
export default function StudioSettingsDialog({ open, project, config, onClose, onSaveProject, onSaveConfig, onDelete }) {
  const L = useL();
  const [name, setName] = useState(project.name || '');
  const [description, setDescription] = useState(project.description || '');
  const [quota, setQuota] = useState(config?.responseQuota ?? '');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Filled when the dialog opens. A save that lands while the researcher types
  // in another field must not reset what they are typing.
  useEffect(() => {
    if (!open) return;
    setName(project.name || '');
    setDescription(project.description || '');
    setQuota(config?.responseQuota ?? '');
    setError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action) => {
    setError('');
    const result = await action();
    if (result && result.success === false) setError(result.error || L('Saving failed.', '保存失败。'));
  };

  const saveName = () => {
    const next = name.trim();
    if (!next) { setName(project.name || ''); return; }
    if (next !== project.name) run(() => onSaveProject({ name: next }));
  };
  const saveDescription = () => {
    if (description !== (project.description || '')) run(() => onSaveProject({ description }));
  };
  const saveQuota = () => {
    const next = quotaValue(quota);
    setQuota(next ?? '');
    if (next !== (config?.responseQuota ?? null)) run(() => onSaveConfig({ responseQuota: next }));
  };

  const remove = async () => {
    setDeleting(true);
    const result = await onDelete();
    setDeleting(false);
    if (result && result.success === false) {
      setConfirming(false);
      setError(L(`Deleting failed: ${result.error}`, `删除失败：${result.error}`));
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('Settings', '设置')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label={L('Name', '名称')} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} fullWidth />
          <TextField
            label={L('Description', '说明')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            multiline
            minRows={2}
            fullWidth
            helperText={L('Only you see this.', '只有你能看到。')}
          />
          <TextField
            label={L('Response limit', '答卷上限')}
            type="number"
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            onBlur={saveQuota}
            inputProps={{ min: 1 }}
            helperText={L('Leave empty for no limit. The survey closes when the limit is reached.', '留空表示不限。达到上限后问卷自动关闭。')}
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Box>
            <Button color="error" variant="outlined" startIcon={<DeleteOutline />} onClick={() => setConfirming(true)}>
              {L('Delete this study', '删除这个研究')}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {L('Deletes the survey, its images and its settings. This cannot be undone.', '会删除问卷、图片和设置，不能恢复。')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} variant="contained">{L('Done', '完成')}</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        title={L('Delete this study?', '删除这个研究？')}
        message={L(
          `The survey, images and settings of "${project.name || ''}" will be deleted. This cannot be undone.`,
          `「${project.name || ''}」的问卷、图片和设置都会被删除，不能恢复。`,
        )}
        confirmLabel={L('Delete', '删除')}
        cancelLabel={L('Cancel', '取消')}
        confirmColor="error"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
