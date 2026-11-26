/**
 * Geographic map answers. Coordinates are GeoJSON [longitude, latitude].
 * Image-annotation 0–1 coordinates are a different system and are rejected here.
 */

export const MAP_ANSWER_SCHEMA_VERSION = 1;
export const MAP_TASK_ORDERS = Object.freeze(['liked_first', 'disliked_first']);
export const MAP_STATUSES = Object.freeze(['annotated', 'none', 'unfamiliar', 'skipped']);
export const COMPLETED_MAP_STATUSES = Object.freeze(['annotated', 'none']);
export const CELL_METERS_OPTIONS = Object.freeze([100, 250, 500]);
const MAX_VERTICES = 80;
const MAX_PAYLOAD_CHARS = 200000;

export function mapTaskOrderFromSeed(seed) {
  let hash = 2166136261;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? 'liked_first' : 'disliked_first';
}

/** Same seed always yields the same liked/disliked page order. */
export function applyMapTaskOrder(surveyJson, seed) {
  const spec = surveyJson?.spMapTaskOrder;
  if (!spec?.firstPage || !spec?.secondPage || !Array.isArray(surveyJson?.pages)) return surveyJson;
  const order = MAP_TASK_ORDERS.includes(spec.order)
    ? spec.order
    : mapTaskOrderFromSeed(seed);
  const pages = surveyJson.pages.slice();
  const first = pages.findIndex((page) => page.name === spec.firstPage);
  const second = pages.findIndex((page) => page.name === spec.secondPage);
  if (first < 0 || second < 0) return { ...surveyJson, spMapTaskOrder: { ...spec, order } };
  if (order === 'disliked_first' && first < second) {
    const [liked] = pages.splice(first, 1);
    const dislikedAt = pages.findIndex((page) => page.name === spec.secondPage);
    pages.splice(dislikedAt + 1, 0, liked);
  }
  return { ...surveyJson, pages, spMapTaskOrder: { ...spec, order } };
}

export function readResponseValue(row, name) {
  const raw = row?.responses?.[name];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'answer')) {
    return raw.answer;
  }
  return raw;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isLngLat(pair) {
  return Array.isArray(pair) && pair.length >= 2
    && finite(pair[0]) != null && finite(pair[1]) != null
    && pair[0] >= -180 && pair[0] <= 180
    && pair[1] >= -90 && pair[1] <= 90;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function ringSelfIntersects(ring) {
  const n = ring.length - 1;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rectangleRing(a, b) {
  const west = Math.min(a[0], b[0]);
  const east = Math.max(a[0], b[0]);
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

export function closeRing(ring) {
  if (!ring?.length) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.map((pair) => [pair[0], pair[1]]);
  return [...ring.map((pair) => [pair[0], pair[1]]), [first[0], first[1]]];
}

function geometryOf(feature) {
  return feature?.geometry || null;
}

export function featureVertices(feature) {
  const geometry = geometryOf(feature);
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return geometry.coordinates || [];
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] || [];
  return [];
}

export function lineLengthMeters(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const [east, north] = localMeters(coordinates[i - 1], coordinates[i]);
    total += Math.hypot(east, north);
  }
  return total;
}

export function insideStudyArea(point, studyArea) {
  const ring = studyArea?.boundary?.type === 'Polygon' ? studyArea.boundary.coordinates?.[0] : null;
  if (!ring?.length) return true;
  return pointInRing(point, ring);
}

export function validateMapFeature(feature, studyArea) {
  const errors = [];
  const geometry = geometryOf(feature);
  if (!feature?.id) errors.push('missing feature id');
  if (!geometry || (geometry.type !== 'Point' && geometry.type !== 'LineString' && geometry.type !== 'Polygon')) {
    errors.push('geometry must be a Point, LineString, or Polygon');
    return errors;
  }
  const vertices = featureVertices(feature);
  if (vertices.length > MAX_VERTICES) errors.push('too many vertices');
  if (!vertices.every(isLngLat)) errors.push('coordinates must be [longitude, latitude]');
  if (geometry.type === 'LineString' && vertices.length < 2) errors.push('line needs two points');
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates?.[0] || [];
    if (ring.length < 4) errors.push('polygon ring is too short');
    const closed = ring[0] && ring[ring.length - 1]
      && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    if (!closed) errors.push('polygon ring must be closed');
    if (ringSelfIntersects(ring)) errors.push('polygon crosses itself');
    if (Math.abs(ringArea(ring)) === 0) errors.push('polygon has no area');
  }
  if (studyArea && vertices.some((point) => !insideStudyArea(point, studyArea))) {
    errors.push('annotation is outside the study area');
  }
  return errors;
}

