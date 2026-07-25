import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Alert, CircularProgress, TextField, IconButton, Tooltip,
  Button, Stack, Chip, LinearProgress, FormControl, InputLabel, Select, MenuItem,
  Collapse,
} from '@mui/material';
import {
  NavigateBefore, NavigateNext, AutoAwesome, Stop, Add, Delete,
  ExpandLess, ExpandMore, Replay,
} from '@mui/icons-material';
import ImageAnnotationCanvas from '../ImageAnnotationWidget';
import PreannotateLabelManager from './PreannotateLabelManager';
import {
  loadPreannotation,
  savePreannotation,
  DEFAULT_SAM_LABELS,
  SAM_PREANNOT_MODEL,
} from '../../lib/imageFeaturesR2';
import {
  normalizeLabelDefs,
  labelNames,
  labelColorMap,
  remapShapeLabels,
  clearShapeLabel,
  removeShapesWithLabel,
  defaultLabelDefs,
} from '../../lib/preannotateLabels';
import { migrateLabelAcrossMediaList } from '../../lib/preannotateLabelMigrate';
import {
  runBatchSamText,
  normalizeBatchSamJobs,
  estimateBatchSamCalls,
  undoBatchRun,
  acceptBatchRun,
  BATCH_MODE_REPLACE_SAME_PROMPT,
  BATCH_MODE_SKIP_COMPLETED,
  BATCH_MODE_APPEND_DEDUPE,
} from '../../lib/batchSamText';
import { findDuplicateShapePairs } from '../../lib/annotationGeometry';
import { normalizeMediaEntry } from '../../lib/mediaUtils';
import { isR2Configured } from '../../lib/r2';

const AUTOSAVE_MS = 700;

function newBatchJobRow(partial = {}) {
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    prompt: partial.prompt || '',
    label: partial.label || '',
  };
}

