import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
  Alert, CircularProgress, Chip, Box, TextField,
} from '@mui/material';
import ImageAnnotationCanvas from '../ImageAnnotationWidget';
import {
  loadPreannotation,
  savePreannotation,
  DEFAULT_SAM_LABELS,
  SAM_PREANNOT_MODEL,
} from '../../lib/imageFeaturesR2';
import { getMediaId, normalizeMediaEntry } from '../../lib/mediaUtils';
import { isR2Configured } from '../../lib/r2';

/**
 * Researcher SAM3 pre-annotation dialog for one media library image.
 */
export default function MediaPreannotateDialog({
  open,
  onClose,
  mediaEntry,
  r2Prefix,
  falKey = '',
  projectId = '',
  onSaved,
}) {
  const entry = normalizeMediaEntry(mediaEntry);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [value, setValue] = useState({ image: '', shapes: [] });
  const [labelsText, setLabelsText] = useState(DEFAULT_SAM_LABELS.join(', '));

  const labels = labelsText
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!open || !entry?.url || !r2Prefix) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const doc = await loadPreannotation(r2Prefix, entry);
        if (cancelled) return;
        if (doc?.shapes) {
          setValue({ image: entry.url, shapes: doc.shapes });
          if (doc.labels?.length) setLabelsText(doc.labels.join(', '));
        } else {
          setValue({ image: entry.url, shapes: [] });
          setLabelsText(DEFAULT_SAM_LABELS.join(', '));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.url, entry?.name, r2Prefix]);

  const handleSave = async () => {
    if (!isR2Configured()) {
      setError('R2 is not configured.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await savePreannotation(r2Prefix, entry, {
        image: entry.url,
        shapes: value?.shapes || [],
        labels,
      });
      onSaved?.(result);
      onClose?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Pre-annotate — {entry.name}
        <Typography variant="caption" display="block" color="text.secondary">
          SAM3 (fal) · saves to R2 · model {SAM_PREANNOT_MODEL}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
        {!String(falKey || '').trim() && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            Save a fal API key in Spatial Intelligence to use SAM assist. You can still draw manually.
          </Alert>
        )}
        <TextField
          size="small"
          fullWidth
          label="Labels (comma-separated)"
          value={labelsText}
          onChange={(e) => setLabelsText(e.target.value)}
          sx={{ mb: 1.5 }}
          helperText="Assign labels to shapes; open-vocab via SAM text prompt then pick a label."
        />
        <Box sx={{ mb: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" label={`media_id: ${getMediaId(entry)}`} variant="outlined" />
          <Chip size="small" label={`shapes: ${value?.shapes?.length || 0}`} />
        </Box>
        {loading ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Loading…</Typography>
          </Box>
        ) : (
          <ImageAnnotationCanvas
            imageUrl={entry.url}
            value={value}
            onChange={setValue}
            allowedTools={['point', 'line', 'polygon', 'bbox']}
            annotationLabels={labels.length ? labels : DEFAULT_SAM_LABELS}
            enableSamAssist={!!String(falKey || '').trim()}
            falKey={falKey}
            projectId={projectId}
            maxAnnotations={80}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save pre-annotation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
