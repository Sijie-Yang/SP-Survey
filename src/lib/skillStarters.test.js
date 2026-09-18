import { createSkillStarter, SKILL_STARTERS } from './skillStarters';
import { checkAnswerAgainstResultSchema } from './skillResultTypes';
import { prepareSkillForSave } from './skillHtmlValidate';
import { buildSkillSrcdoc } from './skillSdk';
import { validateQuestionSettings } from './designProtocol/validate';

test.each(SKILL_STARTERS.map((s) => s.id))('%s starter can be saved with matching example and native contract', (id) => {
  const starter = createSkillStarter(id);
  expect(checkAnswerAgainstResultSchema(starter.exampleAnswer, starter.resultSchema).fields.every((f) => f.ok)).toBe(true);
  const result = prepareSkillForSave({ ...starter, name: 'Test', contractVersion: 1 });
  expect(result.errors).toEqual([]);
});

test('sandbox document installs policy before authored scripts', () => {
  const html = buildSkillSrcdoc(createSkillStarter().sourceHtml);
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'));
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain('e.source !== window.parent');
});

test('question bounds and IDs fail consistently without rejecting zero', () => {
  expect(validateQuestionSettings({ type: 'rating', rateMin: 0, rateMax: 5 })).toEqual([]);
  expect(validateQuestionSettings({ type: 'rating', rateMin: 5, rateMax: 1 })).toHaveLength(1);
  expect(validateQuestionSettings({ choices: [{ value: 'a' }, { value: 'a' }] })).toHaveLength(1);
  expect(validateQuestionSettings({ budget: 0 })).toHaveLength(1);
  expect(validateQuestionSettings({ dimensions: [{ id: 'x', min: 5, max: 1 }] })).toHaveLength(1);
});
