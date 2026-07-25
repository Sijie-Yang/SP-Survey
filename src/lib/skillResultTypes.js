/**
 * Thin catalog of skill resultSchema field types.
 * Used for editor self-check, analysis routing, and export shapes.
 * Unknown types are allowed (warning only) — skills stay free-form.
 */

export const SKILL_RESULT_TYPES = {
  number: {
    id: 'number',
    shape: 'number',
    analysis: 'histogram',
    export: 'scalar',
  },
  rating: {
    id: 'rating',
    shape: 'number on a declared min/max rating scale',
    analysis: 'ratingDistribution',
    export: 'scalar or image_rating when media is attached',
  },
  boolean: {
    id: 'boolean',
    shape: 'boolean',
    analysis: 'yesNo',
    export: 'scalar',
  },
  choice: {
    id: 'choice',
    shape: 'string',
    analysis: 'frequency',
    export: 'scalar',
  },
  text: {
    id: 'text',
    shape: 'string',
    analysis: 'textList',
    export: 'scalar',
  },
  json: {
    id: 'json',
    shape: 'object|array (novel structured result; raw data is always preserved)',
    analysis: 'genericStructureProfile',
    export: 'json',
  },
  count: {
    id: 'count',
    shape: 'array|number',
    analysis: 'count',
    export: 'scalar',
  },
  color: {
    id: 'color',
    shape: 'hex string',
    analysis: 'colorChips',
    export: 'scalar',
  },
  scaleGroup: {
    id: 'scaleGroup',
    shape: '{dimensionId: number}',
    analysis: 'scaleBars',
    export: 'perKey',
  },
  points: {
    id: 'points',
    shape: '[{x,y,label?}] normalized 0–1',
    analysis: 'densityOverlay',
    export: 'perPoint',
  },
  path: {
    id: 'path',
    shape: '[{x,y,t?}] normalized 0–1',
    analysis: 'pathOverlay',
    export: 'perPoint',
  },
  polygon: {
    id: 'polygon',
    shape: '[{x,y},…] ≥3 vertices normalized 0–1 (closed)',
    analysis: 'polygonOverlay',
    export: 'perVertex',
  },
  bbox: {
    id: 'bbox',
    shape: '[{x,y},{x,y}] two opposite corners normalized 0–1 (alias: box)',
    analysis: 'bboxOverlay',
    export: 'perCorner',
  },
  allocation: {
    id: 'allocation',
    shape: '{label: number}',
    analysis: 'allocationBars',
    export: 'perItem',
  },
  rankedList: {
    id: 'rankedList',
    shape: 'ordered string[]',
    analysis: 'rankingBorda',
    export: 'perRank',
  },
  multiChoice: {
    id: 'multiChoice',
    shape: 'string[] (checkbox multi-select)',
    analysis: 'multiChoiceFrequency',
    export: 'perSelected',
  },
  matrix: {
    id: 'matrix',
    shape: '{rowKey: colValue} or [{row,column,value?}]',
    analysis: 'matrixCells',
    export: 'perCell',
  },
  mediaMatrix: {
    id: 'mediaMatrix',
    shape: '{rowKey: colValue} with imageUrl/videoUrl or shown media',
    analysis: 'imageMediaMatrixTabs',
    export: 'image_matrix',
  },
  mediaChoice: {
    id: 'mediaChoice',
    shape: 'media url/key string (imagepicker/mediapicker)',
    analysis: 'mediaPickFrequency',
    export: 'scalar',
  },
  mediaRankedList: {
    id: 'mediaRankedList',
    shape: 'ordered media url/key[] (imageranking/mediaranking)',
    analysis: 'mediaRankingBorda',
    export: 'perRank',
  },
  timeRanges: {
    id: 'timeRanges',
    shape: '[{start,end,label?}] or {segments:[…],duration?,videoUrl?} (video moments)',
    analysis: 'videoMomentTimeline',
    export: 'perSegment',
  },
  timeSeries: {
    id: 'timeSeries',
    shape: '[{t,v|value}] or {samples:[…],videoUrl?} (continuous video rating)',
    analysis: 'continuousVideoTimeline',
    export: 'perSample',
  },
  pairwise: {
    id: 'pairwise',
    shape: '{preference:number, imageA?, imageB?, hardToDecide?} (A/B slider or forced)',
    analysis: 'pairwisePreference',
    export: 'pairwise',
  },
  pairwiseChoice: {
    id: 'pairwiseChoice',
    shape: '{left,right,winner} or {imageA,imageB,choice:"A"|"B"} (forced choice)',
    analysis: 'forcedChoiceTrueSkill',
    export: 'pairwiseChoice',
  },
  pairwisePreference: {
    id: 'pairwisePreference',
    shape: '{left?,right?,preference:number,hardToDecide?} (continuous A/B preference)',
    analysis: 'pairwisePreference',
    export: 'pairwisePreference',
  },
  bestWorst: {
    id: 'bestWorst',
    shape: '{best|bestIndex, worst|worstIndex, shownUrls?} (MaxDiff)',
    analysis: 'maxDiffBws',
    export: 'bestWorst',
  },
  compositeBlocks: {
    id: 'compositeBlocks',
    shape: '{ratings:[{id,value,left?,right?}], words?:string[], choice?:string, text?:string}',
    analysis: 'compositeBlocksTabs',
    export: 'composite_blocks',
  },
};

