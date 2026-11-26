import { editorSelectionIdentity, nextEditorSelectionState } from './editorSelection';

test('typing in the working copy does not replace editor selection state', () => {
  const current = {
    panel: 'builder',
    pageName: 'page1',
    questionName: 'comfort',
    dirty: true,
    pageDirty: false,
    workingCopy: { title: 'A', imageCount: 1, trialCount: 8 },
  };
  const typed = nextEditorSelectionState(current, {
    ...current,
    workingCopy: { title: 'AB', imageCount: 1, trialCount: 8 },
  });
  expect(typed).toBe(current);
  expect(editorSelectionIdentity(typed)).toBe(editorSelectionIdentity(current));
});

test('a new question or a dirty flag still updates editor selection state', () => {
  const current = { pageName: 'page1', questionName: 'comfort', dirty: false };
  const dirty = nextEditorSelectionState(current, { ...current, dirty: true, workingCopy: { title: 'A' } });
  expect(dirty).not.toBe(current);
  expect(dirty.dirty).toBe(true);
  const other = nextEditorSelectionState(dirty, { ...dirty, questionName: 'safety' });
  expect(other.questionName).toBe('safety');
});
