import {
  movePage,
  moveQuestion,
  updatePageText,
  updateQuestionText,
  updateSurveyText,
} from './viewportLayout';

function plainText(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => (
    vars[key] != null ? String(vars[key]) : ''
  ));
}

function bindEditable(el, { label, kind, onCommit, placeholder }) {
  if (!el) return;
  if (el.dataset.spEditBound === '1') {
    if (document.activeElement !== el) el.dataset.spEditValue = plainText(el);
    return;
  }
  el.dataset.spEditBound = '1';
  el.dataset.spEdit = kind;
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('role', 'textbox');
  if (label) el.setAttribute('aria-label', label);
  if (placeholder) el.dataset.spPlaceholder = placeholder;
  el.dataset.spEditValue = plainText(el);
  const commit = () => {
    const value = plainText(el);
    if (value === el.dataset.spEditValue) return;
    el.dataset.spEditValue = value;
    onCommit(value);
  };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      el.textContent = el.dataset.spEditValue;
      el.blur();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      el.blur();
    }
  });
}

// Rendered Markdown is selectable for device-specific styling, but must never
// be serialized from textContent: that loses Markdown syntax and paragraphs.
function descriptionClickOffset(el, event) {
  const doc = el.ownerDocument;
  const caret = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  const pointRange = caret ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  const selection = doc.getSelection();
  const node = caret?.offsetNode || pointRange?.startContainer || selection?.focusNode;
  const offset = caret?.offset ?? pointRange?.startOffset ?? selection?.focusOffset;
  if (!node || !el.contains(node)) return 0;
  const before = doc.createRange();
  before.selectNodeContents(el);
  before.setEnd(node, offset);
  return before.toString().length;
}

function bindDescription(el, { label, kind, placeholder, onSelect, onEdit, editHint }) {
  if (!el) return;
  el.dataset.spEdit = kind;
  el.dataset.spMarkdown = 'true';
  el.contentEditable = 'false';
  if (editHint) el.title = editHint;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-readonly', 'true');
  el.setAttribute('aria-multiline', 'true');
  if (label) el.setAttribute('aria-label', label);
  if (placeholder) el.dataset.spPlaceholder = placeholder;
  if (!el.dataset.spMarkdownBound) {
    el.dataset.spMarkdownBound = '1';
    let pointerStart = null;
    let dragged = false;
    el.addEventListener('pointerdown', (event) => {
      pointerStart = { x: event.clientX, y: event.clientY };
      dragged = false;
    });
    el.addEventListener('pointermove', (event) => {
      if (pointerStart && event.buttons && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) dragged = true;
    });
    el.addEventListener('click', (event) => {
      // A description link is content to edit in Studio, not a navigation action.
      if (event.target.closest('a')) event.preventDefault();
      onSelect?.();
      const selection = el.ownerDocument.getSelection();
      const selectedText = selection && !selection.isCollapsed && (el.contains(selection.anchorNode) || el.contains(selection.focusNode));
      // Mouse-up after drag selection also emits a click. Keep that selection
      // available to the text style toolbar instead of replacing it with an input.
      // WebKit can retain a non-collapsed (even empty) range after formatting.
      // A fresh stationary pointer click must enter editing despite that old
      // range; only this gesture's drag/Shift selection should prevent it.
      const selecting = dragged || (selectedText && (!pointerStart || event.shiftKey));
      if (!selecting) onEdit?.(descriptionClickOffset(el, event));
      pointerStart = null;
      dragged = false;
    });
    el.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); onEdit?.(); });
    el.addEventListener('keydown', (event) => {
      if (['Enter', 'F2'].includes(event.key) && !event.isComposing) { event.preventDefault(); event.stopPropagation(); onEdit?.(); }
    });
  }
}

function reorderButton(label, text, onClick, disabled) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.setAttribute('aria-label', label);
  el.disabled = !!disabled;
  el.style.cssText = [
    'font:inherit',
    'font-size:13px',
    'font-weight:600',
    'line-height:1.2',
    'padding:6px 10px',
    'border:1px solid #c8c8c8',
    'background:#fff',
    'border-radius:6px',
    'color:#1a1a1a',
    'white-space:nowrap',
    disabled ? 'opacity:0.38;cursor:default' : 'cursor:pointer',
  ].join(';');
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!el.disabled) onClick();
  });
  return el;
}

function reorderBar(kind, caption) {
  const bar = document.createElement('div');
  bar.dataset.spReorder = kind;
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:8px 10px;border:1px solid #d5d5d5;border-left:4px solid #1976d2;border-radius:8px;background:#f4f7fb;';
  const label = document.createElement('span');
  label.dataset.spReorderLabel = kind;
  label.textContent = caption;
  label.title = caption;
  label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:#1a1a1a;';
  bar.appendChild(label);
  return bar;
}

function commitConfig(api, next) {
  if (next && next !== api.getConfig()) api.onConfigChange(next);
}

function questionTitleNode(root) {
  return root.querySelector('.sd-question__title .sv-string-viewer')
    || root.querySelector('.sd-question__title');
}

