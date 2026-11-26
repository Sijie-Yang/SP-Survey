import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, Close } from '@mui/icons-material';
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import {
  emptyMapAnswer,
  insideStudyArea,
  rectangleRing,
  resolveStudyArea,
  validateMapAnswer,
} from '../lib/mapAnnotation';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function newId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toLatLng(pair) {
  return [pair[1], pair[0]];
}

function vertexIcon(number, color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font:700 12px/18px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 0 1px ${color}">${number}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function areaLabelIcon(text, point) {
  return L.divIcon({
    className: 'sp-area-label',
    html: `<div style="display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:10px;background:rgba(255,255,255,.94);color:#1b5e20;font:700 12px/20px sans-serif;border:1px solid #1b5e20;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.28)">${text}</div>`,
    iconSize: [72, 20],
    iconAnchor: point ? [-10, 10] : [36, 28],
  });
}

function featureLabelPoint(feature) {
  if (feature.geometry?.type === 'Point') return feature.geometry.coordinates;
  if (feature.geometry?.type === 'LineString') {
    const pts = feature.geometry.coordinates || [];
    if (!pts.length) return null;
    return [
      pts.reduce((sum, pair) => sum + pair[0], 0) / pts.length,
      pts.reduce((sum, pair) => sum + pair[1], 0) / pts.length,
    ];
  }
  const ring = feature.geometry?.coordinates?.[0] || [];
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (!pts.length) return null;
  return [
    pts.reduce((sum, pair) => sum + pair[0], 0) / pts.length,
    pts.reduce((sum, pair) => sum + pair[1], 0) / pts.length,
  ];
}

function shortAreaName(area) {
  if (!area) return '';
  const label = String(area.label || area.cityId || area.id || '');
  return label.split('.')[0].trim();
}

function markName(feature, index) {
  if (feature.geometry?.type === 'Point') return `Point ${index + 1}`;
  if (feature.geometry?.type === 'LineString') return `Line ${index + 1}`;
  return `Area ${index + 1}`;
}

function featureFromDraft(draft, label) {
  if (!draft?.points?.length) return null;
  if (draft.tool === 'point') {
    return {
      type: 'Feature',
      id: newId(),
      geometry: { type: 'Point', coordinates: draft.points[0] },
      properties: { label, tool: 'point', placeName: '', boundaryDescription: '', note: '' },
    };
  }
  if (draft.tool === 'line') {
    return {
      type: 'Feature',
      id: newId(),
      geometry: { type: 'LineString', coordinates: draft.points.slice() },
      properties: { label, tool: 'line', placeName: '', boundaryDescription: '', note: '' },
    };
  }
  const ring = draft.tool === 'rectangle'
    ? rectangleRing(draft.points[0], draft.points[1])
    : [...draft.points, draft.points[0]];
  return {
    type: 'Feature',
    id: newId(),
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { label, tool: draft.tool, placeName: '', boundaryDescription: '', note: '' },
  };
}

/**
 * Participant and researcher map. Drawing lives here; street-level capture does not.
 * Tiles load on view, not as a bulk download. The participant's GPS is never requested.
 */
