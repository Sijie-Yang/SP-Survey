/**
 * Unified Results Analysis export: per-question __long / __summary CSVs,
 * data_quality, manifest, README, and full ZIP file list.
 *
 * Long prefix (all types):
 *   participant_id, created_at, session_id, attempt_index, practice_mode, quality_flags,
 *   question_name, question_type,
 *   shown_images, shown_media_ids, shown_media_set, shown_media_categories
 *
 * Summary (all types, tidy):
 *   question_name, question_type, n_responses, unit_key, unit_label, metric, value, n
 */

import { average, descriptiveStats } from './stats';
import { computeBordaScores, kendallW } from './rankingStats';
import {
  computeQuestionTrueSkill,
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
} from './trueskill';
import {
  evaluateResponseQuality,
  QUALITY_FLAG_LABELS,
} from './quality';
import { getPresetSkill } from './presetSkills';
import { stripSkillAnswerContext } from './skillMediaUtils';
import { objectsToCsv, rowsToCsv, exportDateStamp } from './csvUtil';
import { downloadZip } from './zipDownload';
import { downloadTextFile, generateMethodsText } from './methodsExport';

// ─── Shared constants ─────────────────────────────────────────────────────────

export const LONG_PREFIX = [
  'participant_id',
  'created_at',
  'session_id',
  'attempt_index',
  'practice_mode',
  'quality_flags',
  'question_name',
  'question_type',
  'trial_index',
  'shown_images',
  'shown_media_ids',
  'shown_media_set',
  'shown_media_categories',
];

export const SUMMARY_HEADERS = [
  'question_name',
  'question_type',
  'n_responses',
  'unit_key',
  'unit_label',
  'metric',
  'value',
  'n',
];

const DISPLAY_ONLY = new Set(['expression', 'image', 'html', 'mediadisplay']);

const LONG_EXTRA_BY_FAMILY = {
  scalar: ['value'],
  boolean: ['value', 'value_norm'],
  choice: ['value', 'label'],
  text: ['text'],
  matrix: ['row_key', 'row_label', 'column_key', 'column_label', 'value'],
  ranking: ['rank_position', 'item_key', 'item_label'],
  image_rating: ['item_key', 'value'],
  image_boolean: ['item_key', 'value', 'value_norm'],
  imagepicker: ['item_key'],
  slider: ['dimension_id', 'dimension_label', 'value'],
  points: ['choice_key', 'choice_label', 'points'],
  skill: ['schema_key', 'value'],
  annotation: ['item_key', 'label', 'annotation_json'],
};

function questionFamily(type) {
  const t = type || '';
  if (t === 'rating' || t === 'number') return 'scalar';
  if (t === 'boolean' || t === 'consent') return 'boolean';
  if (t === 'radiogroup' || t === 'dropdown' || t === 'checkbox') return 'choice';
  if (t === 'text' || t === 'comment') return 'text';
  if (t === 'matrix' || t === 'imagematrix' || t === 'image_matrix' || t === 'mediamatrix') return 'matrix';
  if (t === 'ranking' || t === 'imageranking' || t === 'image_ranking' || t === 'mediaranking') return 'ranking';
  if (t === 'imagerating' || t === 'image_rating' || t === 'mediarating') return 'image_rating';
  if (t === 'imageboolean' || t === 'image_boolean' || t === 'mediaboolean') return 'image_boolean';
  if (t === 'imagepicker' || t === 'mediapicker') return 'imagepicker';
  if (t === 'slidergroup' || t === 'imageslidergroup' || t === 'mediaslidergroup') return 'slider';
  if (t === 'pointallocation' || t === 'imagepointallocation' || t === 'mediapointallocation') return 'points';
  if (t === 'skillquestion') return 'skill';
  if (t === 'imageannotation') return 'annotation';
  return 'text';
}

function longHeadersForType(type) {
  const fam = questionFamily(type);
  return [...LONG_PREFIX, ...(LONG_EXTRA_BY_FAMILY[fam] || LONG_EXTRA_BY_FAMILY.text)];
}

function isDisplayOnly(question) {
  return DISPLAY_ONLY.has(question?.type);
}

function responsesEligibleForQuestion(questionName, responses) {
  return (responses || []).filter((row) => {
    if (row.survey_metadata?.practice_mode) {
      return row.survey_metadata?.practice_question === questionName;
    }
    return true;
  });
}

function imageKeyFromShown(entry) {
  if (!entry) return '';
  const s = typeof entry === 'string' ? entry : (entry.url || entry.name || '');
  return s.split('?')[0].split('/').pop() || s;
}

