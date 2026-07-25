import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, Refresh, FolderZip } from '@mui/icons-material';
import {
  loadPreannotationsForMediaList,
  SAM_PREANNOT_MODEL,
  featureStatusFromMap,
} from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';
import {
  PREANNOTATE_QUESTION_NAME,
  preannotationsToAnalysisInputs,
} from '../../lib/preannotateAnalysis';
import { downloadQuestionExportZip } from '../../lib/questionSummaryExport';
import { downloadPreannotatePackageZip } from '../../lib/mediaLibraryDownload';
import { ImageResolverContext } from './imageResolverContext';
import AnnotationAnalysis from './AnnotationAnalysis';

function mediaKey(entry) {
  return entry?.name || entry?.media_id || entry?.url || '';
}

function itemsFromCache(cache, mediaList) {
  const nameSet = new Set((mediaList || []).map((m) => mediaKey(m)));
  const out = [];
  cache.forEach((row, key) => {
    if (nameSet.has(key) && row.annotation?.shapes?.length) out.push(row);
  });
  return out;
}

/** Media that already have a SAM preannot feature row (skip blank 404 probes). */
function filterLikelyAnnotated(mediaList, featureMap) {
  if (!mediaList?.length) return [];
  if (!featureMap || !Object.keys(featureMap).length) return [];
  return mediaList.filter((entry) => {
    const { status, records } = featureStatusFromMap(featureMap, entry, [SAM_PREANNOT_MODEL]);
    if (status[SAM_PREANNOT_MODEL] !== 'ready') return false;
    const count = records[SAM_PREANNOT_MODEL]?.features?.sam_shape_count;
    return count == null || Number(count) > 0;
  });
}

/**
 * Library pre-annotate results.
 * - First expand: load known-annotated JSONs once
 * - Autosave: patch ONLY that one media locally (no network)
 * - Refresh button: full re-download from R2
 */
