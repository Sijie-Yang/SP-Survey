import { insertPreviewContent, removePreviewContent } from './previewContentEditing';
import { previewStudioI18n } from '../components/admin/previewStudioI18n';
const labels = previewStudioI18n.en;
const config = { pages: [{ name: 'page_1', elements: [{ name: 'question_1', type: 'text' }, { name: 'q2', type: 'text' }] }, { name: 'p2', elements: [] }] };

test('new questions insert after the selection with unique names and usable options', () => {
  const result = insertPreviewContent(config, 'radiogroup', { kind: 'question', name: 'question_1', pageName: 'page_1' }, 'p2', labels);
  expect(result.config.pages[0].elements.map((q) => q.name)).toEqual(['question_1', 'question_2', 'q2']);
  expect(result.config.pages[0].elements[1].choices).toHaveLength(3);
  expect(result.selection).toEqual({ kind: 'question', name: 'question_2', pageName: 'page_1' });
  expect(config.pages[0].elements).toHaveLength(2);
});

test('survey selection inserts into the visible page and an empty survey creates its first page', () => {
  const result = insertPreviewContent(config, 'expression', { kind: 'survey' }, 'p2', labels);
  expect(result.config.pages[1].elements[0]).toMatchObject({ type: 'expression', title: 'Instructions', showNumber: false });
  expect(result.config.pages[1].elements[0].isRequired).toBeUndefined();
  const empty = insertPreviewContent({ pages: [] }, 'text', { kind: 'survey' }, null, labels);
  expect(empty.config.pages[0].elements).toHaveLength(1);
  const page = insertPreviewContent(config, 'page', { kind: 'page', pageName: 'page_1' }, null, labels);
  expect(page.config.pages.map((p) => p.name)).toEqual(['page_1', 'page_2', 'p2']);
});

test('new names avoid nested question names and deletion removes both viewport overrides', () => {
  const nested = { pages: [{ name: 'p', elements: [{ name: 'panel', elements: [{ name: 'question_1', type: 'text' }] }] }] };
  expect(insertPreviewContent(nested, 'text', {}, null, labels).selection.name).toBe('question_2');
  const saved = { ...config, viewportLayout: { desktop: { questions: { question_1: { questionWidth: 400 }, q2: { questionWidth: 500 } } }, mobile: { questions: { question_1: { mediaWidth: 70 } } } } };
  const deleted = removePreviewContent(saved, 'question_1');
  expect(deleted.pages[0].elements.map((q) => q.name)).toEqual(['q2']);
  expect(deleted.viewportLayout.desktop.questions).toEqual({ q2: { questionWidth: 500 } });
  expect(deleted.viewportLayout.mobile.questions).toEqual({});
  expect(saved.viewportLayout.mobile.questions.question_1).toBeDefined();
});