export const KNOWN_SKILL_RESULT_TYPE_IDS = Object.keys(SKILL_RESULT_TYPES);

// New Skill revisions must route to an existing native question/results/export
// family. json and the ambiguous legacy pairwise alias remain read-compatible
// only; authors must choose pairwiseChoice or pairwisePreference explicitly.
export const NATIVE_SKILL_RESULT_TYPE_IDS = KNOWN_SKILL_RESULT_TYPE_IDS.filter(
  (id) => id !== 'json' && id !== 'pairwise',
);

export function isNativeSkillResultType(type) {
  return NATIVE_SKILL_RESULT_TYPE_IDS.includes(canonicalizeSkillResultType(type));
}

/** Types that already had SkillFieldSummary support before archetypes. */
export const LEGACY_SKILL_RESULT_TYPES = [
  'number', 'rating', 'boolean', 'choice', 'text', 'count', 'color', 'scaleGroup', 'string',
];

/** Types that need archetype-specific analysis / export. */
export const ARCHETYPE_SKILL_RESULT_TYPES = [
  'points', 'path', 'polygon', 'bbox', 'box',
  'allocation', 'rankedList',
  'multiChoice', 'matrix', 'mediaMatrix', 'mediaChoice', 'mediaRankedList',
  'timeRanges', 'timeSeries', 'pairwise', 'bestWorst',
  'pairwiseChoice', 'pairwisePreference', 'compositeBlocks',
];

export function isKnownSkillResultType(type) {
  const t = String(type || '').trim();
  if (!t) return false;
  if (t === 'string') return true; // alias of text
  if (t === 'box') return true; // alias of bbox
  return Object.prototype.hasOwnProperty.call(SKILL_RESULT_TYPES, t);
}

/** Normalize aliases (box → bbox). */
export function canonicalizeSkillResultType(type) {
  const t = String(type || '').trim();
  if (t === 'box' || t === 'rect') return 'bbox';
  if (t === 'string') return 'text';
  return t;
}

/**
 * Soft-validate a value against a declared result type.
 * Never used to block save — only editor self-check / analysis routing.
 * @returns {{ ok: boolean, detail: string }}
 */