export default function MapAnnotationWidget({
  question,
  value,
  onChange,
  cityValue = null,
  mode = 'answer',
  readOnly = false,
}) {
  const areas = Array.isArray(question?.studyAreas) ? question.studyAreas : [];
  const cityMatched = cityValue
    ? areas.find((area) => area?.cityId === cityValue || area?.id === cityValue) || null
    : null;
  const studyArea = cityValue ? cityMatched : resolveStudyArea(question, null);
  const maxAnnotations = question?.maxAnnotations ?? 5;
  const label = question?.mapLabel || 'liked';
  const tools = question?.mapTools || ['polygon', 'rectangle', 'point'];
  const holder = useRef(null);
  const mapRef = useRef(null);
  const drawnRef = useRef([]);
  const [tool, setTool] = useState('pan');
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [tileError, setTileError] = useState(false);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [hover, setHover] = useState(null);
  const [confirmPos, setConfirmPos] = useState(null);
  const matchesArea = !value?.studyAreaId || !studyArea
    || (value.studyAreaId === studyArea.id && value.studyAreaRevision === studyArea.revision);
  const blank = useMemo(() => emptyMapAnswer(studyArea, null), [studyArea]);
  const answer = value?.schemaVersion && matchesArea ? value : blank;
  const features = answer.features?.features || blank.features.features;

  useEffect(() => {
    if (!value?.studyAreaId || !studyArea) return;
    if (value.studyAreaId !== studyArea.id || value.studyAreaRevision !== studyArea.revision) onChange?.(null);
  }, [studyArea, value, onChange]);

  const view = useMemo(() => {
    const center = studyArea?.center || [-83.9207, 35.9606];
    return { center: toLatLng(center), zoom: studyArea?.zoom || 12 };
  }, [studyArea]);

  const commit = (nextFeatures, status) => {
    const next = {
      ...emptyMapAnswer(studyArea, status || (nextFeatures.length ? 'annotated' : null)),
      features: { type: 'FeatureCollection', features: nextFeatures },
    };
    if (status) next.status = status;
    const checked = validateMapAnswer(next, { studyArea, maxAnnotations });
    if (!checked.ok && status !== 'none' && status !== 'unfamiliar' && status !== 'skipped') {
      setMessage(checked.errors[0]);
      return;
    }
    setPast((items) => [...items, features]);
    setFuture([]);
    onChange?.(next);
    setMessage('');
  };

  useEffect(() => {
    if (!holder.current || mapRef.current) return undefined;
    const map = L.map(holder.current, { zoomControl: true });
    map.setView(view.center, view.zoom);
    const tiles = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 });
    tiles.on('tileerror', () => setTileError(true));
    tiles.addTo(map);
    mapRef.current = map;
    setMapReady(true);
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [view.center, view.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const drawing = !readOnly && tool !== 'pan';
    if (drawing) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
    }
    map.getContainer().classList.toggle('sp-map-draw', drawing);
    return undefined;
  }, [tool, readOnly, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    drawnRef.current.forEach((layer) => map.removeLayer(layer));
    drawnRef.current = [];
    const ring = studyArea?.boundary?.coordinates?.[0];
    if (ring) {
      drawnRef.current.push(L.polygon(ring.map(toLatLng), {
        color: '#1565c0', weight: 2, fillOpacity: 0.04, interactive: false,
      }).addTo(map));
    }
    features.forEach((feature, index) => {
      const active = feature.id === selected;
      const style = { color: active ? '#e65100' : '#2e7d32', weight: active ? 3 : 2, fillOpacity: 0.25 };
      let layer = null;
      if (feature.geometry?.type === 'Point') layer = L.circleMarker(toLatLng(feature.geometry.coordinates), { ...style, radius: 7 });
      if (feature.geometry?.type === 'LineString') layer = L.polyline(feature.geometry.coordinates.map(toLatLng), style);
      if (feature.geometry?.type === 'Polygon') layer = L.polygon(feature.geometry.coordinates[0].map(toLatLng), style);
      if (!layer) return;
      layer.on('click', () => setSelected(feature.id));
      layer.addTo(map);
      drawnRef.current.push(layer);
      const anchor = featureLabelPoint(feature);
      if (anchor) {
        const tag = L.marker(toLatLng(anchor), {
          interactive: false,
          keyboard: false,
          zIndexOffset: 600,
          icon: areaLabelIcon(markName(feature, index), feature.geometry?.type === 'Point'),
        });
        tag.addTo(map);
        drawnRef.current.push(tag);
      }
      const vertexRing = feature.geometry?.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry?.type === 'Polygon'
          ? feature.geometry.coordinates[0].slice(0, -1)
          : null;
      if (!readOnly && feature.id === selected && vertexRing) {
        vertexRing.forEach((pair, vertexIndex) => {
          const handle = L.marker(toLatLng(pair), {
            draggable: true,
            icon: L.divIcon({ className: '', html: '<div style="width:12px;height:12px;border-radius:50%;background:#e65100;border:2px solid white"></div>', iconSize: [12, 12] }),
          });
          handle.on('dragend', (event) => {
            const moved = event.target.getLatLng();
            const point = [Number(moved.lng.toFixed(6)), Number(moved.lat.toFixed(6))];
            if (studyArea && !insideStudyArea(point, studyArea)) {
              setMessage('That corner is outside the study area.');
              return;
            }
            if (feature.geometry.type === 'LineString') {
              const coordinates = feature.geometry.coordinates.slice();
              coordinates[vertexIndex] = point;
              onChange?.({
                ...answer,
                features: {
                  type: 'FeatureCollection',
                  features: features.map((item) => (item.id === feature.id
                    ? { ...item, geometry: { type: 'LineString', coordinates } }
                    : item)),
                },
              });
              return;
            }
            const ring = feature.geometry.coordinates[0].slice();
            ring[vertexIndex] = point;
            ring[ring.length - 1] = ring[0];
            onChange?.({
              ...answer,
              features: {
                type: 'FeatureCollection',
                features: features.map((item) => (item.id === feature.id
                  ? { ...item, geometry: { type: 'Polygon', coordinates: [ring] } }
                  : item)),
              },
            });
          });
          handle.addTo(map);
          drawnRef.current.push(handle);
        });
      }
    });
    if (draft?.points?.length) {
      const previewPoints = draft.points.slice();
      if (!draft.closed && hover && (draft.tool === 'polygon' || draft.tool === 'line' || (draft.tool === 'rectangle' && previewPoints.length === 1))) {
        previewPoints.push(hover);
      }
      if (draft.tool === 'rectangle' && previewPoints.length >= 2) {
        const ring = rectangleRing(previewPoints[0], previewPoints[1]);
        drawnRef.current.push(L.polygon(ring.map(toLatLng), {
          color: '#6a1b9a', weight: 2, dashArray: draft.closed ? null : '6 4', fillOpacity: 0.12,
        }).addTo(map));
      } else if (draft.tool === 'line' && previewPoints.length >= 2) {
        drawnRef.current.push(L.polyline(previewPoints.map(toLatLng), { color: '#6a1b9a', weight: 2, dashArray: '6 4' }).addTo(map));
      } else if (draft.tool === 'polygon' && (draft.closed || previewPoints.length >= 2)) {
        const latlngs = (draft.closed ? [...draft.points, draft.points[0]] : previewPoints).map(toLatLng);
        drawnRef.current.push((draft.closed ? L.polygon(latlngs, { color: '#6a1b9a', weight: 2, fillOpacity: 0.15 }) : L.polyline(latlngs, { color: '#6a1b9a', dashArray: '6 4' })).addTo(map));
      }
      draft.points.forEach((pair, index) => {
        const marker = L.marker(toLatLng(pair), { icon: vertexIcon(index + 1, index === 0 ? '#6a1b9a' : '#4527a0'), draggable: !readOnly, zIndexOffset: 500 });
        marker.on('click', (event) => {
          L.DomEvent.stop(event);
          if (draft.tool === 'polygon' && index === 0 && draft.points.length >= 3) setDraft((current) => (current ? { ...current, closed: true } : current));
        });
        marker.on('dragend', (event) => {
          const moved = event.target.getLatLng();
          const point = [Number(moved.lng.toFixed(6)), Number(moved.lat.toFixed(6))];
          if (studyArea && !insideStudyArea(point, studyArea)) {
            setMessage('That corner is outside the study area.');
            return;
          }
          setDraft((current) => {
            if (!current) return current;
            const points = current.points.slice();
            points[index] = point;
            return { ...current, points };
          });
        });
        marker.addTo(map);
        drawnRef.current.push(marker);
      });
    }
    return undefined;
  }, [features, draft, hover, selected, studyArea, answer, onChange, readOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const onClick = (event) => {
      if (readOnly || tool === 'pan' || tileError || !studyArea) return;
      if (event.originalEvent?.target?.closest?.('.leaflet-marker-icon')) return;
      const point = [Number(event.latlng.lng.toFixed(6)), Number(event.latlng.lat.toFixed(6))];
      if (!insideStudyArea(point, studyArea)) {
        setMessage('That point is outside the study area. Move it back inside the blue boundary.');
        return;
      }
      if (features.length >= maxAnnotations && !draft) {
        setMessage(`At most ${maxAnnotations} marks.`);
        return;
      }
      if (tool === 'point') {
        setDraft({ tool, points: [point], closed: true });
        return;
      }
      if (tool === 'line') {
        setDraft((current) => ({ tool: 'line', points: [...(current?.points || []), point], closed: false }));
        return;
      }
      if (tool === 'rectangle') {
        setDraft((current) => {
          if (!current?.points?.length) return { tool, points: [point], closed: false };
          return { tool, points: [current.points[0], point], closed: true };
        });
        return;
      }
      if (draft?.tool === 'polygon' && draft.points.length >= 3) {
        const first = map.latLngToContainerPoint(toLatLng(draft.points[0]));
        const here = map.latLngToContainerPoint(event.latlng);
        if (first.distanceTo(here) <= 18) {
          setDraft({ ...draft, closed: true });
          return;
        }
      }
      setDraft((current) => ({ tool: 'polygon', points: [...(current?.points || []), point], closed: false }));
    };
    const onDouble = (event) => {
      if (tool !== 'polygon' && tool !== 'line') return;
      L.DomEvent.stop(event);
      const minimum = tool === 'line' ? 2 : 3;
      setDraft((current) => {
        if (!current || current.points.length < minimum) return current;
        const points = current.points.slice(0, -1);
        return { ...current, points: points.length >= minimum ? points : current.points, closed: tool === 'polygon' && points.length >= 3 };
      });
    };
    const onMove = (event) => {
      if (tool === 'pan' || !draft) return;
      setHover([Number(event.latlng.lng.toFixed(6)), Number(event.latlng.lat.toFixed(6))]);
    };
    map.on('click', onClick);
    map.on('dblclick', onDouble);
    map.on('mousemove', onMove);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDouble);
      map.off('mousemove', onMove);
    };
  });

  const draftReady = draft?.tool === 'point'
    ? draft.points.length === 1
    : draft?.tool === 'rectangle'
      ? draft.points.length >= 2
      : draft?.tool === 'line'
        ? draft.points.length >= 2
        : (draft?.points.length || 0) >= 3;

  const confirmDraft = () => {
    if (!draftReady) {
      setMessage(draft?.tool === 'rectangle'
        ? 'Click two opposite corners, then confirm.'
        : draft?.tool === 'line'
          ? 'Add at least two points, then confirm.'
          : 'Add at least three corners, then confirm.');
      return;
    }
    const feature = featureFromDraft({ ...draft, closed: true }, label);
    setDraft(null);
    setHover(null);
    commit([...features, feature], 'annotated');
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !draft?.points?.length) {
      setConfirmPos(null);
      return undefined;
    }
    const place = () => {
      const anchor = draft.points[draft.points.length - 1];
      const pt = map.latLngToContainerPoint(toLatLng(anchor));
      const size = map.getSize();
      const width = 52;
      const height = 26;
      setConfirmPos({
        x: Math.min(size.x - width - 4, Math.max(4, pt.x - width - 16)),
        y: Math.min(size.y - height - 4, Math.max(4, pt.y - height - 16)),
      });
    };
    place();
    map.on('move zoom resize', place);
    return () => map.off('move zoom resize', place);
  }, [draft, mapReady]);

  const discardDraft = () => {
    setDraft(null);
    setHover(null);
    setMessage('');
  };

  const removeLastVertex = () => {
    setDraft((current) => {
      if (!current?.points?.length) return null;
      const points = current.points.slice(0, -1);
      if (!points.length) return null;
      return { ...current, points, closed: false };
    });
  };

  useEffect(() => {
    if (readOnly) return undefined;
    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea')) return;
      if (event.key === 'Escape') discardDraft();
      if (event.key === 'Enter' && draft) confirmDraft();
      if ((event.key === 'Backspace' || event.key === 'Delete') && draft) {
        event.preventDefault();
        removeLastVertex();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [...items, features]);
    onChange?.({ ...answer, status: previous.length ? 'annotated' : null, features: { type: 'FeatureCollection', features: previous } });
  };

  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((items) => items.slice(0, -1));
    setPast((items) => [...items, features]);
    onChange?.({ ...answer, status: next.length ? 'annotated' : null, features: { type: 'FeatureCollection', features: next } });
  };

  const setStatus = (status) => {
    setDraft(null);
    commit([], status);
  };

  const updateFeature = (id, patch) => {
    onChange?.({
      ...answer,
      features: {
        type: 'FeatureCollection',
        features: features.map((feature) => (feature.id === id
          ? { ...feature, properties: { ...feature.properties, ...patch } }
          : feature)),
      },
    });
  };

  const retryTiles = () => {
    setTileError(false);
    mapRef.current?.eachLayer((layer) => {
      if (layer.redraw) layer.redraw();
    });
  };

  return (
    <Stack gap={1}>
      <Box sx={{ position: 'relative' }}>
        <Box ref={holder} sx={{ height: 420, width: '100%', borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider', position: 'relative', '& .leaflet-container': { height: '100%', width: '100%', background: '#e8eef2' }, '&.sp-map-draw, &.sp-map-draw .leaflet-pane, &.sp-map-draw .leaflet-marker-icon': { cursor: 'crosshair !important' }, '& .sp-area-label': { background: 'none !important', border: 'none !important', pointerEvents: 'none' } }} />
        <Typography
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 500,
            m: 0,
            px: 1.25,
            py: 0.5,
            borderRadius: 1,
            bgcolor: 'rgba(255,255,255,0.94)',
            boxShadow: 1,
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.2,
            pointerEvents: 'none',
          }}
        >
          {features.length} of {maxAnnotations}
        </Typography>
        {draft && confirmPos && (
          <Box
            sx={{
              position: 'absolute',
              top: confirmPos.y,
              left: confirmPos.x,
              zIndex: 1000,
              display: 'flex',
              bgcolor: 'rgba(255,255,255,0.94)',
              borderRadius: '2px',
              boxShadow: 1,
              overflow: 'hidden',
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton color="success" aria-label="Confirm shape" title="Confirm" onClick={confirmDraft} disabled={!draftReady} sx={{ width: 26, height: 26, borderRadius: 0 }}><Check sx={{ fontSize: 16 }} /></IconButton>
            <IconButton color="error" aria-label="Discard shape" title="Discard" onClick={discardDraft} sx={{ width: 26, height: 26, borderRadius: 0 }}><Close sx={{ fontSize: 16 }} /></IconButton>
          </Box>
        )}
      </Box>
      {tileError && (
        <Alert severity="warning" action={<Button color="inherit" size="small" onClick={retryTiles}>Retry</Button>}>
          The base map did not load. No empty answer was saved.
        </Alert>
      )}
      {!readOnly && (
        <Stack direction="row" gap={0.25} sx={{ flexWrap: 'nowrap', overflowX: 'auto', '& .MuiButton-root': { flexShrink: 0, whiteSpace: 'nowrap', px: 1 } }}>
          <Button size="small" variant={tool === 'pan' ? 'contained' : 'outlined'} onClick={() => { setTool('pan'); discardDraft(); }}>Move map / Select</Button>
          {tools.includes('polygon') && <Button size="small" variant={tool === 'polygon' ? 'contained' : 'outlined'} onClick={() => { setTool('polygon'); discardDraft(); }}>Polygon</Button>}
          {tools.includes('rectangle') && <Button size="small" variant={tool === 'rectangle' ? 'contained' : 'outlined'} onClick={() => { setTool('rectangle'); discardDraft(); }}>Rectangle</Button>}
          {tools.includes('point') && <Button size="small" variant={tool === 'point' ? 'contained' : 'outlined'} onClick={() => { setTool('point'); discardDraft(); }}>Point</Button>}
          {tools.includes('line') && <Button size="small" variant={tool === 'line' ? 'contained' : 'outlined'} onClick={() => { setTool('line'); discardDraft(); }}>Line</Button>}
          <Button size="small" disabled={!past.length} onClick={undo}>Undo</Button>
          <Button size="small" disabled={!future.length} onClick={redo}>Redo</Button>
          <Button size="small" color="error" disabled={!selected} onClick={() => commit(features.filter((feature) => feature.id !== selected), features.length > 1 ? 'annotated' : null)}>Delete</Button>
        </Stack>
      )}
      {draft && (
        <Button size="small" onClick={removeLastVertex} disabled={!draft.points.length} sx={{ alignSelf: 'flex-start' }}>Remove last point</Button>
      )}
      {message && <Alert severity="info" onClose={() => setMessage('')}>{message}</Alert>}
      <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0 }}>
        {tool === 'pan' && 'Drag the map, or click a marked area to select it. Then choose Polygon, Rectangle, or Point.'}
        {tool === 'polygon' && 'Polygon: the map does not drag. Click numbered corners. Click corner 1 or double-click to close, then confirm. Escape discards.'}
        {tool === 'rectangle' && 'Rectangle: the map does not drag. Click two opposite corners, then confirm.'}
        {tool === 'point' && 'Point: the map does not drag. Click a place, then confirm. A point is not an area.'}
        {tool === 'line' && 'Line: the map does not drag. Click points along the line, then confirm. Double-click ends it. A line is not an area.'}
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0 }}>
        {!studyArea && cityValue && `“${cityValue}” is not one of the configured study areas.`}
        {!studyArea && !cityValue && 'No study area is configured.'}
        {studyArea && (cityValue
          ? `City: ${shortAreaName(studyArea)}`
          : question?.cityQuestion
            ? `No city selected yet. This preview shows ${shortAreaName(studyArea)}. Participants see the area matching “${question.cityQuestion}”.`
            : shortAreaName(studyArea))}
      </Typography>
      {mode === 'answer' && (
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button size="small" variant={answer.status === 'none' ? 'contained' : 'outlined'} onClick={() => setStatus('none')}>No area to mark</Button>
          <Button size="small" variant={answer.status === 'unfamiliar' ? 'contained' : 'outlined'} onClick={() => setStatus('unfamiliar')}>Not familiar with this city</Button>
          <Button size="small" variant={answer.status === 'skipped' ? 'contained' : 'outlined'} onClick={() => setStatus('skipped')}>Skip</Button>
        </Stack>
      )}
      {features.map((feature, index) => (
        <Stack key={feature.id} gap={1} sx={{ p: 1, border: '1px solid', borderColor: feature.id === selected ? 'warning.main' : 'divider', borderRadius: 1 }} onClick={() => setSelected(feature.id)}>
          <Typography variant="subtitle2">{markName(feature, index)}</Typography>
          <TextField size="small" label="Place name" value={feature.properties?.placeName || ''} onChange={(event) => updateFeature(feature.id, { placeName: event.target.value })} />
          <TextField size="small" label="Why this area" value={feature.properties?.note || ''} onChange={(event) => updateFeature(feature.id, { note: event.target.value })} />
        </Stack>
      ))}
    </Stack>
  );
}

