import { FONT_FAMILIES } from './viewportTypography';

export const textStyleKey = ({ kind, name = '', field }) => JSON.stringify([kind, name, field]);
export function validTextTarget(target) {
  return ['survey', 'page', 'question'].includes(target?.kind) && ['title', 'description'].includes(target?.field);
}
const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const normalizeStyle = (style) => ({
  ...Object.fromEntries(['bold', 'italic', 'underline'].filter((key) => typeof style?.[key] === 'boolean').map((key) => [key, style[key]])),
  ...(isColor(style?.color) ? { color: style.color.toLowerCase() } : {}),
  ...(isColor(style?.highlight) || style?.highlight === 'transparent' ? { highlight: style.highlight.toLowerCase() } : {}),
  ...(Object.hasOwn(FONT_FAMILIES, style?.fontFamily) ? { fontFamily: style.fontFamily } : {}),
  ...(typeof style?.fontSize === 'number' && Number.isFinite(style.fontSize) ? { fontSize: Math.max(10, Math.min(96, Math.round(style.fontSize))) } : {}),
});

// Keep disjoint runs so overlapping edits override only the selected characters.
export function setSelectedTextStyle(config, viewport, target, style) {
  if (!validTextTarget(target) || typeof target.text !== 'string') return config;
  const { text } = target;
  const start = Math.max(0, Math.floor(target.start));
  const end = Math.min(text.length, Math.floor(target.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return config;
  const device = viewport === 'mobile' ? 'mobile' : 'desktop';
  const layout = config?.viewportLayout || {};
  const slot = layout[device] || {};
  const key = textStyleKey(target);
  const entries = { ...slot.textStyles };
  const saved = entries[key];
  if (target.whole) {
    if (style == null) delete entries[key];
    else {
      const patch = normalizeStyle(style);
      const runs = (saved?.text === text ? saved.runs || [] : []).map((run) => {
        const remaining = { ...run.style };
        Object.keys(patch).forEach((field) => delete remaining[field]);
        return { ...run, style: remaining };
      }).filter((run) => Object.keys(run.style).length);
      entries[key] = { ...saved, text, runs, fieldStyle: { ...saved?.fieldStyle, ...patch } };
    }
    return { ...config, viewportLayout: { ...layout, [device]: { ...slot, textStyles: entries } } };
  }
  const runs = saved?.text === text ? saved.runs || [] : [];
  const bounds = [...new Set([0, text.length, start, end, ...runs.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const nextRuns = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const a = bounds[i], b = bounds[i + 1];
    const previous = runs.find((r) => r.start <= a && r.end >= b)?.style || {};
    const selected = a >= start && b <= end;
    const next = selected ? (style == null ? {} : { ...previous, ...normalizeStyle(style) }) : previous;
    if (!Object.keys(next).length) continue;
    const last = nextRuns[nextRuns.length - 1];
    if (last && last.end === a && JSON.stringify(last.style) === JSON.stringify(next)) last.end = b;
    else nextRuns.push({ start: a, end: b, style: next });
  }
  if (nextRuns.length || saved?.fieldStyle) entries[key] = { text, runs: nextRuns, ...(saved?.fieldStyle ? { fieldStyle: saved.fieldStyle } : {}) };
  else delete entries[key];
  const nextSlot = { ...slot };
  if (Object.keys(entries).length) nextSlot.textStyles = entries;
  else delete nextSlot.textStyles;
  return { ...config, viewportLayout: { ...layout, [device]: nextSlot } };
}

export function selectedTextTarget(selection, container, allowWhole = false) {
  if (!selection || (!allowWhole && selection.isCollapsed) || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const host = element?.closest('[data-sp-edit]');
  if (!host || !container.contains(host) || !host.contains(range.endContainer)) return null;
  const [kind, field] = host.dataset.spEdit.split('-');
  const name = kind === 'question' ? host.closest('[data-sp-question-name]')?.dataset.spQuestionName : kind === 'page' ? host.closest('[data-sp-page-name]')?.dataset.spPageName : '';
  const before = range.cloneRange();
  before.selectNodeContents(host);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const target = { kind, name: name || '', field, text: host.textContent, start: selection.isCollapsed ? 0 : start, end: selection.isCollapsed ? host.textContent.length : start + range.toString().length, whole: selection.isCollapsed };
  return validTextTarget(target) ? target : null;
}

function renderStyledHtml(text, html, entry) {
  const template = document.createElement('template');
  if (html) template.innerHTML = html; // Existing platform Markdown output, already escaped.
  else template.content.appendChild(document.createTextNode(text));
  // If the text changed, stale offsets must never format a different phrase.
  const textMatches = template.content.textContent === entry.text;
  if (!textMatches && !entry.fieldStyle) return html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let offset = 0;
  nodes.forEach((node) => {
    const value = node.textContent;
    const start = offset;
    offset += value.length;
    const partial = textMatches ? (entry.runs || []).filter((r) => r.start < offset && r.end > start) : [];
    const boundaries = [...new Set([start, offset, ...partial.flatMap((r) => [Math.max(start, r.start), Math.min(offset, r.end)])])].sort((a, b) => a - b);
    const runs = boundaries.slice(0, -1).map((a, index) => ({ start: a, end: boundaries[index + 1], style: { ...entry.fieldStyle, ...partial.find((r) => r.start <= a && r.end >= boundaries[index + 1])?.style } }));
    if (!runs.some((r) => Object.keys(r.style).length)) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    runs.forEach((run) => {
      const a = Math.max(0, run.start - start), b = Math.min(value.length, run.end - start);
      if (a < cursor || a >= b) return;
      fragment.appendChild(document.createTextNode(value.slice(cursor, a)));
      const span = document.createElement('span');
      span.dataset.spTextRun = '';
      const style = normalizeStyle(run.style);
      if (style.bold != null) span.style.fontWeight = style.bold ? '700' : '400';
      if (style.italic != null) span.style.fontStyle = style.italic ? 'italic' : 'normal';
      if (style.underline != null) span.style.textDecoration = style.underline ? 'underline' : 'none';
      if (style.color) span.style.color = style.color;
      if (style.highlight) span.style.backgroundColor = style.highlight;
      if (style.fontFamily) span.style.fontFamily = FONT_FAMILIES[style.fontFamily];
      if (style.fontSize) { span.style.fontSize = `${style.fontSize}px`; span.style.lineHeight = 'var(--sp-text-line-height, 1.5)'; }
      span.textContent = value.slice(a, b);
      fragment.appendChild(span);
      cursor = b;
    });
    fragment.appendChild(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  });
  return template.innerHTML;
}

export function bindSelectedTextStyles(model, getEntries) {
  if (!model?.onTextMarkdown) return () => {};
  const handler = (_sender, options) => {
    if (!['title', 'description'].includes(options.name)) return;
    const kind = options.element === model ? 'survey' : options.element?.getType?.() === 'page' ? 'page' : 'question';
    const key = textStyleKey({ kind, name: kind === 'survey' ? '' : options.element?.name || '', field: options.name });
    const entry = getEntries()?.[key];
    if (entry) options.html = renderStyledHtml(options.text, options.html, entry);
  };
  model.onTextMarkdown.add(handler);
  return () => model.onTextMarkdown.remove(handler);
}