export function validateSkillResultValue(type, value) {
  const t = canonicalizeSkillResultType(type) || 'text';
  if (value === undefined || value === null) {
    return { ok: false, detail: 'missing' };
  }

  switch (t) {
    case 'number':
    case 'rating': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n)
        ? { ok: true, detail: String(n) }
        : { ok: false, detail: 'not a number' };
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, detail: value ? 'true' : 'false' }
        : { ok: false, detail: 'not boolean' };
    case 'choice':
    case 'text':
    case 'string':
      return (typeof value === 'string' || typeof value === 'number')
        ? { ok: true, detail: String(value).slice(0, 80) }
        : { ok: false, detail: 'not a string' };
    case 'json':
      return (value && typeof value === 'object')
        ? { ok: true, detail: Array.isArray(value) ? `${value.length} items` : `${Object.keys(value).length} keys` }
        : { ok: false, detail: 'expected object or array' };
    case 'count': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, detail: String(value) };
      }
      if (Array.isArray(value)) {
        return { ok: true, detail: `${value.length} items` };
      }
      return { ok: false, detail: 'expected number or array' };
    }
    case 'color': {
      const s = String(value);
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)
        ? { ok: true, detail: s }
        : { ok: false, detail: 'expected #hex color' };
    }
    case 'scaleGroup':
    case 'allocation': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, detail: 'expected object map' };
      }
      const keys = Object.keys(value);
      if (!keys.length) return { ok: false, detail: 'empty object' };
      const numeric = keys.filter((k) => Number.isFinite(Number(value[k])));
      return numeric.length
        ? { ok: true, detail: `${numeric.length} keys` }
        : { ok: false, detail: 'no numeric values' };
    }
    case 'points': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length
        ? { ok: true, detail: `${pts.length} points` }
        : { ok: false, detail: 'no valid {x,y} points' };
    }
    case 'path': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length >= 2
        ? { ok: true, detail: `${pts.length} vertices` }
        : { ok: false, detail: 'need ≥2 {x,y} vertices' };
    }
    case 'polygon': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length >= 3
        ? { ok: true, detail: `${pts.length} vertices` }
        : { ok: false, detail: 'need ≥3 {x,y} vertices' };
    }
    case 'bbox': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length >= 2
        ? { ok: true, detail: '2 corners' }
        : { ok: false, detail: 'need 2 corner {x,y}' };
    }
    case 'rankedList':
    case 'mediaRankedList':
    case 'multiChoice': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const items = value.filter((x) => x != null && String(x).trim());
      return items.length
        ? { ok: true, detail: `${items.length} items` }
        : { ok: false, detail: 'empty list' };
    }
    case 'mediaChoice':
      return (typeof value === 'string' || typeof value === 'number')
        ? { ok: true, detail: String(value).slice(0, 80) }
        : { ok: false, detail: 'expected media key/url string' };
    case 'matrix':
    case 'mediaMatrix': {
      if (Array.isArray(value)) {
        const cells = value.filter((c) => c && (c.row != null || c.row_key != null));
        return cells.length
          ? { ok: true, detail: `${cells.length} cells` }
          : { ok: false, detail: 'empty matrix cells' };
      }
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        return keys.length
          ? { ok: true, detail: `${keys.length} rows` }
          : { ok: false, detail: 'empty matrix object' };
      }
      return { ok: false, detail: 'expected object or cell array' };
    }
    case 'compositeBlocks': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, detail: 'expected composite block object' };
      }
      const known = ['ratings', 'words', 'choice', 'text'].some((key) => value[key] != null);
      return known
        ? { ok: true, detail: 'composite blocks' }
        : { ok: false, detail: 'expected ratings/words/choice/text' };
    }
    case 'timeRanges': {
      const segs = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? (value.segments || value.ranges) : null);
      if (!Array.isArray(segs) || !segs.length) return { ok: false, detail: 'expected segments[]' };
      const ok = segs.filter((s) => s && Number.isFinite(Number(s.start ?? s.begin)));
      return ok.length
        ? { ok: true, detail: `${ok.length} segments` }
        : { ok: false, detail: 'no valid segments' };
    }
    case 'timeSeries': {
      const samples = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? (value.samples || value.series) : null);
      if (!Array.isArray(samples) || !samples.length) return { ok: false, detail: 'expected samples[]' };
      const ok = samples.filter((s) => s && Number.isFinite(Number(s.t ?? s.time))
        && Number.isFinite(Number(s.v ?? s.value)));
      return ok.length
        ? { ok: true, detail: `${ok.length} samples` }
        : { ok: false, detail: 'no valid samples' };
    }
    case 'pairwise': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, detail: String(value) };
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const p = Number(value.preference ?? value.score ?? value.value);
        if (Number.isFinite(p)) return { ok: true, detail: String(p) };
        if (value.choice === 'A' || value.choice === 'B' || value.chosenIndex != null) {
          return { ok: true, detail: 'forced-choice' };
        }
      }
      return { ok: false, detail: 'expected preference number or pairwise object' };
    }
    case 'pairwiseChoice': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, detail: 'expected forced-choice object' };
      }
      const winner = value.winner ?? value.choice ?? value.chosenIndex;
      const hasPair = (value.left != null && value.right != null)
        || (value.imageA != null && value.imageB != null)
        || (Array.isArray(value.shownUrls) && value.shownUrls.length >= 2);
      return hasPair && winner != null
        ? { ok: true, detail: 'pair+winner' }
        : { ok: false, detail: 'need pair and winner/choice' };
    }
    case 'pairwisePreference': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, detail: String(value) };
      }
      const preference = value && typeof value === 'object'
        ? Number(value.preference ?? value.score ?? value.value)
        : NaN;
      return Number.isFinite(preference)
        ? { ok: true, detail: String(preference) }
        : { ok: false, detail: 'need numeric preference' };
    }
    case 'bestWorst': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, detail: 'expected best/worst object' };
      }
      const hasBest = value.best != null || value.bestIndex != null || value.bestUrl != null;
      const hasWorst = value.worst != null || value.worstIndex != null || value.worstUrl != null;
      return (hasBest && hasWorst)
        ? { ok: true, detail: 'best+worst' }
        : { ok: false, detail: 'need best and worst' };
    }
    default:
      // Unknown type — accept any non-null value
      return { ok: true, detail: 'custom/unknown type' };
  }
}