export function StudyAreaFields({ areas = [], onChange, cityChoices = [] }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [note, setNote] = useState('');
  const [geojson, setGeojson] = useState('');
  const [index, setIndex] = useState(0);
  const current = areas[index] || null;
  const updateCurrent = (patch) => {
    if (!current) {
      onChange?.([{ id: 'study-area', revision: 1, cityId: '', zoom: 12, ...patch }]);
      return;
    }
    onChange?.(areas.map((area, i) => (i === index ? { ...area, ...patch } : area)));
  };
  const search = async () => {
    setNote('');
    try {
      const rows = await searchCities(query);
      setHits(rows);
      setNote('Search returns a geocoder view. It is not the administrative boundary. Confirm the box, then adjust it.');
    } catch {
      setNote('City search did not respond. Enter a center and a GeoJSON polygon instead. No location was taken from this browser.');
    }
  };
  const chooseCity = (hit) => {
    updateCurrent({
      revision: (current?.revision || 0) + 1,
      label: hit.label,
      center: [hit.longitude, hit.latitude],
      zoom: current?.zoom || 12,
      boundary: hit.boundingBox ? { type: 'Polygon', coordinates: [hit.boundingBox] } : current?.boundary || null,
    });
  };
  const importGeojson = () => {
    try {
      const parsed = JSON.parse(geojson);
      const geometry = parsed.type === 'Feature' ? parsed.geometry : parsed.type === 'FeatureCollection' ? parsed.features?.[0]?.geometry : parsed;
      if (geometry?.type !== 'Polygon') {
        setNote('Import a Polygon GeoJSON geometry. Longitude comes first.');
        return;
      }
      updateCurrent({ revision: (current?.revision || 0) + 1, boundary: geometry });
      setNote('Imported polygon. Check that it is the study boundary you intend to freeze.');
    } catch {
      setNote('That text is not valid JSON.');
    }
  };
  return (
    <Stack gap={1}>
      <Typography variant="subtitle2">Study areas</Typography>
      {areas.length > 1 && (
        <TextField select size="small" label="Area to edit" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {areas.map((area, i) => <MenuItem key={area.id || i} value={i}>{shortAreaName(area) || `Area ${i + 1}`}</MenuItem>)}
        </TextField>
      )}
      <TextField
        select={cityChoices.length > 0}
        size="small"
        label="City id (matches the city question's choice value)"
        value={current?.cityId || ''}
        onChange={(event) => updateCurrent({ cityId: event.target.value })}
        helperText="Participants who pick this value see this area. Other areas stay unchanged."
      >
        {cityChoices.length > 0 && <MenuItem value="">Not linked</MenuItem>}
        {cityChoices.map((choice) => <MenuItem key={choice.value} value={String(choice.value)}>{choice.text || choice.value}</MenuItem>)}
      </TextField>
      <Stack direction="row" gap={1}>
        <TextField size="small" label="Search a city" value={query} onChange={(event) => setQuery(event.target.value)} fullWidth />
        <Button variant="outlined" onClick={search}>Search</Button>
      </Stack>
      {hits.map((hit) => (
        <Button key={hit.label} size="small" sx={{ justifyContent: 'flex-start' }} onClick={() => chooseCity(hit)}>{hit.label}</Button>
      ))}
      <TextField size="small" label="Paste a Polygon GeoJSON" value={geojson} onChange={(event) => setGeojson(event.target.value)} multiline minRows={2} />
      <Button size="small" variant="outlined" onClick={importGeojson}>Import boundary</Button>
      {current && <Typography variant="caption">Revision {current.revision}. Center {Array.isArray(current.center) ? current.center.join(', ') : 'not set'}. {current.label || current.id}</Typography>}
      {note && <Alert severity="info">{note}</Alert>}
    </Stack>
  );
}

export async function searchCities(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('City search failed');
  const rows = await response.json();
  return (rows || []).map((row) => ({
    label: row.display_name,
    longitude: Number(row.lon),
    latitude: Number(row.lat),
    boundingBox: row.boundingbox
      ? rectangleRing([Number(row.boundingbox[2]), Number(row.boundingbox[0])], [Number(row.boundingbox[3]), Number(row.boundingbox[1])])
      : null,
  }));
}
