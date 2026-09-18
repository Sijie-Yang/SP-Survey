/**
 * Structural survey validation for agent / MCP / builder.
 * Pure module — no I/O.
 */

import { isKnownQuestionType, questionHasTrait } from '../platformSchema';
import { describeDimensionIncomplete, matrixItemLabel } from '../sliderScale';
import { evaluateSurveyContract } from './answerability.js';

function structuredIssue(issue, severity = 'error') {
  return {
    code: issue.code || (severity === 'error' ? 'INVALID_SURVEY_FIELD' : 'SURVEY_WARNING'),
    path: issue.path || 'surveyConfig',
    question: issue.question || '',
    message: issue.message || 'Invalid survey configuration.',
    reason: issue.reason || issue.message || 'Invalid survey configuration.',
    retryable: severity === 'error',
    repairHint: issue.repairHint || issue.hint || (severity === 'error'
      ? `Correct ${issue.path || 'the survey configuration'} and validate again.`
      : 'Review this warning before publishing.'),
    hint: issue.hint || issue.repairHint || (severity === 'error'
      ? `Correct ${issue.path || 'the survey configuration'} and validate again.`
      : 'Review this warning before publishing.'),
  };
}

/** Native settings shared by the Builder and Agent API. Undefined means use the native default. */
export function validateQuestionSettings(q) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  const bounds = (obj, minKey, maxKey, prefix = '') => {
    for (const key of [minKey, maxKey]) {
      if (obj[key] != null && !Number.isFinite(obj[key])) add(prefix + key, `${prefix + key} must be a finite number.`);
    }
    if (obj[minKey] != null && obj[maxKey] != null && obj[minKey] > obj[maxKey]) {
      add(prefix + minKey, `${prefix + minKey} must not exceed ${prefix + maxKey}.`);
    }
  };
  bounds(q, 'min', 'max');
  bounds(q, 'rateMin', 'rateMax');
  bounds(q, 'minValue', 'maxValue');
  bounds(q, 'scaleMin', 'scaleMax');
  bounds({ ...q, maxAnnotations: q.maxAnnotations === 0 ? undefined : (q.maxAnnotations ?? 50) }, 'minAnnotations', 'maxAnnotations');
  for (const key of ['minAnnotations', 'maxAnnotations', 'minSelectedChoices', 'maxSelectedChoices']) {
    if (q[key] != null && (!Number.isInteger(q[key]) || q[key] < 0)) add(key, `${key} must be a non-negative integer.`);
  }
  if (q.annotationLabels != null) {
    if (!Array.isArray(q.annotationLabels)) {
      add('annotationLabels', 'annotationLabels must be an array of strings.');
    } else {
      q.annotationLabels.forEach((label, i) => {
        if (typeof label !== 'string' || !label.trim()) {
          add(`annotationLabels[${i}]`, `annotationLabels[${i}] must be a non-empty string.`);
        }
      });
    }
  }
  if (['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(q.type)
    && (q.scaleMin ?? 1) >= (q.scaleMax ?? 7)) add('scaleMin', 'Scale minimum must be less than its maximum.');
  bounds({ ...q, maxSelectedChoices: q.maxSelectedChoices === 0 ? undefined : q.maxSelectedChoices }, 'minSelectedChoices', 'maxSelectedChoices');
  for (const key of ['step', 'rateStep', 'scaleStep', 'budget']) {
    if (q[key] != null && (!Number.isFinite(q[key]) || q[key] <= 0)) add(key, `${key} must be a positive number.`);
  }
  for (const key of ['choices', 'rows', 'columns', 'dimensions']) {
    if (!Array.isArray(q[key])) continue;
    const seen = new Set();
    q[key].forEach((item, i) => {
      const id = item && typeof item === 'object' ? (item.value ?? item.id ?? item.key) : item;
      if (id == null || String(id).trim() === '') add(`${key}[${i}]`, `${key}[${i}] needs a stable, non-empty ID.`);
      else if (seen.has(String(id))) add(`${key}[${i}]`, `${key}: duplicate ID "${id}".`);
      seen.add(String(id));
      if (key === 'dimensions' && item && typeof item === 'object') {
        bounds(item, 'min', 'max', `dimensions[${i}].`);
        if (!(item.min != null && item.max != null && item.min > item.max)
          && (item.min ?? q.scaleMin ?? 1) >= (item.max ?? q.scaleMax ?? 7)) {
          add(`dimensions[${i}].min`, 'Dimension minimum must be less than its effective maximum.');
        }
        if (item.step != null && (!Number.isFinite(item.step) || item.step <= 0)) add(`dimensions[${i}].step`, 'Dimension step must be positive.');
      }
    });
  }
  return errors;
}

