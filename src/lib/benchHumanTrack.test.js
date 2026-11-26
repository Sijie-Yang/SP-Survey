import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import {
  MIN_HUMAN_RESPONSES,
  SUBMISSION_SCHEMA,
  buildHumanTask,
  buildSubmission,
  candidateTasks,
  leaderboard,
  parsePredictionsCsv,
  predictionsFromRows,
  publicTask,
  scoreSubmission,
  scoreTask,
  submissionFileName,
  taskTemplateCsv,
  tasksFromProjectMetadata,
  validateSubmission,
  validateTask,
} from './benchHumanTrack';
import { siliconAgreement } from './siliconAgreement';

const config = syntheticSurveyConfig({ images: 12 });
const questions = config.pages.flatMap((p) => p.elements);
const human = syntheticResponses(80, { config, seed: 3 });
const project = { id: 'abcd1234-0000-4000-8000-000000000000', name: 'Synthetic' };
const q = (name) => questions.find((x) => x.name === name);

describe('task sets', () => {
  test('image questions become candidates; demographics and text do not', () => {
    const c = candidateTasks(project.id, questions, human);
    const ids = c.map((t) => t.task_id);
    expect(ids).toEqual(expect.arrayContaining([
      'abcd1234-safe', 'abcd1234-lively', 'abcd1234-beautiful', 'abcd1234-comfort', 'abcd1234-greenery', 'abcd1234-feel-calm', 'abcd1234-feel-open',
    ]));
    expect(ids.some((id) => /gender|age|usage|comment|personality|consent/.test(id))).toBe(false);
    expect(c.find((t) => t.task_id === 'abcd1234-safe')).toMatchObject({ comparison: 'item_scores', n_items: 12, n_human: 80, eligible: true });
    expect(c.find((t) => t.task_id === 'abcd1234-comfort')).toMatchObject({ comparison: 'item_means' });
  });

  test('too few participants is not eligible', () => {
    const c = candidateTasks(project.id, questions, human.slice(0, MIN_HUMAN_RESPONSES - 1));
    expect(c.every((t) => !t.eligible && t.reasons.includes('responses'))).toBe(true);
  });

  test('a frozen task holds per-image aggregates only, and validates', () => {
    const task = buildHumanTask({ project, question: q('safe'), humanRows: human, publishedAt: '2026-10-22T10:00:00Z', doi: 'https://doi.org/10.5281/zenodo.1' });
    expect(task).toMatchObject({ task_id: 'abcd1234-safe', version: '2026-10-22', comparison: 'item_scores', target_metric: 'mu', headline_metric: 'kendall_tau_b', n_items: 12, n_human: 80, dataset_doi: '10.5281/zenodo.1' });
    expect(task.question.title).toBe('Which place looks safer?');
    expect(task.items[0]).toEqual({ item_key: expect.stringMatching(/^img_\d{4}\.jpg$/), image_url: expect.stringMatching(/^https:/), value: expect.any(Number), spread: expect.any(Number), n: expect.any(Number) });
    expect(JSON.stringify(task)).not.toMatch(/participant|trials|shown_at/);
    expect(validateTask(task)).toEqual([]);

    const slider = buildHumanTask({ project, question: q('feel'), attributeKey: 'calm', humanRows: human });
    expect(slider.question).toMatchObject({ attribute_key: 'calm', attribute_label: 'Calm', scale: { min: 0, max: 100 } });
    const rating = buildHumanTask({ project, question: q('comfort'), humanRows: human });
    expect(rating.question.scale).toEqual({ min: 1, max: 7 });
  });

  test('stored metadata is filtered to valid public tasks', () => {
    const good = buildHumanTask({ project, question: q('safe'), humanRows: human });
    const small = buildHumanTask({ project, question: q('lively'), humanRows: human.slice(0, 5) });
    const tampered = { ...good, task_id: 'x', items: good.items.map((it) => ({ ...it, secret: 1 })) };
    const list = tasksFromProjectMetadata({ a: good, b: small, c: tampered, d: { schema: 'nope' } });
    expect(list.map((t) => t.task_id)).toEqual(['abcd1234-safe']);
    expect(Object.keys(list[0].items[0])).toEqual(['item_key', 'image_url', 'value', 'spread', 'n']);
    expect(publicTask(good)).toEqual(list[0]);
  });
});

