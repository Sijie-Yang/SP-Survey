import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

/**
 * Question and page descriptions are plain SurveyJS text unless markdown is
 * enabled on that localizable string. Titles already opt in; descriptions do not.
 */

const attached = new WeakSet();

// One safe parser for the source editor, Layout Studio and participant survey.
// Raw HTML and unsafe URL protocols stay disabled (micromark defaults).
export function descriptionMarkdownToHtml(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';
  return micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

function enableDescriptionMarkdown(element) {
  const loc = element?.locDescription;
  if (loc) loc.useMarkdown = true;
}

export function attachSurveyMarkdown(model) {
  if (!model?.onTextMarkdown?.add || attached.has(model)) return;
  attached.add(model);
  model.onTextMarkdown.add((_, options) => {
    if (options.name !== 'description') return;
    const html = descriptionMarkdownToHtml(options.text);
    if (html) options.html = html;
  });
  enableDescriptionMarkdown(model);
  (model.pages || []).forEach((page) => enableDescriptionMarkdown(page));
  if (typeof model.getAllPanels === 'function') model.getAllPanels().forEach(enableDescriptionMarkdown);
  if (typeof model.getAllQuestions === 'function') model.getAllQuestions().forEach(enableDescriptionMarkdown);
  model.onQuestionAdded?.add?.((_, options) => enableDescriptionMarkdown(options.question));
  model.onPanelAdded?.add?.((_, options) => enableDescriptionMarkdown(options.panel));
}
