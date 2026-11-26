/**
 * Participant-facing translations for one survey and one response dataset.
 * Language is how the wording is shown. It is not a research condition,
 * a region, or a separate survey version.
 *
 * A response records answerLanguage and questionAnswerLanguages.
 * The participant answers a language question on its own first page. Those fields
 * are never written into condition.
 */

import { surveyLocalization } from 'survey-core';
import { UI_LANGUAGES, surveyJsLocale, uiPair } from './uiLanguages';
import { applySurveyLocale } from './surveyLocale';
import { attachSurveyMarkdown } from './surveyMarkdown';

export const TRANSLATION_MACHINE = 'machine';
export const TRANSLATION_REVIEWED = 'reviewed';
export const ANSWER_LANGUAGE_QUESTION = 'sp_answer_language';
export const ANSWER_LANGUAGE_PAGE = 'sp_answer_language_page';

const OPTION_LISTS = [
  ['choices', 'choice'],
  ['rows', 'row'],
  ['columns', 'column'],
  ['rateValues', 'rate'],
];

export function isKnownSurveyLanguage(raw) {
  const lower = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return false;
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return true;
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans') return true;
  if (UI_LANGUAGES.some((item) => item.id.toLowerCase() === lower || item.surveyJs === lower)) return true;
  return UI_LANGUAGES.some((item) => item.nativeName.toLowerCase() === String(raw || '').trim().toLowerCase());
}

/** Known interface languages use their id. Any other typed name is kept for the model. */
export function strictSurveyLanguage(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ').replace(/[\u0000-\u001f]/g, '');
  if (!text) return '';
  const lower = text.toLowerCase().replace(/_/g, '-');
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return 'zh-TW';
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans') return 'zh';
  const found = UI_LANGUAGES.find((item) => item.id.toLowerCase() === lower || item.surveyJs === lower);
  if (found) return found.id;
  const byName = UI_LANGUAGES.find((item) => item.nativeName.toLowerCase() === text.toLowerCase());
  if (byName) return byName.id;
  return text.slice(0, 80);
}

function languageName(id) {
  return UI_LANGUAGES.find((item) => item.id === id)?.nativeName || id;
}

export function translationStatusLabel(status, uiLanguage) {
  if (status === 'missing') return uiPair(uiLanguage, 'Missing translation', '缺少翻译');
  if (status === TRANSLATION_REVIEWED) return uiPair(uiLanguage, 'Reviewed', '已审阅');
  return uiPair(uiLanguage, 'Machine translation, needs review', '机器翻译，需要审阅');
}

