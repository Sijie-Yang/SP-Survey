/**
 * Per-viewport preview sizes stored on the survey config.
 *
 * `config.viewportLayout.desktop` and `config.viewportLayout.mobile` are
 * independent. Question text and page/question order stay on `pages`, so
 * an edit made while previewing one viewport is the same edit for the other.
 * Participant rendering reads this object from the published survey config.
 */
import { MOBILE_WIDTH } from './imagePickerLayout';

export const VIEWPORT_LAYOUT_DEFAULTS = {
  desktop: { contentWidth: 900, questionWidth: 900, mediaMaxHeight: 480, questionGap: 24, cardPadding: 32 },
  mobile: { contentWidth: 390, questionWidth: 390, mediaMaxHeight: 320, questionGap: 16, cardPadding: 20 },
};

export const VIEWPORT_LAYOUT_LIMITS = {
  desktop: { contentWidth: [480, 1400], questionWidth: [280, 1400], mediaMaxHeight: [80, 800], questionGap: [0, 80], cardPadding: [8, 64] },
  mobile: { contentWidth: [280, 480], questionWidth: [200, 480], mediaMaxHeight: [80, 800], questionGap: [0, 80], cardPadding: [8, 64] },
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clampLayoutValue(viewport, field, value) {
  const limits = VIEWPORT_LAYOUT_LIMITS[viewport] || VIEWPORT_LAYOUT_LIMITS.desktop;
  const [min, max] = limits[field] || VIEWPORT_LAYOUT_LIMITS.desktop[field];
  const fallback = VIEWPORT_LAYOUT_DEFAULTS[viewport]?.[field] ?? VIEWPORT_LAYOUT_DEFAULTS.desktop[field];
  const n = finite(value);
  if (n == null) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Slider values. Unsaved fields fall back to the preview defaults. */
export function viewportSlot(config, viewport) {
  const key = viewport === 'mobile' ? 'mobile' : 'desktop';
  const saved = config?.viewportLayout?.[key] || {};
  const defaults = VIEWPORT_LAYOUT_DEFAULTS[key];
  const contentWidth = finite(saved.contentWidth);
  const questionWidth = finite(saved.questionWidth);
  const mediaMaxHeight = finite(saved.mediaMaxHeight);
  const resolvedContent = contentWidth > 0 ? contentWidth : defaults.contentWidth;
  const resolvedQuestion = questionWidth > 0 ? questionWidth : resolvedContent;
  return {
    viewport: key,
    questionGap: saved.questionGap ?? defaults.questionGap,
    cardPadding: saved.cardPadding ?? defaults.cardPadding,
    contentWidth: resolvedContent,
    questionWidth: Math.min(resolvedQuestion, resolvedContent),
    mediaMaxHeight: mediaMaxHeight > 0 ? mediaMaxHeight : defaults.mediaMaxHeight,
    contentWidthSaved: contentWidth > 0,
    questionWidthSaved: questionWidth > 0,
    mediaMaxHeightSaved: mediaMaxHeight > 0,
  };
}

export function setViewportLayoutField(config, viewport, field, value) {
  const key = viewport === 'mobile' ? 'mobile' : 'desktop';
  const nextValue = clampLayoutValue(key, field, value);
  const current = config?.viewportLayout || {};
  const slot = { ...(current[key] || {}) };
  if (slot[field] === nextValue) return config;
  slot[field] = nextValue;
  return {
    ...config,
    viewportLayout: { ...current, [key]: slot },
  };
}

/**
 * Sizes to apply on the participant survey. Missing fields stay on the
 * historical hardcoded layout so untouched surveys do not change.
 */
export function resolvePublishedFrame(config, viewportWidth) {
  const viewport = viewportWidth > 0 && viewportWidth < MOBILE_WIDTH ? 'mobile' : 'desktop';
  const saved = config?.viewportLayout?.[viewport];
  if (!saved) return { viewport, contentWidth: null, questionWidth: null, mediaMaxHeight: null };
  const contentWidth = finite(saved.contentWidth);
  const questionWidth = finite(saved.questionWidth);
  const mediaMaxHeight = finite(saved.mediaMaxHeight);
  // A question override is authored inside the studio's default frame. Without
  // this fallback, SurveyJS's narrower legacy body silently caps that width.
  const hasQuestionSizing = Object.values(saved.questions || {}).some((q) => q?.mediaLayout || ['questionWidth', 'mediaMaxHeight', 'mediaWidth'].some((field) => q?.[field] > 0));
  const studioDefaults = hasQuestionSizing ? viewportSlot(config, viewport) : null;
  const resolvedContent = contentWidth > 0 ? contentWidth : studioDefaults?.contentWidth || null;
  const resolvedQuestion = questionWidth > 0 ? questionWidth : studioDefaults?.questionWidth || null;
  return {
    viewport,
    contentWidth: resolvedContent,
    questionWidth: resolvedQuestion && resolvedContent
      ? Math.min(resolvedQuestion, resolvedContent)
      : resolvedQuestion,
    mediaMaxHeight: mediaMaxHeight > 0 ? mediaMaxHeight : studioDefaults?.mediaMaxHeight || null,
  };
}

export function applyContentWidthToModel(model, contentWidth) {
  if (!model || !(finite(contentWidth) > 0)) return;
  model.widthMode = 'static';
  model.width = `${Math.round(contentWidth)}px`;
}

export function updateSurveyText(config, field, value) {
  if (!config || config[field] === value) return config;
  if (field !== 'title' && field !== 'description' && field !== 'logo') return config;
  return { ...config, [field]: value };
}

export function updateQuestionText(config, questionName, field, value) {
  let changed = false;
  const pages = (config?.pages || []).map((page) => ({
    ...page,
    elements: (page.elements || []).map((element) => {
      if (!element || element.name !== questionName || element[field] === value) return element;
      changed = true;
      return { ...element, [field]: value };
    }),
  }));
  if (!changed) return config;
  return { ...config, pages };
}

export function updatePageText(config, pageName, field, value) {
  let changed = false;
  const pages = (config?.pages || []).map((page) => {
    if (!page || page.name !== pageName || page[field] === value) return page;
    changed = true;
    return { ...page, [field]: value };
  });
  if (!changed) return config;
  return { ...config, pages };
}

export function moveQuestion(config, questionName, direction) {
  const pages = config?.pages || [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const elements = pages[pageIndex].elements || [];
    const index = elements.findIndex((element) => element?.name === questionName);
    if (index < 0) continue;
    const target = index + direction;
    if (target < 0 || target >= elements.length) return config;
    const nextElements = elements.slice();
    const [item] = nextElements.splice(index, 1);
    nextElements.splice(target, 0, item);
    const nextPages = pages.slice();
    nextPages[pageIndex] = { ...pages[pageIndex], elements: nextElements };
    return { ...config, pages: nextPages };
  }
  return config;
}

export function movePage(config, pageName, direction) {
  const pages = config?.pages || [];
  const index = pages.findIndex((page) => page?.name === pageName);
  if (index < 0) return config;
  const target = index + direction;
  if (target < 0 || target >= pages.length) return config;
  const nextPages = pages.slice();
  const [item] = nextPages.splice(index, 1);
  nextPages.splice(target, 0, item);
  return { ...config, pages: nextPages };
}

/** Drop text and viewport sizes so typing or resizing does not redraw the survey. */
export function configForPreviewRefresh(config) {
  if (!config || typeof config !== 'object') return config || null;
  const rest = { ...config };
  delete rest.viewportLayout;
  delete rest.title;
  delete rest.description;
  delete rest.logo;
  delete rest.theme;
  if (!Array.isArray(rest.pages)) return rest;
  rest.pages = rest.pages.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const nextPage = { ...page };
    delete nextPage.title;
    delete nextPage.description;
    if (Array.isArray(nextPage.elements)) {
      nextPage.elements = nextPage.elements.map((element) => {
        if (!element || typeof element !== 'object') return element;
        const nextElement = { ...element };
        delete nextElement.title;
        delete nextElement.description;
        return nextElement;
      });
    }
    return nextPage;
  });
  return rest;
}

