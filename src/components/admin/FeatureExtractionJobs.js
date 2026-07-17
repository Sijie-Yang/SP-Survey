/**
 * Shared L0 / SegFormer batch jobs writing features to R2 CSV.
 * Used by project Media Dataset and admin Template image dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, LinearProgress, Alert, Chip, Stack,
} from '@mui/material';
import { L0_MODEL } from '../../lib/imageFeaturesL0';
import { SEG_MODEL, SEGFORMER_HF_MODEL } from '../../lib/falInference';
import {
  loadFeaturesMapFromR2,
  FEATURE_MODELS,
} from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';
import {
  normalizeImageList,
  isFeatureReady,
  getFeatureRec,
  runL0Extraction,
  runSegExtraction,
} from '../../lib/runFeatureExtraction';

/**
 * @param {{
 *   r2Prefix: string,
 *   images: array,
 *   hfToken: string,
 *   onFeaturesUpdated?: (map) => void,
 *   compact?: boolean,
 * }} props
 */
export default function FeatureExtractionJobs({
  r2Prefix,
  images: rawImages,
  hfToken = '',
  onFeaturesUpdated,
  compact = false,
}) {
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [featureMap, setFeatureMap] = useState({});
  const [loadingMap, setLoadingMap] = useState(false);
  const abortRef = useRef(false);

  const images = useMemo(() => normalizeImageList(rawImages), [rawImages]);

  const reloadMap = async () => {
    if (!r2Prefix || !isR2Configured()) {
      setFeatureMap({});
      return {};
    }
    setLoadingMap(true);
    try {
      const map = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
      setFeatureMap(map);
      onFeaturesUpdated?.(map);
      return map;
    } catch (err) {
      console.warn(err);
      return {};
    } finally {
      setLoadingMap(false);
    }
  };

  useEffect(() => {
    reloadMap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r2Prefix]);

  const l0Ready = images.filter((m) => isFeatureReady(getFeatureRec(featureMap, m, L0_MODEL))).length;
  const segReady = images.filter((m) => isFeatureReady(getFeatureRec(featureMap, m, SEG_MODEL))).length;

  const requestStop = () => { abortRef.current = true; };

  const runL0 = async () => {
    abortRef.current = false;
    setBusy('l0');
    setError(null);
    setMessage(null);
    try {
      // If nothing pending, re-run all (manual refresh of features).
      const pending = images.filter((m) => !isFeatureReady(getFeatureRec(featureMap, m, L0_MODEL)));
      const result = await runL0Extraction({
        r2Prefix,
        images,
        featureMap,
        skipReady: pending.length > 0,
        onProgress: ({ done, total, featureMap: map }) => {
          setProgress({ done, total });
          setFeatureMap({ ...map });
        },
        shouldAbort: () => abortRef.current,
      });
      setFeatureMap(result.featureMap);
      onFeaturesUpdated?.(result.featureMap);
      await reloadMap();
      setMessage(result.stopped
        ? `L0 stopped. Wrote ${result.done}/${result.total} to the feature CSV.`
        : result.total === 0
          ? `All ${result.skipped} image(s) already have L0 features.`
          : `L0 done for ${result.done} image(s) → Supabase features/${L0_MODEL}.csv`
            + (result.skipped ? ` (skipped ${result.skipped} ready)` : ''));
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
  };

  const runSeg = async () => {
    abortRef.current = false;
    setBusy('seg');
    setError(null);
    setMessage(null);
    try {
      const result = await runSegExtraction({
        r2Prefix,
        images,
        featureMap,
        hfToken,
        onProgress: ({ done, total, featureMap: map }) => {
          setProgress({ done, total });
          setFeatureMap({ ...map });
        },
        shouldAbort: () => abortRef.current,
      });
      setFeatureMap(result.featureMap);
      onFeaturesUpdated?.(result.featureMap);
      await reloadMap();
      setMessage(result.stopped
        ? `Seg stopped. Wrote ${result.done}/${result.total} to the feature CSV.`
        : result.total === 0
          ? 'All images already have Seg features in Supabase Storage.'
          : `SegFormer done for ${result.done} image(s) → Supabase features/${SEG_MODEL}.csv`
            + (result.skipped ? ` (skipped ${result.skipped} ready)` : ''));
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
  };

  return (
    <Stack spacing={compact ? 1 : 1.5}>
      {message && <Alert severity="success" onClose={() => setMessage(null)} sx={compact ? { py: 0 } : undefined}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={compact ? { py: 0 } : undefined}>{error}</Alert>}
      {!compact && (
        <Typography variant="body2" color="text.secondary">
          Features are stored in the survey-images bucket as CSV under <code>{r2Prefix}features/</code>.
          {loadingMap ? ' Loading existing CSV…' : ''}
        </Typography>
      )}
      {compact && loadingMap && (
        <Typography variant="caption" color="text.secondary">Loading status…</Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`L0 ${l0Ready}/${images.length}`} color={l0Ready ? 'success' : 'default'} />
        <Button size="small" variant="contained" disabled={!!busy || !images.length} onClick={runL0}>
          {compact ? 'Run L0' : 'Extract L0 features'}
        </Button>
        {busy === 'l0' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>Stop</Button>}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`Seg ${segReady}/${images.length}`} color={segReady ? 'success' : 'default'} />
        <Button
          size="small"
          variant="contained"
          color="secondary"
          disabled={!!busy || !images.length || !String(hfToken || '').trim()}
          onClick={runSeg}
        >
          {compact ? 'Run Seg' : 'Run streetscape segmentation'}
        </Button>
        {busy === 'seg' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>Stop</Button>}
      </Stack>
      {!compact && (
        <Typography variant="caption" color="text.secondary">
          Seg: {SEGFORMER_HF_MODEL} via HuggingFace — needs HF token.
        </Typography>
      )}
      {compact && !String(hfToken || '').trim() && (
        <Typography variant="caption" color="warning.main">
          Seg needs HF token
        </Typography>
      )}

      {busy && (
        <Box>
          <Typography variant="caption">
            {busy === 'l0' ? 'L0…' : 'Seg…'} {progress.done}/{progress.total}
          </Typography>
          <LinearProgress
            variant={progress.total ? 'determinate' : 'indeterminate'}
            value={progress.total ? (100 * progress.done) / progress.total : 0}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      )}
    </Stack>
  );
}
