// Studio additions use the same native question families as the main builder.
export const PREVIEW_QUESTION_TYPES = ['text', 'comment', 'number', 'radiogroup', 'checkbox', 'dropdown', 'rating', 'boolean'];

function usedNames(config) {
  const names = new Set();
  const visit = (items) => (items || []).forEach((item) => {
    if (item.name) names.add(item.name);
    visit(item.elements);
    visit(item.templateElements);
  });
  visit(config?.pages);
  return names;
}

function nextName(names, prefix) {
  let index = 1;
  while (names.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

export function insertPreviewContent(config, type, selection, visiblePageName, labels) {
  if (![...PREVIEW_QUESTION_TYPES, 'expression', 'page'].includes(type)) return { config, selection };
  const pages = [...(config?.pages || [])];
  const names = usedNames(config);
  const targetName = selection?.pageName || visiblePageName;
  let pageIndex = pages.findIndex((page) => page.name === targetName);
  if (type === 'page' || !pages.length) {
    const page = { name: nextName(names, 'page'), title: labels.newPage, elements: [] };
    names.add(page.name);
    const index = pageIndex >= 0 ? pageIndex + 1 : pages.length;
    pages.splice(index, 0, page);
    pageIndex = index;
    if (type === 'page') return { config: { ...config, pages }, selection: { kind: 'page', name: page.name, pageName: page.name } };
  }
  if (pageIndex < 0) pageIndex = 0;
  const page = pages[pageIndex];
  const element = { type, name: nextName(names, type === 'expression' ? 'note' : 'question'), title: type === 'expression' ? labels.newText : labels.newQuestion };
  if (type === 'expression') {
    element.description = labels.textPlaceholder;
    element.showNumber = false;
  } else {
    element.isRequired = false;
  }
  if (['radiogroup', 'checkbox', 'dropdown'].includes(type)) {
    element.choices = [1, 2, 3].map((n) => ({ value: `option_${n}`, text: `${labels.option} ${n}` }));
  }
  if (type === 'rating') Object.assign(element, { rateMin: 1, rateMax: 5, rateStep: 1 });
  if (type === 'boolean') Object.assign(element, { labelTrue: labels.yes, labelFalse: labels.no });
  const elements = [...(page.elements || [])];
  const selectedIndex = selection?.kind === 'question' ? elements.findIndex((q) => q.name === selection.name) : -1;
  elements.splice(selectedIndex >= 0 ? selectedIndex + 1 : elements.length, 0, element);
  pages[pageIndex] = { ...page, elements };
  return { config: { ...config, pages }, selection: { kind: 'question', name: element.name, pageName: page.name } };
}

export function removePreviewContent(config, questionName) {
  const pages = (config.pages || []).map((page) => ({ ...page, elements: (page.elements || []).filter((q) => q.name !== questionName) }));
  const viewportLayout = { ...config.viewportLayout };
  Object.keys(viewportLayout).forEach((key) => {
    if (!viewportLayout[key]?.questions?.[questionName]) return;
    const questions = { ...viewportLayout[key].questions };
    delete questions[questionName];
    viewportLayout[key] = { ...viewportLayout[key], questions };
  });
  return { ...config, pages, ...(config.viewportLayout ? { viewportLayout } : {}) };
}
