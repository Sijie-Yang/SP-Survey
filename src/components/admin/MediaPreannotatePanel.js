import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Box, Typography, Alert, CircularProgress, TextField, IconButton, Tooltip,
} from '@mui/material';
import { NavigateBefore, NavigateNext, AutoAwesome } from '@mui/icons-material';
import ImageAnnotationCanvas from '../ImageAnnotationWidget';
import {
  loadPreannotation,
  savePreannotation,
  DEFAULT_SAM_LABELS,
  SAM_PREANNOT_MODEL,
} from '../../lib/imageFeaturesR2';
import { normalizeMediaEntry } from '../../lib/mediaUtils';
import { isR2Configured } from '../../lib/r2';

const AUTOSAVE_MS = 700;

function StatusHint({ annotLoading, saveStatus }) {
  let text = '\u00a0'; // keep line height stable
  let color = 'text.secondary';
  let showSpinner = false;
  if (annotLoading) {
    text = 'Loading…';
    showSpinner = true;
  } else if (saveStatus === 'saving') {
    text = 'Saving…';
    showSpinner = true;
  } else if (saveStatus === 'saved') {
    text = 'Saved';
    color = 'success.main';
  } else if (saveStatus === 'error') {
    text = 'Save failed';
    color = 'error.main';
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, minHeight: 20, minWidth: 88 }}>
      {showSpinner ? <CircularProgress size={12} thickness={5} /> : <Box sx={{ width: 12, height: 12 }} />}
      <Typography variant="caption" sx={{ color, fontWeight: 500, letterSpacing: 0.2 }}>
        {text}
      </Typography>
    </Box>
  );
}

/**
 * Always-visible SAM3 pre-annotation block (Media Dataset).
 */
