import { classicHasUnsavedEdits, forgetClassicEditingState } from './studioState';

afterEach(() => sessionStorage.clear());

test('after a Studio write the classic editor forgets only that project\'s clean working copy', () => {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ p1: { surveyConfig: { old: true } }, p2: { surveyConfig: {} } }));
  forgetClassicEditingState('p1');
  expect(JSON.parse(sessionStorage.getItem('project_editing_states'))).toEqual({ p2: { surveyConfig: {} } });
  forgetClassicEditingState('missing');
  forgetClassicEditingState('');
  expect(Object.keys(JSON.parse(sessionStorage.getItem('project_editing_states')))).toEqual(['p2']);
});

test('a working copy with unsaved edits is kept, and Studio can tell', () => {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ p1: { surveyConfig: { edit: 1 }, hasUnsavedChanges: true }, p2: { hasUnsavedChanges: false } }));
  forgetClassicEditingState('p1');
  expect(JSON.parse(sessionStorage.getItem('project_editing_states')).p1).toEqual({ surveyConfig: { edit: 1 }, hasUnsavedChanges: true });
  expect(classicHasUnsavedEdits('p1')).toBe(true);
  expect(classicHasUnsavedEdits('p2')).toBe(false);
  expect(classicHasUnsavedEdits('nope')).toBe(false);
  forgetClassicEditingState('p1', { evenUnsaved: true });
  expect(classicHasUnsavedEdits('p1')).toBe(false);
});

test('broken stored state is left alone', () => {
  sessionStorage.setItem('project_editing_states', '{not json');
  expect(() => forgetClassicEditingState('p1')).not.toThrow();
  expect(classicHasUnsavedEdits('p1')).toBe(false);
});