export function emptyMapAnswer(studyArea, status = null) {
  return {
    schemaVersion: MAP_ANSWER_SCHEMA_VERSION,
    studyAreaId: studyArea?.id || null,
    studyAreaRevision: studyArea?.revision || null,
    cityId: studyArea?.cityId || studyArea?.id || null,
    status,
    features: { type: 'FeatureCollection', features: [] },
  };
}

export function isImageAnnotationAnswer(value) {
  return Array.isArray(value?.shapes) && !value?.features;
}

export function validateMapAnswer(value, { studyArea = null, maxAnnotations = 5 } = {}) {
  if (isImageAnnotationAnswer(value)) {
    return { ok: false, errors: ['image annotation coordinates are not geographic'] };
  }
  if (value == null || value === '') return { ok: false, errors: ['missing answer'] };
  const errors = [];
  if (value.schemaVersion !== MAP_ANSWER_SCHEMA_VERSION) errors.push('unsupported map answer version');
  if (!MAP_STATUSES.includes(value.status)) errors.push('status is missing');
  const features = value.features?.type === 'FeatureCollection' ? value.features.features : null;
  if (!Array.isArray(features)) errors.push('features must be a GeoJSON FeatureCollection');
  if (JSON.stringify(value).length > MAX_PAYLOAD_CHARS) errors.push('answer is too large');
  if (features && features.length > maxAnnotations) errors.push('too many annotations');
  (features || []).forEach((feature) => {
    validateMapFeature(feature, studyArea).forEach((error) => errors.push(error));
  });
  if (value.status === 'annotated' && !(features || []).length) errors.push('annotated status needs a feature');
  if (value.status === 'none' && (features || []).length) errors.push('none status cannot include features');
  if (studyArea && value.studyAreaId && value.studyAreaId !== studyArea.id) errors.push('study area does not match');
  if (studyArea && value.studyAreaRevision && value.studyAreaRevision !== studyArea.revision) {
    errors.push('study area revision does not match');
  }
  return { ok: errors.length === 0, errors };
}

export function listStudyAreas(question) {
  const raw = question?.studyAreas;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return question?.studyArea ? [question.studyArea] : [];
}

export function mapLayerPolarity(question) {
  if (question?.mapPolarity === 'positive' || question?.mapPolarity === 'negative') return question.mapPolarity;
  return question?.mapLabel === 'disliked' ? 'negative' : 'positive';
}

export function mapLayerName(question, polarity = mapLayerPolarity(question)) {
  const label = String(question?.mapLabel || '').trim();
  if (label === 'disliked') return 'Disliked';
  if (label === 'liked') return 'Liked';
  if (label) return label;
  return polarity === 'negative' ? 'Disliked' : 'Liked';
}

function namedPairId(question) {
  return String(question?.mapPair || '').trim();
}

function analysisResult(positive, negative, pairId, mode) {
  return {
    mode,
    pairId: pairId || '',
    positive: positive || null,
    negative: negative || null,
    question: (mode === 'intensity' ? positive : positive || negative) || null,
    positiveName: mapLayerName(positive, 'positive'),
    negativeName: mode === 'paired' ? mapLayerName(negative, 'negative') : '',
  };
}

/**
 * Decide the analysis for one map question.
 * The same mapPair name on one positive question and one negative question is one pair.
 * A different name is a different pair. single, or a pair name with no opposite side, is overlap intensity.
 * Questions still named by the template recommendation pair together when they have no pair name.
 */