export function translationAccuracyNotice(uiLanguage) {
  return uiPair(
    uiLanguage,
    'Machine translations can be inaccurate until a person reviews them. Language only changes the wording participants see. It is not a research condition or a regional version.',
    '机器翻译在人工审阅之前可能不准确。语言只改变参与者看到的文字，不是研究条件，也不是地区版本。',
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasLetters(text) {
  return /\p{L}/u.test(String(text || ''));
}

function questionId(name, field) {
  return `question:${encodeURIComponent(name)}:${field}`;
}

function optionId(name, kind, value) {
  return `question:${encodeURIComponent(name)}:${kind}:${encodeURIComponent(String(value))}`;
}

function optionValue(item, index) {
  if (item == null) return index;
  if (typeof item === 'string' || typeof item === 'number') return item;
  if (typeof item === 'object') return item.value ?? item.id ?? item.text ?? index;
  return index;
}

function optionText(item) {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item === 'object') {
    if (item.text != null && String(item.text).trim()) return String(item.text);
    if (item.value != null) return String(item.value);
  }
  return '';
}

function walkElements(pages, visit) {
  const visitList = (elements) => {
    (elements || []).forEach((element) => {
      if (!element || typeof element !== 'object') return;
      visit(element);
      if (Array.isArray(element.elements)) visitList(element.elements);
    });
  };
  (pages || []).forEach((page) => visitList(page?.elements));
}

function pushString(list, item) {
  const text = String(item.sourceText ?? '');
  if (!text.trim() || !hasLetters(text)) return;
  list.push({ ...item, sourceText: text });
}

export function extractTranslatableStrings(config) {
  const list = [];
  pushString(list, {
    id: 'survey.title',
    sourceText: config?.title || '',
    group: 'survey',
    groupLabel: 'Survey',
    field: 'title',
  });
  pushString(list, {
    id: 'survey.description',
    sourceText: config?.description || '',
    group: 'survey',
    groupLabel: 'Survey',
    field: 'description',
  });
  pushString(list, {
    id: 'survey.completionMessage',
    sourceText: config?.completionMessage || '',
    group: 'completion',
    groupLabel: 'Completion page',
    field: 'completion',
  });
  pushString(list, {
    id: 'survey.completedHtml',
    sourceText: config?.completedHtml || '',
    group: 'completion',
    groupLabel: 'Completion page',
    field: 'completion',
  });
  walkElements(config?.pages, (element) => {
    if (!element.name || element.name === ANSWER_LANGUAGE_QUESTION) return;
    const groupLabel = element.title || element.name;
    pushString(list, {
      id: questionId(element.name, 'title'),
      sourceText: element.title || '',
      group: 'question',
      groupLabel,
      field: 'title',
      questionName: element.name,
    });
    pushString(list, {
      id: questionId(element.name, 'description'),
      sourceText: element.description || '',
      group: 'question',
      groupLabel,
      field: 'description',
      questionName: element.name,
    });
    OPTION_LISTS.forEach(([key, kind]) => {
      if (!Array.isArray(element[key])) return;
      element[key].forEach((item, index) => {
        const value = optionValue(item, index);
        pushString(list, {
          id: optionId(element.name, kind, value),
          sourceText: optionText(item),
          group: 'question',
          groupLabel,
          field: kind,
          questionName: element.name,
          optionValue: value,
        });
      });
    });
    ['minRateDescription', 'maxRateDescription', 'labelTrue', 'labelFalse'].forEach((field) => {
      pushString(list, {
        id: questionId(element.name, field),
        sourceText: element[field] || '',
        group: 'question',
        groupLabel,
        field,
        questionName: element.name,
      });
    });
    if (Array.isArray(element.dimensions)) {
      element.dimensions.forEach((dimension, index) => {
        if (!dimension || typeof dimension !== 'object') return;
        const dimId = dimension.id != null && String(dimension.id) !== '' ? dimension.id : index;
        ['left', 'right'].forEach((side) => {
          pushString(list, {
            id: questionId(element.name, `dimension:${encodeURIComponent(String(dimId))}:${side}`),
            sourceText: dimension[side] || '',
            group: 'question',
            groupLabel,
            field: side === 'left' ? 'scaleStart' : 'scaleEnd',
            questionName: element.name,
          });
        });
      });
    }
  });
  return list;
}

function cleanCell(cell) {
  if (!cell || typeof cell !== 'object') return null;
  const text = typeof cell.text === 'string' ? cell.text : '';
  if (!text.trim()) return null;
  return {
    text,
    status: cell.status === TRANSLATION_REVIEWED ? TRANSLATION_REVIEWED : TRANSLATION_MACHINE,
    humanEdited: Boolean(cell.humanEdited || cell.editedByPerson),
  };
}

export function readTranslations(config) {
  const raw = config?.translations && typeof config.translations === 'object' ? config.translations : {};
  const sourceLanguage = strictSurveyLanguage(raw.sourceLanguage || config?.locale) || 'en';
  const targetLanguages = unique((raw.targetLanguages || []).map(strictSurveyLanguage).filter((code) => code && code !== sourceLanguage));
  const enabledLanguages = unique([
    sourceLanguage,
    ...(raw.enabledLanguages || []).map(strictSurveyLanguage).filter((code) => code === sourceLanguage || targetLanguages.includes(code)),
  ]);
  const entries = {};
  const sourceEntries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
  Object.entries(sourceEntries).forEach(([id, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const byLanguage = {};
    Object.entries(entry.byLanguage || {}).forEach(([lang, cell]) => {
      const code = strictSurveyLanguage(lang);
      const clean = cleanCell(cell);
      if (code && clean) byLanguage[code] = clean;
    });
    entries[id] = {
      sourceText: typeof entry.sourceText === 'string' ? entry.sourceText : '',
      byLanguage,
    };
  });
  return { sourceLanguage, targetLanguages, enabledLanguages, entries };
}

function protectCell(cell, sourceChanged) {
  if (!cell) return cell;
  if (!sourceChanged) return { ...cell };
  return {
    text: cell.text,
    status: TRANSLATION_MACHINE,
    humanEdited: Boolean(cell.humanEdited || cell.status === TRANSLATION_REVIEWED),
  };
}

/** Refresh source snapshots. Source edits mark translations needs-review and keep person-reviewed text. */
export function reconcileTranslations(config) {
  const current = readTranslations(config);
  const strings = extractTranslatableStrings(config);
  const entries = {};
  strings.forEach((item) => {
    const prev = current.entries[item.id];
    const sourceChanged = Boolean(prev && prev.sourceText !== item.sourceText);
    const byLanguage = {};
    Object.entries(prev?.byLanguage || {}).forEach(([lang, cell]) => {
      if (lang === current.sourceLanguage) return;
      byLanguage[lang] = protectCell(cell, sourceChanged);
    });
    entries[item.id] = { sourceText: item.sourceText, byLanguage };
  });
  return {
    sourceLanguage: current.sourceLanguage,
    targetLanguages: current.targetLanguages,
    enabledLanguages: current.enabledLanguages,
    entries,
  };
}

export function setTranslationLanguages(config, { sourceLanguage, targetLanguages, enabledLanguages } = {}) {
  const current = reconcileTranslations(config);
  const source = strictSurveyLanguage(sourceLanguage) || current.sourceLanguage;
  const targets = unique((targetLanguages || current.targetLanguages).map(strictSurveyLanguage).filter((code) => code && code !== source));
  const requestedEnabled = enabledLanguages || current.enabledLanguages;
  const enabled = unique([
    source,
    ...requestedEnabled.map(strictSurveyLanguage).filter((code) => code === source || targets.includes(code)),
  ]);
  const sourceChanged = source !== current.sourceLanguage;
  const entries = {};
  Object.entries(current.entries).forEach(([id, entry]) => {
    const byLanguage = {};
    Object.entries(entry.byLanguage || {}).forEach(([lang, cell]) => {
      byLanguage[lang] = protectCell(cell, sourceChanged);
    });
    entries[id] = { sourceText: entry.sourceText, byLanguage };
  });
  return { sourceLanguage: source, targetLanguages: targets, enabledLanguages: enabled, entries };
}

export function editTranslation(translations, id, language, text) {
  const next = JSON.parse(JSON.stringify(translations));
  const code = strictSurveyLanguage(language);
  if (!next.entries[id] || !code || code === next.sourceLanguage) return next;
  const previous = next.entries[id].byLanguage[code];
  const value = String(text ?? '');
  if (previous && previous.text === value) return next;
  next.entries[id].byLanguage[code] = {
    text: value,
    status: TRANSLATION_MACHINE,
    humanEdited: true,
  };
  if (!value.trim()) delete next.entries[id].byLanguage[code];
  return next;
}

export function confirmTranslation(translations, id, language) {
  const next = JSON.parse(JSON.stringify(translations));
  const code = strictSurveyLanguage(language);
  const cell = next.entries?.[id]?.byLanguage?.[code];
  if (!cell || !String(cell.text || '').trim()) return next;
  cell.status = TRANSLATION_REVIEWED;
  return next;
}

export function confirmAllTranslations(translations, language) {
  const code = strictSurveyLanguage(language);
  let next = translations;
  Object.entries(translations.entries || {}).forEach(([id, entry]) => {
    if (entry?.byLanguage?.[code]?.text) next = confirmTranslation(next, id, code);
  });
  return next;
}

export function mergeMachineTranslations(translations, language, acceptedMap, { forceIds = [] } = {}) {
  const next = JSON.parse(JSON.stringify(translations));
  const code = strictSurveyLanguage(language);
  const force = new Set(forceIds);
  if (!code || code === next.sourceLanguage) return next;
  Object.entries(acceptedMap || {}).forEach(([id, text]) => {
    if (!next.entries[id] || typeof text !== 'string' || !text.trim()) return;
    const cell = next.entries[id].byLanguage[code];
    if (cell && (cell.humanEdited || cell.status === TRANSLATION_REVIEWED) && !force.has(id)) return;
    next.entries[id].byLanguage[code] = {
      text,
      status: TRANSLATION_MACHINE,
      humanEdited: false,
    };
  });
  return next;
}

export function stringsForMachineTranslation(config, language, { forceIds = [] } = {}) {
  const translations = reconcileTranslations(config);
  const code = strictSurveyLanguage(language);
  const force = new Set(forceIds);
  if (!code || code === translations.sourceLanguage) return [];
  return extractTranslatableStrings(config).filter((item) => {
    const cell = translations.entries[item.id]?.byLanguage?.[code];
    if (force.has(item.id)) return true;
    if (!cell || !cell.text) return true;
    if (cell.humanEdited || cell.status === TRANSLATION_REVIEWED) return false;
    return true;
  }).map((item) => ({ id: item.id, text: item.sourceText }));
}

/** Remove one generated language. Participants can no longer choose it. */
export function deleteLanguageVersion(translations, language) {
  const next = JSON.parse(JSON.stringify(translations || {}));
  const code = strictSurveyLanguage(language);
  if (!next.entries || !code || code === next.sourceLanguage) return next;
  next.targetLanguages = (next.targetLanguages || []).filter((item) => item !== code);
  next.enabledLanguages = (next.enabledLanguages || []).filter((item) => item !== code);
  if (next.sourceLanguage && !next.enabledLanguages.includes(next.sourceLanguage)) {
    next.enabledLanguages.unshift(next.sourceLanguage);
  }
  Object.values(next.entries).forEach((entry) => {
    if (entry?.byLanguage) delete entry.byLanguage[code];
  });
  return next;
}

export function languageVersionSummary(config, language) {
  const translations = reconcileTranslations(config);
  const code = strictSurveyLanguage(language);
  const strings = extractTranslatableStrings(config);
  let translatedCount = 0;
  let needsUpdate = false;
  strings.forEach((item) => {
    const cell = translations.entries[item.id]?.byLanguage?.[code];
    const text = cell && String(cell.text || '').trim();
    if (!text) {
      needsUpdate = true;
      return;
    }
    translatedCount += 1;
    if (cell.status !== TRANSLATION_REVIEWED) needsUpdate = true;
  });
  const total = strings.length;
  return {
    language: code,
    name: languageName(code),
    translated: total > 0 && translatedCount === total,
    partial: translatedCount > 0 && translatedCount < total,
    translatedCount,
    total,
    needsUpdate: total === 0 ? false : needsUpdate,
    enabled: translations.enabledLanguages.includes(code),
    hasUiPack: isKnownSurveyLanguage(code),
  };
}

/** Survey chrome for a language the site does not ship: the source language, or English when the source has no pack either. */
export function chromeLanguageFor(config, answerLanguage) {
  const translations = readTranslations(config || {});
  const answer = strictSurveyLanguage(answerLanguage) || translations.sourceLanguage;
  if (isKnownSurveyLanguage(answer)) return answer;
  if (isKnownSurveyLanguage(translations.sourceLanguage)) return translations.sourceLanguage;
  return 'en';
}

export function systemChromeNote(uiLanguage) {
  return uiPair(
    uiLanguage,
    'The model translates the title, description, questions, and choices only. Buttons, validation, progress, and other system prompts stay in the source language when a language has no built-in interface.',
    '模型只翻译标题、说明、题目和选项。没有内置界面的语言，按钮、校验、进度和其他系统提示仍使用源语言。',
  );
}

export function systemChromeRowNote(uiLanguage, sourceLanguage) {
  const name = languageName(strictSurveyLanguage(sourceLanguage) || sourceLanguage);
  return uiPair(
    uiLanguage,
    `Buttons and system prompts stay in ${name}.`,
    `按钮和系统提示仍使用${name}。`,
  );
}

function languageQuestionPrompt(language) {
  const known = strictSurveyLanguage(language);
  if (known === 'zh-TW') return '你希望用哪種語言填寫這份問卷？';
  if (known === 'zh') return '你希望用哪种语言填写这份问卷？';
  return 'Which language do you want to use for this survey?';
}

/** A normal radiogroup, present only when the participant has a real choice. */
export function languageChoiceQuestion(config) {
  const languages = participantLanguages(config);
  if (languages.length < 2) return null;
  const source = readTranslations(config).sourceLanguage;
  return {
    type: 'radiogroup',
    name: ANSWER_LANGUAGE_QUESTION,
    title: languageQuestionPrompt(source),
    isRequired: true,
    choices: languages.map((item) => ({ value: item.id, text: item.nativeName })),
  };
}

export function textForLanguage(translations, id, language, sourceText) {
  const source = sourceText == null ? '' : String(sourceText);
  if (!translations || !language || language === translations.sourceLanguage) return source;
  const cell = translations.entries?.[id]?.byLanguage?.[language];
  if (!cell || typeof cell.text !== 'string' || !cell.text.trim()) return source;
  return cell.text;
}

export function participantLanguages(config) {
  const translations = readTranslations(config);
  return translations.enabledLanguages.map((id) => ({ id, nativeName: languageName(id) }));
}

export function participantMayUseLanguage(config, language) {
  const code = strictSurveyLanguage(language);
  if (!code) return false;
  return readTranslations(config).enabledLanguages.includes(code);
}

export function resolveParticipantLanguage(config, requested) {
  const translations = readTranslations(config);
  const asked = strictSurveyLanguage(requested);
  if (asked && translations.enabledLanguages.includes(asked)) return asked;
  if (translations.enabledLanguages.includes(translations.sourceLanguage)) return translations.sourceLanguage;
  return translations.enabledLanguages[0] || translations.sourceLanguage;
}

export function translationPublishFindings(config) {
  const translations = reconcileTranslations(config);
  const missing = [];
  const unreviewed = [];
  if (!translations.targetLanguages.length) return { missing, unreviewed };
  extractTranslatableStrings(config).forEach((item) => {
    translations.targetLanguages.forEach((language) => {
      const cell = translations.entries[item.id]?.byLanguage?.[language];
      const row = {
        id: item.id,
        language,
        languageName: languageName(language),
        groupLabel: item.groupLabel,
        field: item.field,
        sourceText: item.sourceText,
      };
      if (!cell || !String(cell.text || '').trim()) missing.push(row);
      else if (cell.status !== TRANSLATION_REVIEWED) unreviewed.push({ ...row, text: cell.text });
    });
  });
  return { missing, unreviewed };
}

function setOptionText(item, text) {
  if (typeof item === 'string' || typeof item === 'number') {
    if (String(item) === text) return item;
    return { value: item, text };
  }
  if (item && typeof item === 'object') {
    return { ...item, text };
  }
  return item;
}

function applyToElement(element, translations, language) {
  if (!element?.name) return element;
  const next = { ...element };
  if (element.title != null) {
    next.title = textForLanguage(translations, questionId(element.name, 'title'), language, element.title);
  }
  if (element.description != null) {
    next.description = textForLanguage(translations, questionId(element.name, 'description'), language, element.description);
  }
  OPTION_LISTS.forEach(([key, kind]) => {
    if (!Array.isArray(element[key])) return;
    next[key] = element[key].map((item, index) => {
      const value = optionValue(item, index);
      const translated = textForLanguage(
        translations,
        optionId(element.name, kind, value),
        language,
        optionText(item),
      );
      const updated = setOptionText(item, translated);
      if (updated && typeof updated === 'object' && item && typeof item === 'object') {
        updated.value = item.value ?? updated.value;
      }
      return updated;
    });
  });
  ['minRateDescription', 'maxRateDescription', 'labelTrue', 'labelFalse'].forEach((field) => {
    if (element[field] == null) return;
    next[field] = textForLanguage(translations, questionId(element.name, field), language, element[field]);
  });
  if (Array.isArray(element.dimensions)) {
    next.dimensions = element.dimensions.map((dimension, index) => {
      if (!dimension || typeof dimension !== 'object') return dimension;
      const dimId = dimension.id != null && String(dimension.id) !== '' ? dimension.id : index;
      return {
        ...dimension,
        left: textForLanguage(
          translations,
          questionId(element.name, `dimension:${encodeURIComponent(String(dimId))}:left`),
          language,
          dimension.left || '',
        ),
        right: textForLanguage(
          translations,
          questionId(element.name, `dimension:${encodeURIComponent(String(dimId))}:right`),
          language,
          dimension.right || '',
        ),
      };
    });
  }
  if (Array.isArray(element.elements)) {
    next.elements = element.elements.map((child) => applyToElement(child, translations, language));
  }
  return next;
}

/** Display copy. Option values, logic, and numbers stay on the source question. */
export function applyParticipantLanguage(config, language) {
  const source = config && typeof config === 'object' ? config : {};
  const translations = readTranslations(source);
  const lang = participantMayUseLanguage(source, language)
    ? strictSurveyLanguage(language)
    : resolveParticipantLanguage(source, null);
  const copy = JSON.parse(JSON.stringify(source));
  if (copy.title != null) copy.title = textForLanguage(translations, 'survey.title', lang, source.title || '');
  if (copy.description != null) copy.description = textForLanguage(translations, 'survey.description', lang, source.description || '');
  if (copy.completionMessage != null) {
    copy.completionMessage = textForLanguage(translations, 'survey.completionMessage', lang, source.completionMessage || '');
  }
  if (copy.completedHtml != null) {
    copy.completedHtml = textForLanguage(translations, 'survey.completedHtml', lang, source.completedHtml || '');
  }
  copy.pages = (source.pages || []).map((page) => ({
    ...JSON.parse(JSON.stringify(page)),
    elements: (page?.elements || []).map((element) => applyToElement(element, translations, lang)),
  }));
  return copy;
}

/** SurveyJS stores English on the default locale. Other known languages use their SurveyJS code. Typed languages use their own name. */
function surveyLocaleBucket(language) {
  const code = strictSurveyLanguage(language);
  if (!code) return 'default';
  if (!isKnownSurveyLanguage(code)) return code;
  const surveyCode = surveyJsLocale(code);
  return surveyCode === 'en' ? 'default' : surveyCode;
}

export function participantModelLocale(language) {
  const code = strictSurveyLanguage(language);
  if (!code) return 'en';
  if (!isKnownSurveyLanguage(code)) return code;
  return surveyJsLocale(code);
}

function writeLoc(owner, locProp, language, text) {
  const loc = owner?.[locProp];
  if (!loc || typeof loc.setLocaleText !== 'function') return false;
  loc.setLocaleText(surveyLocaleBucket(language), text == null ? '' : String(text));
  return true;
}

/**
 * Write source text and the chosen translation into their own locale slots.
 * Assigning `.text` would store the new wording under the previous locale, so
 * the next switch shows the other language.
 */
function assignLoc(owner, locProp, plainProp, sourceLanguage, displayLanguage, sourceText, displayText) {
  const wroteSource = writeLoc(owner, locProp, sourceLanguage, sourceText);
  const wroteDisplay = displayLanguage === sourceLanguage
    ? wroteSource
    : writeLoc(owner, locProp, displayLanguage, displayText);
  if (!wroteSource && !wroteDisplay && plainProp && owner) owner[plainProp] = displayText;
}

const LOCALIZED_FIELDS = [
  ['title', 'locTitle'],
  ['description', 'locDescription'],
  ['minRateDescription', 'locMinRateDescription'],
  ['maxRateDescription', 'locMaxRateDescription'],
  ['labelTrue', 'locLabelTrue'],
  ['labelFalse', 'locLabelFalse'],
];

export function applyLanguageToSurveyModel(model, config, language) {
  if (!model || !config) return model;
  const translations = readTranslations(config);
  const lang = participantMayUseLanguage(config, language)
    ? strictSurveyLanguage(language)
    : resolveParticipantLanguage(config, null);
  const sourceLanguage = translations.sourceLanguage;
  if (config.title != null) {
    assignLoc(
      model,
      'locTitle',
      'title',
      sourceLanguage,
      lang,
      config.title || '',
      textForLanguage(translations, 'survey.title', lang, config.title || ''),
    );
  }
  if (config.description != null) {
    assignLoc(
      model,
      'locDescription',
      'description',
      sourceLanguage,
      lang,
      config.description || '',
      textForLanguage(translations, 'survey.description', lang, config.description || ''),
    );
  }
  if (config.completedHtml != null) {
    assignLoc(
      model,
      'locCompletedHtml',
      'completedHtml',
      sourceLanguage,
      lang,
      config.completedHtml,
      textForLanguage(translations, 'survey.completedHtml', lang, config.completedHtml),
    );
  }
  const sources = new Map();
  walkElements(config.pages, (element) => {
    if (element?.name) sources.set(element.name, element);
  });
  const questions = typeof model.getAllQuestions === 'function' ? model.getAllQuestions() : [];
  questions.forEach((question) => {
    const source = sources.get(question.name);
    if (!source) return;
    LOCALIZED_FIELDS.forEach(([field, locProp]) => {
      if (source[field] == null) return;
      assignLoc(
        question,
        locProp,
        field,
        sourceLanguage,
        lang,
        source[field],
        textForLanguage(translations, questionId(source.name, field), lang, source[field]),
      );
    });
    OPTION_LISTS.forEach(([key, kind]) => {
      const live = question[key];
      const original = source[key];
      if (!Array.isArray(live) || !Array.isArray(original)) return;
      live.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const value = item.value ?? optionValue(original[index], index);
        const fromSource = original.find((candidate, candidateIndex) => optionValue(candidate, candidateIndex) === value) || original[index];
        const sourceText = optionText(fromSource);
        assignLoc(
          item,
          'locText',
          'text',
          sourceLanguage,
          lang,
          sourceText,
          textForLanguage(translations, optionId(source.name, kind, value), lang, sourceText),
        );
      });
    });
    if (Array.isArray(source.dimensions) && Array.isArray(question.dimensions)) {
      question.dimensions = source.dimensions.map((dimension, index) => {
        if (!dimension || typeof dimension !== 'object') return question.dimensions[index] || dimension;
        const dimId = dimension.id != null && String(dimension.id) !== '' ? dimension.id : index;
        const live = question.dimensions[index] && typeof question.dimensions[index] === 'object'
          ? question.dimensions[index]
          : dimension;
        return {
          ...live,
          ...dimension,
          left: textForLanguage(
            translations,
            questionId(source.name, `dimension:${encodeURIComponent(String(dimId))}:left`),
            lang,
            dimension.left || '',
          ),
          right: textForLanguage(
            translations,
            questionId(source.name, `dimension:${encodeURIComponent(String(dimId))}:right`),
            lang,
            dimension.right || '',
          ),
        };
      });
    }
  });
  try {
    model.locale = participantModelLocale(lang);
  } catch { /* ignore */ }
  return model;
}

