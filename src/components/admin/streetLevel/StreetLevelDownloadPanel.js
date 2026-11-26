import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Divider, IconButton, LinearProgress,
  Link, MenuItem, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { ContentCopy, Download as DownloadIcon, ExpandMore } from '@mui/icons-material';
import { useStreetLevelText } from '../../../contexts/streetLevelI18n';
import {
  ACTIVE_JOB_STATES, DEFAULT_CAPTURE, FOLDER_MODES, HEADING_MODES, MAPILLARY_TOKEN_STORAGE_KEY, OPERATING_SYSTEMS,
  PRESETS, SOURCES, cancelJob, detectOs, getJob, helperCommands, helperHealth, mergeMediaEntries, resumeJob,
  runCommand, sendToken, startJob, summarizeItems,
} from '../../../lib/streetLevel/localHelper';
import { currentAccessToken } from '../../../lib/streetLevel/api';
import { getR2PublicBase, getR2ServerUrl, listImagesFromR2 } from '../../../lib/r2';
import { compareMediaNames, normalizeFolderPath } from '../../../lib/mediaUtils';

const POLL_MS = 1500;
const HEALTH_MS = 4000;
const HEALTH_CONNECTED_MS = 10000;
const LANDED_MS = 5000;
const TOKEN_REFRESH_MS = 5 * 60 * 1000;
const ZOOM_WIDTHS = { 1: 1024, 2: 2048, 3: 4096, 4: 8192 };

