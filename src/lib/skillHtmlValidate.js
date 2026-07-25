/**
 * Hard rules for custom skill HTML / schemas (AI + manual save).
 */

import { normalizeSkillSchemaArray } from './skillAnswerBridge';
import {
  checkAnswerAgainstResultSchema,
  isKnownSkillResultType,
  isNativeSkillResultType,
  KNOWN_SKILL_RESULT_TYPE_IDS,
  NATIVE_SKILL_RESULT_TYPE_IDS,
} from './skillResultTypes';

const ALT_ANSWER_TYPES_RE = /skill-result|skillResult|SP_SURVEY_SKILL_RESULT|skill_answer|skill-answer/;

/**
 * @param {string} sourceHtml
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateSkillSourceHtml(sourceHtml) {
  const html = String(sourceHtml || '');
  const errors = [];
  const warnings = [];

  if (!html.trim()) {
    errors.push('sourceHtml is empty');
    return { ok: false, errors, warnings };
  }

  if (!/SPSkill\s*\.\s*setAnswer\s*\(/.test(html)) {
    errors.push(
      'HTML must call SPSkill.setAnswer(...) to record answers. '
      + 'Do not use parent.postMessage with skill-result / skillResult / SP_SURVEY_SKILL_RESULT.',
    );
  }

  if (ALT_ANSWER_TYPES_RE.test(html) && !/SPSkill\s*\.\s*setAnswer\s*\(/.test(html)) {
    errors.push('Remove custom postMessage answer protocols; use SPSkill.setAnswer only.');
  } else if (ALT_ANSWER_TYPES_RE.test(html)) {
    warnings.push('HTML still mentions alternate postMessage answer types — prefer SPSkill.setAnswer only.');
  }

  if (!/spskill-init|SPSkill\s*\.\s*getConfig|SPSkill\s*\.\s*getImages/.test(html)) {
    warnings.push(
      'Prefer document.addEventListener("spskill-init", ...) or SPSkill.getConfig()/getImages() for init/media.',
    );
  }

  // Heuristic: packing many named task modes into one skill
  const modeHits = (html.match(/\b(attention_map|route_trace|budget_lab|flash_reveal|cue_detective)\b/g) || []);
  const uniqueModes = new Set(modeHits);
  if (uniqueModes.size >= 3) {
    warnings.push(
      `This HTML looks like ${uniqueModes.size} task modes in one skill. `
      + 'Prefer one focused skill per task (save multiple skills, multiple skillquestion items).',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Normalize + validate a skill payload before save / AI apply.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], skill: object }}
 */