function resolveImageChoiceKey(value, shownImages) {
  if (value == null || value === '') return '';
  const str = String(value);
  const match = str.match(/^image_(\d+)$/);
  if (match && Array.isArray(shownImages) && shownImages.length) {
    const img = shownImages[Number(match[1])];
    if (img != null) return imageKeyFromShown(img) || String(img);
  }
  return imageKeyFromShown(str) || str;
}

function joinPipe(arr) {
  if (!Array.isArray(arr)) return arr == null ? '' : String(arr);
  return arr.map((v) => (v == null ? '' : imageKeyFromShown(v) || String(v))).join('|');
}

function choiceLabelMap(choices) {
  const map = {};
  (choices || []).forEach((c) => {
    if (typeof c === 'object' && c !== null) {
      map[String(c.value)] = String(c.text ?? c.label ?? c.value);
    } else {
      map[String(c)] = String(c);
    }
  });
  return map;
}

function matrixLabelMap(items) {
  const map = {};
  (items || []).forEach((item) => {
    if (typeof item === 'object' && item !== null) {
      map[String(item.value)] = String(item.text ?? item.label ?? item.value);
    } else {
      map[String(item)] = String(item);
    }
  });
  return map;
}

function normalizeBool(v) {
  if (v === true || v === 'true' || v === 'yes' || v === 1 || v === '1') return 1;
  if (v === false || v === 'false' || v === 'no' || v === 0 || v === '0') return 0;
  return '';
}

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function parsePayload(row, questionName) {
  const qData = row.responses?.[questionName];
  if (qData === undefined || qData === null) return null;

  // Multi-trial enriched shape: expand to one payload per trial
  if (typeof qData === 'object' && !Array.isArray(qData) && Array.isArray(qData.trials)) {
    return qData.trials.map((trial, trialIndex) => {
      const answer = trial?.answer ?? trial?.value;
      if (answer === null || answer === undefined || answer === '') return null;
      const shownImages = trial?.shown_images?.length
        ? trial.shown_images
        : (row.displayed_images?.[`${questionName}__trials`]?.[trialIndex]
          || row.displayed_images?.[questionName]
          || []);
      return {
        answer,
        shownImages,
        shownMediaIds: Array.isArray(trial?.shown_media_ids) ? trial.shown_media_ids : [],
        shownMediaGroup: '',
        shownMediaSet: '',
        shownMediaCategories: '',
        trialIndex,
      };
    }).filter(Boolean);
  }

  // Recovery: answer[] paired with displayed_images[name__trials]
  if (typeof qData === 'object' && !Array.isArray(qData) && Array.isArray(qData.answer) && !qData.trials) {
    const trialShown = row.displayed_images?.[`${questionName}__trials`];
    if (Array.isArray(trialShown) && trialShown.length >= 2 && qData.answer.length === trialShown.length) {
      return qData.answer.map((answer, trialIndex) => {
        if (answer === null || answer === undefined || answer === '') return null;
        return {
          answer,
          shownImages: trialShown[trialIndex] || [],
          shownMediaIds: [],
          shownMediaGroup: '',
          shownMediaSet: '',
          shownMediaCategories: '',
          trialIndex,
        };
      }).filter(Boolean);
    }
  }

  let answer;
  let shownImages = [];
  let shownMediaIds = [];
  let shownMediaSet = '';
  let shownMediaCategories = '';

  if (typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
    answer = qData.answer;
    // If answer is array from enrich multi-trial without trials key, keep as-is
    shownImages = qData.shown_images?.length
      ? qData.shown_images
      : (row.displayed_images?.[questionName] || []);
    shownMediaIds = Array.isArray(qData.shown_media_ids) ? qData.shown_media_ids : [];
    shownMediaSet = qData.shown_media_set
      || qData.shown_media_group
      || row.displayed_media_groups?.[questionName]
      || '';
    const cats = qData.shown_media_categories ?? row.displayed_media_categories?.[questionName];
    shownMediaCategories = Array.isArray(cats) ? cats.join('|') : (cats || '');
  } else {
    answer = qData;
    shownImages = row.displayed_images?.[questionName] || [];
  }

  if (answer === null || answer === undefined || answer === '') return null;

  return {
    answer,
    shownImages,
    shownMediaIds,
    shownMediaGroup: shownMediaSet,
    shownMediaSet,
    shownMediaCategories,
  };
}

