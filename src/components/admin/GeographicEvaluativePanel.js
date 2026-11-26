import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Alert, Box, Button, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import {
  compareGeographicMaps,
  geographicEvaluativeMap,
  gridCellRing,
  listStudyAreas,
  mapExportBundle,
  resolveMapQuestionAnalysis,
  startGeographicEvaluativeMap,
} from '../../lib/mapAnnotation';
import { downloadTextFile } from '../../lib/methodsExport';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

const MAP_PROGRESS_MIN = 40;

export function AnalysisProgressBar({ label, loaded = 0, total = null }) {
  const known = Number.isFinite(total) && total > 0;
  const value = known ? Math.max(0, Math.min(100, (100 * loaded) / total)) : 0;
  return (
    <Box role="status" aria-live="polite" sx={{ width: 'min(440px, 100%)', mx: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 2 }}>
      <LinearProgress variant={known ? 'determinate' : 'indeterminate'} value={known ? value : undefined} sx={{ width: '100%' }} />
      <Typography variant="body2" color="text.secondary" textAlign="center">{label}</Typography>
    </Box>
  );
}

/** Small sets stay synchronous. Large sets advance one batch per turn so the bar can move. */
export function useGeographicEvaluativeMaps(entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.rows?.length || 0), 0);
  const heavy = total >= MAP_PROGRESS_MIN;
  const syncMaps = useMemo(() => {
    if (heavy) return null;
    const maps = {};
    entries.forEach((entry) => {
      maps[entry.id] = entry.spec ? geographicEvaluativeMap(entry.rows, entry.spec) : null;
    });
    return maps;
  }, [entries, heavy]);
  const [asyncState, setAsyncState] = useState(null);
  useEffect(() => {
    if (!heavy) {
      setAsyncState(null);
      return undefined;
    }
    let cancelled = false;
    const maps = {};
    let entryIndex = 0;
    let job = null;
    let loadedBefore = 0;
    const tick = () => {
      if (cancelled) return;
      if (!job) {
        if (entryIndex >= entries.length) {
          setAsyncState({ maps, progress: null });
          return;
        }
        const entry = entries[entryIndex];
        job = entry.spec ? startGeographicEvaluativeMap(entry.rows, entry.spec) : {
          step() { return { done: true, loaded: entry.rows?.length || 0, total: entry.rows?.length || 0 }; },
          finish() { return null; },
        };
      }
      const progress = job.step(30);
      if (!progress.done) {
        setAsyncState({ maps: null, progress: { loaded: loadedBefore + progress.loaded, total } });
        window.setTimeout(tick, 0);
        return;
      }
      maps[entries[entryIndex].id] = job.finish();
      loadedBefore += progress.total || progress.loaded;
      entryIndex += 1;
      job = null;
      window.setTimeout(tick, 0);
    };
    setAsyncState({ maps: null, progress: { loaded: 0, total } });
    const timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [entries, heavy, total]);
  if (!heavy) return { maps: syncMaps || {}, progress: null };
  return asyncState || { maps: null, progress: { loaded: 0, total } };
}

function color(net) {
  const clamped = Math.max(-1, Math.min(1, net));
  const red = clamped < 0 ? 180 : Math.round(180 * (1 - clamped));
  const green = clamped > 0 ? 140 : Math.round(140 * (1 + clamped));
  return `rgb(${red},${green},90)`;
}

function cellColor(cell, layer, colorMode) {
  if (colorMode === 'intensity') return `rgba(21,101,192,${Math.max(0.18, Math.min(1, cell.likedShare || 0))})`;
  if (layer === 'liked') return `rgba(46,125,50,${Math.max(0.15, cell.likedShare)})`;
  if (layer === 'disliked') return `rgba(198,40,40,${Math.max(0.15, cell.dislikedShare)})`;
  return color(cell.net);
}

