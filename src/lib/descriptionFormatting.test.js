import { descriptionSourceOffset, descriptionRenderedText, formatDescriptionMarkdown, setDescriptionFormatting } from './descriptionFormatting';
import { descriptionMarkdownToHtml } from './surveyMarkdown';
import { setSelectedTextStyle, textStyleKey } from './selectedTextStyles';

const targetFor = (source, phrase) => {
  const text = descriptionRenderedText(source);
  const start = phrase ? text.indexOf(phrase) : 0;
  return { kind: 'question', name: 'q', field: 'description', text, start, end: phrase ? start + phrase.length : text.length, whole: !phrase };
};

test('partial italic updates Markdown and can be toggled off without changing visible text', () => {
  const source = 'A **bold** instruction and a [link](https://example.com).';
  const target = targetFor(source, 'bold');
  const next = formatDescriptionMarkdown(source, target, 'italic', true);
  expect(descriptionMarkdownToHtml(next)).toContain('<em><strong>bold</strong></em>');
  expect(descriptionRenderedText(next)).toBe(target.text);
  expect(formatDescriptionMarkdown(next, target, 'italic', false)).toBe(source);
});

test('whole description formatting preserves headings, paragraphs, lists, tables and code', () => {
  const source = '### Heading\n\nOne &amp; two.\n\n- First\n- Second\n\n| A | B |\n| - | - |\n| X | Y |\n\n`code`';
  const target = targetFor(source);
  const next = formatDescriptionMarkdown(source, target, 'italic', true);
  const html = descriptionMarkdownToHtml(next);
  expect(html).toContain('<h3><em>Heading</em></h3>');
  expect(html).toContain('<li><em>Second</em></li>');
  expect(html).toContain('<table>');
  expect(html).toContain('<code>code</code>');
  expect(descriptionRenderedText(next)).toBe(target.text);
});

test('removes emphasis only from the selected substring, preserving the surrounding emphasis', () => {
  const source = '*First middle last*';
  const target = targetFor(source, 'middle');
  const next = formatDescriptionMarkdown(source, target, 'italic', false);
  expect(next).toBe('*First* middle *last*');
  expect(descriptionRenderedText(next)).toBe(target.text);
});

test('duplicate words use rendered offsets; stale selection does not change source', () => {
  const source = 'Same same same';
  const target = { ...targetFor(source, 'same'), start: 10, end: 14 };
  expect(formatDescriptionMarkdown(source, target, 'bold', true)).toBe('Same same **same**');
  expect(formatDescriptionMarkdown('Changed', target, 'bold', true)).toBe('Changed');
});

test('shared Markdown clears conflicting legacy emphasis, preserving other device styles', () => {
  const source = 'First middle last';
  const target = targetFor(source, 'middle');
  let config = { pages: [{ name: 'p', elements: [{ name: 'q', description: source }] }] };
  config = setSelectedTextStyle(config, 'desktop', targetFor(source), { italic: false, fontSize: 24 });
  config = setSelectedTextStyle(config, 'mobile', target, { italic: true, color: '#ff0000' });
  const next = setDescriptionFormatting(config, target, 'italic', true);
  expect(next.pages[0].elements[0].description).toBe('First *middle* last');
  const key = textStyleKey(target);
  expect(next.viewportLayout.desktop.textStyles[key].fieldStyle).toEqual({ fontSize: 24 });
  expect(next.viewportLayout.mobile.textStyles[key].runs[0].style).toEqual({ color: '#ff0000' });
  expect(next.viewportLayout.desktop.textStyles[key].runs).toEqual([
    { start: 0, end: 6, style: { italic: false } }, { start: 12, end: 17, style: { italic: false } },
  ]);
});

test('source caret follows the clicked paragraph and skips emphasis/link syntax', () => {
  const source = 'First\n\nSecond **bold** and [link](https://example.com).';
  const text = descriptionRenderedText(source);
  expect(descriptionSourceOffset(source, text.indexOf('Second') + 3)).toBe(source.indexOf('Second') + 3);
  expect(descriptionSourceOffset(source, text.indexOf('bold') + 2)).toBe(source.indexOf('bold') + 2);
  expect(descriptionSourceOffset(source, text.indexOf('bold'))).toBe(source.indexOf('bold'));
  expect(descriptionSourceOffset(source, text.indexOf('link') + 1)).toBe(source.indexOf('link') + 1);
});