function CopyLine({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ bgcolor: 'grey.100', borderRadius: 1, px: 1, py: 0.5 }}>
      <Box component="code" data-testid="helper-command" sx={{ flex: 1, fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>{text}</Box>
      <Tooltip title={copied ? '✓' : label}>
        <IconButton size="small" aria-label={label} onClick={() => {
          navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}><ContentCopy fontSize="inherit" /></IconButton>
      </Tooltip>
    </Stack>
  );
}

function readStoredToken() {
  try { return localStorage.getItem(MAPILLARY_TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
}

/**
 * Download bar + collapsed settings. Reports per-point status to the parent via `onItemsChange`
 * so the point table can show it; the map and the point list stay the main surface.
 */
export default function StreetLevelDownloadPanel({
  points, selectedIds, currentProject, projectRef, projectPrefix, onProjectUpdate, commitStreetLevel,
  initialCapture, lastJob, onItemsChange,
}) {
  const tx = useStreetLevelText();
  const [helper, setHelper] = useState({ checking: true, running: false });
  const [capture, setCapture] = useState({ ...DEFAULT_CAPTURE, ...(initialCapture || {}) });
  const [mapillaryToken, setMapillaryToken] = useState(readStoredToken);
  const [scope, setScope] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [os, setOs] = useState(() => detectOs());
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(lastJob?.jobId || null);
  const [error, setError] = useState(null);
  const [interrupted, setInterrupted] = useState(false);
  const [landed, setLanded] = useState(null);
  const seenRef = useRef(0);
  const tokenSentAt = useRef(0);
  const countsKey = useRef('');
  const helperSectionRef = useRef(null);

  const apiBase = getR2ServerUrl() || window.location.origin;
  const origin = window.location.origin;
  const projectId = currentProject?.id;
  const folder = normalizeFolderPath(capture.folder || 'street-level') || 'street-level';
  const scopePoints = scope === 'selected' ? points.filter((p) => selectedIds.includes(p.id)) : points;
  const items = useMemo(() => {
    const raw = job?.items || lastJob?.items || {};
    if (job || !interrupted) return raw;
    return Object.fromEntries(Object.entries(raw).map(([id, it]) => [id, it.status === 'running' ? { ...it, status: 'pending' } : it]));
  }, [job, lastJob?.items, interrupted]);
  const counts = summarizeItems(points, items);
  const active = Boolean(job && ACTIVE_JOB_STATES.has(job.state));
  const runState = job?.state || (interrupted ? 'interrupted' : lastJob?.state);
  const hasResumable = Boolean(counts.failed || counts.pending
    || ['partial', 'cancelled', 'needs-auth', 'failed', 'interrupted'].includes(runState));
  const commands = helperCommands(os, origin);
  const mapillaryMissingToken = capture.source === 'mapillary' && !mapillaryToken.trim();
  const helperCall = helper.base ? { base: helper.base } : {};
  const backupCommand = runCommand({ projectId: projectId || '<project-id>', apiBase, capture: { ...capture, folder }, os });

  useEffect(() => { onItemsChange?.(items); }, [items, onItemsChange]);

  const checkHelper = useCallback(async () => {
    const h = await helperHealth();
    setHelper({ checking: false, ...h });
    return h;
  }, []);

  useEffect(() => {
    let timer;
    let alive = true;
    const loop = async () => {
      const h = await checkHelper();
      if (alive) timer = setTimeout(loop, h.running ? HEALTH_CONNECTED_MS : HEALTH_MS);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [checkHelper]);

  const registerEntries = useCallback((snapshot) => {
    const cur = projectRef.current;
    if (!cur) return;
    const cfg = cur.imageDatasetConfig || {};
    const entries = snapshot.entries || [];
    const nextKey = `${snapshot.state}|${JSON.stringify(snapshot.counts)}`;
    if (!entries.length && nextKey === countsKey.current) return;
    countsKey.current = nextKey;
    const lastItems = Object.fromEntries(Object.entries(snapshot.items || {}).map(([id, it]) => [id, {
      status: it.status, keys: it.keys || [], error: it.error || null, panoId: it.pano_id || null,
    }]));
    const mediaFolders = [...new Set([...(cfg.mediaFolders || []), ...(snapshot.folders || [])].filter(Boolean))]
      .sort(compareMediaNames);
    const next = {
      ...cur,
      ...(entries.length ? { preloadedImages: mergeMediaEntries(cur.preloadedImages || [], entries), preloadedSource: 'r2' } : {}),
      imageDatasetConfig: {
        ...cfg,
        mediaFolders,
        mediaFolderTags: { ...(cfg.mediaFolderTags || {}), ...(snapshot.tags || {}) },
        streetLevel: {
          ...(cfg.streetLevel || {}),
          lastJob: { jobId: snapshot.jobId, state: snapshot.state, counts: snapshot.counts, items: lastItems, updatedAt: snapshot.updatedAt },
        },
      },
    };
    projectRef.current = next;
    onProjectUpdate(next);
  }, [onProjectUpdate, projectRef]);

  useEffect(() => {
    if (!jobId || !helper.running) return undefined;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const snap = await getJob(jobId, seenRef.current, helper.base ? { base: helper.base } : {});
        if (!alive) return;
        seenRef.current = snap.entryCount;
        setJob(snap);
        setError(snap.error && snap.state !== 'needs-auth' ? snap.error : null);
        registerEntries(snap);
        const now = Date.now();
        if (snap.state === 'needs-auth' || (ACTIVE_JOB_STATES.has(snap.state) && now - tokenSentAt.current > TOKEN_REFRESH_MS)) {
          const token = await currentAccessToken();
          if (token && now - tokenSentAt.current > 20000) {
            tokenSentAt.current = now;
            await sendToken(jobId, token, helper.base ? { base: helper.base } : {});
          }
        }
        if (ACTIVE_JOB_STATES.has(snap.state) || snap.state === 'needs-auth') timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!alive) return;
        if (err.status === 404) { setJob(null); setInterrupted(true); return; }
        const h = await checkHelper();
        if (h.running) timer = setTimeout(poll, POLL_MS * 2);
      }
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId, helper.running, helper.base, registerEntries, checkHelper]);

  const refreshLanded = useCallback(async () => {
    if (!projectPrefix) return;
    const res = await listImagesFromR2(`${projectPrefix}${folder}/`);
    if (res.success) setLanded(new Set((res.images || []).map((i) => i.key)));
  }, [projectPrefix, folder]);

  useEffect(() => {
    refreshLanded();
    if (!active) return undefined;
    const t = setInterval(refreshLanded, LANDED_MS);
    return () => clearInterval(t);
  }, [active, refreshLanded]);

  const revealHelper = () => {
    setSettingsOpen(true);
    setTimeout(() => helperSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  };

  const start = async (resume) => {
    setError(null);
    if (!projectId || !projectPrefix) { setError(tx('Open a project first.')); return; }
    if (!scopePoints.length) { setError(tx('Add points first.')); return; }
    if (!helper.running) {
      if (!helper.blocked) setError(tx('Start the local helper first (commands in Download settings).'));
      revealHelper();
      return;
    }
    if (mapillaryMissingToken) { setError(tx('mapillary-token-required')); setSettingsOpen(true); return; }
    const options = { ...capture, folder };
    commitStreetLevel({ capture: options });
    try {
      const token = await currentAccessToken();
      tokenSentAt.current = Date.now();
      if (resume && jobId && job && !ACTIVE_JOB_STATES.has(job.state)) {
        await resumeJob(jobId, token, helperCall);
        setJob({ ...job, state: 'queued' });
        return;
      }
      const res = await startJob({
        apiBase, projectId, mediaPrefix: projectPrefix, publicBase: getR2PublicBase(), token, points: scopePoints,
        options: capture.source === 'mapillary' ? { ...options, mapillaryToken: mapillaryToken.trim() } : options,
      }, helperCall);
      seenRef.current = 0;
      setJob(null);
      setInterrupted(false);
      setJobId(res.jobId);
    } catch (err) {
      setError(tx('The local helper rejected the job: {e}', { e: err.message }));
      checkHelper();
    }
  };

  const failures = useMemo(() => points
    .map((p, i) => ({ p, i, it: items[p.id] }))
    .filter(({ it }) => it?.error && (it.status === 'failed' || it.status === 'no-image'))
    .slice(0, 5), [points, items]);
  const landedCount = landed
    ? new Set(Object.values(items).flatMap((it) => it.keys || []).filter((k) => landed.has(k))).size
    : null;

  const set = (key, value) => setCapture((c) => ({ ...c, [key]: value }));
  const showsHeading = capture.preset === 'current' || capture.preset === 'headings';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.25 }} data-testid="download-panel">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button variant="contained" startIcon={<DownloadIcon />} disabled={active || !scopePoints.length} onClick={() => start(false)}>
          {tx('Download {n} point(s)', { n: scopePoints.length })}
        </Button>
        {hasResumable && !active && (
          <Button variant="outlined" size="small" onClick={() => start(true)}>{tx('Resume')}</Button>
        )}
        {active && <Button color="warning" size="small" onClick={() => cancelJob(jobId, helperCall).catch(() => {})}>{tx('Cancel')}</Button>}
        <Box sx={{ flex: 1 }} />
        {helper.checking ? null : helper.running ? (
          <Chip size="small" color="success" variant="outlined" label={tx('Helper connected')} />
        ) : (
          <Chip size="small" color="warning" variant="outlined" label={tx(helper.blocked ? 'Browser blocked the helper' : 'Helper not running')} onClick={revealHelper} data-testid={helper.blocked ? 'helper-blocked-chip' : 'helper-missing-chip'} />
        )}
        <Chip size="small" variant="outlined" label={capture.source === 'mapillary' ? 'Mapillary' : 'Google Street View'} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        {capture.source === 'mapillary' ? tx('terms-short-mapillary') : tx('terms-short')}
      </Typography>

      {!helper.checking && helper.blocked && (
        <Alert severity="warning" sx={{ mt: 1 }} data-testid="helper-blocked">
          <Typography variant="body2">{tx('helper-blocked')}</Typography>
          <Box sx={{ mt: 0.75 }}><CopyLine text={backupCommand} label={tx('Copy')} /></Box>
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {job?.state === 'needs-auth' && <Alert severity="warning" sx={{ mt: 1 }}>{tx('Sign-in expired; sending a fresh session to the helper…')}</Alert>}

      {counts.total > 0 && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress variant={active && !counts.done ? 'indeterminate' : 'determinate'}
            value={counts.total ? ((counts.done + counts.noImage + counts.failed) / counts.total) * 100 : 0}
            sx={{ height: 6, borderRadius: 3, mb: 0.5 }} />
          <Typography variant="body2" data-testid="download-summary">
            {tx('{done} done ({files} file(s)), {none} without coverage, {failed} failed, {pending} pending — of {total}.', {
              done: counts.done, files: counts.files, none: counts.noImage, failed: counts.failed,
              pending: counts.pending + counts.running, total: counts.total,
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary" data-testid="landed-summary">
            {landedCount != null ? `${tx('{n} file(s) in the media library folder “{f}”.', { n: landedCount, f: folder })} ` : ''}
            {runState ? tx('Run: {s}', { s: tx(`status:${runState}`) }) : ''}
          </Typography>
          {failures.map(({ p, i, it }) => (
            <Typography key={p.id} variant="caption" sx={{ display: 'block', color: it.status === 'failed' ? 'error.main' : 'text.secondary' }}>
              #{i + 1}: {it.status === 'no-image' ? `${tx('item:no-image')} — ${it.error}` : it.error}
            </Typography>
          ))}
        </Box>
      )}

      <Accordion
        expanded={settingsOpen}
        onChange={(_, open) => setSettingsOpen(open)}
        disableGutters
        elevation={0}
        sx={{ mt: 1, '&:before': { display: 'none' }, bgcolor: 'transparent' }}
      >
        <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0, minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{tx('Download settings')}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <Stack spacing={1.25}>
            <Typography variant="caption" color="text.secondary" data-testid="batch-note">{tx('batch-note')}</Typography>

            <Stack direction="row" spacing={1}>
              <TextField select size="small" label={tx('Imagery source')} value={capture.source} sx={{ flex: 1 }}
                onChange={(e) => set('source', e.target.value)}>
                {SOURCES.map((s) => <MenuItem key={s} value={s}>{tx(`source-option:${s}`)}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={tx('Views per point')} value={capture.preset} sx={{ flex: 1.3 }}
                onChange={(e) => set('preset', e.target.value)}>
                {PRESETS.map((p) => <MenuItem key={p} value={p}>{tx(`preset:${p}`)}</MenuItem>)}
              </TextField>
            </Stack>
            {capture.source === 'mapillary' && (
              <TextField size="small" type="password" label={tx('Mapillary access token')} value={mapillaryToken} autoComplete="off"
                error={mapillaryMissingToken}
                onChange={(e) => {
                  setMapillaryToken(e.target.value);
                  try { localStorage.setItem(MAPILLARY_TOKEN_STORAGE_KEY, e.target.value.trim()); } catch { /* ignore */ }
                }}
                helperText={<>{tx('mapillary-token-help')} <Link href="https://www.mapillary.com/dashboard/developers" target="_blank" rel="noopener">mapillary.com/dashboard/developers</Link></>} />
            )}
            <Stack direction="row" spacing={1}>
              {showsHeading && (
                <TextField select size="small" label={tx('Heading')} value={capture.headingMode} sx={{ flex: 1.2 }}
                  onChange={(e) => set('headingMode', e.target.value)}>
                  {HEADING_MODES.map((m) => <MenuItem key={m} value={m}>{tx(`heading-mode:${m}`)}</MenuItem>)}
                </TextField>
              )}
              {showsHeading && capture.headingMode === 'fixed' && (
                <TextField size="small" type="number" label={tx('Compass heading (°)')} value={capture.fixedHeading} sx={{ flex: 0.8 }}
                  onChange={(e) => set('fixedHeading', ((Number(e.target.value) || 0) % 360 + 360) % 360)} />
              )}
              {capture.preset === 'headings' && (
                <TextField size="small" type="number" label={tx('Headings (N)')} value={capture.headingCount} sx={{ flex: 0.6 }}
                  inputProps={{ min: 1, max: 12 }} onChange={(e) => set('headingCount', Math.max(1, Math.min(12, Number(e.target.value) || 4)))} />
              )}
              {capture.preset !== 'pano' && (
                <>
                  <TextField size="small" type="number" label={tx('Pitch')} value={capture.pitch} sx={{ flex: 0.6 }}
                    onChange={(e) => set('pitch', Math.max(-90, Math.min(90, Number(e.target.value) || 0)))} />
                  <TextField size="small" type="number" label="FOV" value={capture.fov} sx={{ flex: 0.6 }}
                    onChange={(e) => set('fov', Math.max(10, Math.min(120, Number(e.target.value) || 90)))} />
                </>
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              {capture.source === 'google' && (
                <TextField select size="small" label={tx('Panorama resolution')} value={capture.zoom} sx={{ flex: 1.2 }}
                  onChange={(e) => set('zoom', Number(e.target.value))}>
                  {[1, 2, 3, 4].map((z) => <MenuItem key={z} value={z}>{tx('zoom {z} (~{w} px)', { z, w: ZOOM_WIDTHS[z] })}</MenuItem>)}
                </TextField>
              )}
              <TextField size="small" type="number" label={tx('View width (px)')} value={capture.width} sx={{ flex: 1 }}
                onChange={(e) => set('width', Math.max(256, Math.min(2048, Number(e.target.value) || 1024)))} />
              <TextField size="small" type="number" label={tx('Search radius (m)')} value={capture.radius} sx={{ flex: 1 }}
                onChange={(e) => set('radius', Math.max(5, Math.min(capture.source === 'mapillary' ? 50 : 200, Number(e.target.value) || 50)))} />
              <TextField size="small" type="number" label={tx('Seconds between requests')} value={capture.minInterval} sx={{ flex: 1 }}
                inputProps={{ min: 0.5, step: 0.5 }}
                onChange={(e) => set('minInterval', Math.max(0.5, Math.min(60, Number(e.target.value) || 1.5)))} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label={tx('Target folder')} value={capture.folder} sx={{ flex: 1 }}
                onChange={(e) => set('folder', e.target.value)} />
              <TextField select size="small" label={tx('Folder role')} value={capture.folderMode} sx={{ flex: 1.2 }}
                onChange={(e) => set('folderMode', e.target.value)}>
                {FOLDER_MODES.map((m) => <MenuItem key={m} value={m}>{tx(`folder:${m}`)}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={tx('Points')} value={scope} sx={{ flex: 1 }}
                onChange={(e) => setScope(e.target.value)}>
                <MenuItem value="all">{tx('All ({n})', { n: points.length })}</MenuItem>
                <MenuItem value="selected" disabled={!selectedIds.length}>{tx('Selected ({n})', { n: selectedIds.length })}</MenuItem>
              </TextField>
            </Stack>

            <Divider />
            <Box ref={helperSectionRef} data-testid="helper-section">
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{tx('Local helper')}</Typography>
                <Typography variant="caption" color={helper.running ? 'success.main' : 'warning.main'} data-testid="helper-status">
                  {helper.running
                    ? tx('Connected (sp_streetlevel {v}, streetlevel {s}).', { v: helper.version, s: helper.streetlevel })
                    : tx(helper.blocked ? 'The helper is running, but this browser blocked it.' : 'Not running on this computer.')}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{tx('helper-prereq')}</Typography>
              <Tabs value={os} onChange={(_, v) => setOs(v)} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5 } }}>
                {OPERATING_SYSTEMS.map((o) => <Tab key={o} value={o} label={tx(`os:${o}`)} />)}
              </Tabs>
              {commands.systemDeps && (
                <Box data-testid="mac-system-deps">
                  <Typography variant="body2" sx={{ mt: 0.75 }}>{tx('0. macOS only — install two Homebrew libraries first:')}</Typography>
                  <CopyLine text={commands.systemDeps} label={tx('Copy')} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{tx('mac-deps-why')}</Typography>
                </Box>
              )}
              {commands.systemDeps && (
                <Typography variant="body2" sx={{ mt: 0.75 }} data-testid="mac-reinstall">{tx('mac-reinstall')}</Typography>
              )}
              <Typography variant="body2" sx={{ mt: 0.75 }}>{tx('1. Install once:')}</Typography>
              <CopyLine text={commands.install} label={tx('Copy')} />
              {commands.installedServe && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} data-testid="mac-venv-why">{tx('mac-venv-why')}</Typography>
              )}
              <Typography variant="body2" sx={{ mt: 0.75 }}>{tx('2. Start it and keep the window open:')}</Typography>
              <CopyLine text={commands.serve} label={tx('Copy')} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} data-testid="helper-listen">{tx('helper-listen')}</Typography>
              {commands.installedServe && (
                <Box data-testid="mac-already-serve" sx={{ mt: 0.75 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{tx('mac-already-serve')}</Typography>
                  <CopyLine text={commands.installedServe} label={tx('Copy')} />
                </Box>
              )}
              {commands.isolatedInstall && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{tx('externally-managed-help')}</Typography>
                  <CopyLine text={commands.isolatedInstall} label={tx('Copy')} />
                  <Box sx={{ mt: 0.5 }}><CopyLine text={commands.isolatedServe} label={tx('Copy')} /></Box>
                </>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{tx(os === 'windows' ? 'python-missing-windows' : os === 'mac' ? 'python-missing-mac' : 'python-missing-linux')}</Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>{tx('Without the browser (same batch, one command):')}</Typography>
              <CopyLine text={backupCommand} label={tx('Copy')} />
              {capture.source === 'mapillary' && (
                <Typography variant="caption" color="text.secondary">{tx('mapillary-cli-token')}</Typography>
              )}
            </Box>
            <Alert severity="warning" variant="outlined" sx={{ py: 0.25 }}>
              {capture.source === 'mapillary' ? tx('terms-mapillary') : tx('terms-warning')}
            </Alert>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
