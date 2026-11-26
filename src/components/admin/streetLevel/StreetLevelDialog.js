import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppBar, Box, Button, Checkbox, Chip, CircularProgress, Dialog, Divider, IconButton,
  Popover, Stack, TextField, ToggleButton, ToggleButtonGroup,
  Toolbar, Tooltip, Typography,
} from '@mui/material';
import {
  Close, DeleteOutline, Download, OpenInNew, Place, PanTool, Timeline, CropSquare, GridOn, Tune, Upload,
} from '@mui/icons-material';
import StreetLevelMap from './StreetLevelMap';
import { useStreetLevelText } from '../../../contexts/streetLevelI18n';
import {
  buildGoogleMapUrl, buildStreetViewUrl, extractUrls, isShortMapsUrl, parseGoogleMapsUrl,
  viewPatchFromStreetViewUrl,
} from '../../../lib/streetLevel/googleMapsUrl';
import {
  gridInBounds, gridInPolygon, mergePoints, normalizePoint, pointDedupKey, pointFromParsedUrl,
  pointsFromCsv, pointsFromGeoJson, pointsToCsv, pointsToGeoJson, samplePolyline, MAX_POINTS,
} from '../../../lib/streetLevel/points';
import { expandShortLinks } from '../../../lib/streetLevel/api';
import { DEFAULT_CAPTURE, hasOwnView } from '../../../lib/streetLevel/localHelper';
import StreetLevelDownloadPanel from './StreetLevelDownloadPanel';

const PAGE_SIZE = 100;
const GOOGLE_WINDOW = 'sp-google-maps';