export function resolveMapQuestionAnalysis(question, questions, recommendation) {
  const maps = (questions || []).filter((item) => item?.type === 'mapannotation');
  const self = maps.find((item) => item?.name && item.name === question?.name) || (question?.type === 'mapannotation' ? question : null);
  if (!self) return analysisResult(null, null, '', 'intensity');
  if (self.mapPolarity === 'single') return analysisResult(self, null, '', 'intensity');
  const pairId = namedPairId(self);
  if (pairId) {
    const group = maps.filter((item) => namedPairId(item) === pairId && item.mapPolarity !== 'single');
    const side = mapLayerPolarity(self);
    const partner = group.find((item) => item.name !== self.name && mapLayerPolarity(item) !== side);
    if (!partner) return analysisResult(self, null, pairId, 'intensity');
    const positive = side === 'negative' ? partner : self;
    const negative = side === 'negative' ? self : partner;
    return analysisResult(positive, negative, pairId, 'paired');
  }
  const legacyPositiveName = recommendation?.likedQuestion || 'liked_areas';
  const legacyNegativeName = recommendation?.dislikedQuestion || 'disliked_areas';
  if (self.name === legacyPositiveName || self.name === legacyNegativeName) {
    const positive = maps.find((item) => item.name === legacyPositiveName && item.mapPolarity !== 'single' && !namedPairId(item));
    const negative = maps.find((item) => item.name === legacyNegativeName && item.mapPolarity !== 'single' && !namedPairId(item));
    if (positive && negative && positive.name !== negative.name) return analysisResult(positive, negative, '', 'paired');
  }
  return analysisResult(self, null, '', 'intensity');
}

/** Survey-level pair used by the results summary. Named pairs stay on their own questions. */
export function resolveEvaluativeMapPair(questions, recommendation) {
  const maps = (questions || []).filter((item) => item?.type === 'mapannotation');
  const legacyPositiveName = recommendation?.likedQuestion || 'liked_areas';
  const legacyNegativeName = recommendation?.dislikedQuestion || 'disliked_areas';
  const anchor = maps.find((item) => item.name === legacyPositiveName)
    || maps.find((item) => item.name === legacyNegativeName)
    || maps[0];
  const analysis = resolveMapQuestionAnalysis(anchor, maps, recommendation);
  return {
    mode: analysis.mode,
    pairId: analysis.pairId,
    positive: analysis.positive,
    negative: analysis.negative,
    positiveName: analysis.positiveName,
    negativeName: analysis.negativeName,
  };
}

export function resolveStudyArea(question, cityValue) {
  const areas = listStudyAreas(question);
  if (cityValue) {
    const match = areas.find((area) => area?.cityId === cityValue || area?.id === cityValue);
    if (match) return match;
  }
  return areas[0] || null;
}

const METERS_PER_DEGREE_LAT = 111320;

function localMeters(origin, point) {
  const latScale = METERS_PER_DEGREE_LAT * Math.cos((origin[1] * Math.PI) / 180);
  return [(point[0] - origin[0]) * latScale, (point[1] - origin[1]) * METERS_PER_DEGREE_LAT];
}

export function gridCellRing(origin, ix, iy, cellMeters) {
  const latScale = METERS_PER_DEGREE_LAT * Math.cos((origin[1] * Math.PI) / 180);
  const corner = (x, y) => [origin[0] + x / latScale, origin[1] + y / METERS_PER_DEGREE_LAT];
  const sw = corner(ix * cellMeters, iy * cellMeters);
  const se = corner((ix + 1) * cellMeters, iy * cellMeters);
  const ne = corner((ix + 1) * cellMeters, (iy + 1) * cellMeters);
  const nw = corner(ix * cellMeters, (iy + 1) * cellMeters);
  return [sw, se, ne, nw, sw];
}