function FeatureMap({ studyArea, points = [], lines = [] }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    if (!holder.current || mapRef.current) return undefined;
    const map = L.map(holder.current);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const drawn = [];
    const bounds = [];
    const ring = studyArea?.boundary?.coordinates?.[0];
    if (ring) {
      const extent = ring.map(([lng, lat]) => [lat, lng]);
      bounds.push(...extent);
      drawn.push(L.polygon(extent, { color: '#1565c0', weight: 2, fillOpacity: 0.03, interactive: false }).addTo(map));
    }
    points.forEach((point) => {
      const latlng = [point.coordinates[1], point.coordinates[0]];
      bounds.push(latlng);
      drawn.push(L.circleMarker(latlng, {
        radius: 6,
        color: point.layer === 'disliked' ? '#c62828' : '#2e7d32',
        fillOpacity: 0.85,
      }).addTo(map));
    });
    lines.forEach((line) => {
      const latlngs = (line.coordinates || []).map(([lng, lat]) => [lat, lng]);
      bounds.push(...latlngs);
      drawn.push(L.polyline(latlngs, {
        color: line.layer === 'disliked' ? '#c62828' : '#1565c0',
        weight: 3,
      }).addTo(map));
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [16, 16] });
    return () => drawn.forEach((shape) => map.removeLayer(shape));
  }, [studyArea, points, lines]);
  return <Box ref={holder} sx={{ height: 360, '& .leaflet-container': { height: '100%', width: '100%', background: '#e8eef2' } }} />;
}

function GridMap({ mapResult, layer, origin, colorMode }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    if (!holder.current || mapRef.current || !mapResult?.ok) return undefined;
    const map = L.map(holder.current);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapResult?.ok]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !origin) return undefined;
    const drawn = [];
    const bounds = [];
    (mapResult.cells || []).forEach((cell) => {
      const ring = gridCellRing(origin, cell.ix, cell.iy, mapResult.cellMeters).map((pair) => [pair[1], pair[0]]);
      bounds.push(...ring);
      drawn.push(L.polygon(ring, { color: cellColor(cell, layer, colorMode), weight: 1, fillOpacity: 0.55 }).addTo(map));
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [12, 12] });
    return () => drawn.forEach((shape) => map.removeLayer(shape));
  }, [mapResult, layer, origin, colorMode]);
  if (!mapResult?.ok) return null;
  return <Box ref={holder} sx={{ height: 360, '& .leaflet-container': { height: '100%', width: '100%', background: '#e8eef2' } }} />;
}

function MapSummary({ map, title, positiveName = 'Liked', negativeName = 'Disliked', mode = 'paired' }) {
  if (!map?.ok) return <Alert severity="warning">{map?.error || 'Map unavailable'}</Alert>;
  return (
    <Stack gap={0.5}>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2">
        {mode === 'intensity'
          ? <>Completed N = {map.denominator ?? '—'}. Strength is how many of these people covered the cell, divided by N. Each person counts once per cell. </>
          : <>Paired participants N = {map.denominator ?? '—'}. {positiveName} completed {map.likedCompleted}, {negativeName} completed {map.dislikedCompleted}. Net is the positive share minus the negative share. </>}
        Unfamiliar {map.unfamiliar}, skipped {map.skipped}, missing {map.missing}.
        Explicit “no area” counts as completed. Unanswered does not. Points are listed separately ({map.points.length}).
      </Typography>
      {!map.cells.length && <Typography variant="body2">No grid cell was covered.</Typography>}
      <Typography variant="caption" color="text.secondary">{map.note} Cell size {map.cellMeters} m. The grid does not follow the browser width.</Typography>
    </Stack>
  );
}

