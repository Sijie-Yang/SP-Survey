/**
 * Shared survey contract: shape → compatible transforms → answerability → user goals.
 * Used by survey_validate and every Assistant submit path.
 */

import { PLATFORM_SCHEMA } from '../platformSchema/generated.js';
import {
  describeDimensionIncomplete,
  dimensionIncomplete,
  normalizeSliderDimension,
} from '../sliderScale.js';
import { getGenerationContract, GENERATION_CONTRACT_VERSION } from './generationContracts.js';

function isKnownQuestionType(type) {
  return Object.prototype.hasOwnProperty.call(PLATFORM_SCHEMA.questionTypes || {}, type);
}

function questionHasTrait(type, trait) {
  return (PLATFORM_SCHEMA.questionTypes?.[type]?.traits || []).includes(trait);
}

const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);
const MATRIX_TYPES = new Set(['matrix', 'imagematrix', 'mediamatrix']);
const RANKING_TYPES = new Set(['ranking', 'imageranking', 'mediaranking']);
const ALLOCATION_TYPES = new Set(['pointallocation', 'imagepointallocation', 'mediapointallocation']);
const DISPLAY_TYPES = new Set(['expression', 'image', 'mediadisplay']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issue({
  question = '',
  path,
  reason,
  repairHint,
  code = 'UNANSWERABLE_QUESTION',
  severity = 'error',
} = {}) {
  return {
    code,
    question,
    path: path || 'surveyConfig',
    reason: reason || 'Invalid survey configuration.',
    message: reason || 'Invalid survey configuration.',
    repairHint: repairHint || `Correct ${path || 'the survey configuration'} and retry.`,
    hint: repairHint || `Correct ${path || 'the survey configuration'} and retry.`,
    retryable: severity === 'error',
    severity,
  };
}

export function questionFingerprint(element) {
  if (!element || typeof element !== 'object') return '';
  const keys = [
    'type', 'name', 'title', 'dimensions', 'choices', 'rows', 'columns', 'budget',
    'scaleMin', 'scaleMax', 'scaleStep', 'rateMin', 'rateMax', 'imageCount',
    'imageSelectionMode', 'mediaAssignmentMode', 'mediaFolders', 'trialCount',
    'skillId', 'skillConfig',
  ];
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, element[key]])));
}

export function indexQuestions(surveyConfig = {}) {
  const map = new Map();
  for (const page of surveyConfig.pages || []) {
    for (const element of page?.elements || []) {
      if (element?.name) map.set(String(element.name), { page, element });
    }
  }
  return map;
}

export function changedQuestionNames(baseline, next) {
  const before = indexQuestions(baseline);
  const after = indexQuestions(next);
  const names = [];
  for (const [name, entry] of after.entries()) {
    const prior = before.get(name);
    if (!prior || questionFingerprint(prior.element) !== questionFingerprint(entry.element)) {
      names.push(name);
    }
  }
  return names;
}

function itemId(item) {
  if (item == null) return '';
  if (typeof item === 'object') return text(item.value ?? item.id ?? item.key);
  return text(item);
}

function itemLabel(item) {
  if (item == null) return '';
  if (typeof item === 'object') return text(item.text ?? item.label ?? item.title ?? item.name);
  return text(item);
}

export function applyCompatibleTransforms(surveyConfig) {
  const transforms = [];
  const next = clone(surveyConfig || {});
  for (const page of next.pages || []) {
    if (!Array.isArray(page?.elements)) continue;
    page.elements = page.elements.map((element, elementIndex) => {
      if (!element || typeof element !== 'object' || Array.isArray(element)) return element;
      const copy = { ...element };
      if (SLIDER_TYPES.has(copy.type) && Array.isArray(copy.dimensions)) {
        copy.dimensions = copy.dimensions.map((dimension, index) => {
          if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) {
            return dimension;
          }
          const normalized = normalizeSliderDimension(dimension, index);
          if (JSON.stringify(normalized) !== JSON.stringify(dimension)) {
            transforms.push({
              question: copy.name || '',
              path: `pages.${page.name || '?'}.elements[${elementIndex}].dimensions[${index}]`,
              from: dimension,
              to: normalized,
              note: 'Mapped documented pole/label aliases. Answer ids were not rewritten when already present.',
            });
          }
          return normalized;
        });
      }
      return copy;
    });
  }
  return { surveyConfig: next, transforms };
}