/** Per-question overrides inherit the active viewport's global values. */
export function questionLayoutSlot(config, viewport, name) {
  const global = viewportSlot(config, viewport);
  const saved = config?.viewportLayout?.[global.viewport]?.questions?.[name] || {};
  return {
    questionWidth: Math.min(global.contentWidth, saved.questionWidth > 0 ? saved.questionWidth : global.questionWidth),
    mediaMaxHeight: saved.mediaMaxHeight > 0 ? saved.mediaMaxHeight : global.mediaMaxHeight,
    mediaWidth: saved.mediaWidth > 0 ? saved.mediaWidth : 100,
  };
}

export function setQuestionLayoutField(config, viewport, name, field, value) {
  if (!['questionWidth', 'mediaMaxHeight', 'mediaWidth'].includes(field)) return config;
  const key = viewport === 'mobile' ? 'mobile' : 'desktop';
  const layout = config?.viewportLayout || {};
  const slot = layout[key] || {};
  const questions = { ...slot.questions };
  const next = { ...questions[name] };
  if (value == null) delete next[field];
  else next[field] = field === 'mediaWidth' ? Math.min(100, Math.max(20, Math.round(value))) : clampLayoutValue(key, field, value);
  if (Object.keys(next).length) questions[name] = next;
  else delete questions[name];
  return { ...config, viewportLayout: { ...layout, [key]: { ...slot, questions } } };
}

/** Move a top-level question, including between pages and into an empty page. */
export function relocateQuestion(config, name, pageName, beforeName = null) {
  const source = config?.pages?.find((p) => p.elements?.some((q) => q.name === name));
  const target = config?.pages?.find((p) => p.name === pageName);
  if (!source || !target || name === beforeName) return config;
  if (beforeName && !target.elements?.some((q) => q.name === beforeName)) return config;
  const question = source.elements.find((q) => q.name === name);
  return { ...config, pages: config.pages.map((page) => {
    if (page !== source && page !== target) return page;
    const elements = (page.elements || []).filter((q) => q.name !== name);
    if (page === target) {
      const index = beforeName ? elements.findIndex((q) => q.name === beforeName) : elements.length;
      elements.splice(index, 0, question);
    }
    return { ...page, elements };
  }) };
}