function installSourceChromePack(localeName, chromeLanguage) {
  const packId = surveyJsLocale(chromeLanguage);
  const sourcePack = surveyLocalization.locales[packId] || surveyLocalization.locales.en;
  if (!sourcePack || !localeName) return;
  const copy = {};
  Object.keys(sourcePack).forEach((key) => {
    copy[key] = sourcePack[key];
  });
  surveyLocalization.locales[localeName] = copy;
}

/**
 * Known languages use their built-in SurveyJS interface.
 * A typed language keeps survey content in its own locale slot and reuses the
 * source language for buttons, validation, progress, and other system prompts.
 */
export function applyAnswerLanguageChrome(model, config, language) {
  if (!model) return;
  const answer = strictSurveyLanguage(language);
  const chrome = chromeLanguageFor(config, answer);
  if (typeof model.setPropertyValue === 'function') {
    model.setPropertyValue('spChromeLanguage', chrome);
  }
  if (answer && !isKnownSurveyLanguage(answer)) {
    installSourceChromePack(answer, chrome);
    try { model.locale = participantModelLocale(answer); } catch { /* ignore */ }
    attachSurveyMarkdown(model);
    return;
  }
  if (answer) applySurveyLocale(model, { locale: answer });
}

/** The language question is the only question on the first page. Later pages have no switcher. */
export function placeLanguageChoiceQuestion(model, config) {
  if (!model || typeof model.getQuestionByName !== 'function' || typeof model.addNewPage !== 'function') return null;
  const spec = languageChoiceQuestion(config);
  const existing = model.getQuestionByName(ANSWER_LANGUAGE_QUESTION);
  const languagePage = typeof model.getPageByName === 'function' ? model.getPageByName(ANSWER_LANGUAGE_PAGE) : null;
  if (!spec) {
    if (existing && typeof existing.delete === 'function') existing.delete();
    if (languagePage && typeof model.removePage === 'function') model.removePage(languagePage);
    return null;
  }
  let page = languagePage;
  if (!page) page = model.addNewPage(ANSWER_LANGUAGE_PAGE, 0);
  else if (model.pages[0] !== page) {
    const index = model.pages.indexOf(page);
    if (index > 0) {
      model.pages.splice(index, 1);
      model.pages.splice(0, 0, page);
    }
  }
  (page.questions || []).slice().forEach((item) => {
    if (item?.name !== ANSWER_LANGUAGE_QUESTION && typeof item.delete === 'function') item.delete();
  });
  let question = model.getQuestionByName(ANSWER_LANGUAGE_QUESTION);
  if (question && question.page !== page) {
    question.delete();
    question = null;
  }
  if (!question) question = page.addNewQuestion('radiogroup', ANSWER_LANGUAGE_QUESTION);
  const previousValue = question.value;
  const prompts = new Map();
  const source = readTranslations(config).sourceLanguage;
  const promptFor = (language) => (
    isKnownSurveyLanguage(language) ? languageQuestionPrompt(language) : languageQuestionPrompt(source)
  );
  prompts.set(source, languageQuestionPrompt(source));
  spec.choices.forEach((choice) => prompts.set(choice.value, promptFor(choice.value)));
  prompts.forEach((text, language) => writeLoc(question, 'locTitle', language, text));
  question.isRequired = true;
  question.choices = spec.choices.map((choice) => ({ value: choice.value, text: choice.text }));
  question.choices.forEach((item, index) => {
    const text = spec.choices[index]?.text || '';
    prompts.forEach((_, language) => writeLoc(item, 'locText', language, text));
  });
  if (previousValue != null && previousValue !== '' && question.value !== previousValue) {
    question.value = previousValue;
  }
  return question;
}