function boundsOfRing(ring) {
  const lngs = ring.map((point) => point[0]);
  const lats = ring.map((point) => point[1]);
  return {
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

function polygonCoversCell(ring, cell) {
  if (cell.some((corner) => pointInRing(corner, ring))) return true;
  if (ring.some((point) => pointInRing(point, cell))) return true;
  for (let i = 0; i < ring.length - 1; i += 1) {
    for (let j = 0; j < cell.length - 1; j += 1) {
      if (segmentsCross(ring[i], ring[i + 1], cell[j], cell[j + 1])) return true;
    }
  }
  return false;
}

function completedStatus(answer) {
  if (!answer || answer.schemaVersion !== MAP_ANSWER_SCHEMA_VERSION) return null;
  if (answer.status === 'none') return 'none';
  if (answer.status === 'annotated' && answer.features?.features?.length) return 'annotated';
  if (answer.status === 'unfamiliar' || answer.status === 'skipped') return answer.status;
  return null;
}

function responseKey(row, index) {
  return String(row?.id || row?.participant_id || `row-${index}`);
}

/**
 * Fixed-meter grid over one study-area revision.
 * A person counts once per layer per cell. Points stay on their own layer.
 * mode "paired" uses people who completed both questions (annotated or explicit none).
 * step() counts a batch of responses so a large set can show progress without blocking the page.
 */
export function startGeographicEvaluativeMap(rows, {
  likedQuestion,
  dislikedQuestion,
  studyArea,
  cellMeters = 250,
  mode = 'paired',
} = {}) {
  const list = rows || [];
  const empty = { ok: false, error: 'study area is required', cells: [], points: [] };
  const size = CELL_METERS_OPTIONS.includes(cellMeters) ? cellMeters : 250;
  const ring = studyArea?.boundary?.coordinates?.[0];
  if (!studyArea?.id || !ring?.length) {
    return {
      step() { return { done: true, loaded: 0, total: list.length }; },
      finish() { return empty; },
    };
  }
  const origin = ring[0];
  const box = boundsOfRing(ring);
  const originMeters = localMeters(origin, origin);
  const northEast = localMeters(origin, [box.east, box.north]);
  const cols = Math.max(1, Math.ceil((northEast[0] - originMeters[0]) / size));
  const rowsN = Math.max(1, Math.ceil((northEast[1] - originMeters[1]) / size));
  const single = mode === 'intensity';
  const liked = new Map();
  const disliked = new Map();
  const points = [];
  const lines = [];
  let pairedN = 0;
  let likedCompleted = 0;
  let dislikedCompleted = 0;
  let unfamiliar = 0;
  let skipped = 0;
  let missing = 0;
  let rejectedImage = 0;
  let index = 0;
  const processRow = (row) => {
    const id = responseKey(row, index);
    const likedAnswer = readResponseValue(row, likedQuestion);
    const dislikedAnswer = single ? null : readResponseValue(row, dislikedQuestion);
    if (isImageAnnotationAnswer(likedAnswer) || isImageAnnotationAnswer(dislikedAnswer)) {
      rejectedImage += 1;
      return;
    }
    const likedStatus = completedStatus(likedAnswer);
    const dislikedStatus = completedStatus(dislikedAnswer);
    if (likedAnswer?.status === 'unfamiliar' || dislikedAnswer?.status === 'unfamiliar') unfamiliar += 1;
    if (likedAnswer?.status === 'skipped' || dislikedAnswer?.status === 'skipped') skipped += 1;
    const likedOk = COMPLETED_MAP_STATUSES.includes(likedStatus);
    const dislikedOk = COMPLETED_MAP_STATUSES.includes(dislikedStatus);
    if (likedOk) likedCompleted += 1;
    if (!single && dislikedOk) dislikedCompleted += 1;
    if (single && !likedOk) {
      const familiarGap = likedAnswer?.status !== 'unfamiliar' && likedAnswer?.status !== 'skipped';
      if (familiarGap) missing += 1;
      return;
    }
    const includeLiked = single || mode === 'separate' ? likedOk : (likedOk && dislikedOk);
    const includeDisliked = single ? false : (mode === 'separate' ? dislikedOk : (likedOk && dislikedOk));
    if (single) {
      pairedN += 1;
    } else if (mode === 'paired' && !(likedOk && dislikedOk)) {
      const familiarGap = likedAnswer?.status !== 'unfamiliar' && dislikedAnswer?.status !== 'unfamiliar'
        && likedAnswer?.status !== 'skipped' && dislikedAnswer?.status !== 'skipped';
      if (familiarGap) missing += 1;
      return;
    }
    if (includeLiked && includeDisliked) pairedN += 1;
    const cover = (answer, layer, include, layerName) => {
      if (!include || answer?.studyAreaRevision !== studyArea.revision || answer?.studyAreaId !== studyArea.id) return;
      const seen = new Set();
      (answer.features?.features || []).forEach((feature) => {
        if (feature.geometry?.type === 'Point') {
          points.push({
            id: feature.id,
            participantId: id,
            layer: layerName,
            coordinates: feature.geometry.coordinates,
            properties: feature.properties || {},
          });
          return;
        }
        if (feature.geometry?.type === 'LineString') {
          lines.push({
            id: feature.id,
            participantId: id,
            layer: layerName,
            coordinates: feature.geometry.coordinates,
            lengthMeters: lineLengthMeters(feature.geometry.coordinates),
            properties: feature.properties || {},
          });
          return;
        }
        const poly = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates[0] : null;
        if (!poly) return;
        const polyBox = boundsOfRing(poly);
        const southWest = localMeters(origin, [polyBox.west, polyBox.south]);
        const northEastBox = localMeters(origin, [polyBox.east, polyBox.north]);
        const ix0 = Math.max(0, Math.floor(southWest[0] / size) - 1);
        const iy0 = Math.max(0, Math.floor(southWest[1] / size) - 1);
        const ix1 = Math.min(cols - 1, Math.floor(northEastBox[0] / size) + 1);
        const iy1 = Math.min(rowsN - 1, Math.floor(northEastBox[1] / size) + 1);
        for (let ix = ix0; ix <= ix1; ix += 1) {
          for (let iy = iy0; iy <= iy1; iy += 1) {
            const key = `${ix},${iy}`;
            if (seen.has(key)) continue;
            if (polygonCoversCell(poly, gridCellRing(origin, ix, iy, size))) seen.add(key);
          }
        }
      });
      seen.forEach((key) => layer.set(key, (layer.get(key) || new Set()).add(id)));
    };
    cover(likedAnswer, liked, includeLiked, 'liked');
    cover(dislikedAnswer, disliked, includeDisliked, 'disliked');
  };
  const finish = () => {
  const denominator = single ? likedCompleted : (mode === 'separate' ? null : pairedN);
  const cells = [];
  for (let ix = 0; ix < cols; ix += 1) {
    for (let iy = 0; iy < rowsN; iy += 1) {
      const key = `${ix},${iy}`;
      const likedCount = liked.get(key)?.size || 0;
      const dislikedCount = disliked.get(key)?.size || 0;
      if (!likedCount && !dislikedCount) continue;
      const likedShare = denominator ? likedCount / denominator : (likedCompleted ? likedCount / likedCompleted : 0);
      const dislikedShare = denominator ? dislikedCount / denominator : (dislikedCompleted ? dislikedCount / dislikedCompleted : 0);
      const center = gridCellRing(origin, ix, iy, size)[0];
      cells.push({
        key,
        ix,
        iy,
        longitude: center[0],
        latitude: center[1],
        likedCount,
        dislikedCount,
        likedShare,
        dislikedShare,
        net: single ? likedShare : likedShare - dislikedShare,
      });
    }
  }
  return {
    ok: true,
    mode,
    cellMeters: size,
    studyAreaId: studyArea.id,
    studyAreaRevision: studyArea.revision,
    cityId: studyArea.cityId || studyArea.id,
    denominator,
    likedCompleted,
    dislikedCompleted,
    pairedN,
    unfamiliar,
    skipped,
    missing,
    rejectedImage,
    cells,
    points,
    lines,
    note: 'Grid shares are a reproducible adaptation. Nasar overlaid personal evaluative maps and tabulated overlap frequency.',
  };
  };
  return {
    step(batch = 20) {
      const end = Math.min(list.length, index + Math.max(1, batch));
      for (; index < end; index += 1) processRow(list[index]);
      return { done: index >= list.length, loaded: index, total: list.length };
    },
    finish,
  };
}

export function geographicEvaluativeMap(rows, options) {
  const job = startGeographicEvaluativeMap(rows, options);
  while (!job.step(100000).done) { /* drain */ }
  return job.finish();
}

export function compareGeographicMaps(left, right) {
  if (!left?.ok || !right?.ok) return { ok: false, error: 'both maps must be computed' };
  if (left.studyAreaId !== right.studyAreaId || left.studyAreaRevision !== right.studyAreaRevision) {
    return { ok: false, error: 'maps use different study areas' };
  }
  if (left.cellMeters !== right.cellMeters) return { ok: false, error: 'maps use different cell sizes' };
  const keys = new Set([...left.cells.map((cell) => cell.key), ...right.cells.map((cell) => cell.key)]);
  const byKey = (map) => new Map(map.cells.map((cell) => [cell.key, cell]));
  const a = byKey(left);
  const b = byKey(right);
  const cells = [...keys].map((key) => {
    const leftCell = a.get(key);
    const rightCell = b.get(key);
    return {
      key,
      longitude: (leftCell || rightCell).longitude,
      latitude: (leftCell || rightCell).latitude,
      leftNet: leftCell?.net || 0,
      rightNet: rightCell?.net || 0,
      netDifference: (leftCell?.net || 0) - (rightCell?.net || 0),
    };
  });
  return {
    ok: true,
    leftN: left.denominator,
    rightN: right.denominator,
    cellMeters: left.cellMeters,
    studyAreaId: left.studyAreaId,
    studyAreaRevision: left.studyAreaRevision,
    cells,
  };
}

function answerText(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'answer')) return answerText(value.answer);
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text || null;
}

