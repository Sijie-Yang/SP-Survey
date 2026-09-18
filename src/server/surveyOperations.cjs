function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findPageIndex(pages, pageName) {
  return pages.findIndex((p) => p.name === pageName);
}

function findQuestionIndex(page, questionName) {
  return (page.elements || []).findIndex((el) => el.name === questionName);
}

function normalizeOperationsArg(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'object') return null;
  if (Array.isArray(raw.operations)) return raw.operations;
  if (typeof raw.op === 'string') return [raw];
  if (raw.surveyConfig && typeof raw.surveyConfig === 'object' && Array.isArray(raw.surveyConfig.pages)) {
    return [{ op: 'replaceConfig', surveyConfig: raw.surveyConfig }];
  }
  if (Array.isArray(raw.pages)) {
    return [{ op: 'replaceConfig', surveyConfig: raw }];
  }
  if (raw.replaceConfig && typeof raw.replaceConfig === 'object') {
    const payload = raw.replaceConfig.surveyConfig || raw.replaceConfig;
    return [{ op: 'replaceConfig', surveyConfig: payload }];
  }
  const values = Object.keys(raw)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => raw[key])
    .filter((item) => item && typeof item === 'object' && typeof item.op === 'string');
  return values.length ? values : null;
}

function applyOperations(surveyConfig, operations = []) {
  const list = normalizeOperationsArg(operations);
  if (!Array.isArray(list)) {
    throw new Error('operations must be an array of {op, ...}. A single replaceConfig object is also accepted.');
  }

  let config = clone(surveyConfig || { pages: [] });
  if (!Array.isArray(config.pages)) config.pages = [];

  const applied = [];
  const inverse = [];

  list.forEach((op, opIndex) => {
    if (!op || typeof op !== 'object' || !op.op) {
      throw new Error(`operations[${opIndex}] is missing op`);
    }

    switch (op.op) {
      case 'addPage': {
        const page = clone(op.page || {});
        if (!page.name) page.name = `page_${Date.now()}_${opIndex}`;
        if (!Array.isArray(page.elements)) page.elements = [];
        const index = Number.isInteger(op.index) ? op.index : config.pages.length;
        config.pages.splice(Math.max(0, Math.min(index, config.pages.length)), 0, page);
        applied.push(op);
        inverse.unshift({ op: 'removePage', pageName: page.name });
        break;
      }
      case 'removePage': {
        const idx = findPageIndex(config.pages, op.pageName);
        if (idx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const removed = config.pages[idx];
        config.pages.splice(idx, 1);
        applied.push(op);
        inverse.unshift({ op: 'addPage', page: removed, index: idx });
        break;
      }
      case 'addQuestion': {
        const pageIdx = findPageIndex(config.pages, op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const page = config.pages[pageIdx];
        if (!Array.isArray(page.elements)) page.elements = [];
        const question = clone(op.question || {});
        if (!question.name) throw new Error('addQuestion requires question.name');
        if (!question.type) throw new Error('addQuestion requires question.type');
        const index = Number.isInteger(op.index) ? op.index : page.elements.length;
        page.elements.splice(Math.max(0, Math.min(index, page.elements.length)), 0, question);
        applied.push(op);
        inverse.unshift({ op: 'removeQuestion', pageName: op.pageName, questionName: question.name });
        break;
      }
      case 'updateQuestion': {
        const pageIdx = findPageIndex(config.pages, op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const qIdx = findQuestionIndex(config.pages[pageIdx], op.questionName);
        if (qIdx < 0) throw new Error(`Question not found: ${op.questionName}`);
        const previous = clone(config.pages[pageIdx].elements[qIdx]);
        config.pages[pageIdx].elements[qIdx] = {
          ...previous,
          ...(op.patch || {}),
          name: previous.name,
        };
        applied.push(op);
        inverse.unshift({
          op: 'updateQuestion',
          pageName: op.pageName,
          questionName: op.questionName,
          patch: previous,
        });
        break;
      }
      case 'removeQuestion': {
        const pageIdx = findPageIndex(config.pages, op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const qIdx = findQuestionIndex(config.pages[pageIdx], op.questionName);
        if (qIdx < 0) throw new Error(`Question not found: ${op.questionName}`);
        const removed = config.pages[pageIdx].elements[qIdx];
        config.pages[pageIdx].elements.splice(qIdx, 1);
        applied.push(op);
        inverse.unshift({
          op: 'addQuestion',
          pageName: op.pageName,
          question: removed,
          index: qIdx,
        });
        break;
      }
      case 'setAllRatingScales': {
        const types = new Set(op.types || ['rating', 'imagerating', 'mediarating']);
        const previous = [];
        config.pages.forEach((page) => {
          (page.elements || []).forEach((el) => {
            if (!types.has(el.type)) return;
            previous.push({
              pageName: page.name,
              questionName: el.name,
              rateMin: el.rateMin,
              rateMax: el.rateMax,
            });
            if (op.rateMin != null) el.rateMin = op.rateMin;
            if (op.rateMax != null) el.rateMax = op.rateMax;
          });
        });
        applied.push(op);
        inverse.unshift({ op: 'restoreRatingScales', previous });
        break;
      }
      case 'restoreRatingScales': {
        (op.previous || []).forEach((item) => {
          const pageIdx = findPageIndex(config.pages, item.pageName);
          if (pageIdx < 0) return;
          const qIdx = findQuestionIndex(config.pages[pageIdx], item.questionName);
          if (qIdx < 0) return;
          const el = config.pages[pageIdx].elements[qIdx];
          if (item.rateMin !== undefined) el.rateMin = item.rateMin;
          if (item.rateMax !== undefined) el.rateMax = item.rateMax;
        });
        applied.push(op);
        break;
      }
      case 'replaceConfig': {
        const previous = clone(config);
        config = clone(op.surveyConfig || { pages: [] });
        applied.push(op);
        inverse.unshift({ op: 'replaceConfig', surveyConfig: previous });
        break;
      }
      case 'updateSurvey': {
        const previous = {};
        const patch = op.patch && typeof op.patch === 'object' ? op.patch : {};
        Object.keys(patch).forEach((key) => {
          if (key === 'pages') return;
          previous[key] = clone(config[key]);
          config[key] = clone(patch[key]);
        });
        applied.push(op);
        inverse.unshift({ op: 'updateSurvey', patch: previous });
        break;
      }
      case 'updatePage': {
        const idx = findPageIndex(config.pages, op.pageName);
        if (idx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const previous = clone(config.pages[idx]);
        const patch = op.patch && typeof op.patch === 'object' ? op.patch : {};
        config.pages[idx] = {
          ...previous,
          ...clone(patch),
          name: previous.name,
          elements: Object.prototype.hasOwnProperty.call(patch, 'elements')
            ? clone(patch.elements)
            : previous.elements,
        };
        applied.push(op);
        inverse.unshift({ op: 'updatePage', pageName: op.pageName, patch: previous });
        break;
      }
      case 'setTheme': {
        const previous = clone(config.theme || {});
        const patch = clone(op.theme || {});
        config.theme = op.replace === true ? patch : { ...previous, ...patch };
        applied.push(op);
        inverse.unshift({ op: 'setTheme', theme: previous, replace: true });
        break;
      }
      case 'reorderPages': {
        const names = Array.isArray(op.pageNames) ? op.pageNames : [];
        const previous = config.pages.map((page) => page.name);
        const next = names.map((name) => config.pages.find((page) => page.name === name)).filter(Boolean);
        const leftover = config.pages.filter((page) => !names.includes(page.name));
        config.pages = [...next, ...leftover];
        applied.push(op);
        inverse.unshift({ op: 'reorderPages', pageNames: previous });
        break;
      }
      case 'reorderQuestions': {
        const pageIdx = findPageIndex(config.pages, op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const page = config.pages[pageIdx];
        const names = Array.isArray(op.questionNames) ? op.questionNames : [];
        const previous = (page.elements || []).map((element) => element.name);
        const next = names.map((name) => (page.elements || []).find((element) => element.name === name)).filter(Boolean);
        const leftover = (page.elements || []).filter((element) => !names.includes(element.name));
        page.elements = [...next, ...leftover];
        applied.push(op);
        inverse.unshift({ op: 'reorderQuestions', pageName: op.pageName, questionNames: previous });
        break;
      }
      default:
        throw new Error(`Unknown operation: ${op.op}`);
    }
  });

  return { surveyConfig: config, applied, inverse };
}

module.exports = {
  applyOperations,
  normalizeOperationsArg,
};