function payloadsForQuestion(row, questionName) {
  const parsed = parsePayload(row, questionName);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function baseLongFields(row, question, flags, payload = null) {
  const p = payload || (payloadsForQuestion(row, question.name)[0] || null);
  return {
    participant_id: row.participant_id || '',
    created_at: row.created_at || row.survey_metadata?.completion_time || '',
    session_id: row.survey_metadata?.session_id || '',
    attempt_index: row.survey_metadata?.attempt_index ?? '',
    practice_mode: row.survey_metadata?.practice_mode ? 'true' : 'false',
    quality_flags: (flags || []).join('|'),
    question_name: question.name,
    question_type: question.type || '',
    trial_index: p?.trialIndex ?? '',
    shown_images: joinPipe(p?.shownImages),
    shown_media_ids: (p?.shownMediaIds || []).join('|'),
    shown_media_set: p?.shownMediaSet || p?.shownMediaGroup || '',
    shown_media_categories: p?.shownMediaCategories || '',
    _payload: p,
  };
}

function emptyExtra(fam) {
  const keys = LONG_EXTRA_BY_FAMILY[fam] || LONG_EXTRA_BY_FAMILY.text;
  const o = {};
  keys.forEach((k) => { o[k] = ''; });
  return o;
}

function summaryRow(question, nResponses, unitKey, unitLabel, metric, value, n) {
  return {
    question_name: question.name,
    question_type: question.type || '',
    n_responses: nResponses,
    unit_key: unitKey,
    unit_label: unitLabel,
    metric,
    value: value == null || Number.isNaN(value) ? '' : value,
    n: n == null ? '' : n,
  };
}

function pushStats(out, question, nResponses, unitKey, unitLabel, nums) {
  const st = descriptiveStats(nums);
  if (!st.n) return;
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'mean', st.mean, st.n));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'sd', st.sd, st.n));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'median', st.median, st.n));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'min', st.min, st.n));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'max', st.max, st.n));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'count', st.n, st.n));
}

// ─── Long builders ────────────────────────────────────────────────────────────