export function rowMatchesDemographicFilters(row, filters = []) {
  return (filters || []).every((filter) => {
    const value = answerText(readResponseValue(row, filter.question));
    if (filter.op === 'missing') return value == null;
    if (filter.op === 'range') {
      const number = Number(value);
      const min = filter.min === '' || filter.min == null ? null : Number(filter.min);
      const max = filter.max === '' || filter.max == null ? null : Number(filter.max);
      if (min == null && max == null) return true;
      if (!Number.isFinite(number)) return false;
      if (min != null && number < min) return false;
      if (max != null && number > max) return false;
      return true;
    }
    const selected = new Set((filter.values || []).map(String));
    if (selected.has('__missing__') && value == null) return true;
    return value != null && selected.has(value);
  });
}

export function compositionTable(rows, questionName, choices = []) {
  const counts = new Map(choices.map((choice) => [String(choice.value), 0]));
  let missing = 0;
  (rows || []).forEach((row) => {
    const value = answerText(readResponseValue(row, questionName));
    if (value == null) {
      missing += 1;
      return;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  const total = (rows || []).length;
  const items = [...counts.entries()].map(([value, count]) => ({
    value,
    text: choices.find((choice) => String(choice.value) === value)?.text || value,
    count,
    percent: total ? count / total : 0,
  }));
  return { questionName, total, missing, missingRate: total ? missing / total : 0, items };
}

export function mapExportBundle(rows, spec) {
  const map = geographicEvaluativeMap(rows, spec);
  const features = [];
  (rows || []).forEach((row, index) => {
    [spec.likedQuestion, spec.dislikedQuestion].filter(Boolean).forEach((questionName) => {
      const answer = readResponseValue(row, questionName);
      (answer?.features?.features || []).forEach((feature) => {
        features.push({
          participantId: responseKey(row, index),
          question: questionName,
          featureId: feature.id,
          tool: feature.properties?.tool || '',
          label: feature.properties?.label || '',
          placeName: feature.properties?.placeName || '',
          boundaryDescription: feature.properties?.boundaryDescription || '',
          note: feature.properties?.note || '',
          geometry: feature.geometry,
        });
      });
    });
  });
  return {
    config: {
      studyAreaId: spec.studyArea?.id || null,
      studyAreaRevision: spec.studyArea?.revision || null,
      cellMeters: spec.cellMeters || 250,
      mode: spec.mode || 'paired',
      denominator: 'paired explicit completion; none counts, unanswered and unfamiliar do not',
    },
    map,
    features,
    geojson: {
      type: 'FeatureCollection',
      features: features.map((feature) => ({
        type: 'Feature',
        id: feature.featureId,
        geometry: feature.geometry,
        properties: { ...feature, geometry: undefined },
      })),
    },
  };
}