export function validateSurveyConfig(surveyConfig, options = {}) {
  const errors = [];
  const warnings = [];
  let questionCount = 0;

  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      errors: [structuredIssue({ path: 'surveyConfig', message: 'surveyConfig must be an object.' })],
      warnings,
      pageCount: 0,
      questionCount,
    };
  }

  if (!Array.isArray(surveyConfig.pages)) {
    errors.push({ path: 'surveyConfig.pages', message: 'pages must be an array.' });
  } else {
    if (surveyConfig.pages.length === 0) {
      warnings.push({ path: 'surveyConfig.pages', message: 'The survey has no pages.' });
    }
    const names = new Map();
    surveyConfig.pages.forEach((page, pageIndex) => {
      const pagePath = `surveyConfig.pages[${pageIndex}]`;
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        errors.push({ path: pagePath, message: 'Each page must be an object.' });
        return;
      }
      if (!page.name) warnings.push({ path: `${pagePath}.name`, message: 'Page name is recommended.' });
      if (!Array.isArray(page.elements)) {
        errors.push({ path: `${pagePath}.elements`, message: 'elements must be an array.' });
        return;
      }
      if (page.elements.length === 0) {
        warnings.push({ path: `${pagePath}.elements`, message: 'Page has no questions.' });
      }
      page.elements.forEach((element, elementIndex) => {
        questionCount += 1;
        const elementPath = `${pagePath}.elements[${elementIndex}]`;
        if (!element || typeof element !== 'object' || Array.isArray(element)) {
          errors.push({ path: elementPath, message: 'Each element must be an object.' });
          return;
        }
        if (!element.type) errors.push({ path: `${elementPath}.type`, message: 'Question type is required.' });
        else if (!isKnownQuestionType(element.type)) {
          warnings.push({
            path: `${elementPath}.type`,
            message: `Question type "${element.type}" is not in the canonical platform schema.`,
          });
        }
        if (!element.name) {
          errors.push({ path: `${elementPath}.name`, message: 'Question name is required.' });
        } else if (names.has(element.name)) {
          errors.push({
            path: `${elementPath}.name`,
            message: `Duplicate question name; first used at ${names.get(element.name)}.`,
          });
        } else {
          names.set(element.name, `${elementPath}.name`);
        }

        validateQuestionSettings(element).forEach((error) => errors.push({
          path: `${elementPath}.${error.path}`, message: `${element.name || 'Question'}: ${error.message}`,
        }));

        if (questionHasTrait(element.type, 'stimulus') && element.type !== 'skillquestion') {
          const hasManual = element.selectedImageUrls?.length
            || element.choices?.length
            || element.imageLinks?.length
            || element.annotationImageUrl;
          const hasRandom = element.randomImageSelection !== false
            || element.imageSelectionMode === 'huggingface_random';
          if (!hasManual && !hasRandom) {
            warnings.push({
              path: elementPath,
              message: `Question "${element.title || element.name}" may have no images configured.`,
            });
          }
        }
        if (questionHasTrait(element.type, 'slider')) {
          if (element.dimensions != null && !Array.isArray(element.dimensions)) {
            errors.push({
              path: `${elementPath}.dimensions`,
              message: `Slider group "${element.title || element.name}" dimensions must be an array.`,
            });
          } else if (!element.dimensions?.length) {
            warnings.push({
              path: elementPath,
              message: `Slider group "${element.title || element.name}" has no dimensions configured.`,
            });
          } else {
            element.dimensions.forEach((dimension, dimIndex) => {
              if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) {
                errors.push({
                  path: `${elementPath}.dimensions[${dimIndex}]`,
                  message: `Dimension ${dimIndex + 1} must be an object {id, label, left, right}.`,
                });
                return;
              }
              const detail = describeDimensionIncomplete(dimension, dimIndex);
              if (detail) {
                const question = element.name || 'unnamed question';
                const title = element.title ? ` (${element.title})` : '';
                warnings.push({
                  path: `${elementPath}.dimensions[${dimIndex}]`,
                  message: `Question "${question}"${title}: ${detail}`,
                });
              }
            });
          }
        }
        for (const key of ['rows', 'columns']) {
          if (!Array.isArray(element[key])) continue;
          element[key].forEach((item, itemIndex) => {
            const kind = key === 'rows' ? 'Row' : 'Column';
            const hasText = item && typeof item === 'object'
              ? String(item.text || '').trim()
              : String(item || '').trim();
            if (!hasText) {
              warnings.push({
                path: `${elementPath}.${key}[${itemIndex}]`,
                message: `${kind} ${itemIndex + 1} is missing a display label (fallback: ${matrixItemLabel(item, itemIndex, kind)}).`,
              });
            }
          });
        }
        if (
          questionHasTrait(element.type, 'allocation')
          && !element.choices?.length
        ) {
          warnings.push({
            path: elementPath,
            message: `Point allocation "${element.title || element.name}" has no choices configured.`,
          });
        }
      });
    });
  }

  const contract = evaluateSurveyContract(surveyConfig, options);
  contract.errors.forEach((item) => {
    errors.push({
      path: item.path,
      message: item.reason || item.message,
      code: item.code,
      question: item.question,
      repairHint: item.repairHint,
    });
  });
  contract.warnings.forEach((item) => {
    warnings.push({
      path: item.path,
      message: item.reason || item.message,
      code: item.code,
      question: item.question,
      repairHint: item.repairHint,
    });
  });

  const uniqueByPath = (list) => {
    const seen = new Set();
    return list.filter((item) => {
      const key = `${item.path}|${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    valid: uniqueByPath(errors).length === 0,
    errors: uniqueByPath(errors).map((entry) => structuredIssue(entry)),
    warnings: uniqueByPath(warnings).map((entry) => structuredIssue(entry, 'warning')),
    pageCount: Array.isArray(surveyConfig.pages) ? surveyConfig.pages.length : 0,
    questionCount,
    transforms: contract.transforms,
    coveredTypes: contract.coveredTypes,
    generationContractVersion: contract.generationContractVersion,
  };
}

/** Human-readable warning strings for the builder banner. */
export function getSurveyValidationWarningStrings(surveyConfig) {
  const report = validateSurveyConfig(surveyConfig);
  return [
    ...report.errors.map((e) => e.message),
    ...report.warnings.map((w) => w.message),
  ];
}
