import { useMediaLibraryText } from '../../contexts/mediaLibraryI18n';
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
import { downloadFeatureCsvsZip } from '../../lib/mediaLibraryDownload';

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
  const tx = useMediaLibraryText();
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [featureMap, setFeatureMap] = useState({});
  const [loadingMap, setLoadingMap] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
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

  const downloadCsvs = async () => {
    if (!r2Prefix || !isR2Configured()) return;
    setDownloadingCsv(true);
    setError(null);
    setMessage(null);
    try {
      const { filename, included, missing } = await downloadFeatureCsvsZip(r2Prefix, {
        models: [L0_MODEL, SEG_MODEL],
      });
      const missHint = missing.length ? tx(" Missing: {v0}.", { v0: missing.join(', ') }) : '';
      setMessage(tx("Downloaded {v0} ({v1}).{v2}", { v0: filename, v1: included.join(', '), v2: missHint }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setDownloadingCsv(false);
    }
  };

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
        ? tx("L0 stopped. Wrote {v0}/{v1} to R2 CSV.", { v0: result.done, v1: result.total })
        : result.total === 0
          ? tx("All {v0} image(s) already have L0 features.", { v0: result.skipped })
          : tx("L0 done for {v0} image(s) → R2 features/{v1}.csv", { v0: result.done, v1: L0_MODEL })
            + (result.skipped ? tx(" (skipped {v0} ready)", { v0: result.skipped }) : ''));
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
        ? tx("Seg stopped. Wrote {v0}/{v1} to R2 CSV.", { v0: result.done, v1: result.total })
        : result.total === 0
          ? tx("All images already have Seg features on R2.")
          : tx("SegFormer done for {v0} image(s) → R2 features/{v1}.csv", { v0: result.done, v1: SEG_MODEL })
            + (result.skipped ? tx(" (skipped {v0} ready)", { v0: result.skipped }) : ''));
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
        <Typography variant="body2" color="text.secondary">{' '}{tx("Features stored on R2 as CSV under")}{' '}<code>{r2Prefix}features/</code>{' '}{tx("(keyed by media_id / filename — migrates with template→project).")}{' '}{loadingMap ? tx(" Loading existing CSV…") : ''}
        </Typography>
      )}
      {compact && loadingMap && (
        <Typography variant="caption" color="text.secondary">{tx("Loading status…")}</Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={tx("L0 {v0}/{v1}", { v0: l0Ready, v1: images.length })} color={l0Ready ? 'success' : 'default'} />
        <Button size="small" variant="contained" disabled={!!busy || !images.length} onClick={runL0}>
          {compact ? tx("Run L0") : tx("Extract L0 features")}
        </Button>
        {busy === 'l0' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>{tx("Stop")}</Button>}
        <Button
          size="small"
          variant="outlined"
          disabled={!!busy || downloadingCsv || !r2Prefix || !isR2Configured()}
          onClick={downloadCsvs}
        >
          {downloadingCsv ? tx("Downloading…") : (compact ? tx("Download CSVs") : tx("Download L0 + Seg CSV"))}
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={tx("Seg {v0}/{v1}", { v0: segReady, v1: images.length })} color={segReady ? 'success' : 'default'} />
        <Button
          size="small"
          variant="contained"
          color="secondary"
          disabled={!!busy || !images.length || !String(hfToken || '').trim()}
          onClick={runSeg}
        >
          {compact ? tx("Run Seg") : tx("Run streetscape segmentation")}
        </Button>
        {busy === 'seg' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>{tx("Stop")}</Button>}
      </Stack>
      {!compact && (
        <Typography variant="caption" color="text.secondary">{' '}{tx("Seg:")}{' '}{SEGFORMER_HF_MODEL}{' '}{tx("via HuggingFace — needs HF token.")}{' '}</Typography>
      )}
      {compact && !String(hfToken || '').trim() && (
        <Typography variant="caption" color="warning.main">{' '}{tx("Seg needs HF token")}{' '}</Typography>
      )}

      {busy && (
        <Box>
          <Typography variant="caption">
            {busy === 'l0' ? tx("L0…") : tx("Seg…")} {progress.done}/{progress.total}
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
