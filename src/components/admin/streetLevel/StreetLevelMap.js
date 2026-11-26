import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Standard OSM tiles washed out to light gray (keyless; CARTO/Stadia toner styles now need API keys),
// so selected points and drawings carry the only strong colour.
const BASEMAP_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const BASEMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const BASEMAP_FILTER = 'grayscale(1) contrast(0.72) brightness(1.12)';

const POINT_STYLE = { radius: 4.5, color: '#ffffff', weight: 1.5, fillColor: '#37474f', fillOpacity: 0.9 };
const SELECTED_STYLE = { radius: 7, color: '#ffffff', weight: 2, fillColor: '#ff6d00', fillOpacity: 1 };
const HEADING_COLOR = '#455a64';
const SELECTED_HEADING_COLOR = '#ff6d00';
const DRAFT_STYLE = { color: '#d500f9', weight: 3.5, dashArray: '7 5' };
const DRAFT_PREVIEW_STYLE = { radius: 3, color: '#d500f9', weight: 1, fillColor: '#d500f9', fillOpacity: 0.75 };

function headingTip(p) {
  if (p.heading == null) return null;
  const len = 0.00018;
  const rad = (p.heading * Math.PI) / 180;
  return [p.lat + len * Math.cos(rad), p.lng + (len * Math.sin(rad)) / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))];
}

/**
 * Platform-owned OpenStreetMap (Leaflet). No Google content is displayed here.
 * Stateless about drawing: the parent owns `draft` vertices and reacts to clicks.
 */
export default function StreetLevelMap({
  points = [],
  selectedIds = [],
  draft = null,
  initialView,
  onMapClick,
  onPointClick,
  onViewChange,
  fitKey,
  height = '100%',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pointLayerRef = useRef(null);
  const draftLayerRef = useRef(null);
  const handlersRef = useRef({});
  handlersRef.current = { onMapClick, onPointClick, onViewChange };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: [initialView?.lat ?? 1.2966, initialView?.lng ?? 103.7764],
      zoom: initialView?.zoom ?? 15,
      zoomControl: true,
    });
    const tiles = L.tileLayer(BASEMAP_TILES, { maxZoom: 19, opacity: 0.85, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
    const tileContainer = tiles.getContainer();
    if (tileContainer) tileContainer.style.filter = BASEMAP_FILTER;
    pointLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    const emitView = () => {
      const c = map.getCenter();
      handlersRef.current.onViewChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on('click', (e) => handlersRef.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.on('moveend', emitView);
    emitView();
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const layer = pointLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const selected = new Set(selectedIds);
    points.forEach((p) => {
      const isSel = selected.has(p.id);
      const tip = headingTip(p);
      if (tip) L.polyline([[p.lat, p.lng], tip], { color: isSel ? SELECTED_HEADING_COLOR : HEADING_COLOR, weight: 2 }).addTo(layer);
      const marker = L.circleMarker([p.lat, p.lng], isSel ? SELECTED_STYLE : POINT_STYLE).addTo(layer);
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        handlersRef.current.onPointClick?.(p.id, e.originalEvent);
      });
      if (p.label) marker.bindTooltip(p.label);
    });
  }, [points, selectedIds]);

  useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft?.vertices?.length) return;
    const latlngs = draft.vertices.map((v) => [v.lat, v.lng]);
    if (draft.kind === 'grid' && latlngs.length === 2) {
      L.rectangle(latlngs, { ...DRAFT_STYLE, fillOpacity: 0.08 }).addTo(layer);
    } else if (draft.kind === 'area' && latlngs.length >= 3) {
      L.polygon(latlngs, { ...DRAFT_STYLE, fillOpacity: 0.08 }).addTo(layer);
    } else if (latlngs.length >= 2) {
      L.polyline(latlngs, DRAFT_STYLE).addTo(layer);
    }
    latlngs.forEach((ll) => L.circleMarker(ll, { radius: 5, color: '#ffffff', weight: 2, fillColor: '#d500f9', fillOpacity: 1 }).addTo(layer));
    (draft.preview || []).forEach((p) => L.circleMarker([p.lat, p.lng], DRAFT_PREVIEW_STYLE).addTo(layer));
  }, [draft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey || !points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 18 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} data-testid="street-level-map" style={{ width: '100%', height, minHeight: 320 }} />;
}