function buildLongObjects(question, responses, surveyConfig) {
  const fam = questionFamily(question.type);
  const eligible = responsesEligibleForQuestion(question.name, responses);
  const objects = [];

  for (const row of eligible) {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    const payloads = payloadsForQuestion(row, question.name);
    for (const payload of payloads) {
    const base = baseLongFields(row, question, flags, payload);
    delete base._payload;
    if (!payload) continue;

    const { answer, shownImages } = payload;
    const extra = emptyExtra(fam);

    if (fam === 'scalar') {
      objects.push({ ...base, ...extra, value: answer });
    } else if (fam === 'boolean') {
      objects.push({
        ...base,
        ...extra,
        value: answer,
        value_norm: normalizeBool(answer),
      });
    } else if (fam === 'choice') {
      const labels = choiceLabelMap(question.choices);
      const vals = question.type === 'checkbox'
        ? (Array.isArray(answer) ? answer : [answer])
        : [answer];
      vals.forEach((v) => {
        objects.push({
          ...base,
          ...extra,
          value: v,
          label: labels[String(v)] || String(v ?? ''),
        });
      });
    } else if (fam === 'text') {
      objects.push({ ...base, ...extra, text: typeof answer === 'object' ? JSON.stringify(answer) : String(answer) });
    } else if (fam === 'matrix') {
      const rowLabels = matrixLabelMap(question.rows);
      const colLabels = matrixLabelMap(question.columns);
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      Object.entries(obj).forEach(([rowKey, colVal]) => {
        objects.push({
          ...base,
          ...extra,
          row_key: rowKey,
          row_label: rowLabels[String(rowKey)] || rowKey,
          column_key: colVal,
          column_label: colLabels[String(colVal)] || String(colVal ?? ''),
          value: colVal,
        });
      });
    } else if (fam === 'ranking') {
      const labels = choiceLabelMap(question.choices);
      const ranked = Array.isArray(answer) ? answer : [];
      ranked.forEach((item, idx) => {
        const key = resolveImageChoiceKey(item, shownImages);
        objects.push({
          ...base,
          ...extra,
          rank_position: idx + 1,
          item_key: key,
          item_label: labels[String(item)] || labels[key] || key,
        });
      });
    } else if (fam === 'image_rating') {
      const rating = Number(answer);
      (shownImages || []).forEach((img) => {
        objects.push({
          ...base,
          ...extra,
          item_key: imageKeyFromShown(img) || String(img),
          value: Number.isNaN(rating) ? answer : rating,
        });
      });
    } else if (fam === 'image_boolean') {
      (shownImages || []).forEach((img) => {
        objects.push({
          ...base,
          ...extra,
          item_key: imageKeyFromShown(img) || String(img),
          value: answer,
          value_norm: normalizeBool(answer),
        });
      });
    } else if (fam === 'imagepicker') {
      const vals = Array.isArray(answer) ? answer : [answer];
      vals.forEach((v) => {
        objects.push({
          ...base,
          ...extra,
          item_key: resolveImageChoiceKey(v, shownImages),
        });
      });
    } else if (fam === 'slider') {
      const dims = question.dimensions || [];
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      dims.forEach((d) => {
        objects.push({
          ...base,
          ...extra,
          dimension_id: d.id,
          dimension_label: d.label || `${d.left || ''} ↔ ${d.right || ''}` || d.id,
          value: obj[d.id] ?? '',
        });
      });
      if (!dims.length) {
        Object.entries(obj).forEach(([k, v]) => {
          objects.push({
            ...base,
            ...extra,
            dimension_id: k,
            dimension_label: k,
            value: v,
          });
        });
      }
    } else if (fam === 'points') {
      const labels = choiceLabelMap(question.choices);
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      const keys = (question.choices || []).map((c) => (typeof c === 'object' ? c.value : c)).filter((k) => k != null);
      const useKeys = keys.length ? keys : Object.keys(obj);
      useKeys.forEach((k) => {
        objects.push({
          ...base,
          ...extra,
          choice_key: k,
          choice_label: labels[String(k)] || String(k),
          points: obj[k] ?? '',
        });
      });
    } else if (fam === 'skill') {
      let schema = question.skillResultSchema;
      if (!schema?.length && question.skillId?.startsWith('preset_')) {
        schema = getPresetSkill(question.skillId.replace(/^preset_/, ''))?.resultSchema;
      }
      const raw = (answer && typeof answer === 'object' && !Array.isArray(answer))
        ? stripSkillAnswerContext(answer)
        : answer;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = (schema || []).map((f) => f.key).filter(Boolean);
        const useKeys = keys.length ? keys : Object.keys(raw);
        useKeys.forEach((k) => {
          const v = getPath(raw, k);
          objects.push({
            ...base,
            ...extra,
            schema_key: k,
            value: v != null && typeof v === 'object' ? JSON.stringify(v) : (v ?? ''),
          });
        });
      } else {
        objects.push({
          ...base,
          ...extra,
          schema_key: 'answer',
          value: typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? ''),
        });
      }
    } else if (fam === 'annotation') {
      const ann = (answer && typeof answer === 'object') ? answer : null;
      const img = ann?.image
        ? imageKeyFromShown(ann.image)
        : (shownImages?.[0] ? imageKeyFromShown(shownImages[0]) : '');
      if (ann?.shapes?.length) {
        ann.shapes.forEach((shape) => {
          objects.push({
            ...base,
            ...extra,
            item_key: img,
            label: shape.label || '',
            annotation_json: JSON.stringify(shape),
          });
        });
      } else {
        objects.push({
          ...base,
          ...extra,
          item_key: img,
          label: '',
          annotation_json: JSON.stringify(ann || answer),
        });
      }
    } else {
      objects.push({
        ...base,
        ...extra,
        text: typeof answer === 'object' ? JSON.stringify(answer) : String(answer),
      });
    }
    } // end payloads loop
  }

  return objects;
}

// ─── Summary builders ─────────────────────────────────────────────────────────