function pageTitleNode(root) {
  return root.querySelector('.sd-page__title .sv-string-viewer')
    || root.querySelector('.sd-page__title');
}

function questionPlace(config, questionName) {
  const pages = config?.pages || [];
  for (const page of pages) {
    const elements = page.elements || [];
    const index = elements.findIndex((element) => element?.name === questionName);
    if (index >= 0) return { index, count: elements.length };
  }
  return { index: -1, count: 0 };
}

function questionCaption(question, place, labels) {
  const name = String(question?.title || question?.name || '').trim() || question?.name || '';
  return fill(labels.reorderQuestion || 'Question {index} of {count}: {name}', {
    index: Math.max(1, place.index + 1),
    count: Math.max(place.count, 1),
    name,
  });
}

function pageCaption(page, index, count, labels) {
  const name = String(page?.title || page?.name || '').trim() || page?.name || '';
  return fill(labels.reorderPage || 'Page {index} of {count}: {name}', {
    index: Math.max(1, index + 1),
    count: Math.max(count, 1),
    name,
  });
}

function syncCaption(root, kind, caption) {
  const label = root.querySelector(`[data-sp-reorder="${kind}"] [data-sp-reorder-label]`);
  if (!label || label.textContent === caption) return;
  label.textContent = caption;
  label.title = caption;
}