export function readStreetLevelConfig(project) {
  const sl = project?.imageDatasetConfig?.streetLevel || {};
  return {
    points: Array.isArray(sl.points) ? sl.points : [],
    capture: { ...DEFAULT_CAPTURE, ...(sl.capture || {}) },
    lastJob: sl.lastJob || null,
    view: sl.view || null,
  };
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openGoogle(url) {
  window.open(url, GOOGLE_WINDOW, 'popup,width=1280,height=860');
}

const fmt = (n, d = 5) => (n == null || n === '' ? '—' : Number(n).toFixed(d));
const STATUS_COLOR = { done: 'success', 'no-image': 'default', failed: 'error', running: 'info', pending: 'default' };

function viewLabel(p) {
  const part = (v, unit) => (v == null ? '·' : `${Math.round(v)}${unit}`);
  return `${part(p.heading, '°')} / ${part(p.pitch, '°')} / ${part(p.fov, '')}`;
}

function NumberCell({ value, onCommit, min, max, width = 64, label, placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  return (
    <TextField
      size="small"
      variant="standard"
      value={draft}
      placeholder={placeholder}
      inputProps={{ 'aria-label': label, inputMode: 'decimal', style: { width, fontSize: 13 } }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (String(draft) === String(value ?? '')) return;
        if (draft === '') { onCommit(null); return; }
        const n = Number(draft);
        if (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) { setDraft(value ?? ''); return; }
        onCommit(n);
      }}
    />
  );
}

export default function StreetLevelDialog({ open, onClose, currentProject, onProjectUpdate, projectPrefix }) {
  const tx = useStreetLevelText();
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;
  const config = readStreetLevelConfig(currentProject);
  const points = config.points;

  const [downloadItems, setDownloadItems] = useState({});
  const [viewEdit, setViewEdit] = useState(null);
  const [pointUrl, setPointUrl] = useState('');
  const [pointUrlError, setPointUrlError] = useState('');
  const [mode, setMode] = useState('point');
  const [spacing, setSpacing] = useState(25);
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState(config.view || null);
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const [notice, setNotice] = useState(null);

  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState([]);
  const [parsing, setParsing] = useState(false);

  const fileRef = useRef(null);

  const commitStreetLevel = useCallback((patch) => {
    const p = projectRef.current;
    if (!p) return;
    const cfg = p.imageDatasetConfig || {};
    const next = {
      ...p,
      imageDatasetConfig: { ...cfg, streetLevel: { ...(cfg.streetLevel || {}), ...patch } },
    };
    projectRef.current = next;
    onProjectUpdate(next);
  }, [onProjectUpdate]);

  const commitPoints = useCallback((nextPoints) => commitStreetLevel({ points: nextPoints }), [commitStreetLevel]);

  const addPoints = useCallback((incoming, label) => {
    const current = readStreetLevelConfig(projectRef.current).points;
    const result = mergePoints(current, incoming.filter(Boolean));
    commitPoints(result.points);
    setNotice({
      severity: result.added ? 'success' : 'info',
      text: tx('{label}: added {added}, skipped {dup} duplicate(s){over}.', {
        label,
        added: result.added,
        dup: result.duplicates,
        over: result.overLimit ? tx(', {n} over the {max}-point limit', { n: result.overLimit, max: MAX_POINTS }) : '',
      }),
    });
    return result;
  }, [commitPoints, tx]);

  // ── Map drawing ───────────────────────────────────────────────────────────
  const draftPreview = useMemo(() => {
    if (!draft?.vertices?.length) return [];
    try {
      if (draft.kind === 'road' && draft.vertices.length >= 2) return samplePolyline(draft.vertices, spacing);
      if (draft.kind === 'area' && draft.vertices.length >= 3) return gridInPolygon(draft.vertices, spacing);
      if (draft.kind === 'grid' && draft.vertices.length === 2) {
        const [a, b] = draft.vertices;
        return gridInBounds({ south: a.lat, north: b.lat, west: a.lng, east: b.lng }, spacing);
      }
    } catch (err) {
      return { error: err.message };
    }
    return [];
  }, [draft, spacing]);

  const handleMapClick = (ll) => {
    if (mode === 'pan') return;
    if (mode === 'point') {
      addPoints([normalizePoint({ ...ll, source: 'map-click' })], tx('Map click'));
      return;
    }
    setDraft((d) => {
      const base = d?.kind === mode ? d.vertices : [];
      if (mode === 'grid' && base.length >= 2) return { kind: mode, vertices: [ll] };
      return { kind: mode, vertices: [...base, ll] };
    });
  };

  const finishDraft = () => {
    if (!Array.isArray(draftPreview) || !draftPreview.length) return;
    const source = draft.kind;
    addPoints(draftPreview.map((p) => normalizePoint({ ...p, source })), tx({ road: 'Road', area: 'Area', grid: 'Grid' }[source]));
    setDraft(null);
  };

  const togglePoint = (id, additive) => {
    setSelected((s) => {
      if (additive) return s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      return s.length === 1 && s[0] === id ? [] : [id];
    });
    const idx = readStreetLevelConfig(projectRef.current).points.findIndex((p) => p.id === id);
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
  };

  // ── Paste Google URLs ────────────────────────────────────────────────────
  const parsePaste = async () => {
    const urls = extractUrls(pasteText);
    if (!urls.length) { setParsed([]); return; }
    setParsing(true);
    try {
      const shorts = urls.filter(isShortMapsUrl);
      let expanded = new Map();
      if (shorts.length) {
        try {
          const results = [];
          for (let i = 0; i < shorts.length; i += 50) {
            results.push(...await expandShortLinks(shorts.slice(i, i + 50)));
          }
          expanded = new Map(results.map((r) => [r.input, r]));
        } catch (err) {
          setNotice({ severity: 'warning', text: tx('Short links could not be resolved: {e}', { e: err.message }) });
        }
      }
      const existingKeys = new Set(readStreetLevelConfig(projectRef.current).points.map(pointDedupKey));
      const seen = new Set();
      const rows = urls.map((url) => {
        let target = url;
        let expandedFrom = null;
        if (isShortMapsUrl(url)) {
          const e = expanded.get(url);
          if (!e?.ok) return { url, ok: false, reason: tx('Short link not resolved'), detail: e?.error };
          target = e.url;
          expandedFrom = url;
        }
        const r = parseGoogleMapsUrl(target);
        if (!r.ok) return { url, ok: false, reason: tx(`reason:${r.reason}`) };
        const point = pointFromParsedUrl(r);
        const key = pointDedupKey(point);
        const duplicate = existingKeys.has(key) || seen.has(key);
        seen.add(key);
        return { url, ok: true, parsed: r, point, duplicate, expandedFrom };
      });
      setParsed(rows);
    } finally {
      setParsing(false);
    }
  };

  const addParsed = () => {
    const incoming = parsed.filter((r) => r.ok && !r.duplicate).map((r) => r.point);
    addPoints(incoming, tx('Pasted URLs'));
    setParsed([]);
    setPasteText('');
    setFitKey((k) => k + 1);
  };

  // ── Point table ──────────────────────────────────────────────────────────
  const updatePoint = (id, patch) => {
    const next = readStreetLevelConfig(projectRef.current).points.map((p) => (p.id === id ? normalizePoint({ ...p, ...patch }) || p : p));
    commitPoints(next);
  };
  const deletePoints = (ids) => {
    const drop = new Set(ids);
    commitPoints(readStreetLevelConfig(projectRef.current).points.filter((p) => !drop.has(p.id)));
    setSelected((s) => s.filter((id) => !drop.has(id)));
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const isJson = /\.(geo)?json$/i.test(file.name) || /^\s*[{[]/.test(text);
      const { points: incoming, invalid } = isJson ? pointsFromGeoJson(text) : pointsFromCsv(text);
      addPoints(incoming, file.name);
      if (invalid) setNotice((n) => ({ severity: 'warning', text: `${n?.text || ''} ${tx('{n} row(s) had no valid location.', { n: invalid })}` }));
      setFitKey((k) => k + 1);
    } catch (err) {
      setNotice({ severity: 'error', text: tx('Import failed: {e}', { e: err.message }) });
    }
  };

  const projectSlug = String(currentProject?.name || currentProject?.id || 'project').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const exportCsv = () => downloadText(`${projectSlug}_street_points.csv`, pointsToCsv(points), 'text/csv;charset=utf-8');
  const exportGeoJson = () => downloadText(`${projectSlug}_street_points.geojson`, JSON.stringify(pointsToGeoJson(points), null, 2), 'application/geo+json');

  const pagePoints = points.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const viewEditPoint = viewEdit ? points.find((p) => p.id === viewEdit.id) : null;
  useEffect(() => {
    setPointUrl('');
    setPointUrlError('');
  }, [viewEdit?.id]);

  const applyPointUrl = async (text) => {
    const urls = extractUrls(text);
    if (urls.length !== 1) {
      setPointUrlError(tx(urls.length ? 'Paste one Street View URL, not several.' : 'reason:empty'));
      return;
    }
    let target = urls[0];
    if (isShortMapsUrl(target)) {
      try {
        const [expanded] = await expandShortLinks([target]);
        if (!expanded?.ok || !expanded.url) {
          setPointUrlError(tx('reason:short-link'));
          return;
        }
        target = expanded.url;
      } catch (err) {
        setPointUrlError(tx('Short links could not be resolved: {e}', { e: err.message }));
        return;
      }
    }
    const result = viewPatchFromStreetViewUrl(target);
    if (!result.ok) {
      const reason = result.reason === 'not-pano'
        ? 'That URL is not a Street View panorama.'
        : result.reason === 'several'
          ? 'Paste one Street View URL, not several.'
          : `reason:${result.reason}`;
      setPointUrlError(tx(reason));
      return;
    }
    updatePoint(viewEdit.id, result.patch);
    setPointUrl('');
    setPointUrlError('');
  };
  const pageCount = Math.max(1, Math.ceil(points.length / PAGE_SIZE));

  const persistView = () => { if (view) commitStreetLevel({ view }); };

  const draftCount = Array.isArray(draftPreview) ? draftPreview.length : 0;
  const drawHint = {
    pan: tx('Drag to pan. Click a point to select it.'),
    point: tx('Click the map to add a point.'),
    road: tx('Click along a road, then Finish to sample every {s} m.', { s: spacing }),
    area: tx('Click the corners of an area, then Finish to fill it with a {s} m grid.', { s: spacing }),
    grid: tx('Click two opposite corners, then Finish to create a {s} m grid.', { s: spacing }),
  }[mode];

  return (
    <Dialog open={open} onClose={() => { persistView(); onClose(); }} fullScreen>
      <AppBar position="relative" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ flex: 1, fontSize: 18 }}>{tx('Street-level points & capture')}</Typography>
          <Chip size="small" label={tx('{n} point(s)', { n: points.length })} />
          <IconButton aria-label={tx('Close')} onClick={() => { persistView(); onClose(); }}><Close /></IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, height: 'calc(100vh - 48px)', minHeight: 0 }}>
        <Box sx={{ flex: 1.3, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: { xs: 420, md: 0 } }}>
          <Stack direction="row" spacing={1} sx={{ p: 1, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) { setMode(v); setDraft(null); } }}>
              <ToggleButton value="pan" aria-label={tx('Pan')}><Tooltip title={tx('Pan')}><PanTool fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="point"><Place fontSize="small" sx={{ mr: 0.5 }} />{tx('Point')}</ToggleButton>
              <ToggleButton value="road"><Timeline fontSize="small" sx={{ mr: 0.5 }} />{tx('Road')}</ToggleButton>
              <ToggleButton value="area"><CropSquare fontSize="small" sx={{ mr: 0.5 }} />{tx('Area')}</ToggleButton>
              <ToggleButton value="grid"><GridOn fontSize="small" sx={{ mr: 0.5 }} />{tx('Grid')}</ToggleButton>
            </ToggleButtonGroup>
            {['road', 'area', 'grid'].includes(mode) && (
              <>
                <TextField size="small" type="number" label={tx('Spacing (m)')} value={spacing} sx={{ width: 110 }}
                  inputProps={{ min: 5, max: 1000 }}
                  onChange={(e) => setSpacing(Math.max(5, Math.min(1000, Number(e.target.value) || 25)))} />
                <Button size="small" variant="contained" disabled={!draftCount} onClick={finishDraft}>
                  {tx('Finish ({n})', { n: draftCount })}
                </Button>
                <Button size="small" onClick={() => setDraft(null)} disabled={!draft}>{tx('Clear drawing')}</Button>
              </>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" startIcon={<OpenInNew />} disabled={!view}
              onClick={() => openGoogle(buildGoogleMapUrl(view))}>
              {tx('Open Google Maps here')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<OpenInNew />} disabled={!view}
              onClick={() => openGoogle(buildStreetViewUrl(view))}>
              {tx('Street View here')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 0.5 }}>
            {drawHint}
            {draftPreview?.error ? ` — ${draftPreview.error}` : ''}
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <StreetLevelMap
              points={points}
              selectedIds={selected}
              draft={draft ? { ...draft, preview: Array.isArray(draftPreview) ? draftPreview : [] } : null}
              initialView={config.view || (points[0] ? { lat: points[0].lat, lng: points[0].lng, zoom: 16 } : null)}
              onMapClick={handleMapClick}
              onPointClick={(id, e) => togglePoint(id, e?.shiftKey || e?.metaKey || e?.ctrlKey)}
              onViewChange={setView}
              fitKey={fitKey}
            />
          </Box>
        </Box>

        <Divider orientation="vertical" flexItem />
        <Box sx={{ width: { xs: '100%', md: 560 }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {notice && (
            <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ m: 1, mb: 0 }}>{notice.text}</Alert>
          )}
          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
            <Stack spacing={1.5}>
              <StreetLevelDownloadPanel
                points={points}
                selectedIds={selected}
                currentProject={currentProject}
                projectRef={projectRef}
                projectPrefix={projectPrefix}
                onProjectUpdate={onProjectUpdate}
                commitStreetLevel={commitStreetLevel}
                initialCapture={config.capture}
                lastJob={config.lastJob}
                onItemsChange={setDownloadItems}
              />
              <TextField
                multiline
                minRows={2}
                maxRows={8}
                size="small"
                label={tx('Paste Google Maps / Street View URLs (one or many)')}
                placeholder="https://www.google.com/maps/@1.2966,103.7764,3a,75y,90h,95t/data=…"
                helperText={tx('paste-help')}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              {(pasteText.trim() || parsed.length > 0) && (
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" size="small" onClick={parsePaste} disabled={!pasteText.trim() || parsing}
                    startIcon={parsing ? <CircularProgress size={14} /> : null}>
                    {tx('Parse URLs')}
                  </Button>
                  {parsed.length > 0 && (
                    <Button variant="contained" size="small" onClick={addParsed}
                      disabled={!parsed.some((r) => r.ok && !r.duplicate)}>
                      {tx('Add {n} point(s)', { n: parsed.filter((r) => r.ok && !r.duplicate).length })}
                    </Button>
                  )}
                </Stack>
              )}
              {parsed.length > 0 && (
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'left' } }}>
                  <thead>
                    <tr><th>{tx('Status')}</th><th>lat, lng</th><th>{tx('Own view')}</th><th>{tx('Pano id')}</th></tr>
                  </thead>
                  <tbody>
                    {parsed.map((r, i) => (
                      <tr key={`${r.url}-${i}`}>
                        <td>
                          {!r.ok && <Chip size="small" color="error" label={r.reason} title={r.detail || undefined} />}
                          {r.ok && r.duplicate && <Chip size="small" label={tx('Duplicate')} />}
                          {r.ok && !r.duplicate && <Chip size="small" color="success" label={r.expandedFrom ? tx('OK (short link)') : 'OK'} />}
                          {r.ok && r.parsed.userUploaded && <Chip size="small" color="warning" sx={{ ml: 0.5 }} label={tx('User photo')} />}
                        </td>
                        <td>{r.ok ? `${fmt(r.point.lat)}, ${fmt(r.point.lng)}` : <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>{r.url.slice(0, 60)}</Typography>}</td>
                        <td>{r.ok ? viewLabel(r.point) : ''}</td>
                        <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ok ? r.point.panoId || '—' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              )}

              <Divider />
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ mr: 1 }}>{tx('Point list')}</Typography>
                <input ref={fileRef} type="file" accept=".csv,.geojson,.json,text/csv,application/geo+json,application/json" hidden
                  onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
                <Button size="small" startIcon={<Upload />} onClick={() => fileRef.current?.click()}>{tx('Import CSV / GeoJSON')}</Button>
                <Button size="small" startIcon={<Download />} disabled={!points.length} onClick={exportCsv}>CSV</Button>
                <Button size="small" startIcon={<Download />} disabled={!points.length} onClick={exportGeoJson}>GeoJSON</Button>
                <Button size="small" onClick={() => setFitKey((k) => k + 1)} disabled={!points.length}>{tx('Zoom to points')}</Button>
                <Button size="small" color="error" disabled={!selected.length} onClick={() => deletePoints(selected)}>
                  {tx('Delete selected ({n})', { n: selected.length })}
                </Button>
                <Button size="small" color="error" disabled={!points.length}
                  onClick={() => { if (window.confirm(tx('Delete all {n} points?', { n: points.length }))) deletePoints(points.map((p) => p.id)); }}>
                  {tx('Clear all')}
                </Button>
              </Stack>
              {!points.length && (
                <Typography variant="body2" color="text.secondary">{tx('No points yet. Click the map, draw a road / area / grid, paste Google URLs, or import a file.')}</Typography>
              )}
              {points.length > 0 && (
                <Box component="table" data-testid="street-level-points" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { borderBottom: '1px solid', borderColor: 'divider', p: 0.25, textAlign: 'left', verticalAlign: 'middle' } }}>
                  <thead>
                    <tr>
                      <th>
                        <Checkbox size="small" sx={{ p: 0.25 }}
                          checked={pagePoints.length > 0 && pagePoints.every((p) => selected.includes(p.id))}
                          onChange={(e) => setSelected((s) => (e.target.checked
                            ? [...new Set([...s, ...pagePoints.map((p) => p.id)])]
                            : s.filter((id) => !pagePoints.some((p) => p.id === id))))} />
                      </th>
                      <th>#</th><th>lat, lng</th><th>{tx('View')}</th><th>{tx('Source')}</th><th>{tx('Download')}</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {pagePoints.map((p, i) => {
                      const it = downloadItems[p.id];
                      return (
                        <tr key={p.id} style={selected.includes(p.id) ? { background: 'rgba(255,109,0,0.10)' } : undefined}>
                          <td><Checkbox size="small" sx={{ p: 0.25 }} checked={selected.includes(p.id)} onChange={() => togglePoint(p.id, true)} /></td>
                          <td>{page * PAGE_SIZE + i + 1}</td>
                          <td>
                            <Tooltip title={p.panoId ? `pano ${p.panoId}` : ''}><span>{fmt(p.lat)}, {fmt(p.lng)}</span></Tooltip>
                          </td>
                          <td>
                            {hasOwnView(p)
                              ? <Tooltip title={tx('This point keeps its own view instead of the batch settings.')}><Chip size="small" color="primary" variant="outlined" label={viewLabel(p)} /></Tooltip>
                              : <Typography variant="caption" color="text.secondary">{tx('Batch')}</Typography>}
                          </td>
                          <td><Typography variant="caption">{tx(`source:${p.source}`)}</Typography></td>
                          <td>
                            {it ? <Chip size="small" color={STATUS_COLOR[it.status] || 'default'} variant={it.status === 'done' ? 'filled' : 'outlined'}
                              label={tx(`item:${it.status}`)} title={it.error || undefined} /> : null}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <Tooltip title={tx('Edit this point’s view')}>
                              <IconButton size="small" aria-label={tx('Edit this point’s view')}
                                onClick={(e) => setViewEdit({ anchor: e.currentTarget, id: p.id })}><Tune fontSize="inherit" /></IconButton>
                            </Tooltip>
                            <Tooltip title={tx('Open in Google Street View')}>
                              <IconButton size="small" aria-label={tx('Open in Google Street View')}
                                onClick={() => openGoogle(buildStreetViewUrl({ ...p, heading: p.heading ?? p.roadBearing }))}><OpenInNew fontSize="inherit" /></IconButton>
                            </Tooltip>
                            <Tooltip title={tx('Delete')}>
                              <IconButton size="small" aria-label={tx('Delete')} onClick={() => deletePoints([p.id])}><DeleteOutline fontSize="inherit" /></IconButton>
                            </Tooltip>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Box>
              )}
              {pageCount > 1 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Button size="small" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>‹</Button>
                  <Typography variant="caption">{tx('Page {p} / {n}', { p: page + 1, n: pageCount })}</Typography>
                  <Button size="small" disabled={page >= pageCount - 1} onClick={() => setPage((x) => x + 1)}>›</Button>
                </Stack>
              )}
            </Stack>
          </Box>
        </Box>
        <Popover
          open={Boolean(viewEditPoint)}
          anchorEl={viewEdit?.anchor}
          onClose={() => setViewEdit(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {viewEditPoint && (
            <Box sx={{ p: 1.5, width: 340 }} data-testid="point-view-editor">
              <Typography variant="subtitle2">{tx('View for point #{n}', { n: points.indexOf(viewEditPoint) + 1 })}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{tx('Leave empty to use the batch settings.')}</Typography>
              <TextField
                size="small"
                fullWidth
                label={tx('Paste a Street View URL')}
                placeholder="https://www.google.com/maps/…"
                value={pointUrl}
                error={Boolean(pointUrlError)}
                helperText={pointUrlError || tx('point-url-help')}
                inputProps={{ 'data-testid': 'point-view-url' }}
                onChange={(e) => { setPointUrl(e.target.value); setPointUrlError(''); }}
                onPaste={(e) => {
                  const text = e.clipboardData?.getData('text') || '';
                  if (!text.trim()) return;
                  e.preventDefault();
                  setPointUrl(text.trim());
                  applyPointUrl(text);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyPointUrl(pointUrl); }
                }}
              />
              <Button size="small" sx={{ mt: 0.5, mb: 1 }} disabled={!pointUrl.trim()} onClick={() => applyPointUrl(pointUrl)}>
                {tx('Apply this URL')}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {tx('Pano id')}: {viewEditPoint.panoId || '—'}
              </Typography>
              <Stack direction="row" spacing={1}>
                <NumberCell label={tx('Heading')} value={viewEditPoint.heading} min={-360} max={720} width={56}
                  placeholder={tx('Heading')} onCommit={(v) => updatePoint(viewEditPoint.id, { heading: v })} />
                <NumberCell label={tx('Pitch')} value={viewEditPoint.pitch} min={-90} max={90} width={48}
                  placeholder={tx('Pitch')} onCommit={(v) => updatePoint(viewEditPoint.id, { pitch: v })} />
                <NumberCell label="FOV" value={viewEditPoint.fov} min={10} max={120} width={44}
                  placeholder="FOV" onCommit={(v) => updatePoint(viewEditPoint.id, { fov: v })} />
              </Stack>
              <Button size="small" sx={{ mt: 1 }} disabled={!hasOwnView(viewEditPoint)}
                onClick={() => { updatePoint(viewEditPoint.id, { heading: null, pitch: null, fov: null }); setViewEdit(null); }}>
                {tx('Use batch settings')}
              </Button>
            </Box>
          )}
        </Popover>
      </Box>
    </Dialog>
  );
}