function buildSummaryObjects(question, responses) {
  const type = question.type || '';
  const fam = questionFamily(type);
  const eligible = responsesEligibleForQuestion(question.name, responses);
  const longObjs = buildLongObjects(question, responses, null);
  const nResponses = new Set(
    longObjs.map((r) => `${r.participant_id}|${r.session_id}|${r.attempt_index}|${r.created_at}`),
  ).size || eligible.filter((row) => parsePayload(row, question.name)).length;

  const out = [];

  if (fam === 'scalar') {
    const nums = longObjs.map((r) => Number(r.value)).filter((n) => !Number.isNaN(n));
    pushStats(out, question, nResponses, 'overall', 'overall', nums);
    const freq = {};
    nums.forEach((n) => { freq[n] = (freq[n] || 0) + 1; });
    Object.entries(freq).forEach(([k, count]) => {
      out.push(summaryRow(question, nResponses, k, k, 'count', count, nResponses));
      out.push(summaryRow(question, nResponses, k, k, 'pct', nResponses ? count / nResponses : 0, nResponses));
    });
  } else if (fam === 'boolean') {
    let yes = 0;
    let no = 0;
    longObjs.forEach((r) => {
      if (r.value_norm === 1 || r.value_norm === '1') yes += 1;
      else if (r.value_norm === 0 || r.value_norm === '0') no += 1;
    });
    const total = yes + no;
    out.push(summaryRow(question, nResponses, 'yes', 'yes', 'count', yes, total));
    out.push(summaryRow(question, nResponses, 'no', 'no', 'count', no, total));
    out.push(summaryRow(question, nResponses, 'yes', 'yes', 'yes_rate', total ? yes / total : 0, total));
    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', total, total));
  } else if (fam === 'choice') {
    const freq = {};
    longObjs.forEach((r) => {
      const k = String(r.value ?? '');
      if (!freq[k]) freq[k] = { count: 0, label: r.label || k };
      freq[k].count += 1;
    });
    const denom = type === 'checkbox' ? nResponses : longObjs.length;
    Object.entries(freq).forEach(([k, { count, label }]) => {
      out.push(summaryRow(question, nResponses, k, label, 'count', count, denom));
      out.push(summaryRow(question, nResponses, k, label, 'pct', denom ? count / denom : 0, denom));
    });
  } else if (fam === 'text') {
    const texts = longObjs.map((r) => String(r.text || '')).filter(Boolean);
    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', texts.length, texts.length));
    const lengths = texts.map((t) => t.length);
    pushStats(out, question, nResponses, 'length_chars', 'length_chars', lengths);
  } else if (fam === 'matrix') {
    const freq = {};
    longObjs.forEach((r) => {
      const key = `${r.row_key}||${r.column_key}`;
      if (!freq[key]) {
        freq[key] = {
          row_key: r.row_key,
          column_key: r.column_key,
          label: `${r.row_label}|${r.column_label}`,
          count: 0,
        };
      }
      freq[key].count += 1;
    });
    Object.values(freq).forEach((f) => {
      const unit = `${f.row_key}__${f.column_key}`;
      out.push(summaryRow(question, nResponses, unit, f.label, 'count', f.count, nResponses));
      out.push(summaryRow(question, nResponses, unit, f.label, 'pct', nResponses ? f.count / nResponses : 0, nResponses));
    });
  } else if (fam === 'ranking') {
    if (type === 'ranking') {
      const rankPositions = {};
      const rankingLists = [];
      for (const row of eligible) {
        const payload = parsePayload(row, question.name);
        if (!payload) continue;
        const ranked = Array.isArray(payload.answer) ? payload.answer : [];
        if (ranked.length) rankingLists.push(ranked.map(String));
        ranked.forEach((val, idx) => {
          const k = String(val);
          if (!rankPositions[k]) rankPositions[k] = [];
          rankPositions[k].push(idx + 1);
        });
      }
      const items = Object.keys(rankPositions);
      const bordaMap = computeBordaScores(rankPositions, items.length);
      const w = kendallW(rankingLists, items);
      if (w != null) {
        out.push(summaryRow(question, nResponses, 'overall', 'overall', 'kendall_w', w, nResponses));
      }
      const labels = choiceLabelMap(question.choices);
      const sorted = Object.entries(rankPositions)
        .map(([val, ranks]) => ({
          val,
          avg: average(ranks),
          borda: bordaMap[val]?.borda,
          n: ranks.length,
        }))
        .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
      sorted.forEach((row, idx) => {
        const label = labels[row.val] || row.val;
        out.push(summaryRow(question, nResponses, row.val, label, 'rank', idx + 1, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'avg_rank', row.avg, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'borda', row.borda, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'count', row.n, row.n));
      });
    } else {
      // image / media ranking → TrueSkill + classical
      const imageRankPositions = {};
      const rankingLists = [];
      const allMatches = [];
      for (const row of eligible) {
        const payload = parsePayload(row, question.name);
        if (!payload) continue;
        const ranked = Array.isArray(payload.answer) ? payload.answer : [];
        const keys = ranked
          .map((val) => resolveImageChoiceKey(val, payload.shownImages))
          .filter(Boolean);
        if (keys.length < 2) continue;
        rankingLists.push(keys);
        allMatches.push(...matchesFromOrderedRanking(keys));
        keys.forEach((key, rankIdx) => {
          if (!imageRankPositions[key]) imageRankPositions[key] = [];
          imageRankPositions[key].push(rankIdx + 1);
        });
      }
      const items = Object.keys(imageRankPositions);
      const w = kendallW(rankingLists, items);
      const bordaMap = computeBordaScores(imageRankPositions, items.length);
      const { rankings: tsRows } = computeTrueSkillFromMatches(allMatches);
      if (w != null) {
        out.push(summaryRow(question, nResponses, 'overall', 'overall', 'kendall_w', w, nResponses));
      }
      const byKey = new Map((tsRows || []).map((r) => [r.imageKey, r]));
      items.forEach((key) => {
        const ranks = imageRankPositions[key] || [];
        const avg = ranks.length ? average(ranks) : null;
        const ts = byKey.get(key);
        out.push(summaryRow(question, nResponses, key, key, 'avg_rank', avg, ranks.length));
        out.push(summaryRow(question, nResponses, key, key, 'borda', bordaMap[key]?.borda, ranks.length));
        out.push(summaryRow(question, nResponses, key, key, 'count', ranks.length, ranks.length));
        if (ts?.mu != null) {
          out.push(summaryRow(question, nResponses, key, key, 'mu', ts.mu, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'sigma', ts.sigma, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'mu_std5', ts.muStd5, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'wins', ts.wins, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'losses', ts.losses, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'games', ts.games, ranks.length));
        }
      });
      const rankedByMu = [...(tsRows || [])].sort((a, b) => (b.mu ?? -Infinity) - (a.mu ?? -Infinity));
      rankedByMu.forEach((r, idx) => {
        out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'rank', idx + 1, r.games));
      });
    }
  } else if (fam === 'image_rating') {
    const perImage = {};
    longObjs.forEach((r) => {
      const key = r.item_key;
      const num = Number(r.value);
      if (!key || Number.isNaN(num)) return;
      if (!perImage[key]) perImage[key] = [];
      perImage[key].push(num);
    });
    Object.entries(perImage).forEach(([key, nums]) => {
      pushStats(out, question, nResponses, key, key, nums);
    });
  } else if (fam === 'image_boolean') {
    const perImage = {};
    longObjs.forEach((r) => {
      const key = r.item_key;
      if (!key) return;
      if (!perImage[key]) perImage[key] = { yes: 0, no: 0 };
      if (r.value_norm === 1 || r.value_norm === '1') perImage[key].yes += 1;
      else perImage[key].no += 1;
    });
    Object.entries(perImage).forEach(([key, { yes, no }]) => {
      const total = yes + no;
      out.push(summaryRow(question, nResponses, key, key, 'yes_rate', total ? yes / total : 0, total));
      out.push(summaryRow(question, nResponses, key, key, 'count', total, total));
      out.push(summaryRow(question, nResponses, `${key}__yes`, key, 'count', yes, total));
      out.push(summaryRow(question, nResponses, `${key}__no`, key, 'count', no, total));
    });
  } else if (fam === 'imagepicker') {
    const { rankings } = computeQuestionTrueSkill(eligible, question.name);
    const sortedTs = [...(rankings || [])].sort((a, b) => (b.mu ?? -Infinity) - (a.mu ?? -Infinity));
    sortedTs.forEach((r, idx) => {
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'rank', idx + 1, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'mu', r.mu, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'sigma', r.sigma, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'mu_std5', r.muStd5, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'wins', r.wins, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'losses', r.losses, r.games));
      out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'games', r.games, r.games));
    });
    const freq = {};
    longObjs.forEach((r) => {
      const k = r.item_key;
      if (!k) return;
      freq[k] = (freq[k] || 0) + 1;
    });
    Object.entries(freq).forEach(([k, count]) => {
      out.push(summaryRow(question, nResponses, k, k, 'count', count, nResponses));
      out.push(summaryRow(question, nResponses, k, k, 'pct', nResponses ? count / nResponses : 0, nResponses));
    });
  } else if (fam === 'slider') {
    const byDim = {};
    longObjs.forEach((r) => {
      const id = r.dimension_id;
      if (!id) return;
      if (!byDim[id]) byDim[id] = { label: r.dimension_label || id, nums: [] };
      const num = Number(r.value);
      if (!Number.isNaN(num)) byDim[id].nums.push(num);
    });
    Object.entries(byDim).forEach(([id, { label, nums }]) => {
      pushStats(out, question, nResponses, id, label, nums);
    });
  } else if (fam === 'points') {
    const byChoice = {};
    longObjs.forEach((r) => {
      const id = r.choice_key;
      if (!id) return;
      if (!byChoice[id]) byChoice[id] = { label: r.choice_label || id, nums: [] };
      const num = Number(r.points);
      if (!Number.isNaN(num)) byChoice[id].nums.push(num);
    });
    Object.entries(byChoice).forEach(([id, { label, nums }]) => {
      pushStats(out, question, nResponses, id, label, nums);
    });
  } else if (fam === 'skill') {
    const byKey = {};
    longObjs.forEach((r) => {
      const id = r.schema_key;
      if (!id) return;
      if (!byKey[id]) byKey[id] = [];
      const num = Number(r.value);
      if (!Number.isNaN(num)) byKey[id].push(num);
      else byKey[id].push(null);
    });
    Object.entries(byKey).forEach(([id, vals]) => {
      const nums = vals.filter((v) => v != null && !Number.isNaN(v));
      if (nums.length) pushStats(out, question, nResponses, id, id, nums);
      else out.push(summaryRow(question, nResponses, id, id, 'count', vals.length, vals.length));
    });
  } else if (fam === 'annotation') {
    const byLabel = {};
    const byImage = {};
    longObjs.forEach((r) => {
      const label = r.label || '(unlabeled)';
      byLabel[label] = (byLabel[label] || 0) + 1;
      const img = r.item_key || 'unknown';
      byImage[img] = (byImage[img] || 0) + 1;
    });
    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', longObjs.length, nResponses));
    Object.entries(byLabel).forEach(([label, count]) => {
      out.push(summaryRow(question, nResponses, `label__${label}`, label, 'count', count, nResponses));
    });
    Object.entries(byImage).forEach(([img, count]) => {
      out.push(summaryRow(question, nResponses, `image__${img}`, img, 'count', count, nResponses));
    });
  }

  return out;
}