function hasRuntimeMediaPool(element) {
  if (element?.imageSelectionMode === 'huggingface_manual') {
    return Boolean(element.selectedImageUrls?.length || element.imageLinks?.length || element.choices?.length);
  }
  return element?.randomImageSelection !== false
    || element?.imageSelectionMode === 'huggingface_random'
    || element?.imageSelectionMode == null;
}

function listQuality(items, { requireLabel = false } = {}) {
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'empty' };
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item == null) return { ok: false, reason: `null at ${index}` };
    const id = itemId(item);
    if (!id) return { ok: false, reason: `missing id at ${index}` };
    if (seen.has(id)) return { ok: false, reason: `duplicate id ${id}` };
    seen.add(id);
    if (requireLabel && !itemLabel(item) && typeof item === 'object') {
      return { ok: false, reason: `missing label at ${index}` };
    }
  }
  return { ok: true };
}

function assessSlider(element, path) {
  const errors = [];
  if (!Array.isArray(element.dimensions)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.dimensions`,
      reason: `${element.type} dimensions must be an array of objects, not ${element.dimensions == null ? 'empty' : typeof element.dimensions}.`,
      repairHint: 'Send dimensions:[{id,label,left,right}] with non-empty strings. Do not send a string or null items.',
    }));
    return errors;
  }
  if (!element.dimensions.length) {
    errors.push(issue({
      question: element.name,
      path: `${path}.dimensions`,
      reason: `${element.type} needs a non-empty dimensions array.`,
      repairHint: 'Add study-specific dimensions [{id,label,left,right}]. Do not copy editor blanks ([]). Do not invent leftover street-scene poles unless the study is about that.',
    }));
    return errors;
  }
  const seen = new Set();
  element.dimensions.forEach((dimension, index) => {
    const dimPath = `${path}.dimensions[${index}]`;
    if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) {
      errors.push(issue({
        question: element.name,
        path: dimPath,
        reason: `Dimension ${index + 1} must be an object {id,label,left,right}.`,
        repairHint: 'Replace null/string entries with a dimension object.',
      }));
      return;
    }
    if (dimension.label != null && typeof dimension.label === 'object') {
      errors.push(issue({
        question: element.name,
        path: `${dimPath}.label`,
        reason: 'Dimension label must be a non-empty string, not an object.',
        repairHint: 'Use label:"Pleasantness" (string). Do not nest {en,zh} objects.',
      }));
    }
    const id = text(dimension.id);
    if (!id) {
      errors.push(issue({
        question: element.name,
        path: `${dimPath}.id`,
        reason: 'Dimension id must be a non-empty string.',
        repairHint: 'Set a stable id. Do not change an existing answer id.',
      }));
    } else if (seen.has(id)) {
      errors.push(issue({
        question: element.name,
        path: `${dimPath}.id`,
        reason: `Duplicate dimension id "${id}".`,
        repairHint: 'Each dimension id must be unique and keep historical answer ids.',
      }));
    } else {
      seen.add(id);
    }
    if (dimensionIncomplete(dimension)) {
      errors.push(issue({
        question: element.name,
        path: dimPath,
        reason: describeDimensionIncomplete(dimension, index) || 'Dimension is incomplete.',
        repairHint: 'Each dimension needs non-empty string id, label, left, and right.',
      }));
    }
    const min = dimension.min ?? element.scaleMin ?? 1;
    const max = dimension.max ?? element.scaleMax ?? 7;
    if (!(Number.isFinite(Number(min)) && Number.isFinite(Number(max)) && Number(min) < Number(max))) {
      errors.push(issue({
        question: element.name,
        path: `${dimPath}.min`,
        reason: 'Dimension scale min must be less than max.',
        repairHint: 'Set scaleMin/scaleMax or per-dimension min/max with min < max.',
      }));
    }
  });
  return errors;
}

function assessResearcherList(element, path, key, label) {
  const check = listQuality(element[key], { requireLabel: key !== 'choices' || !questionHasTrait(element.type, 'stimulus') });
  if (check.ok) return [];
  return [issue({
    question: element.name,
    path: `${path}.${key}`,
    reason: `${element.type} ${label} is not answerable (${check.reason}).`,
    repairHint: `Provide a non-empty ${key} array of {value,text} defined by the researcher. Empty editor defaults are not a complete question.`,
  })];
}

export function assessQuestionAnswerability(element, {
  pageName = '',
  index = 0,
} = {}) {
  const errors = [];
  const path = pageName ? `pages.${pageName}.elements[${index}]` : `elements[${index}]`;
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    return [issue({ path, reason: 'Each question must be an object.', repairHint: 'Send {type,name,...}.' })];
  }
  if (!text(element.name)) {
    errors.push(issue({ path: `${path}.name`, reason: 'Question name is required.', repairHint: 'Set a stable unique name.' }));
  }
  if (!text(element.type)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.type`,
      reason: 'Question type is required.',
      repairHint: 'Use a platform question type id from survey_capabilities.',
    }));
    return errors;
  }
  if (!isKnownQuestionType(element.type)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.type`,
      code: 'UNKNOWN_QUESTION_TYPE',
      reason: `Question type "${element.type}" is not a platform type and cannot count toward coverage.`,
      repairHint: 'Replace it with a known type from survey_capabilities domain=questions.',
    }));
    return errors;
  }
  if (DISPLAY_TYPES.has(element.type) || questionHasTrait(element.type, 'display')) {
    return errors;
  }

  const contract = getGenerationContract(element.type);
  if (SLIDER_TYPES.has(element.type)) errors.push(...assessSlider(element, path));
  if (MATRIX_TYPES.has(element.type)) {
    errors.push(...assessResearcherList(element, path, 'rows', 'rows'));
    errors.push(...assessResearcherList(element, path, 'columns', 'columns'));
  }
  if (RANKING_TYPES.has(element.type) && contract.answerOptions === 'researcher_defined') {
    errors.push(...assessResearcherList(element, path, 'choices', 'ranking choices'));
  }
  if (RANKING_TYPES.has(element.type) && contract.answerOptions === 'runtime_media_pool') {
    if (!hasRuntimeMediaPool(element) && !listQuality(element.choices).ok) {
      errors.push(issue({
        question: element.name,
        path,
        reason: `${element.type} needs a media pool or explicit ranking choices.`,
        repairHint: 'Use huggingface_random with imageCount>=2, or provide researcher-defined choices.',
      }));
    }
  }
  if (ALLOCATION_TYPES.has(element.type)) {
    errors.push(...assessResearcherList(element, path, 'choices', 'allocation choices'));
    if (element.budget != null && !(Number.isFinite(Number(element.budget)) && Number(element.budget) > 0)) {
      errors.push(issue({
        question: element.name,
        path: `${path}.budget`,
        reason: 'Allocation budget must be a positive number.',
        repairHint: 'Set budget to a positive number such as 100.',
      }));
    }
  }
  if (['radiogroup', 'checkbox', 'dropdown', 'imagecheckbox', 'mediacheckbox'].includes(element.type)) {
    errors.push(...assessResearcherList(element, path, 'choices', 'choices'));
  }
  if (element.type === 'comment' && element.rows != null && Array.isArray(element.rows)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.rows`,
      reason: 'comment.rows is a textarea height integer, not a matrix row array.',
      repairHint: 'Use rows:3 (integer). Matrix row arrays belong on matrix / imagematrix / mediamatrix.',
    }));
  }
  if (MATRIX_TYPES.has(element.type) && element.rows != null && !Array.isArray(element.rows)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.rows`,
      reason: 'Matrix rows must be an array of {value,text}.',
      repairHint: 'Do not set matrix rows to an integer (that field is comment.rows).',
    }));
  }
  if (questionHasTrait(element.type, 'stimulus') && element.type !== 'skillquestion' && !hasRuntimeMediaPool(element)) {
    errors.push(issue({
      question: element.name,
      path,
      reason: `${element.type} has no media sampling rule and no curated media.`,
      repairHint: 'Set imageSelectionMode=huggingface_random or provide selectedImageUrls.',
    }));
  }
  if (element.type === 'skillquestion' && !text(element.skillId)) {
    errors.push(issue({
      question: element.name,
      path: `${path}.skillId`,
      reason: 'skillquestion requires skillId.',
      repairHint: 'Use a preset_* skillId from survey_capabilities domain=skills.',
    }));
  }
  return errors;
}

export function isAnswerableKnownType(element) {
  if (!element?.type || !isKnownQuestionType(element.type)) return false;
  if (DISPLAY_TYPES.has(element.type) || questionHasTrait(element.type, 'display')) return false;
  return assessQuestionAnswerability(element).length === 0;
}

export function evaluateSurveyContract(surveyConfig, {
  baseline = null,
  mode = 'compat',
  generateGoal = null,
  strictAll = false,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      ok: false,
      errors: [issue({ path: 'surveyConfig', reason: 'surveyConfig must be an object.' })],
      warnings,
      transforms: [],
      coveredTypes: [],
      generationContractVersion: GENERATION_CONTRACT_VERSION,
    };
  }

  const { surveyConfig: transformed, transforms } = applyCompatibleTransforms(surveyConfig);
  const strictNames = new Set(
    strictAll || mode === 'generate'
      ? [...indexQuestions(transformed).keys()]
      : (baseline ? changedQuestionNames(baseline, transformed) : []),
  );

  if (!Array.isArray(transformed.pages)) {
    errors.push(issue({ path: 'surveyConfig.pages', reason: 'pages must be an array.' }));
  } else {
    const pageNames = [];
    const questionNames = [];
    transformed.pages.forEach((page, pageIndex) => {
      const pagePath = `surveyConfig.pages[${pageIndex}]`;
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        errors.push(issue({ path: pagePath, reason: 'Each page must be an object.' }));
        return;
      }
      const pageName = text(page.name);
      if (!pageName) errors.push(issue({ path: `${pagePath}.name`, reason: 'Every page needs a stable unique name.' }));
      else if (pageNames.includes(pageName)) {
        errors.push(issue({ path: `${pagePath}.name`, reason: `Duplicate page name "${pageName}".` }));
      } else pageNames.push(pageName);
      if (!Array.isArray(page.elements)) {
        errors.push(issue({ path: `${pagePath}.elements`, reason: 'elements must be an array.' }));
        return;
      }
      page.elements.forEach((element, elementIndex) => {
        const name = text(element?.name);
        if (name) {
          if (questionNames.includes(name)) {
            errors.push(issue({
              question: name,
              path: `${pagePath}.elements[${elementIndex}].name`,
              reason: `Duplicate question name "${name}".`,
            }));
          } else questionNames.push(name);
        }
        const found = assessQuestionAnswerability(element, { pageName: pageName || `p${pageIndex}`, index: elementIndex });
        const strict = strictNames.has(name) || (!name && (strictAll || mode === 'generate'));
        (strict ? errors : warnings).push(...found.map((item) => (
          strict ? item : { ...item, severity: 'warning', retryable: false, code: item.code || 'SURVEY_WARNING' }
        )));
      });
    });
  }

  if (generateGoal) {
    const goalIssues = evaluateGenerateGoalsAgainstContract(transformed, generateGoal);
    errors.push(...goalIssues);
  }

  const coveredTypes = [...new Set(
    (transformed.pages || []).flatMap((page) => (page.elements || [])
      .filter((element) => isAnswerableKnownType(element))
      .map((element) => element.type)),
  )];

  return {
    valid: errors.length === 0,
    ok: errors.length === 0,
    errors,
    warnings,
    transforms,
    coveredTypes,
    pageCount: Array.isArray(transformed.pages) ? transformed.pages.length : 0,
    questionCount: (transformed.pages || []).reduce((sum, page) => sum + (page.elements?.length || 0), 0),
    surveyConfig: transformed,
    generationContractVersion: GENERATION_CONTRACT_VERSION,
  };
}

export function evaluateGenerateGoalsAgainstContract(surveyConfig, goals = {}) {
  const errors = [];
  const pages = Array.isArray(surveyConfig.pages) ? surveyConfig.pages : [];
  const effectivePages = pages.filter((page) => (
    text(page?.name) && (page.elements || []).some((element) => isAnswerableKnownType(element))
  ));
  if (effectivePages.length < (goals.minPages || 1)) {
    errors.push(issue({
      path: 'pages',
      code: 'GENERATE_GOAL',
      reason: `Need at least ${goals.minPages || 1} effective pages with complete answerable questions; found ${effectivePages.length}.`,
      repairHint: 'Add pages that each contain at least one complete known question type. Incomplete sliders/matrices do not count.',
    }));
  }
  const covered = new Set(
    pages.flatMap((page) => (page.elements || [])
      .filter((element) => isAnswerableKnownType(element))
      .map((element) => element.type)),
  );
  const answerTypes = Array.isArray(goals.answerTypes) ? goals.answerTypes.filter((type) => isKnownQuestionType(type)) : [];
  const requiredCoverage = goals.coverMostTypes ? Math.ceil(answerTypes.length / 2) : 0;
  if (requiredCoverage && covered.size < requiredCoverage) {
    errors.push(issue({
      path: 'elements.type',
      code: 'GENERATE_GOAL',
      reason: `Need ${requiredCoverage} distinct complete answer types; covered ${covered.size}. Unknown or incomplete types do not count.`,
      repairHint: 'Mix real complete families instead of repeating one type or inventing unknown types.',
    }));
  }
  return errors;
}

export {
  SLIDER_TYPES,
  MATRIX_TYPES,
  RANKING_TYPES,
  ALLOCATION_TYPES,
  DISPLAY_TYPES,
};
