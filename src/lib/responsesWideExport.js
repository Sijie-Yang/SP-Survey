/**
 * Wide (one-row-per-response) CSV builder for Results Analysis.
 */

import { evaluateResponseQuality } from './quality';
import { getPresetSkill } from './presetSkills';
import { stripSkillAnswerContext } from './skillMediaUtils';
import { objectsToCsv, exportDateStamp } from './csvUtil';
import { downloadTextFile } from './methodsExport';
import { supportsTrialCount } from './questionTypeConstraints';

const IMAGE_TYPES = new Set([
  'imagerating', 'image_rating',
  'imageranking', 'image_ranking',
  'mediaranking', 'mediapicker',
  'imageboolean', 'image_boolean',
  'imagematrix', 'image_matrix', 'mediamatrix',
  'imagepicker',
  'image',
  'mediadisplay', 'mediarating', 'mediaboolean',
  'mediaslidergroup', 'mediapointallocation',
  'imageannotation',
  'skillquestion',
  'imageslidergroup',
  'imagepointallocation',
]);

function isImageQuestion(q) {
  return IMAGE_TYPES.has(q?.type);
}

function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  return String(path).split('.').reduce(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    obj,
  );
}

function subKeysFor(q) {
  if (q.type === 'slidergroup' || q.type === 'imageslidergroup' || q.type === 'mediaslidergroup') {
    return (q.dimensions || []).map((d) => d.id).filter(Boolean);
  }
  if (q.type === 'pointallocation' || q.type === 'imagepointallocation' || q.type === 'mediapointallocation') {
    return (q.choices || []).map((c) => (typeof c === 'object' ? c.value : c)).filter(Boolean);
  }
  if (q.type === 'matrix' || q.type === 'imagematrix' || q.type === 'mediamatrix') {
    return (q.rows || []).map((r) => (typeof r === 'object' ? r.value : r)).filter(Boolean);
  }
  if (q.type === 'ranking' || q.type === 'imageranking' || q.type === 'mediaranking') {
    if (q.type === 'ranking' && q.choices?.length) {
      return q.choices.map((_, i) => `rank_${i + 1}`);
    }
    if ((q.type === 'imageranking' || q.type === 'mediaranking') && q.imageCount) {
      return Array.from({ length: q.imageCount }, (_, i) => `rank_${i + 1}`);
    }
    return null;
  }
  if (q.type === 'skillquestion') {
    let schema = q.skillResultSchema;
    if (!schema?.length && q.skillId?.startsWith('preset_')) {
      schema = getPresetSkill(q.skillId.replace(/^preset_/, ''))?.resultSchema;
    }
    return (schema || []).map((f) => f.key).filter(Boolean);
  }
  return null;
}

function urlToName(v) {
  return (v && typeof v === 'string') ? v.split('?')[0].split('/').pop() : v;
}

/**
 * Build UTF-8 BOM CSV string (one row per response).
 */