// ─── Public file builders ─────────────────────────────────────────────────────

export function buildQuestionLongCsv(question, responses, surveyConfig) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const headers = longHeadersForType(question.type);
  const objects = buildLongObjects(question, responses, surveyConfig);
  return objectsToCsv(headers, objects);
}

export function buildQuestionSummaryCsv(question, responses) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const objects = buildSummaryObjects(question, responses);
  return objectsToCsv(SUMMARY_HEADERS, objects);
}

/**
 * @returns {{ path: string, content: string }[] | null}
 */
export function buildQuestionExportFiles(question, responses, surveyConfig, { pathPrefix = 'questions' } = {}) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const longCsv = buildQuestionLongCsv(question, responses, surveyConfig);
  const summaryCsv = buildQuestionSummaryCsv(question, responses);
  if (!longCsv && !summaryCsv) return null;
  const name = question.name;
  return [
    { path: `${pathPrefix}/${name}__long.csv`, content: longCsv || objectsToCsv(longHeadersForType(question.type), []) },
    { path: `${pathPrefix}/${name}__summary.csv`, content: summaryCsv || objectsToCsv(SUMMARY_HEADERS, []) },
  ];
}

export function downloadQuestionExportZip(question, responses, surveyConfig) {
  const files = buildQuestionExportFiles(question, responses, surveyConfig);
  if (!files?.length) return;
  const date = exportDateStamp();
  downloadZip(`${question.name}_${date}.zip`, files);
}