/**
 * Check an answer object against a resultSchema array.
 * @returns {{ recorded: boolean, fields: Array<{key,label,type,ok,detail}> }}
 */
export function checkAnswerAgainstResultSchema(answer, resultSchema = []) {
  const recorded = answer != null && typeof answer === 'object'
    && !Array.isArray(answer)
    && Object.keys(answer).length > 0;
  const schema = Array.isArray(resultSchema) ? resultSchema : [];
  if (!schema.length) {
    return {
      recorded,
      fields: recorded
        ? [{ key: '_', label: 'answer', type: 'object', ok: true, detail: `${Object.keys(answer).length} keys` }]
        : [{ key: '_', label: 'answer', type: 'object', ok: false, detail: 'no answer yet' }],
    };
  }
  const fields = schema.map((f) => {
    const key = f.key;
    const val = answer && typeof answer === 'object' ? answer[key] : undefined;
    const check = validateSkillResultValue(f.type, val);
    return {
      key,
      label: f.label || key,
      type: f.type || 'text',
      ok: check.ok,
      detail: check.detail,
    };
  });
  return { recorded, fields };
}

/** One-line catalog for prompts / MCP descriptions. */
export function skillResultTypesCatalogText({ nativeOnly = false } = {}) {
  const ids = nativeOnly ? NATIVE_SKILL_RESULT_TYPE_IDS : KNOWN_SKILL_RESULT_TYPE_IDS;
  return ids.map((id) => {
    const t = SKILL_RESULT_TYPES[id];
    return `- ${id}: ${t.shape} → analysis:${t.analysis}, export:${t.export}`;
  }).join('\n');
}