describe('scoring', () => {
  const task = publicTask(buildHumanTask({ project, question: q('safe'), humanRows: human }));
  const rating = publicTask(buildHumanTask({ project, question: q('comfort'), humanRows: human }));

  test('the human values themselves score 1; reversed scores −1', () => {
    const exact = Object.fromEntries(task.items.map((it) => [it.item_key, it.value]));
    const reversed = Object.fromEntries(task.items.map((it) => [it.item_key, -it.value]));
    expect(scoreTask(task, exact)).toMatchObject({ headline_metric: 'kendall_tau_b', headline: 1, n_matched: 12, coverage: 1 });
    expect(scoreTask(task, reversed).headline).toBe(-1);
    const r = scoreTask(rating, Object.fromEntries(rating.items.map((it) => [it.item_key, it.value])));
    expect(r.metrics).toEqual({ spearman_rho: 1, pearson_r: 1, mean_abs_diff: 0 });
  });

  test('items match by file name or URL, and too few give no score', () => {
    const byUrl = Object.fromEntries(task.items.map((it) => [it.image_url, it.value]));
    expect(scoreTask(task, byUrl).n_matched).toBe(12);
    const two = Object.fromEntries(task.items.slice(0, 2).map((it) => [it.item_key, it.value]));
    expect(scoreTask(task, two)).toMatchObject({ headline: null, n_matched: 2 });
  });

  test('a missing task counts as 0 in the overall score', () => {
    const exact = { [task.task_id]: Object.fromEntries(task.items.map((it) => [it.item_key, it.value])) };
    const s = scoreSubmission([task, rating], exact);
    expect(s).toMatchObject({ overall: 0.5, tasks_scored: 1, tasks_total: 2 });
  });

  test('CSV scoring equals the silicon-vs-human library for the same answers', () => {
    const silicon = syntheticResponses(60, { config, seed: 11 }).map((r) => ({ ...r, source: 'silicon' }));
    const preds = predictionsFromRows([task, rating], questions, silicon);
    const csv = ['task_id,item_key,value', ...Object.entries(preds).flatMap(([t, items]) => Object.entries(items).map(([k, v]) => `${t},${k},${v}`))].join('\n');
    const parsed = parsePredictionsCsv(csv);
    expect(parsed.errors).toEqual([]);
    const s = scoreSubmission([task, rating], parsed.predictions);
    const ref = siliconAgreement([q('safe'), q('comfort')], human, silicon).rows;
    const refValue = (name, metric) => ref.find((r) => r.question_name === name && r.metric === metric).value;
    expect(s.per_task[0].metrics.kendall_tau_b).toBeCloseTo(refValue('safe', 'kendall_tau_b'), 3);
    expect(s.per_task[1].metrics.spearman_rho).toBeCloseTo(refValue('comfort', 'spearman_rho'), 3);
    expect(s.per_task[1].metrics.mean_abs_diff).toBeCloseTo(refValue('comfort', 'mean_abs_diff'), 3);
  });

  test('CSV parsing reports bad rows and accepts a single-task file', () => {
    expect(parsePredictionsCsv('item_key,value\na.jpg,1\nb.jpg,x\nc.jpg,\n', { defaultTaskId: 't' })).toEqual({
      predictions: { t: { 'a.jpg': 1 } },
      errors: ['Row 3: "x" is not a number.'],
    });
    expect(parsePredictionsCsv('foo,bar\n1,2').errors[0]).toMatch(/item_key and value/);
    expect(taskTemplateCsv(task).split('\n')[0]).toBe('task_id,item_key,image_url,value');
  });
});

describe('submissions', () => {
  const task = publicTask(buildHumanTask({ project, question: q('safe'), humanRows: human }));
  const exact = { [task.task_id]: Object.fromEntries(task.items.map((it) => [it.item_key, it.value])) };

  test('a built submission validates and gets a stable file name', () => {
    const sub = buildSubmission({ model: 'My VLM 2', organisation: 'Lab', date: '2026-10-22', predictions: exact });
    expect(sub.schema).toBe(SUBMISSION_SCHEMA);
    expect(validateSubmission(sub)).toEqual([]);
    expect(submissionFileName(sub)).toBe('2026-10-22-my-vlm-2.json');
  });

  test('bad submissions are explained', () => {
    expect(validateSubmission({ schema: 'x', predictions: { t: { a: 'high' } } })).toEqual(expect.arrayContaining([
      expect.stringMatching(/schema/), 'model is required', 'date must be YYYY-MM-DD', 'predictions.t has a non-number',
    ]));
  });

  test('leaderboard recomputes scores and ranks best first', () => {
    const noisy = { [task.task_id]: Object.fromEntries(task.items.map((it, i) => [it.item_key, i % 2 ? it.value : -it.value])) };
    const rows = leaderboard([task], [
      buildSubmission({ model: 'B', date: '2026-10-01', predictions: noisy }),
      buildSubmission({ model: 'A', date: '2026-10-02', predictions: exact, kind: 'silicon' }),
      { schema: SUBMISSION_SCHEMA, model: '', date: 'bad', predictions: {} },
    ]);
    expect(rows.map((r) => r.model)).toEqual(['A', 'B']);
    expect(rows[0]).toMatchObject({ overall: 1, kind: 'silicon', tasks_scored: 1 });
  });
});