export function questionLanguagesForSubmission(questions, currentLanguage, recorded = {}) {
  const out = { ...(recorded || {}) };
  (questions || []).forEach((question) => {
    const name = question?.name;
    if (!name || out[name]) return;
    const value = question.value;
    const answered = !(value === undefined || value === null || value === '');
    if (answered) out[name] = currentLanguage;
  });
  return out;
}

/**
 * Fields stored on the response. answerLanguage is separate from condition.
 * published_version is the released survey version, not a language.
 */
export function surveyLanguageMetadata({
  answerLanguage,
  questionAnswerLanguages,
  publishedVersion,
} = {}) {
  const language = strictSurveyLanguage(answerLanguage) || 'en';
  const perQuestion = {};
  Object.entries(questionAnswerLanguages || {}).forEach(([name, value]) => {
    const code = strictSurveyLanguage(value);
    if (name && code) perQuestion[name] = code;
  });
  return {
    ...(publishedVersion != null ? { published_version: publishedVersion } : {}),
    answerLanguage: language,
    questionAnswerLanguages: perQuestion,
  };
}

const NUMBER_RE = /\d+(?:\.\d+)?/g;
const TOKEN_RE = /\{[^{}]+\}/g;
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function keepsSequence(source, translated, pattern) {
  const parts = String(source || '').match(pattern) || [];
  let rest = String(translated || '');
  return parts.every((part) => {
    const index = rest.indexOf(part);
    if (index < 0) return false;
    rest = rest.slice(index + part.length);
    return true;
  });
}

export function translationPreservesSource(source, translated) {
  if (typeof translated !== 'string' || !translated.trim()) return false;
  return keepsSequence(source, translated, NUMBER_RE)
    && keepsSequence(source, translated, TOKEN_RE)
    && keepsSequence(source, translated, TAG_RE);
}

/** Keep only string translations for the requested ids. Numbers, tokens, and tags must survive. */
export function acceptModelTranslations(items, payload) {
  const raw = payload?.translations && typeof payload.translations === 'object' ? payload.translations : {};
  const accepted = {};
  const rejected = [];
  (items || []).forEach((item) => {
    const text = raw[item.id];
    if (typeof text !== 'string' || !translationPreservesSource(item.text, text)) {
      rejected.push(item.id);
      return;
    }
    accepted[item.id] = text;
  });
  return { accepted, rejected };
}
