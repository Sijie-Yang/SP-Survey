/**
 * @jest-environment node
 */
import { computeQuestionIrr } from './reliability';
import { computeQuestionTrueSkill } from './trueskill';
import { summarizeChoiceOutcomes } from './choiceOutcomes';
import { buildResponseMediaUrlMap } from './skillMediaUtils';
import { expandQuestionAnswerUnits } from './responseAnswerUnits';
import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';

const run = process.env.BENCH ? test : test.skip;

run('bench: analysis functions with native URL', () => {
  const config = syntheticSurveyConfig();
  const rows = syntheticResponses(Number(process.env.BENCH_N || 500), { config });
  const questions = config.pages.flatMap((p) => p.elements);
  const time = (fn) => { const t = performance.now(); fn(); return Math.round(performance.now() - t); };
  const log = {
    responseMediaMap: time(() => buildResponseMediaUrlMap(rows)),
    irrAllQuestions: time(() => questions.forEach((q) => computeQuestionIrr(rows, q))),
    trueSkillPickers: time(() => ['safe', 'lively', 'beautiful'].forEach((n) => computeQuestionTrueSkill(rows, n))),
    choiceOutcomes: time(() => ['safe', 'lively', 'beautiful'].forEach((n) => summarizeChoiceOutcomes(rows.flatMap((r) => expandQuestionAnswerUnits(r, n))))),
  };
  // eslint-disable-next-line no-console
  console.log('BENCH', JSON.stringify(log));
});