export function prepareSkillForSave(raw = {}) {
  const errors = [];
  const warnings = [];
  const htmlCheck = validateSkillSourceHtml(raw.sourceHtml || raw.source_html || '');
  errors.push(...htmlCheck.errors);
  warnings.push(...htmlCheck.warnings);

  const configSchema = normalizeSkillSchemaArray(raw.configSchema || raw.config_schema || []);
  const resultSchema = normalizeSkillSchemaArray(
    raw.resultSchema || raw.result_schema || [],
    { defaultType: 'text' },
  );
  const contractVersion = Number(raw.contractVersion ?? raw.contract_version ?? 0) || 0;
  const strictContract = contractVersion >= 1;
  const sourceHtml = String(raw.sourceHtml || raw.source_html || '');
  if (strictContract && !/spskill-init|SPSkill\s*\.\s*getConfig|SPSkill\s*\.\s*getImages/.test(sourceHtml)) {
    errors.push('sourceHtml must use the official spskill-init or SPSkill.getConfig()/getImages() initialization protocol.');
  }
  if (strictContract && /SPSkill\s*\.\s*setAnswer\s*\(\s*(?:['"`]|-?\d|\[|true\b|false\b|null\b)/.test(sourceHtml)) {
    errors.push('SPSkill.setAnswer must receive an object for contract version 1, not a scalar or array literal.');
  }

  if (Array.isArray(raw.configSchema) && raw.configSchema.some((x) => typeof x === 'string')) {
    warnings.push('configSchema had string keys — normalized to {key,label,type} objects.');
  }
  if (Array.isArray(raw.resultSchema) && raw.resultSchema.some((x) => typeof x === 'string')) {
    warnings.push('resultSchema had string keys — normalized to {key,label,type} objects.');
  }

  const unknownTypes = [...new Set(
    resultSchema
      .map((f) => String(f.type || '').trim())
      .filter((t) => t && !isKnownSkillResultType(t)),
  )];
  if (unknownTypes.length) {
    const message = (
      `Unknown resultSchema type(s): ${unknownTypes.join(', ')}. `
      + `Known types: ${KNOWN_SKILL_RESULT_TYPE_IDS.join(', ')}. `
      + 'Every new Skill field must use an existing native result/export family.'
    );
    if (strictContract) errors.push(message);
    else warnings.push(`${message} Legacy skill will still save with raw JSON fallback.`);
  }

  const nonNativeTypes = [...new Set(resultSchema
    .map((field) => String(field.type || '').trim())
    .filter((type) => type && !isNativeSkillResultType(type)))];
  if (strictContract && nonNativeTypes.length) {
    errors.push(
      `resultSchema type(s) ${nonNativeTypes.join(', ')} do not have an exact native result/export family. `
      + `Use one of: ${NATIVE_SKILL_RESULT_TYPE_IDS.join(', ')}. `
      + 'Use pairwiseChoice or pairwisePreference instead of legacy pairwise; json is legacy read-only.',
    );
  }

  resultSchema.forEach((field) => {
    if (!strictContract) return;
    const type = String(field.type || '');
    const options = Array.isArray(field.options) ? field.options : [];
    if (['choice', 'multiChoice', 'rankedList', 'allocation'].includes(type) && !options.length) {
      errors.push(`resultSchema field "${field.key}" (${type}) requires non-empty options to match its native question settings.`);
    }
    if (['matrix', 'mediaMatrix'].includes(type)
      && (!Array.isArray(field.rows) || !field.rows.length
        || (!(Array.isArray(field.columns) && field.columns.length) && !options.length))) {
      errors.push(`resultSchema field "${field.key}" (${type}) requires non-empty rows and columns/options.`);
    }
    if (type === 'scaleGroup'
      && !(Array.isArray(field.dimensions) && field.dimensions.length)
      && !options.length) {
      errors.push(`resultSchema field "${field.key}" (scaleGroup) requires dimensions/options.`);
    }
  });

  const exampleAnswer = raw.exampleAnswer ?? raw.example_answer ?? null;
  if (strictContract && !resultSchema.length) {
    errors.push('resultSchema must contain at least one typed field for contract version 1.');
  } else if (strictContract && resultSchema.length !== 1) {
    errors.push(
      'resultSchema must contain exactly one native result field for contract version 1. '
      + 'Use compositeBlocks for its supported combined response, or split different outputs into separate Skills.',
    );
  }
  if (strictContract && (!exampleAnswer || typeof exampleAnswer !== 'object' || Array.isArray(exampleAnswer))) {
    errors.push('exampleAnswer must be a non-empty object for contract version 1.');
  } else if (strictContract && !Object.keys(exampleAnswer).length) {
    errors.push('exampleAnswer must be a non-empty object for contract version 1.');
  } else if (strictContract) {
    const check = checkAnswerAgainstResultSchema(exampleAnswer, resultSchema);
    const invalid = check.fields.filter((field) => !field.ok);
    if (invalid.length) {
      errors.push(`exampleAnswer does not match resultSchema: ${invalid.map((f) => `${f.key} (${f.detail})`).join(', ')}.`);
    }
  }

  const defaultConfig = (raw.defaultConfig && typeof raw.defaultConfig === 'object')
    ? raw.defaultConfig
    : ((raw.default_config && typeof raw.default_config === 'object') ? raw.default_config : {});

  const analysisHtml = String(raw.analysisHtml || raw.analysis_html || '');
  if (strictContract && analysisHtml.trim()) {
    errors.push(
      'analysisHtml is not allowed for contract version 1. '
      + 'Skill results must use the exact matched native Results Analysis and export family.',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    skill: {
      ...raw,
      sourceHtml,
      analysisHtml,
      configSchema,
      resultSchema,
      exampleAnswer,
      contractVersion,
      defaultConfig,
    },
  };
}