export function buildResponsesWideCsv(responses, allQuestions, surveyConfig) {
  if (!responses?.length) {
    return objectsToCsv([
      'participant_id',
      'created_at',
      'completion_code',
      'session_id',
      'attempt_index',
      'practice_mode',
      'quality_flags',
    ], []);
  }

  const questions = allQuestions || [];
  const headerCols = [];
  const slotIdsByQuestion = new Map();
  for (const q of questions) {
    headerCols.push(q.name);
    const subKeys = subKeysFor(q);
    if (subKeys) {
      subKeys.forEach((k) => headerCols.push(`${q.name}__${String(k).replace(/\./g, '_')}`));
    }
    if (supportsTrialCount(q.type)) {
      headerCols.push(`${q.name}__trial_count`);
      headerCols.push(`${q.name}__trials_json`);
    }
    if (isImageQuestion(q)) {
      headerCols.push(`${q.name}__shown_images`);
      headerCols.push(`${q.name}__shown_media_ids`);
      headerCols.push(`${q.name}__shown_media_set`);
      headerCols.push(`${q.name}__shown_media_group`);
      headerCols.push(`${q.name}__shown_media_categories`);
      headerCols.push(`${q.name}__shown_media`);
      const slotIds = new Set();
      (q.mediaSlots || []).forEach((s) => { if (s?.id) slotIds.add(String(s.id)); });
      responses.forEach((row) => {
        const qData = row.responses?.[q.name];
        const shown = (typeof qData === 'object' && qData && Array.isArray(qData.shown_media))
          ? qData.shown_media : [];
        shown.forEach((s) => { if (s?.slotId) slotIds.add(String(s.slotId)); });
      });
      const sorted = [...slotIds].sort();
      slotIdsByQuestion.set(q.name, sorted);
      sorted.forEach((id) => {
        headerCols.push(`${q.name}__slot_${id}_name`);
        headerCols.push(`${q.name}__slot_${id}_type`);
      });
    }
  }

  const headers = [
    'participant_id',
    'created_at',
    'completion_code',
    'session_id',
    'attempt_index',
    'practice_mode',
    'quality_flags',
    ...headerCols,
  ];

  const objects = responses.map((row) => {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    const obj = {
      participant_id: row.participant_id || '',
      created_at: row.created_at || row.survey_metadata?.completion_time || '',
      completion_code: row.survey_metadata?.completion_code || '',
      session_id: row.survey_metadata?.session_id || '',
      attempt_index: row.survey_metadata?.attempt_index ?? '',
      practice_mode: row.survey_metadata?.practice_mode ? 'true' : 'false',
      quality_flags: flags.join('|'),
    };

    for (const q of questions) {
      const qName = q.name;
      const qData = row.responses?.[qName];

      let ans;
      let shownImgs;
      if (qData !== null && qData !== undefined && typeof qData === 'object' && !Array.isArray(qData) && Array.isArray(qData.trials)) {
        ans = qData.trials.map((t) => t?.answer ?? t?.value);
        shownImgs = qData.trials.flatMap((t) => t?.shown_images || []);
        obj[`${qName}__trial_count`] = qData.trials.length;
        obj[`${qName}__trials_json`] = JSON.stringify(qData.trials);
      } else if (qData !== null && qData !== undefined && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
        ans = qData.answer;
        shownImgs = qData.shown_images?.length ? qData.shown_images : (row.displayed_images?.[qName] || []);
      } else {
        ans = qData ?? '';
        shownImgs = row.displayed_images?.[qName] || [];
      }

      let ansForCsv = ans;
      if (q.type === 'skillquestion' && ans && typeof ans === 'object' && !Array.isArray(ans)) {
        ansForCsv = stripSkillAnswerContext(ans);
      }
      if (isImageQuestion(q)) {
        if (Array.isArray(ans)) ansForCsv = ans.map(urlToName);
        else if (typeof ans === 'string') ansForCsv = urlToName(ans);
      }
      obj[qName] = typeof ansForCsv === 'object' ? JSON.stringify(ansForCsv) : String(ansForCsv ?? '');

      const subKeys = subKeysFor(q);
      const isMultiTrialAns = Array.isArray(qData?.trials) && qData.trials.length > 1;
      if (subKeys) {
        if (isMultiTrialAns) {
          // Sub-keys assume a single object/ranking; multi-trial detail is in __trials_json.
          subKeys.forEach((k) => {
            obj[`${qName}__${String(k).replace(/\./g, '_')}`] = '';
          });
        } else if (q.type === 'ranking' || q.type === 'imageranking' || q.type === 'mediaranking') {
          const ranked = Array.isArray(ans) ? ans : [];
          subKeys.forEach((k, i) => {
            const v = ranked[i];
            obj[`${qName}__${String(k).replace(/\./g, '_')}`] = v == null ? '' : String(urlToName(v) ?? v);
          });
        } else if (q.type === 'matrix' || q.type === 'imagematrix' || q.type === 'mediamatrix') {
          const rawObj = (ans && typeof ans === 'object' && !Array.isArray(ans)) ? ans : {};
          subKeys.forEach((k) => {
            const v = rawObj[k];
            obj[`${qName}__${String(k).replace(/\./g, '_')}`] = v === undefined || v === null
              ? ''
              : (typeof v === 'object' ? JSON.stringify(v) : v);
          });
        } else {
          const rawObj = (ans && typeof ans === 'object' && !Array.isArray(ans)) ? ans : {};
          const stripped = q.type === 'skillquestion' ? stripSkillAnswerContext(rawObj) : rawObj;
          subKeys.forEach((k) => {
            const v = getPath(stripped, k);
            obj[`${qName}__${String(k).replace(/\./g, '_')}`] = v === undefined || v === null
              ? ''
              : (typeof v === 'object' ? JSON.stringify(v) : v);
          });
        }
      }

      if (isImageQuestion(q)) {
        const imgNames = Array.isArray(shownImgs)
          ? shownImgs.map((v) => (v ? String(v).split('?')[0].split('/').pop() : v))
          : [shownImgs ?? ''];
        obj[`${qName}__shown_images`] = imgNames.join('|');
        const mediaIds = (typeof qData === 'object' && qData && Array.isArray(qData.shown_media_ids))
          ? qData.shown_media_ids
          : [];
        obj[`${qName}__shown_media_ids`] = mediaIds.join('|');
        const mediaSet = (typeof qData === 'object' && qData && ('shown_media_set' in qData || 'shown_media_group' in qData))
          ? (qData.shown_media_set || qData.shown_media_group || '')
          : (row.displayed_media_groups?.[qName] || '');
        obj[`${qName}__shown_media_set`] = mediaSet || '';
        obj[`${qName}__shown_media_group`] = mediaSet || '';
        const mediaCategories = (typeof qData === 'object' && qData && qData.shown_media_categories)
          ? (Array.isArray(qData.shown_media_categories) ? qData.shown_media_categories.join('|') : qData.shown_media_categories)
          : (Array.isArray(row.displayed_media_categories?.[qName])
            ? row.displayed_media_categories[qName].join('|')
            : (row.displayed_media_categories?.[qName] || ''));
        obj[`${qName}__shown_media_categories`] = mediaCategories || '';
        const shownMedia = (typeof qData === 'object' && qData && Array.isArray(qData.shown_media))
          ? qData.shown_media
          : [];
        obj[`${qName}__shown_media`] = shownMedia.length ? JSON.stringify(shownMedia) : '';
        const bySlot = new Map(shownMedia.map((s) => [String(s.slotId), s]));
        (slotIdsByQuestion.get(qName) || []).forEach((id) => {
          const s = bySlot.get(id);
          obj[`${qName}__slot_${id}_name`] = s?.name || '';
          obj[`${qName}__slot_${id}_type`] = s?.type || '';
        });
      }
    }
    return obj;
  });

  return objectsToCsv(headers, objects);
}

export function downloadResponsesWideCsv(responses, allQuestions, surveyConfig) {
  if (!responses?.length) return;
  const csv = buildResponsesWideCsv(responses, allQuestions, surveyConfig);
  downloadTextFile(csv, `responses_wide_${exportDateStamp()}.csv`);
}