export default function MediaPreannotateResults({
  r2Prefix,
  mediaList = [],
  featureMap = {},
  /** { mediaEntry, annotation, at } from autosave — single-file local patch */
  savedPatch = null,
  /** Accumulated patches from batch SAM (multi-image) */
  batchPatches = [],
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [exportInfo, setExportInfo] = useState(null);
  const [items, setItems] = useState([]);
  const cacheRef = useRef(new Map());
  const loadedPrefixRef = useRef('');
  const hasLoadedRef = useRef(false);
  const lastPatchAtRef = useRef(0);

  const mediaSignature = useMemo(
    () => (mediaList || []).map((m) => m?.name || '').filter(Boolean).join('\n'),
    [mediaList],
  );

  const applyPatch = useCallback((mediaEntry, annotation) => {
    const key = mediaKey(mediaEntry) || mediaKey(annotation);
    if (!key) return;
    const entry = mediaEntry || {
      name: annotation?.name,
      url: annotation?.image,
      media_id: annotation?.media_id,
    };
    const row = {
      mediaEntry: entry,
      annotation: annotation?.shapes?.length ? annotation : null,
    };
    if (row.annotation) cacheRef.current.set(key, row);
    else cacheRef.current.delete(key);

    setItems((prev) => {
      const idx = prev.findIndex((it) => mediaKey(it.mediaEntry) === key);
      if (!row.annotation) {
        if (idx < 0) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
  }, []);

  // Autosave → update only this file. Never re-fetch others.
  useEffect(() => {
    if (!savedPatch?.at || savedPatch.at === lastPatchAtRef.current) return;
    lastPatchAtRef.current = savedPatch.at;
    applyPatch(savedPatch.mediaEntry, savedPatch.annotation);
  }, [savedPatch, applyPatch]);

  // Batch SAM saves many images — apply each patch without full refresh.
  const lastBatchLenRef = useRef(0);
  useEffect(() => {
    const list = Array.isArray(batchPatches) ? batchPatches : [];
    if (list.length <= lastBatchLenRef.current) return;
    const fresh = list.slice(lastBatchLenRef.current);
    lastBatchLenRef.current = list.length;
    fresh.forEach((p) => {
      if (p?.mediaEntry || p?.annotation) applyPatch(p.mediaEntry, p.annotation);
    });
  }, [batchPatches, applyPatch]);

  const loadInitial = useCallback(async () => {
    if (!r2Prefix || !isR2Configured()) {
      setItems([]);
      cacheRef.current = new Map();
      setError(isR2Configured() ? null : 'R2 is not configured.');
      return;
    }
    if (!mediaList.length) {
      setItems([]);
      return;
    }

    if (loadedPrefixRef.current && loadedPrefixRef.current !== r2Prefix) {
      cacheRef.current = new Map();
    }
    loadedPrefixRef.current = r2Prefix;

    const candidates = filterLikelyAnnotated(mediaList, featureMap)
      .filter((m) => !cacheRef.current.has(mediaKey(m)));

    setError(null);
    if (!candidates.length) {
      setItems(itemsFromCache(cacheRef.current, mediaList));
      hasLoadedRef.current = true;
      return;
    }

    setLoading(true);
    try {
      const loaded = await loadPreannotationsForMediaList(r2Prefix, candidates, { concurrency: 12 });
      loaded.forEach(({ mediaEntry, annotation }) => {
        const key = mediaKey(mediaEntry);
        if (!key) return;
        if (annotation?.shapes?.length) {
          cacheRef.current.set(key, { mediaEntry, annotation });
        } else {
          cacheRef.current.delete(key);
        }
      });
      setItems(itemsFromCache(cacheRef.current, mediaList));
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [r2Prefix, mediaList, featureMap]);

  const refreshAll = useCallback(async () => {
    if (!r2Prefix || !isR2Configured()) {
      setItems([]);
      setError(isR2Configured() ? null : 'R2 is not configured.');
      return;
    }
    cacheRef.current = new Map();
    hasLoadedRef.current = false;
    loadedPrefixRef.current = r2Prefix;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadPreannotationsForMediaList(r2Prefix, mediaList, { concurrency: 12 });
      loaded.forEach(({ mediaEntry, annotation }) => {
        const key = mediaKey(mediaEntry);
        if (!key) return;
        if (annotation?.shapes?.length) {
          cacheRef.current.set(key, { mediaEntry, annotation });
        }
      });
      setItems(itemsFromCache(cacheRef.current, mediaList));
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [r2Prefix, mediaList]);

  // First expand only — one-time load. Later saves use applyPatch only.
  useEffect(() => {
    if (!open) return;
    if (hasLoadedRef.current && loadedPrefixRef.current === r2Prefix) return;
    loadInitial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, r2Prefix]);

  // Gallery filter changed: drop removed names locally, no network
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    setItems(itemsFromCache(cacheRef.current, mediaList));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature]);

  const analysis = useMemo(() => preannotationsToAnalysisInputs(items), [items]);

  const indexedCount = useMemo(
    () => filterLikelyAnnotated(mediaList, featureMap).length,
    [mediaList, featureMap],
  );

  const handleExportZip = () => {
    if (!analysis.responses.length) return;
    downloadQuestionExportZip(analysis.question, analysis.responses, null);
  };

  const handleExportPackage = async () => {
    if (!r2Prefix || !isR2Configured()) {
      setError('R2 is not configured.');
      return;
    }
    setExporting(true);
    setError(null);
    setExportInfo(null);
    try {
      const result = await downloadPreannotatePackageZip({
        r2Prefix,
        mediaList,
        items: items.length ? items : null,
        includeImages: true,
      });
      setExportInfo(`Downloaded ${result.filename} — ${result.annotatedCount} set(s) (JSON + CSV + images + overlay previews).`);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  };

  const headerCount = analysis.annotatedCount || indexedCount;

  return (
    <Box
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
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          borderBottom: open ? '1px solid' : 'none',
          borderColor: 'divider',
          cursor: 'pointer',
          bgcolor: 'grey.50',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 160 }}>
          Pre-annotate results
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {headerCount} annotated
          {mediaList.length ? ` / ${mediaList.length} images` : ''}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={exporting ? <CircularProgress size={14} /> : <FolderZip />}
          disabled={exporting || loading || !headerCount}
          onClick={(e) => {
            e.stopPropagation();
            handleExportPackage();
          }}
        >
          Download package
        </Button>
        <Button
          size="small"
          startIcon={loading ? <CircularProgress size={14} /> : <Refresh />}
          disabled={loading}
          onClick={(e) => {
            e.stopPropagation();
            refreshAll();
          }}
        >
          Refresh all
        </Button>
        {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
      </Box>

      <Collapse in={open}>
        <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Autosave updates only the image you just annotated — nothing else is re-downloaded.
            Use Refresh all if you need to reload every file from R2.
            Download package = JSON + SAM CSV (if any) + analysis CSVs + source images + overlays (*_annotated.jpg with shapes burned in).
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
          )}
          {exportInfo && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setExportInfo(null)}>{exportInfo}</Alert>
          )}

          {loading && !analysis.answers.length && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Loading pre-annotations…
              </Typography>
            </Box>
          )}

          {!loading && !analysis.answers.length && !error && (
            <Alert severity="info">
              No saved pre-annotations yet. Annotate above — this list updates for that one file on each autosave.
            </Alert>
          )}

          {analysis.answers.length > 0 && (
            <ImageResolverContext.Provider value={analysis.imageNameToUrl}>
              <AnnotationAnalysis
                answers={analysis.answers}
                responses={analysis.responses}
                questionName={PREANNOTATE_QUESTION_NAME}
                exportProfile="library"
                unitChipLabel="annotation set(s)"
                extraActions={(
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FolderZip />}
                    disabled={!analysis.responses.length}
                    onClick={handleExportZip}
                  >
                    Export ZIP (long + summary)
                  </Button>
                )}
              />
            </ImageResolverContext.Provider>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