export function buildDataQualityCsv(responses, surveyConfig, { excludeFlagged = true, includedKeys = null } = {}) {
  const headers = [
    'participant_id',
    'created_at',
    'session_id',
    'practice_mode',
    'duration_seconds',
    'flag_codes',
    'flag_labels',
    'included_in_analysis',
  ];
  const includedSet = includedKeys instanceof Set
    ? includedKeys
    : null;

  const objects = (responses || []).map((row) => {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    let included = true;
    if (includedSet) {
      included = includedSet.has(responseKey(row));
    } else if (excludeFlagged && flags.length) {
      included = false;
    }
    return {
      participant_id: row.participant_id || '',
      created_at: row.created_at || row.survey_metadata?.completion_time || '',
      session_id: row.survey_metadata?.session_id || '',
      practice_mode: row.survey_metadata?.practice_mode ? 'true' : 'false',
      duration_seconds: row.survey_metadata?.timing?.total_seconds ?? '',
      flag_codes: flags.join('|'),
      flag_labels: flags.map((f) => QUALITY_FLAG_LABELS[f] || f).join('|'),
      included_in_analysis: included ? 'true' : 'false',
    };
  });
  return objectsToCsv(headers, objects);
}

function responseKey(row) {
  return String(row.id ?? `${row.participant_id}|${row.created_at}|${row.survey_metadata?.session_id}`);
}