function StatusHint({ annotLoading, saveStatus }) {
  let text = '\u00a0';
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

function SectionHeader({ title, open, onToggle, badge }) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        cursor: 'pointer',
        py: 0.75,
        px: 0.25,
        userSelect: 'none',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
      {badge}
      {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
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
  /** name + review_status when a preannotation loads (hydrate parent filter map) */
  onReviewStatusKnown,
  mediaList = [],
  selectedNames = null,
  labelDefs: labelDefsProp = null,
  onLabelDefsChange,
  /** Notify parent of last batch for review queue */
  onBatchComplete,
  /** Active batch closed (accepted / cancelled / undone) — clear parent queue */
  onBatchClosed,
  reviewFilter = null,
  reviewQueueCount = 0,
  reviewQueueIndex = 0,
  hasLastBatch = false,
  onReviewFilterChange,
  onFocusReviewNext,
  onFocusReviewPrev,
}) {
  const entry = normalizeMediaEntry(mediaEntry);
  const [annotLoading, setAnnotLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [value, setValue] = useState({ image: '', shapes: [] });
  const [reviewStatus, setReviewStatus] = useState(null);
  const [localLabels, setLocalLabels] = useState(() => defaultLabelDefs());
  const labelDefs = labelDefsProp != null ? normalizeLabelDefs(labelDefsProp) : localLabels;
  const setLabelDefs = (next, meta) => {
    const normalized = normalizeLabelDefs(next);
    if (onLabelDefsChange) onLabelDefsChange(normalized, meta);
    else setLocalLabels(normalized);
  };

  const names = useMemo(() => labelNames(labelDefs), [labelDefs]);
  const colors = useMemo(() => labelColorMap(labelDefs), [labelDefs]);

  const [labelsOpen, setLabelsOpen] = useState(true);
  const [batchOpen, setBatchOpen] = useState(false);

  const [batchJobs, setBatchJobs] = useState(() => [newBatchJobRow()]);
  const [batchScope, setBatchScope] = useState('all');
  const [batchMode, setBatchMode] = useState(BATCH_MODE_REPLACE_SAME_PROMPT);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchMessage, setBatchMessage] = useState(null);
  const [lastBatch, setLastBatch] = useState(null);
  const [batchHistory, setBatchHistory] = useState([]);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const activeBatchOpen = !!(
    lastBatch?.batchRunId
    && !['accepted', 'cancelled', 'undone'].includes(lastBatch.status)
  );
  const batchAbortRef = useRef(false);
  const migrateAbortRef = useRef(false);
  const validBatchJobs = useMemo(() => normalizeBatchSamJobs(batchJobs), [batchJobs]);

  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(true);
  const saveTimerRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const minHeightRef = useRef(360);
  const stickTopRef = useRef(null);
  const latestRef = useRef({ entry, value, names, r2Prefix, reviewStatus });
  latestRef.current = { entry, value, names, r2Prefix, reviewStatus };

  const shapeCount = value?.shapes?.length || 0;
  const canPrev = imageTotal > 0 && imageIndex > 0;
  const canNext = imageTotal > 0 && imageIndex < imageTotal - 1;
  const selectedCount = selectedNames instanceof Set
    ? selectedNames.size
    : (Array.isArray(selectedNames) ? selectedNames.length : 0);

  const callEstimate = useMemo(() => {
    const n = batchScope === 'current' ? 1
      : batchScope === 'selected' ? selectedCount
        : (mediaList.length || imageTotal);
    return estimateBatchSamCalls(n, validBatchJobs.length);
  }, [batchScope, selectedCount, mediaList.length, imageTotal, validBatchJobs.length]);

  const dupPairs = useMemo(
    () => findDuplicateShapePairs(value?.shapes || [], { iouThreshold: 0.7 }),
    [value?.shapes],
  );

  useEffect(() => {
    setBatchJobs((prev) => prev.map((j) => (
      j.label && !names.includes(j.label) ? { ...j, label: '' } : j
    )));
  }, [names]);

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
      setReviewStatus(null);
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
          setReviewStatus(doc.review_status || null);
          onReviewStatusKnown?.(entry.name, doc.review_status || null);
          if (labelDefsProp == null && doc.labels?.length) {
            setLocalLabels(normalizeLabelDefs(doc.labels));
          }
        } else {
          setValue({ image: entry.url, shapes: [] });
          setReviewStatus(null);
          onReviewStatusKnown?.(entry.name, null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) {
          setAnnotLoading(false);
          skipNextSaveRef.current = true;
          hydratedRef.current = true;
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
    if (!hydratedRef.current || annotLoading || batchBusy || migrateBusy) return undefined;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    if (!entry?.url || !r2Prefix) return undefined;
    if (!isR2Configured()) {
      setError('R2 is not configured.');
      return undefined;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      const cur = latestRef.current;
      const e = cur.entry;
      if (!e?.url) return;
      try {
        const result = await savePreannotation(cur.r2Prefix, e, {
          image: e.url,
          shapes: cur.value?.shapes || [],
          labels: cur.names.length ? cur.names : DEFAULT_SAM_LABELS,
          review_status: cur.reviewStatus,
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
  }, [value, names.join('\0'), reviewStatus, entry?.url, entry?.name, r2Prefix, annotLoading, batchBusy, migrateBusy]);

  const handleLabelsChange = async (next, meta) => {
    setLabelDefs(next, meta);
    const labelList = labelNames(next);

    if (meta?.type === 'rename' && meta.oldName && meta.newName && meta.oldName !== meta.newName) {
      skipNextSaveRef.current = false;
      setValue((prev) => ({
        ...prev,
        shapes: remapShapeLabels(prev.shapes, meta.oldName, meta.newName),
      }));
      setMigrateBusy(true);
      migrateAbortRef.current = false;
      try {
        const summary = await migrateLabelAcrossMediaList(r2Prefix, mediaList, {
          action: 'rename',
          oldName: meta.oldName,
          newName: meta.newName,
          labelNames: labelList,
          shouldAbort: () => migrateAbortRef.current,
        });
        setBatchMessage(`Renamed “${meta.oldName}” → “${meta.newName}” on ${summary.changed} image(s).`);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setMigrateBusy(false);
      }
    }

    if (meta?.type === 'delete' && meta.name) {
      const mode = meta.deleteMode === 'delete_shapes' ? 'delete_shapes' : 'clear';
      skipNextSaveRef.current = false;
      setValue((prev) => ({
        ...prev,
        shapes: mode === 'delete_shapes'
          ? removeShapesWithLabel(prev.shapes, meta.name)
          : clearShapeLabel(prev.shapes, meta.name),
      }));
      setMigrateBusy(true);
      try {
        const summary = await migrateLabelAcrossMediaList(r2Prefix, mediaList, {
          action: mode,
          oldName: meta.name,
          labelNames: labelList,
        });
        setBatchMessage(
          mode === 'delete_shapes'
            ? `Deleted shapes with “${meta.name}” on ${summary.changed} image(s).`
            : `Cleared label “${meta.name}” on ${summary.changed} image(s).`,
        );
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setMigrateBusy(false);
      }
    }
  };

  const resolveBatchTargets = () => {
    const pool = (mediaList || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url);
    if (batchScope === 'current') return entry?.url ? [entry] : [];
    if (batchScope === 'selected') {
      const set = selectedNames instanceof Set
        ? selectedNames
        : new Set(Array.isArray(selectedNames) ? selectedNames : []);
      return pool.filter((m) => set.has(m.name));
    }
    return pool;
  };

  const updateBatchJob = (id, patch) => {
    setBatchJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  };

  const runBatch = async ({ resumeId = null, retryFailuresOnly = false } = {}) => {
    if (!String(falKey || '').trim()) {
      setError('Add a fal API key in Spatial Intelligence to run batch SAM Text.');
      return;
    }
    if (!validBatchJobs.length && !resumeId) {
      setError('Add at least one complete pair: Text noun + Label.');
      return;
    }
    const targets = resolveBatchTargets();
    if (!targets.length && !resumeId) {
      setError(batchScope === 'selected'
        ? 'No gallery selection — select images first, or switch scope to All.'
        : 'No images to process.');
      return;
    }

    batchAbortRef.current = false;
    setBatchBusy(true);
    setBatchOpen(true);
    setBatchMessage(null);
    setError(null);
    setBatchProgress({ done: 0, total: Math.max(1, targets.length * validBatchJobs.length), name: '' });
    try {
      const summary = await runBatchSamText({
        r2Prefix,
        mediaList: targets,
        jobs: validBatchJobs,
        mode: batchMode,
        scope: batchScope,
        batchRunId: resumeId || undefined,
        retryFailuresOnly,
        labelNames: names.length ? names : DEFAULT_SAM_LABELS,
        falKey,
        projectId,
        onProgress: (p) => setBatchProgress(p),
        shouldAbort: () => batchAbortRef.current,
        onItemSaved: (result, media) => {
          onSaved?.(result);
          if (media?.name && entry?.name && media.name === entry.name) {
            skipNextSaveRef.current = true;
            setValue({
              image: entry.url,
              shapes: result?.annotation?.shapes || [],
            });
            setReviewStatus(result?.annotation?.review_status || 'needs_review');
          }
        },
        onBatchCheckpoint: (doc) => setLastBatch(doc),
      });
      setLastBatch(summary.batch || lastBatch);
      onBatchComplete?.(summary.batch || summary);
      const failHint = summary.failed ? ` ${summary.failed} failed.` : '';
      setBatchMessage(
        `${summary.aborted ? 'Stopped. ' : ''}`
        + `+${summary.polygonsAdded} poly / −${summary.polygonsRemoved || 0} replaced`
        + ` on ${summary.imagesWithAdds}/${summary.total} image(s)`
        + ` · mode ${summary.mode}`
        + (summary.zeroResult ? ` · ${summary.zeroResult} zero-result` : '')
        + failHint
        + (summary.batchRunId ? ` · id ${summary.batchRunId}` : ''),
      );
      if (summary.imagesWithAdds > 0) {
        onReviewFilterChange?.('last_batch');
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
    }
  };

  const reloadCurrentAnnotation = async () => {
    if (!entry?.url || !r2Prefix) return;
    const doc = await loadPreannotation(r2Prefix, entry);
    skipNextSaveRef.current = true;
    setValue({ image: entry.url, shapes: doc?.shapes || [] });
    setReviewStatus(doc?.review_status || null);
    onReviewStatusKnown?.(entry.name, doc?.review_status || null);
  };

  /** End active batch: archive to history, clear noun→label rows, drop review queue. */
  const closeActiveBatchSession = (closedBatch, message, { keepProgress = false } = {}) => {
    if (closedBatch?.batchRunId) {
      setBatchHistory((prev) => {
        const rest = prev.filter((b) => b.batchRunId !== closedBatch.batchRunId);
        return [closedBatch, ...rest].slice(0, 12);
      });
    }
    setLastBatch(null);
    setBatchJobs([newBatchJobRow()]);
    if (!keepProgress) setBatchProgress(null);
    onReviewFilterChange?.(null);
    onBatchComplete?.(null);
    onBatchClosed?.(closedBatch || null);
    if (message) setBatchMessage(message);
  };

  const applyCancelToCurrentCanvas = (batch) => {
    if (!batch?.batchRunId || !entry?.name) return;
    const img = (batch.images || []).find((i) => i.name === entry.name);
    if (!img) return;
    const addedSet = new Set(img.addedShapeIds || []);
    const restored = Array.isArray(img.removedShapes) ? img.removedShapes : [];
    skipNextSaveRef.current = true;
    setValue((prev) => {
      let next = (prev.shapes || []).filter(
        (s) => !addedSet.has(s.id) && s.batchRunId !== batch.batchRunId,
      );
      if (restored.length) {
        const existingIds = new Set(next.map((s) => s.id));
        restored.forEach((s) => {
          if (s?.id && !existingIds.has(s.id)) next.push(s);
        });
      }
      return { ...prev, image: prev.image || entry.url, shapes: next };
    });
    setReviewStatus(null);
    onReviewStatusKnown?.(entry.name, null);
  };

  const handleAcceptAllBatch = () => {
    const snapshot = lastBatch;
    const id = snapshot?.batchRunId;
    if (!id) return;
    const n = snapshot?.summary?.imagesWithAdds || 0;
    if (!window.confirm(
      `Accept all & close this batch?\n\nMarks ${n || 'touched'} image(s) Accepted, keeps polygons, clears Text→label rows, and archives the batch.`,
    )) return;
    const closedAt = new Date().toISOString();
    const optimistic = {
      ...snapshot,
      status: 'accepted',
      accepted_at: closedAt,
      closed_at: closedAt,
    };
    const total = Math.max(1, n || (snapshot.images || []).filter((i) => (
      (i.status === 'done' || i.status === 'partial')
      && (i.polygonsAdded > 0 || (i.addedShapeIds || []).length)
    )).length);
    setError(null);
    setBatchOpen(true);
    setBatchProgress({ done: 0, total, name: '', phase: 'close', label: 'Accepting' });
    setReviewStatus('accepted');
    onReviewStatusKnown?.(entry?.name, 'accepted');
    closeActiveBatchSession(optimistic, `Accepting ${total} image(s)…`, { keepProgress: true });
    acceptBatchRun(r2Prefix, id, {
      labelNames: names.length ? names : DEFAULT_SAM_LABELS,
      onProgress: (p) => setBatchProgress({ ...p, phase: 'close', label: 'Accepting' }),
      onItemSaved: (result) => onSaved?.(result),
    }).then(({ batch }) => {
      if (batch?.batchRunId) {
        setBatchHistory((prev) => {
          const rest = prev.filter((b) => b.batchRunId !== batch.batchRunId);
          return [batch, ...rest].slice(0, 12);
        });
      }
      setBatchProgress(null);
      setBatchMessage(`Batch accepted · ${id}`);
    }).catch((err) => {
      setBatchProgress(null);
      setError(err.message || String(err));
    });
  };

  const handleCancelAllBatch = () => {
    const snapshot = lastBatch;
    const id = snapshot?.batchRunId;
    if (!id) return;
    if (!window.confirm(
      'Delete all & close this batch?\n\nRemoves polygons added by this batch (restores replaced shapes), clears Text→label rows, and archives the batch as cancelled.',
    )) return;
    const closedAt = new Date().toISOString();
    const optimistic = {
      ...snapshot,
      status: 'cancelled',
      closed_at: closedAt,
      undone_at: closedAt,
    };
    const total = Math.max(1, (snapshot.images || []).length);
    setError(null);
    setBatchOpen(true);
    setBatchProgress({ done: 0, total, name: '', phase: 'close', label: 'Deleting' });
    applyCancelToCurrentCanvas(snapshot);
    closeActiveBatchSession(optimistic, `Deleting batch shapes…`, { keepProgress: true });
    undoBatchRun(r2Prefix, id, {
      labelNames: names.length ? names : DEFAULT_SAM_LABELS,
      finalStatus: 'cancelled',
      onProgress: (p) => setBatchProgress({ ...p, phase: 'close', label: 'Deleting' }),
      onItemSaved: (result, media) => {
        onSaved?.(result);
        if (media?.name && entry?.name && media.name === entry.name) {
          skipNextSaveRef.current = true;
          setValue({
            image: entry.url,
            shapes: result?.annotation?.shapes || [],
          });
          setReviewStatus(result?.annotation?.review_status || null);
        }
      },
    }).then(({ batch }) => {
      if (batch?.batchRunId) {
        setBatchHistory((prev) => {
          const rest = prev.filter((b) => b.batchRunId !== batch.batchRunId);
          return [batch, ...rest].slice(0, 12);
        });
      }
      setBatchProgress(null);
      setBatchMessage(`Batch cancelled · ${id}`);
    }).catch((err) => {
      setBatchProgress(null);
      setError(err.message || String(err));
      reloadCurrentAnnotation().catch(() => {});
    });
  };

  const setReview = (status) => {
    skipNextSaveRef.current = false;
    setReviewStatus(status);
  };

  const selectDuplicateWeaker = () => {
    if (!dupPairs.length) return;
    const drop = new Set();
    const byId = new Map((value.shapes || []).map((s) => [s.id, s]));
    dupPairs.forEach(({ aId, bId }) => {
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (!a || !b) return;
      const area = (s) => {
        const xs = (s.points || []).map((p) => p.x);
        const ys = (s.points || []).map((p) => p.y);
        if (!xs.length) return 0;
        return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      };
      drop.add(area(a) >= area(b) ? bId : aId);
    });
    skipNextSaveRef.current = false;
    setValue((prev) => ({
      ...prev,
      shapes: (prev.shapes || []).filter((s) => !drop.has(s.id)),
    }));
  };

  const navBtnSx = {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    '&:hover': { bgcolor: 'grey.50' },
    '&.Mui-disabled': { opacity: 0.35 },
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
            <Chip size="small" color="primary" label="SAM3" sx={{ height: 22, fontWeight: 700 }} />
            {reviewStatus && (
              <Chip
                size="small"
                color={reviewStatus === 'accepted' ? 'success' : 'warning'}
                label={reviewStatus === 'accepted' ? 'Accepted' : 'Needs review'}
                sx={{ height: 22 }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 3.25 }}>
            Labels & Batch fold away · canvas stays · batch default replaces same Text prompt
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
          {imageTotal > 0 && (
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'text.secondary' }}>
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
        {batchMessage && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setBatchMessage(null)}>{batchMessage}</Alert>
        )}
        {migrateBusy && (
          <Alert severity="info" sx={{ mb: 2 }}>Updating labels across project images…</Alert>
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

            <Typography
              variant="body2"
              title={entry.name}
              sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mb: 0.25 }}
            >
              {entry.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {shapeCount} shape{shapeCount === 1 ? '' : 's'}
              {dupPairs.length ? ` · ${dupPairs.length} possible duplicate pair(s)` : ''}
            </Typography>

            {/* Labels (collapsible) */}
            <Box sx={{ mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, px: 1.5, py: 0.5 }}>
              <SectionHeader
                title="Labels"
                open={labelsOpen}
                onToggle={() => setLabelsOpen((v) => !v)}
                badge={<Chip size="small" label={`${names.length}`} sx={{ height: 20 }} />}
              />
              <Collapse in={labelsOpen}>
                <Box sx={{ pb: 1.25 }}>
                  <PreannotateLabelManager
                    labels={labelDefs}
                    onChange={handleLabelsChange}
                    disabled={batchBusy || migrateBusy}
                  />
                </Box>
              </Collapse>
            </Box>

            {/* Batch SAM Text (collapsible; auto-open when running) */}
            <Box
              sx={{
                mb: 2,
                border: '1px solid',
                borderColor: 'secondary.light',
                borderRadius: 1.5,
                px: 1.5,
                py: 0.5,
                bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(156,39,176,0.08)' : 'rgba(156,39,176,0.04)'),
              }}
            >
              <SectionHeader
                title="Batch SAM Text"
                open={batchOpen || batchBusy}
                onToggle={() => setBatchOpen((v) => !v)}
                badge={activeBatchOpen ? (
                  <Chip size="small" color="secondary" variant="outlined" label="active" sx={{ height: 20 }} />
                ) : (batchHistory.length ? (
                  <Chip size="small" variant="outlined" label={`${batchHistory.length} in history`} sx={{ height: 20 }} />
                ) : null)}
              />
              <Collapse in={batchOpen || batchBusy}>
                <Box sx={{ pb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Each row: text noun → label. Default mode replaces prior SAM Text results with the same prompt (keeps manual / click / box).
                    After a run, Accept all or Delete all closes the batch into history and clears these rows.
                  </Typography>

                  <Stack spacing={1} sx={{ mb: 1.25 }}>
                    {batchJobs.map((job, idx) => (
                      <Stack key={job.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 28 }}>#{idx + 1}</Typography>
                        <TextField
                          size="small"
                          label="Text noun *"
                          value={job.prompt}
                          disabled={batchBusy}
                          onChange={(e) => updateBatchJob(job.id, { prompt: e.target.value })}
                          sx={{ minWidth: 140, flex: 1 }}
                        />
                        <FormControl size="small" sx={{ minWidth: 150 }} required>
                          <InputLabel>Label *</InputLabel>
                          <Select
                            label="Label *"
                            value={job.label}
                            disabled={batchBusy || !names.length}
                            onChange={(e) => updateBatchJob(job.id, { label: e.target.value })}
                          >
                            {names.map((n) => (
                              <MenuItem key={n} value={n}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colors[n] }} />
                                  <span>{n}</span>
                                </Stack>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <IconButton
                          size="small"
                          disabled={batchBusy || batchJobs.length <= 1}
                          onClick={() => setBatchJobs((prev) => prev.filter((j) => j.id !== job.id))}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
                    <Button size="small" startIcon={<Add />} disabled={batchBusy} onClick={() => setBatchJobs((p) => [...p, newBatchJobRow()])}>
                      Add noun→label
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={batchBusy || !names.length}
                      onClick={() => setBatchJobs(names.map((n) => newBatchJobRow({ prompt: n, label: n })))}
                    >
                      Prefill from labels
                    </Button>
                  </Stack>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                      <InputLabel>Mode</InputLabel>
                      <Select label="Mode" value={batchMode} disabled={batchBusy} onChange={(e) => setBatchMode(e.target.value)}>
                        <MenuItem value={BATCH_MODE_REPLACE_SAME_PROMPT}>Replace same prompt (default)</MenuItem>
                        <MenuItem value={BATCH_MODE_SKIP_COMPLETED}>Skip if prompt already done</MenuItem>
                        <MenuItem value={BATCH_MODE_APPEND_DEDUPE}>Append + deduplicate</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Scope</InputLabel>
                      <Select label="Scope" value={batchScope} disabled={batchBusy} onChange={(e) => setBatchScope(e.target.value)}>
                        <MenuItem value="all">All images ({mediaList.length || imageTotal})</MenuItem>
                        <MenuItem value="selected" disabled={!selectedCount}>Gallery selected ({selectedCount})</MenuItem>
                        <MenuItem value="current">Current only</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Estimate: {callEstimate.images} images × {callEstimate.jobs} pairs = <strong>{callEstimate.calls}</strong> SAM calls
                    {' '}(≤{callEstimate.maxMasksPerCall} masks each)
                  </Typography>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="contained"
                      color="secondary"
                      disabled={
                        batchBusy
                        || batchProgress?.phase === 'close'
                        || !validBatchJobs.length
                        || !String(falKey || '').trim()
                      }
                      onClick={() => runBatch()}
                    >
                      {batchBusy ? 'Running…' : `Run batch (${validBatchJobs.length})`}
                    </Button>
                    {batchBusy && (
                      <Button size="small" color="warning" variant="outlined" startIcon={<Stop />} onClick={() => { batchAbortRef.current = true; }}>
                        Stop
                      </Button>
                    )}
                    {!batchBusy && activeBatchOpen && lastBatch?.status === 'aborted' && (
                      <Button size="small" variant="outlined" startIcon={<Replay />} onClick={() => runBatch({ resumeId: lastBatch.batchRunId })}>
                        Resume
                      </Button>
                    )}
                    {!batchBusy && activeBatchOpen && lastBatch?.failures?.length > 0 && (
                      <Button size="small" variant="outlined" startIcon={<Replay />} onClick={() => runBatch({ resumeId: lastBatch.batchRunId, retryFailuresOnly: true })}>
                        Retry failures
                      </Button>
                    )}
                    {activeBatchOpen && (lastBatch?.summary?.imagesWithAdds > 0) && (
                      <Button size="small" variant="contained" onClick={() => onReviewFilterChange?.('last_batch')}>
                        Review {lastBatch.summary.imagesWithAdds} images
                      </Button>
                    )}
                    {!batchBusy && activeBatchOpen && (
                      <Button size="small" color="success" variant="contained" onClick={handleAcceptAllBatch}>
                        Accept all & close
                      </Button>
                    )}
                    {!batchBusy && activeBatchOpen && (
                      <Button size="small" color="error" variant="outlined" startIcon={<Delete />} onClick={handleCancelAllBatch}>
                        Delete all & close
                      </Button>
                    )}
                  </Stack>

                  {batchHistory.length > 0 && (
                    <Box sx={{ mt: 1.25 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                        Batch history (this session)
                      </Typography>
                      <Stack spacing={0.5}>
                        {batchHistory.map((b) => {
                          const s = b.summary || {};
                          return (
                            <Typography key={b.batchRunId} variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                              {b.status || '?'}
                              {' · '}
                              +{s.polygonsAdded ?? 0} poly / {s.imagesWithAdds ?? 0} imgs
                              {s.failed ? ` · ${s.failed} fail` : ''}
                              {' · '}
                              {b.batchRunId}
                            </Typography>
                          );
                        })}
                      </Stack>
                    </Box>
                  )}

                  {batchProgress && (
                    <Box sx={{ mt: 1.25 }}>
                      <Typography variant="caption" color="text.secondary">
                        {batchProgress.phase === 'close'
                          ? `${batchProgress.label || 'Syncing'} ${batchProgress.done}/${batchProgress.total}`
                          : `${batchProgress.done}/${batchProgress.total}`}
                        {batchProgress.name ? ` · ${batchProgress.name}` : ''}
                        {batchProgress.prompt ? ` · “${batchProgress.prompt}”→${batchProgress.label || '?'}` : ''}
                        {batchProgress.added ? ` · +${batchProgress.added}` : ''}
                        {batchProgress.error ? ` · ${batchProgress.error}` : ''}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        color={batchProgress.phase === 'close' ? 'success' : 'secondary'}
                        value={batchProgress.total
                          ? Math.min(100, (100 * batchProgress.done) / batchProgress.total)
                          : 0}
                        sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
                      />
                    </Box>
                  )}
                </Box>
              </Collapse>
            </Box>

            {/* Review queue — only while a batch is active for review, or a filter is on */}
            {(activeBatchOpen || hasLastBatch || reviewFilter) && (
              <Box
                sx={{
                  mb: 1.5,
                  p: 1.5,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: 'info.light',
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(2,136,209,0.08)' : 'rgba(2,136,209,0.04)'),
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Review queue
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Filter which images to flip through with Prev/Next (or the side arrows). Pick a filter, then check each image below.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {[
                    {
                      id: 'last_batch',
                      label: 'Got new polygons',
                      hint: 'Last batch added shapes on these images — check quality',
                      requiresBatch: true,
                    },
                    {
                      id: 'needs_review',
                      label: 'Marked Needs fix',
                      hint: 'Only images where you clicked Needs fix (or batch auto-marked). Accept removes them from this list.',
                      requiresBatch: false,
                    },
                    {
                      id: 'zero',
                      label: 'No matches',
                      hint: 'SAM Text found nothing for the noun(s) on these images',
                      requiresBatch: true,
                    },
                    {
                      id: 'failed',
                      label: 'Errors',
                      hint: 'SAM / save failed — retry or fix manually',
                      requiresBatch: true,
                    },
                  ].map((f) => (
                    <Tooltip key={f.id} title={f.hint} arrow>
                      <span>
                        <Chip
                          size="small"
                          color={reviewFilter === f.id ? 'info' : 'default'}
                          variant={reviewFilter === f.id ? 'filled' : 'outlined'}
                          label={f.label}
                          onClick={() => onReviewFilterChange?.(reviewFilter === f.id ? null : f.id)}
                          disabled={f.requiresBatch && !hasLastBatch && !lastBatch}
                        />
                      </span>
                    </Tooltip>
                  ))}
                </Stack>
                {reviewFilter && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {reviewQueueCount
                        ? `Queue ${reviewQueueIndex || '—'}/${reviewQueueCount}`
                        : 'No images in this filter'}
                    </Typography>
                    <Button size="small" disabled={!reviewQueueCount} onClick={onFocusReviewPrev}>Prev</Button>
                    <Button size="small" disabled={!reviewQueueCount} onClick={onFocusReviewNext}>Next</Button>
                    <Button size="small" onClick={() => onReviewFilterChange?.(null)}>Clear filter</Button>
                  </Stack>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                  This image: mark after you look at the canvas.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                  <Tooltip title="Looks good — keep as done" arrow>
                    <Button
                      size="small"
                      variant={reviewStatus === 'accepted' ? 'contained' : 'outlined'}
                      color="success"
                      onClick={() => setReview('accepted')}
                      disabled={batchBusy}
                    >
                      Accept
                    </Button>
                  </Tooltip>
                  <Tooltip title="Not good enough — come back later (stays in Needs fix queue)" arrow>
                    <Button
                      size="small"
                      variant={reviewStatus === 'needs_review' ? 'contained' : 'outlined'}
                      color="warning"
                      onClick={() => setReview('needs_review')}
                      disabled={batchBusy}
                    >
                      Needs fix
                    </Button>
                  </Tooltip>
                  {dupPairs.length > 0 && (
                    <Button size="small" variant="outlined" color="error" onClick={selectDuplicateWeaker}>
                      Remove weaker duplicates ({dupPairs.length})
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            {/* Canvas */}
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
                  <IconButton onClick={onPrev} disabled={!canPrev || batchBusy} aria-label="Previous image" sx={navBtnSx}>
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
                    allowedTools={['point', 'line', 'polygon', 'bbox']}
                    annotationLabels={names.length ? names : DEFAULT_SAM_LABELS}
                    labelColors={colors}
                    enableSamAssist={!!String(falKey || '').trim() && !batchBusy}
                    falKey={falKey}
                    projectId={projectId}
                    maxAnnotations={500}
                    centerContent
                  />
                </Box>
              </Box>

              <Tooltip title="Next image" placement="right">
                <span>
                  <IconButton onClick={onNext} disabled={!canNext || batchBusy} aria-label="Next image" sx={navBtnSx}>
                    <NavigateNext />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
              {SAM_PREANNOT_MODEL}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