export default function MediaPreannotatePanel({
  mediaEntry,
  imageIndex = 0,
  imageTotal = 0,
  onPrev,
  onNext,
  r2Prefix,
  falKey = '',
  projectId = '',
  onSaved,
}) {
  const entry = normalizeMediaEntry(mediaEntry);
  const [annotLoading, setAnnotLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [value, setValue] = useState({ image: '', shapes: [] });
  const [labelsText, setLabelsText] = useState(DEFAULT_SAM_LABELS.join(', '));
  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(true);
  const saveTimerRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const minHeightRef = useRef(360);
  const stickTopRef = useRef(null);
  const latestRef = useRef({ entry, value, labelsText, r2Prefix });
  latestRef.current = { entry, value, labelsText, r2Prefix };

  const labels = labelsText
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const shapeCount = value?.shapes?.length || 0;
  const canPrev = imageTotal > 0 && imageIndex > 0;
  const canNext = imageTotal > 0 && imageIndex < imageTotal - 1;

  // Keep panel viewport position + canvas min-height stable across image swaps
  useLayoutEffect(() => {
    const el = canvasWrapRef.current;
    const panel = document.getElementById('media-preannotate-panel');
    if (el) {
      const h = el.offsetHeight;
      if (h > 120) {
        minHeightRef.current = Math.max(minHeightRef.current, h);
        el.style.minHeight = `${minHeightRef.current}px`;
      }
    }
    if (panel && stickTopRef.current != null) {
      const delta = panel.getBoundingClientRect().top - stickTopRef.current;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    }
  });

  useEffect(() => {
    if (!entry?.url || !r2Prefix) {
      setValue({ image: '', shapes: [] });
      hydratedRef.current = false;
      skipNextSaveRef.current = true;
      return undefined;
    }
    const panel = document.getElementById('media-preannotate-panel');
    if (panel) stickTopRef.current = panel.getBoundingClientRect().top;

    let cancelled = false;
    hydratedRef.current = false;
    skipNextSaveRef.current = true;
    setValue({ image: entry.url, shapes: [] });
    setAnnotLoading(true);
    setError(null);
    setSaveStatus('idle');

    (async () => {
      try {
        const doc = await loadPreannotation(r2Prefix, entry);
        if (cancelled) return;
        if (doc?.shapes) {
          setValue({ image: entry.url, shapes: doc.shapes });
          if (doc.labels?.length) setLabelsText(doc.labels.join(', '));
        } else {
          setValue({ image: entry.url, shapes: [] });
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) {
          setAnnotLoading(false);
          skipNextSaveRef.current = true;
          hydratedRef.current = true;
          // release stick after layout settles
          requestAnimationFrame(() => {
            requestAnimationFrame(() => { stickTopRef.current = null; });
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.url, entry?.name, r2Prefix]);

  useEffect(() => {
    if (!hydratedRef.current || annotLoading) return undefined;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    if (!entry?.url || !r2Prefix) return undefined;
    if (!isR2Configured()) {
      setError('Supabase Storage is not configured.');
      return undefined;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      const cur = latestRef.current;
      const e = cur.entry;
      if (!e?.url) return;
      const labelList = String(cur.labelsText || '')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        const result = await savePreannotation(cur.r2Prefix, e, {
          image: e.url,
          shapes: cur.value?.shapes || [],
          labels: labelList.length ? labelList : DEFAULT_SAM_LABELS,
        });
        setSaveStatus('saved');
        setError(null);
        onSaved?.(result);
      } catch (err) {
        setSaveStatus('error');
        setError(err.message || String(err));
      }
    }, AUTOSAVE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, labelsText, entry?.url, entry?.name, r2Prefix, annotLoading]);

  const navBtnSx = {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    transition: 'background-color .15s, opacity .15s',
    '&:hover': {
      bgcolor: 'grey.50',
    },
    '&.Mui-disabled': {
      opacity: 0.35,
      bgcolor: 'background.paper',
      borderColor: 'divider',
    },
  };

  return (
    <Box
      id="media-preannotate-panel"
      sx={{
        mb: 3,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2.5,
          py: 1.75,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          borderBottom: '1px solid',
          borderColor: 'divider',
          background: (t) => `linear-gradient(180deg, ${t.palette.grey[50]} 0%, ${t.palette.background.paper} 100%)`,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
            <AutoAwesome sx={{ fontSize: 18, color: 'primary.main' }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Pre-annotate
            </Typography>
            <Typography
              component="span"
              variant="caption"
              sx={{
                px: 0.75,
                py: 0.15,
                borderRadius: 1,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 600,
                letterSpacing: 0.3,
              }}
            >
              SAM3
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 3.25 }}>
            Draw or prompt masks · autosaves to Supabase Storage · not used in live surveys
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
          {imageTotal > 0 && (
            <Typography
              variant="body2"
              sx={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 600,
                color: 'text.secondary',
              }}
            >
              {imageIndex + 1}
              <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}> / {imageTotal}</Box>
            </Typography>
          )}
          <StatusHint annotLoading={annotLoading} saveStatus={saveStatus} />
        </Box>
      </Box>

      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
        )}

        {!imageTotal && (
          <Alert severity="info">
            No images to pre-annotate. Upload images above, or set the type filter to Image.
          </Alert>
        )}

        {!!imageTotal && entry && (
            <Box>
              {!String(falKey || '').trim() && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Add a fal API key in Spatial Intelligence to enable SAM assist. Manual drawing still works.
                </Alert>
              )}

              {/* Meta + labels */}
              <Box sx={{ mb: 2 }}>
                <Typography
                  variant="body2"
                  title={entry.name}
                  sx={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    mb: 0.25,
                  }}
                >
                  {entry.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {shapeCount} shape{shapeCount === 1 ? '' : 's'}
                  {shapeCount > 0 ? ' · autosaved' : ' · click or use SAM to annotate'}
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  label="Labels"
                  placeholder="tree, building, sky, road, person, vehicle…"
                  value={labelsText}
                  onChange={(e) => setLabelsText(e.target.value)}
                  helperText="Comma-separated. Used for Active label / SAM prompts — autosaves with annotations."
                  sx={{
                    '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' },
                  }}
                />
              </Box>

              {/* Stage */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.75, sm: 1.25 },
                  p: { xs: 1, sm: 1.5 },
                  borderRadius: 2,
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Tooltip title="Previous image" placement="left">
                  <span>
                    <IconButton
                      onClick={onPrev}
                      disabled={!canPrev}
                      aria-label="Previous image"
                      sx={navBtnSx}
                    >
                      <NavigateBefore />
                    </IconButton>
                  </span>
                </Tooltip>

                <Box
                  ref={canvasWrapRef}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: minHeightRef.current,
                    position: 'relative',
                    borderRadius: 1.5,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    p: { xs: 1, sm: 1.5 },
                    overflow: 'hidden',
                  }}
                >
                  <Box sx={{ width: '100%' }}>
                    <ImageAnnotationCanvas
                      imageUrl={entry.url}
                      value={value}
                      onChange={setValue}
                      allowedTools={['point', 'line', 'region', 'bbox']}
                      annotationLabels={labels.length ? labels : DEFAULT_SAM_LABELS}
                      enableSamAssist={!!String(falKey || '').trim()}
                      falKey={falKey}
                      projectId={projectId}
                      maxAnnotations={80}
                      centerContent
                    />
                  </Box>
                </Box>

                <Tooltip title="Next image" placement="right">
                  <span>
                    <IconButton
                      onClick={onNext}
                      disabled={!canNext}
                      aria-label="Next image"
                      sx={navBtnSx}
                    >
                      <NavigateNext />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              <Typography
                variant="caption"
                color="text.disabled"
                sx={{ display: 'block', mt: 1, textAlign: 'center' }}
              >
                {SAM_PREANNOT_MODEL}
              </Typography>
            </Box>
        )}
      </Box>
    </Box>
  );
}
