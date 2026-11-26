import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { descriptionMarkdownToHtml } from './surveyMarkdown';
import { textStyleKey } from './selectedTextStyles';
import { updatePageText, updateQuestionText, updateSurveyText } from './viewportLayout';

export function descriptionRenderedText(source) {
  const template = document.createElement('template');
  template.innerHTML = descriptionMarkdownToHtml(source);
  return template.content.textContent;
}

/** Place the source caret near the text clicked in the rendered description. */
export function descriptionSourceOffset(source, renderedOffset = 0) {
  const text = descriptionRenderedText(source);
  const offset = Math.max(0, Math.min(text.length, renderedOffset));
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  let cursor = 0, result = 0, found = false;
  const visit = (node) => {
    if (found || ['definition', 'image', 'imageReference'].includes(node.type)) return;
    if (node.children) { node.children.forEach(visit); return; }
    if (typeof node.value !== 'string' || !node.position) return;
    const start = text.indexOf(node.value, cursor);
    if (start < 0) return;
    if (offset < start) { found = true; return; }
    cursor = start + node.value.length;
    const rawStart = node.position.start.offset;
    const raw = source.slice(rawStart, node.position.end.offset);
    // Escaped text/entities do not have a one-to-one character mapping. In that
    // case use the start of the leaf, rather than placing the caret in syntax.
    const literalStart = raw.indexOf(node.value);
    result = rawStart + (literalStart >= 0 ? literalStart + Math.max(0, Math.min(node.value.length, offset - start)) : 0);
    if (offset < cursor) found = true;
  };
  visit(tree);
  return result;
}

const mergeMarks = (nodes, mark) => nodes.reduce((result, node) => {
  const previous = result[result.length - 1];
  if (node.type === mark && previous?.type === mark) previous.children.push(...node.children);
  else result.push(node);
  return result;
}, []);

/** Apply semantic formatting to visible text, preserving links, lists and code. */
export function formatDescriptionMarkdown(source, target, field, enabled) {
  if (!['bold', 'italic'].includes(field) || descriptionRenderedText(source) !== target.text) return source;
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const mark = field === 'bold' ? 'strong' : 'emphasis';
  let cursor = 0;
  let failed = false;
  const marked = (value, active) => {
    if (!value) return [];
    if (!active || !value.trim()) return [{ type: 'text', value }];
    const [, leading, body, trailing] = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return [
      ...(leading ? [{ type: 'text', value: leading }] : []),
      { type: mark, children: [{ type: 'text', value: body }] },
      ...(trailing ? [{ type: 'text', value: trailing }] : []),
    ];
  };
  const visit = (node, inherited = false) => {
    // Definitions and image alt text have no DOM text nodes in the rendered selection.
    if (['definition', 'image', 'imageReference'].includes(node.type)) return [node];
    if (node.children) {
      const children = mergeMarks(node.children.flatMap((child) => visit(child, inherited || node.type === mark)), mark);
      return node.type === mark ? children : [{ ...node, children }];
    }
    if (typeof node.value !== 'string') return [node];
    const start = target.text.indexOf(node.value, cursor);
    if (start < 0) { failed = true; return [node]; }
    cursor = start + node.value.length;
    // Inline code can be emphasized as a token; fenced code remains literal.
    if (node.type === 'inlineCode') {
      const selected = target.whole || (target.start <= start && target.end >= cursor);
      return (selected ? enabled : inherited) ? [{ type: mark, children: [node] }] : [node];
    }
    if (node.type !== 'text') return [node];
    const a = target.whole ? 0 : Math.max(0, target.start - start);
    const b = target.whole ? node.value.length : Math.min(node.value.length, target.end - start);
    if (a >= b) return marked(node.value, inherited);
    return [
      ...marked(node.value.slice(0, a), inherited),
      ...marked(node.value.slice(a, b), enabled),
      ...marked(node.value.slice(b), inherited),
    ];
  };
  const result = visit(tree)[0];
  if (failed) return source;
  return toMarkdown(result, { extensions: [gfmToMarkdown()], emphasis: '*', strong: '*' }).trimEnd();
}

// Legacy device overrides must not mask the new shared Markdown formatting.
// Keep all other styles, and preserve this property outside the selection.
function clearOverride(entry, target, field, nextText) {
  if (!entry) return entry;
  const fieldStyle = { ...entry.fieldStyle };
  const inherited = fieldStyle[field];
  delete fieldStyle[field];
  const oldRuns = entry.text === target.text ? entry.runs || [] : [];
  const bounds = [...new Set([0, target.text.length, target.start, target.end, ...oldRuns.flatMap((run) => [run.start, run.end])])].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i], end = bounds[i + 1];
    const old = oldRuns.find((run) => run.start <= start && run.end >= end);
    const style = { ...(inherited != null ? { [field]: inherited } : {}), ...old?.style };
    if (target.whole || (start >= target.start && end <= target.end)) delete style[field];
    if (Object.keys(style).length) runs.push({ start, end, style });
  }
  return { text: nextText, fieldStyle, runs: nextText === target.text ? runs : [] };
}

export function setDescriptionFormatting(config, target, field, enabled) {
  const owner = target.kind === 'survey' ? config : target.kind === 'page'
    ? config.pages?.find((page) => page.name === target.name)
    : config.pages?.flatMap((page) => page.elements || []).find((question) => question.name === target.name);
  if (typeof owner?.description !== 'string') return config;
  const source = formatDescriptionMarkdown(owner.description, target, field, enabled);
  if (descriptionRenderedText(owner.description) !== target.text) return config;
  let next = target.kind === 'survey' ? updateSurveyText(config, 'description', source) : target.kind === 'page'
    ? updatePageText(config, target.name, 'description', source) : updateQuestionText(config, target.name, 'description', source);
  const key = textStyleKey(target);
  for (const device of ['desktop', 'mobile']) {
    const slot = next.viewportLayout?.[device];
    if (!slot?.textStyles?.[key]) continue;
    next = { ...next, viewportLayout: { ...next.viewportLayout, [device]: { ...slot, textStyles: { ...slot.textStyles, [key]: clearOverride(slot.textStyles[key], target, field, descriptionRenderedText(source)) } } } };
  }
  return next;
}