export default function GeographicEvaluativePanel({ question, responses, surveyConfig, questions = [] }) {
  const rec = (surveyConfig?.spAnalysisRecommendation?.items || []).find((item) => item.method === 'geographic_evaluative_map') || {};
  const analysis = resolveMapQuestionAnalysis(question, questions.length ? questions : [question], rec);
  const intensity = analysis.mode === 'intensity';
  const likedQuestion = (intensity ? analysis.question?.name : analysis.positive?.name) || question?.name;
  const dislikedQuestion = intensity ? null : analysis.negative?.name;
  const source = [questions.find((item) => item.name === likedQuestion), questions.find((item) => item.name === dislikedQuestion), question]
    .find((item) => listStudyAreas(item).length) || question;
  const areas = listStudyAreas(source);
  const [cityId, setCityId] = useState(areas[0]?.cityId || areas[0]?.id || '');
  const [cellMeters, setCellMeters] = useState(250);
  const [groupQuestion, setGroupQuestion] = useState('resident_or_visitor');
  const [layer, setLayer] = useState('net');
  const studyArea = areas.find((area) => area.cityId === cityId || area.id === cityId) || areas[0];
  const spec = useMemo(() => ({ likedQuestion, dislikedQuestion, studyArea, cellMeters, mode: intensity ? 'intensity' : 'paired' }), [likedQuestion, dislikedQuestion, studyArea, cellMeters, intensity]);
  const groupSlices = useMemo(() => {
    const values = [...new Set(responses.map((row) => {
      const raw = row.responses?.[groupQuestion];
      const value = raw && typeof raw === 'object' && 'answer' in raw ? raw.answer : raw;
      return value == null || value === '' ? null : String(value);
    }).filter(Boolean))];
    return values.slice(0, 2).map((value) => ({
      value,
      rows: responses.filter((row) => {
        const raw = row.responses?.[groupQuestion];
        const current = raw && typeof raw === 'object' && 'answer' in raw ? raw.answer : raw;
        return String(current) === value;
      }),
    }));
  }, [responses, groupQuestion]);
  const mapEntries = useMemo(() => [
    { id: 'all', rows: responses, spec },
    ...groupSlices.map((group) => ({ id: group.value, rows: group.rows, spec })),
  ], [responses, spec, groupSlices]);
  const { maps, progress: mapProgress } = useGeographicEvaluativeMaps(mapEntries);
  const map = maps?.all || { ok: false, cells: [], points: [], lines: [] };
  const groups = groupSlices.map((group) => ({ value: group.value, map: maps?.[group.value] })).filter((group) => group.map);
  const comparison = groups.length === 2 ? compareGeographicMaps(groups[0].map, groups[1].map) : null;
  const background = questions.filter((item) => ['radiogroup', 'dropdown'].includes(item.type));
  const { t } = useRegion();
  const tools = Array.isArray(source?.mapTools) && source.mapTools.length ? source.mapTools : ['polygon', 'rectangle', 'point'];
  const areaTools = tools.some((tool) => tool === 'polygon' || tool === 'rectangle');
  const ready = Boolean(maps);
  const lines = map.lines || [];
  const showGrid = ready && (Boolean(map.cells?.length) || (areaTools && !map.points?.length && !lines.length));
  const showPoints = map.points?.length > 0 || (tools.includes('point') && !areaTools && !tools.includes('line'));
  const showLines = lines.length > 0 || (tools.includes('line') && !areaTools && !tools.includes('point'));

  const download = () => {
    const bundle = mapExportBundle(responses, spec);
    const header = ['participantId', 'question', 'featureId', 'tool', 'label', 'placeName', 'boundaryDescription', 'note', 'geometry'];
    const csv = [header.join(',')].concat(bundle.features.map((feature) => header.map((key) => JSON.stringify(feature[key] ?? '')).join(','))).join('\n');
    downloadTextFile(JSON.stringify(bundle.geojson, null, 2), 'evaluative-map.geojson');
    downloadTextFile(csv, 'evaluative-map-features.csv');
    downloadTextFile(JSON.stringify({
      config: bundle.config,
      grid: bundle.map.cells,
      comparison,
      participants: responses.length,
    }, null, 2), 'evaluative-map-summary.json');
  };

  return (
    <Stack gap={2}>
      <Alert severity="info">
        {intensity
          ? `${analysis.positiveName} is scored by overlap. Darker blue means a larger share of the people who completed this question covered that cell.`
          : `${analysis.positiveName} and ${analysis.negativeName} are one pair${analysis.pairId ? ` (“${analysis.pairId}”)` : ''}. Net is the positive share minus the negative share. A different pair name is a separate map.`}
        {' '}Image-annotation drawings are not converted into longitude and latitude.
      </Alert>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <TextField select size="small" label="City / study area" value={cityId} onChange={(event) => setCityId(event.target.value)} sx={{ minWidth: 220 }}>
          {areas.map((area) => <MenuItem key={area.id} value={area.cityId || area.id}>{area.label || area.id}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Cell size" value={cellMeters} onChange={(event) => setCellMeters(Number(event.target.value))}>
          {[100, 250, 500].map((meters) => <MenuItem key={meters} value={meters}>{meters} m</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Compare groups" value={groupQuestion} onChange={(event) => setGroupQuestion(event.target.value)} sx={{ minWidth: 220 }}>
          {background.map((item) => <MenuItem key={item.name} value={item.name}>{item.title || item.name}</MenuItem>)}
        </TextField>
        <Button size="small" variant="outlined" onClick={download} disabled={!ready}>Export GeoJSON and summary</Button>
        {showGrid && !intensity && [['liked', analysis.positiveName], ['disliked', analysis.negativeName], ['net', 'Net']].map(([name, label]) => (
          <Button key={name} size="small" variant={layer === name ? 'contained' : 'outlined'} onClick={() => setLayer(name)}>{label}</Button>
        ))}
      </Stack>
      {mapProgress && <AnalysisProgressBar label={tf(t.resultsAnalysisProgress, { loaded: mapProgress.loaded, total: mapProgress.total })} loaded={mapProgress.loaded} total={mapProgress.total} />}
      {!mapProgress && showGrid && <GridMap mapResult={map} layer={intensity ? 'liked' : layer} colorMode={intensity ? 'intensity' : 'paired'} origin={studyArea?.boundary?.coordinates?.[0]?.[0]} />}
      {showGrid && <MapSummary map={map} title={intensity ? 'Overlap strength' : 'Paired area grid'} positiveName={analysis.positiveName} negativeName={analysis.negativeName} mode={analysis.mode} />}
      {ready && showPoints && (
        <Stack gap={0.5}>
          <Typography variant="subtitle2">Points</Typography>
          <Typography variant="body2">
            {map.points.length} point{map.points.length === 1 ? '' : 's'} from {[...new Set(map.points.map((point) => point.participantId))].length} participant{[...new Set(map.points.map((point) => point.participantId))].length === 1 ? '' : 's'}.
            {intensity ? `These points belong to ${analysis.positiveName}.` : `Green is ${analysis.positiveName} and red is ${analysis.negativeName}.`} A point has no area, so it is not painted into the grid.
          </Typography>
          <FeatureMap studyArea={studyArea} points={map.points} />
        </Stack>
      )}
      {ready && showLines && (
        <Stack gap={0.5}>
          <Typography variant="subtitle2">Lines</Typography>
          <Typography variant="body2">
            {lines.length} line{lines.length === 1 ? '' : 's'}, {(lines.reduce((sum, line) => sum + (line.lengthMeters || 0), 0) / 1000).toFixed(2)} km in total.
            Length is measured on the ground. A line is not split into grid cells.
          </Typography>
          <FeatureMap studyArea={studyArea} lines={lines} />
        </Stack>
      )}
      {showGrid && groups.length > 1 && groups.map((group) => (
        <Stack key={group.value} gap={0.5}>
          <Typography variant="subtitle2">{background.find((item) => item.name === groupQuestion)?.title || groupQuestion}: {group.value} (N={group.map.denominator ?? 0})</Typography>
          <GridMap mapResult={group.map} layer={intensity ? 'liked' : layer} colorMode={intensity ? 'intensity' : 'paired'} origin={studyArea?.boundary?.coordinates?.[0]?.[0]} />
        </Stack>
      ))}
      {ready && comparison?.ok && (
        <Typography variant="body2">
          Difference uses the same cells and color meaning. Group sizes {comparison.leftN} and {comparison.rightN}. Cells compared: {comparison.cells.length}.
        </Typography>
      )}
      {ready && comparison && !comparison.ok && <Alert severity="warning">{comparison.error}</Alert>}
    </Stack>
  );
}