export function attachQuestionEditor(root, question, api) {
  if (!root || !question?.name) return;
  const labels = api.getLabels();
  const place = questionPlace(api.getConfig(), question.name);
  // Ignore generated placeholders and nested nodes not editable by the builder.
  if (place.index < 0) return;
  root.dataset.spQuestionName = question.name;
  const studio = api.getStudio?.();
  if (studio) {
    root.dataset.spSelected = String(studio.selection?.kind === 'question' && studio.selection.name === question.name);
    if (!root.dataset.spSelectBound) {
      root.dataset.spSelectBound = '1';
      root.addEventListener('click', () => {
        const page = api.getConfig()?.pages?.find((p) => p.elements?.some((q) => q.name === question.name));
        api.getStudio?.()?.onSelect({ kind: 'question', name: question.name, pageName: page?.name });
      });
    }
    const handle = (field, label, className, caption) => {
      let button = root.querySelector(`[data-sp-resize="${field}"]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.spResize = field;
        button.className = `sp-preview-resize ${className}`;
        button.addEventListener('pointerdown', (event) => {
          const page = api.getConfig()?.pages?.find((p) => p.elements?.some((q) => q.name === question.name));
          api.getStudio?.()?.onSelect({ kind: 'question', name: question.name, pageName: page?.name });
          api.getStudio?.()?.resize(event, field, question.name);
        });
        button.addEventListener('keydown', (event) => api.getStudio?.()?.resizeKey(event, field, question.name));
        root.appendChild(button);
      }
      button.setAttribute('aria-label', label);
      button.title = labels.resizeHelp || label;
      if (button.textContent !== caption) button.textContent = caption;
      return button;
    };
    handle('questionWidth', labels.resizeQuestion || 'Resize question card width', 'sp-preview-resize--width', '⋮');
    const media = root.querySelector('.sd-image, .sp-image-gallery, .sd-imagepicker, .sp-media-player, video, canvas');
    if (media) {
      const button = handle('mediaMaxHeight', labels.resizeMedia || 'Resize media height', 'sp-preview-resize--media', '↕');
      const widthButton = handle('mediaWidth', labels.resizeMediaWidth || 'Resize media width', 'sp-preview-resize--media-width', '↔');
      const rect = root.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      const scale = root.offsetWidth ? rect.width / root.offsetWidth : 1;
      if (mediaRect.height && scale) {
        button.style.top = `${(mediaRect.bottom - rect.top) / scale - 9}px`;
        button.style.bottom = 'auto';
        widthButton.style.top = `${(mediaRect.top + mediaRect.height / 2 - rect.top) / scale - 10}px`;
        widthButton.style.right = `${(rect.right - mediaRect.right) / scale - 10}px`;
      }
    }
  }
  const caption = questionCaption(question, place, labels);
  const title = questionTitleNode(root);
  bindEditable(title, {
    label: labels.questionText,
    kind: 'question-title',
    onCommit: (value) => {
      question.title = value;
      commitConfig(api, updateQuestionText(api.getConfig(), question.name, 'title', value));
    },
  });
  const description = root.querySelector('.sd-question__description .sv-string-viewer')
    || root.querySelector('.sd-question__description');
  if (description) {
    bindDescription(description, {
      label: labels.questionDescription,
      kind: 'question-description',
      editHint: labels.editDescriptionHint,
      onEdit: (start) => api.getStudio?.()?.onEditDescription?.({ kind: 'question', name: question.name, field: 'description', start }),
    });
  }
  if (root.querySelector('[data-sp-reorder="question"]')) {
    syncCaption(root, 'question', caption);
    return;
  }
  const bar = reorderBar('question', caption);
  bar.append(
    reorderButton(labels.moveQuestionUp, labels.moveUp || 'Move up', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, -1));
    }, place.index <= 0),
    reorderButton(labels.moveQuestionDown, labels.moveDown || 'Move down', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, 1));
    }, place.index < 0 || place.index >= place.count - 1),
  );
  const header = root.querySelector('.sd-question__header') || root;
  header.prepend(bar);
}

export function attachPageEditor(root, page, api) {
  if (!root || !page?.name) return;
  root.dataset.spPageName = page.name;
  const labels = api.getLabels();
  let title = pageTitleNode(root);
  if (!title) {
    title = document.createElement('div');
    title.className = 'sd-page__title';
    const viewer = document.createElement('span');
    viewer.className = 'sv-string-viewer';
    viewer.textContent = page.title || labels.pageTitle;
    title.appendChild(viewer);
    root.prepend(title);
    title = viewer;
  }
  bindEditable(title, {
    label: labels.pageTitle,
    kind: 'page-title',
    onCommit: (value) => {
      page.title = value;
      commitConfig(api, updatePageText(api.getConfig(), page.name, 'title', value));
    },
  });
  const description = root.querySelector('.sd-page__description .sv-string-viewer')
    || root.querySelector('.sd-page__description');
  if (description) {
    bindDescription(description, {
      label: labels.pageDescription,
      kind: 'page-description',
      editHint: labels.editDescriptionHint,
      onEdit: (start) => api.getStudio?.()?.onEditDescription?.({ kind: 'page', name: page.name, field: 'description', start }),
      onSelect: () => api.getStudio?.()?.onSelect({ kind: 'page', name: page.name, pageName: page.name }),
    });
  }
  const pages = api.getConfig()?.pages || [];
  const index = pages.findIndex((item) => item?.name === page.name);
  const caption = pageCaption(page, index, pages.length, labels);
  if (root.querySelector('[data-sp-reorder="page"]')) {
    syncCaption(root, 'page', caption);
    return;
  }
  const bar = reorderBar('page', caption);
  bar.append(
    reorderButton(labels.movePageUp, labels.moveUp || 'Move up', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, -1));
    }, index <= 0),
    reorderButton(labels.movePageDown, labels.moveDown || 'Move down', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, 1));
    }, index < 0 || index >= pages.length - 1),
  );
  root.prepend(bar);
}

function ensureSurveyDescription(header) {
  const viewer = header.querySelector('.sd-header__text .sd-description .sv-string-viewer')
    || header.querySelector('.sd-description .sv-string-viewer');
  const fallback = header.querySelector('[data-sp-description-fallback]');
  if (viewer && !viewer.closest('[data-sp-description-fallback]')) {
    fallback?.remove();
    return viewer;
  }
  if (fallback) return fallback.querySelector('.sv-string-viewer');
  const h5 = document.createElement('h5');
  h5.className = 'sd-description';
  h5.dataset.spDescriptionFallback = '1';
  h5.style.margin = '0';
  const created = document.createElement('span');
  created.className = 'sv-string-viewer';
  h5.appendChild(created);
  (header.querySelector('.sd-header__text') || header).appendChild(h5);
  return created;
}

export function attachSurveyHeader(container, model, api) {
  if (!container || !model) return;
  const header = container.querySelector('.sd-container-modern__title');
  if (!header) return;
  if (!header.dataset.spHeaderSelectBound) {
    header.dataset.spHeaderSelectBound = '1';
    header.addEventListener('click', () => api.getStudio?.()?.onSelect({ kind: 'survey' }));
  }
  const labels = api.getLabels();
  const title = header.querySelector('.sd-header__text .sd-title .sv-string-viewer')
    || header.querySelector('.sd-header__text .sd-title');
  bindEditable(title, {
    label: labels.editSurveyTitle || labels.surveyTitle,
    kind: 'survey-title',
    onCommit: (value) => {
      model.title = value;
      commitConfig(api, updateSurveyText(api.getConfig(), 'title', value));
    },
  });
  const description = ensureSurveyDescription(header);
  bindDescription(description, {
    label: labels.editSurveyDescription || labels.surveyDescription,
    kind: 'survey-description',
    editHint: labels.editDescriptionHint,
    onEdit: (start) => api.getStudio?.()?.onEditDescription?.({ kind: 'survey', name: '', field: 'description', start }),
    placeholder: labels.surveyDescription,
  });
}

export function bindLivePreviewEditing(model, api) {
  const onQuestion = (_sender, options) => attachQuestionEditor(options.htmlElement, options.question, api);
  const onPage = (_sender, options) => attachPageEditor(options.htmlElement, options.page, api);
  const onSurvey = (_sender, options) => attachSurveyHeader(options.htmlElement, model, api);
  model.onAfterRenderQuestion.add(onQuestion);
  model.onAfterRenderPage.add(onPage);
  model.onAfterRenderSurvey.add(onSurvey);
  return () => {
    model.onAfterRenderQuestion.remove(onQuestion);
    model.onAfterRenderPage.remove(onPage);
    model.onAfterRenderSurvey.remove(onSurvey);
  };
}
