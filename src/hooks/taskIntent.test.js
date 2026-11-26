import {
  classifyUserIntent,
  shouldPrepareWrite,
  initialLoadingStatus,
} from './taskIntent';

test('question-mode writes are refused and do not prepare a save', () => {
  expect(classifyUserIntent('把这道题改成7分', 'question').write).toBe(true);
  expect(shouldPrepareWrite({ assistantMode: 'question', message: '把这道题改成7分' })).toBe(false);
  expect(shouldPrepareWrite({ assistantMode: 'adjust', message: '把这道题改成7分' })).toBe(true);
  expect(shouldPrepareWrite({ assistantMode: 'question', message: '现在有几页' })).toBe(false);
  expect(shouldPrepareWrite({ assistantMode: 'agent', message: '现在有几页' })).toBe(false);
});

test('classifies draft, explanation, and mixed goals', () => {
  expect(classifyUserIntent('把标题改成公园感知').goal).toBe('draft_edit');
  expect(classifyUserIntent('主题色改成蓝色').draftWrite).toBe(true);
  expect(classifyUserIntent('设为必答').draftWrite).toBe(true);
  expect(classifyUserIntent('告诉我如何发布但不要实际发布').goal).toBe('answer');
  expect(classifyUserIntent('现在有几页？再加一页知情同意').goal).toBe('mixed');
  expect(shouldPrepareWrite({ assistantMode: 'agent', message: '现在有几页？再加一页知情同意' })).toBe(true);
  expect(shouldPrepareWrite({ assistantMode: 'agent', message: '告诉我如何发布但不要实际发布' })).toBe(false);
});

test('page-count questions are read-only even after a prior publish discussion', () => {
  const intent = classifyUserIntent('现在有几页', 'agent');
  expect(intent.write).toBe(false);
  expect(intent.pageCount).toBe(true);
  expect(intent.publishOrDelete).toBe(false);
  expect(classifyUserIntent('发布到参与者', 'agent').publishOrDelete).toBe(true);
});

test('classifies regenerate and generate even with page-count modifiers', () => {
  expect(classifyUserIntent('重新生成一个至少 8 页、覆盖多数题型的问卷').draftWrite).toBe(true);
  expect(classifyUserIntent('请重新生成一份覆盖多数题型、至少八页的问卷').draftWrite).toBe(true);
  expect(classifyUserIntent('Regenerate a survey with at least 8 pages covering most question types').draftWrite).toBe(true);
  expect(classifyUserIntent('Please design a survey about sidewalk comfort').draftWrite).toBe(true);
  expect(classifyUserIntent('告诉我如何设计问卷').goal).toBe('answer');
  expect(classifyUserIntent('这个问卷现在有几页').goal).toBe('answer');
});

test('summarizes unsaved question and page working copies', () => {
  const { summarizeWorkingCopy } = require('./taskIntent');
  expect(summarizeWorkingCopy({
    dirty: true,
    pageDirty: true,
    workingCopy: { title: 'Keyboard title', isRequired: true },
    pageWorkingCopy: { title: 'Page title', description: 'Page blurb' },
  })).toMatch(/NOT saved[\s\S]*question\.title=Keyboard title[\s\S]*page\.title=Page title/);
});

test('initial loading status follows the current mode and intent', () => {
  expect(initialLoadingStatus('question', { write: false })).toBe('Looking up the current settings…');
  expect(initialLoadingStatus('adjust', { write: true })).toBe('Preparing the edit…');
  expect(initialLoadingStatus('generate', { write: true })).toBe('Designing the survey…');
  expect(initialLoadingStatus('agent', { write: true })).toBe('Working on your request…');
});