export function buildManifest({
  project,
  questions,
  responses,
  filters,
  questionFiles,
}) {
  return {
    project_id: project?.id || null,
    project_name: project?.name || null,
    exported_at: new Date().toISOString(),
    filters: filters || {},
    n_responses_in_export: (responses || []).length,
    questions: (questions || [])
      .filter((q) => q?.name && !isDisplayOnly(q))
      .map((q) => ({
        name: q.name,
        type: q.type || '',
        title: q.title || q.name,
        files: [
          `questions/${q.name}__long.csv`,
          `questions/${q.name}__summary.csv`,
        ],
      })),
    files: (questionFiles || []).map((f) => f.path),
  };
}

export function buildExportReadme({ project, filters, nResponses, questionCount }) {
  const lines = [
    'SP Survey Platform — Results export',
    '====================================',
    '',
    `Project: ${project?.name || project?.id || '(unknown)'}`,
    `Exported: ${new Date().toISOString()}`,
    `Responses in export: ${nResponses}`,
    `Answerable questions: ${questionCount}`,
    '',
    'Filters',
    '-------',
    `date_from: ${filters?.date_from || '(none)'}`,
    `date_to: ${filters?.date_to || '(none)'}`,
    `session_id: ${filters?.session_id || '(all)'}`,
    `include_practice: ${filters?.include_practice}`,
    `exclude_flagged: ${filters?.exclude_flagged}`,
    '',
    'Layout',
    '------',
    'responses_wide.csv     One row per participant/submission',
    'data_quality.csv       Quality flags per response',
    'methods.txt            Methods narrative',
    'references.bib         Bibliography (if available)',
    'manifest.json          Machine-readable export metadata',
    'questions/{name}__long.csv      Tidy long answers for one question',
    'questions/{name}__summary.csv   Tidy summary metrics (unit × metric)',
    '',
    'Summary schema',
    '--------------',
    'question_name, question_type, n_responses, unit_key, unit_label, metric, value, n',
    '',
    'Long schema prefix (all question types)',
    '---------------------------------------',
    LONG_PREFIX.join(', '),
    '',
    'Encoding: UTF-8 with BOM. CSV fields RFC4180-escaped.',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Build all files for Export All ZIP (paths relative to zip root folder).
 */
export function buildResultsExportBundle({
  project,
  surveyConfig,
  questions,
  filteredResponses,
  dateFilteredResponses,
  filters,
  excludeFlagged,
  wideCsv,
}) {
  const answerable = (questions || []).filter((q) => q?.name && !isDisplayOnly(q));
  const questionFiles = [];
  for (const q of answerable) {
    const files = buildQuestionExportFiles(q, filteredResponses, surveyConfig);
    if (files) questionFiles.push(...files);
  }

  const includedKeys = new Set((filteredResponses || []).map(responseKey));
  const qualityCsv = buildDataQualityCsv(dateFilteredResponses || filteredResponses, surveyConfig, {
    excludeFlagged,
    includedKeys,
  });

  let methodsText = '';
  let bibtex = null;
  try {
    const methods = generateMethodsText({
      project,
      surveyConfig,
      responses: dateFilteredResponses || filteredResponses,
      templateMeta: project?.templateMeta || null,
      excludeFlagged,
    });
    methodsText = methods.methodsText || '';
    bibtex = methods.bibtex || null;
  } catch (err) {
    methodsText = `Methods export unavailable: ${err?.message || err}\n`;
  }

  const manifest = buildManifest({
    project,
    questions: answerable,
    responses: filteredResponses,
    filters,
    questionFiles,
  });

  const readme = buildExportReadme({
    project,
    filters,
    nResponses: (filteredResponses || []).length,
    questionCount: answerable.length,
  });

  const rootFiles = [
    { path: 'README.txt', content: readme },
    { path: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'responses_wide.csv', content: wideCsv || rowsToCsv([['participant_id']]) },
    { path: 'data_quality.csv', content: qualityCsv },
    { path: 'methods.txt', content: methodsText || '' },
    ...questionFiles,
  ];
  if (bibtex) {
    rootFiles.push({ path: 'references.bib', content: bibtex });
  }
  return rootFiles;
}

export function downloadResultsExportZip(opts) {
  const date = exportDateStamp();
  const projectId = opts.project?.id || 'survey';
  const folder = `results_${projectId}_${date}`;
  const files = buildResultsExportBundle(opts).map((f) => ({
    path: `${folder}/${f.path}`,
    content: f.content,
  }));
  downloadZip(`${folder}.zip`, files);
}

export function downloadDataQualityCsv(responses, surveyConfig, opts) {
  const csv = buildDataQualityCsv(responses, surveyConfig, opts);
  downloadTextFile(csv, `data_quality_${exportDateStamp()}.csv`);
}
