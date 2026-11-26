import { enrichSurveyResponses } from './enrichSurveyResponses';
import { buildAnalysisRecords, computeAnalysisBlocks, evaluateAnalysis, generateQuestionAnalysis, platformAnalysis, runAnalysisUnsandboxed, savedParts } from './aiQuestionAnalysis';
import { answerRows, checkPlan, fieldInventory, inventoryText, planBlock, planSummaryForCode, requiredPaths, runPlan } from './analysisPlan';

// ── A children's safety page: per round two street photos, a choice, two ratings, two reason lists ──

const START = 1793174875928;
const trial = (round, imageA, imageB, compare, ratingA, ratingB, reasonsA, reasonsB) => ({
  round, imageA, imageB, compare, ratingA, ratingB, reasonsA, reasonsB,
  // The page records startedAt once for the whole task, so durationMs grows from round to round.
  startedAt: START, savedAt: START + round * 30000, durationMs: round * 30000,
});
const P1 = [
  trial(1, 's1.jpg', 's2.jpg', 'a_safer', 5, 2, ['有人行道', '车少'], ['路太窄']),
  trial(2, 's3.jpg', 's1.jpg', 'b_safer', 2, 4, ['车太多'], ['有人行道']),
  trial(3, 's2.jpg', 's3.jpg', 'similar', 3, 3, ['路太窄'], ['车太多']),
];
const P2 = [
  trial(1, 's2.jpg', 's1.jpg', 'b_safer', 2, 5, ['路太窄'], ['有人行道', '有树']),
  trial(2, 's1.jpg', 's3.jpg', 'a_safer', 4, 1, ['有树'], ['车太多']),
  trial(3, 's3.jpg', 's2.jpg', 'unclear', 2, 2, ['车太多'], ['路太窄']),
];
const QUESTION = { name: 'pair_task', type: 'custom', title: '哪条街更安全？' };
// As the page stores it (SPSite.answer with trials) …
const storedRows = [
  { id: 'r1', participant_id: 'p1', responses: { grade: '二年级', pair_task: { trials: P1.map((v) => ({ key: `r${v.round}`, value: v, shown_images: [v.imageA, v.imageB] })) } } },
  { id: 'r2', participant_id: 'p2', responses: { grade: '五年级', pair_task: { trials: P2.map((v) => ({ key: `r${v.round}`, value: v, shown_images: [v.imageA, v.imageB] })) } } },
];
// … and as a submitted row keeps it (each trial's object moves under `answer`, other answers get { type, answer }).
const enrichedRows = storedRows.map((row) => ({
  ...row,
  responses: enrichSurveyResponses({ responses: row.responses, questionTypeMap: { grade: 'radiogroup', pair_task: 'custom' } }).enrichedResponses,
}));

// What the model is expected to write for this page, in the survey's own words.
const CHILD_PLAN = {
  summary: '每轮看两张街景（A、B），选更安全的一张，各打安全感分并勾理由。',
  fields: [
    { path: 'round', use: 'skip', meaning: '第几轮', why: '轮次编号' },
    { path: 'imageA', use: 'image', meaning: '左图 A' },
    { path: 'imageB', use: 'image', meaning: '右图 B' },
    { path: 'compare', use: 'pick', meaning: '哪张更安全', images: ['imageA', 'imageB'], options: { a_safer: { label: 'A 更安全', picks: 'imageA' }, b_safer: { label: 'B 更安全', picks: 'imageB' }, similar: { label: '差不多', picks: null }, unclear: { label: '说不清', picks: null } } },
    { path: 'ratingA', use: 'score', meaning: 'A 的安全感评分', image: 'imageA', measure: '安全感评分', scale: { 1: '很不安全', 5: '很安全' } },
    { path: 'ratingB', use: 'score', meaning: 'B 的安全感评分', image: 'imageB', measure: '安全感评分' },
    { path: 'reasonsA', use: 'tags', meaning: '觉得 A 安全/不安全的理由', image: 'imageA', measure: '理由' },
    { path: 'reasonsB', use: 'tags', meaning: '觉得 B 安全/不安全的理由', image: 'imageB', measure: '理由' },
    { path: 'startedAt', use: 'time', meaning: '开始时间' },
    { path: 'savedAt', use: 'time', meaning: '提交时间' },
    { path: 'durationMs', use: 'duration', meaning: '每轮用时', unit: 'ms' },
    { path: '@grade', use: 'group', meaning: '年级' },
  ],
};

const syncRunner = async (code, records) => runAnalysisUnsandboxed(code, records);

describe('answerRows and the field inventory', () => {
  test('stored and submitted shapes give the same rows: the page object, who answered, what was shown', () => {
    const stored = answerRows(buildAnalysisRecords(storedRows, QUESTION));
    const enriched = answerRows(buildAnalysisRecords(enrichedRows, QUESTION));
    expect(stored).toHaveLength(6);
    expect(enriched).toHaveLength(6);
    expect(enriched.map((r) => r.value)).toEqual(stored.map((r) => r.value));
    expect(enriched[0]).toMatchObject({ participant: 'p1', trial: 0, shown: ['s1.jpg', 's2.jpg'], context: { grade: '二年级' } });
    expect(enriched[3].context).toEqual({ grade: '五年级' });
  });

  test('the inventory lists every path with type, how many rows have it and examples, plus other questions as @name', () => {
    const inventory = fieldInventory(buildAnalysisRecords(enrichedRows, QUESTION));
    expect(inventory).toMatchObject({ rows: 6, participants: 2 });
    const paths = inventory.fields.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['round', 'imageA', 'compare', 'ratingA', 'reasonsA', 'durationMs', '@grade']));
    const text = inventoryText(inventory);
    expect(text).toMatch(/^compare {2}string {2}\(6\/6\) {2}e\.g\. "a_safer", "b_safer", "similar", "unclear"$/m);
    expect(text).toMatch(/^reasonsA {2}array {2}\(6\/6\) {2}list of e\.g\. "有人行道", "车少"/m);
    expect(text).toMatch(/^@grade {2}string/m);
    // Leaves only: every path here is a leaf.
    expect(requiredPaths(inventory)).toEqual(paths);
  });
});

describe('checkPlan: the plan must cover every field and use only known paths and uses', () => {
  const inventory = fieldInventory(buildAnalysisRecords(enrichedRows, QUESTION));

  test('a complete plan has nothing missing', () => {
    const checked = checkPlan(CHILD_PLAN, inventory);
    expect(checked.missing).toEqual([]);
    expect(checked.unknown).toEqual([]);
    expect(checked.problems).toEqual([]);
    expect(checked.plan.fields).toHaveLength(12);
    expect(checked.plan.fields.find((f) => f.path === 'compare').options.a_safer).toEqual({ label: 'A 更安全', picks: 'imageA' });
    expect(checked.plan.fields.find((f) => f.path === 'durationMs').unit).toBe('ms');
  });

  test('left-out fields are reported as missing, invented paths as unknown', () => {
    const partial = { summary: 'x', fields: CHILD_PLAN.fields.filter((f) => !['reasonsA', 'reasonsB', 'durationMs'].includes(f.path)).concat([{ path: 'reasons', use: 'tags', meaning: '理由' }]) };
    const checked = checkPlan(partial, inventory);
    expect(checked.missing).toEqual(['reasonsA', 'reasonsB', 'durationMs']);
    expect(checked.unknown).toEqual(['reasons']);
  });

  test('an unknown use becomes skip, a pick without two image fields becomes an option, both with a note', () => {
    const checked = checkPlan({ fields: [{ path: 'compare', use: 'winner' }, { path: 'ratingA', use: 'pick', images: ['imageA'] }] }, inventory);
    expect(checked.plan.fields[0].use).toBe('skip');
    expect(checked.plan.fields[1].use).toBe('option');
    expect(checked.problems.join(' ')).toMatch(/winner.*treated as skip/);
    expect(checked.problems.join(' ')).toMatch(/a pick needs images/);
    // A bare array of entries is accepted too.
    expect(checkPlan([{ path: 'round', use: 'skip' }], inventory).plan.fields).toHaveLength(1);
  });
});

describe('runPlan on the children page', () => {
  const records = buildAnalysisRecords(enrichedRows, QUESTION);
  const plan = checkPlan(CHILD_PLAN, fieldInventory(records)).plan;
  const run = runPlan(records, plan);
  const byTitle = (re) => run.blocks.find((b) => re.test(b.title));

  test('both ratings become one per-image score block under the shared measure, tied to the right image', () => {
    const scores = byTitle(/安全感评分：每张图的分数/);
    expect(scores.type).toBe('per_item');
    expect(scores.values).toHaveLength(12);
    // p1 round 1: A = s1.jpg got 5, B = s2.jpg got 2.
    expect(scores.values).toEqual(expect.arrayContaining([{ item: 's1.jpg', value: 5, rater: 'p1' }, { item: 's2.jpg', value: 2, rater: 'p1' }]));
    expect(scores.note).toMatch(/1=很不安全，5=很安全/);
    const computed = computeAnalysisBlocks([scores]);
    const s1 = computed[0].items.find((r) => r.item === 's1.jpg');
    expect(s1.n).toBe(4);
    expect(s1.mean).toBeCloseTo((5 + 4 + 5 + 4) / 4, 3);
  });

  test('the choice between the images ranks the images, counts each option and checks it against the ratings', () => {
    const ranking = byTitle(/哪张更安全：图片排名/);
    expect(ranking.type).toBe('pairwise');
    // 4 decided rounds; "similar" and "unclear" are counted but not ranked.
    expect(ranking.matches).toHaveLength(4);
    expect(ranking.matches).toEqual(expect.arrayContaining([{ winner: 's1.jpg', loser: 's2.jpg' }, { winner: 's1.jpg', loser: 's3.jpg' }]));
    expect(ranking.note).toMatch(/另有 2 次选了“差不多”或“说不清”/);
    expect(ranking.note).toMatch(/imageA 2 \/ imageB 2/);
    const counts = byTitle(/哪张更安全：各选项次数/);
    expect(counts.values).toEqual(['A 更安全', 'B 更安全', '差不多', 'B 更安全', 'A 更安全', '说不清']);
    const consistency = byTitle(/选择和打分是否一致/);
    // Every decided round rated the chosen image higher.
    expect(consistency.rows[0]).toEqual(['选中的图分数更高（一致）', 4, 100]);
    expect(consistency.rows[2][1]).toBe(0);
  });

  test('reason tags of both images are counted together and paired with the score of the image they describe', () => {
    const tags = byTitle(/理由：标签被选的次数/);
    expect(tags.type).toBe('choice');
    expect(tags.multi).toBe(true);
    expect(tags.total).toBe(12);
    expect(tags.values.filter((v) => v === '有人行道')).toHaveLength(3);
    const table = byTitle(/选了这个标签时，那张图的平均分/);
    const rowOf = (tag) => table.rows.find((r) => r[0] === tag);
    // 有人行道: s1 rated 5 (p1 r1 A), 4 (p1 r2 B), 5 (p2 r1 B) → mean 4.67
    expect(rowOf('有人行道')[1]).toBe(3);
    expect(rowOf('有人行道')[2]).toBeCloseTo(4.67, 2);
    // 车太多: 2, 3, 1, 2 → 2
    expect(rowOf('车太多')).toEqual(['车太多', 4, 2, 1, 3]);
    // Sorted by mean, high to low: 车少 was picked once, for a 5.
    expect(table.rows[0]).toEqual(['车少', 1, 5, 5, 5]);
    expect(table.rows[1][0]).toBe('有人行道');
  });

  test('durations are shown in seconds and the cumulative-timing pattern is explained', () => {
    const duration = byTitle(/每轮用时（秒）/);
    expect(duration.type).toBe('rating');
    expect(duration.values).toEqual([30, 60, 90, 30, 60, 90]);
    expect(duration.note).toMatch(/累计时间/);
    expect(duration.note).toMatch(/毫秒/);
  });

  test('the grade from another question is listed in the background table; it only splits results when the researcher asked', () => {
    const background = byTitle(/^参与者背景$/);
    expect(background.columns).toEqual(['背景', '人数', '分布']);
    expect(background.rows).toEqual([['年级', 2, '二年级 1（50%），五年级 1（50%）']]);
    expect(background.note).toMatch(/在说明里写“按 X 比较”/);
    expect(run.blocks.some((b) => /按年级分组/.test(b.title))).toBe(false);
    const compare = runPlan(records, { ...plan, fields: plan.fields.map((f) => (f.path === '@grade' ? { ...f, compare: true } : f)) });
    const bar = compare.blocks.find((b) => /按年级分组：安全感评分 平均分/.test(b.title));
    expect(bar.type).toBe('bar');
    expect(bar.items).toEqual([{ label: '二年级', value: 3.17 }, { label: '五年级', value: 2.67 }]);
    const table = compare.blocks.find((b) => /^按年级分组$/.test(b.title));
    expect(compare.blocks.some((b) => /^参与者背景$/.test(b.title))).toBe(false);
    expect(table.columns).toEqual(['组', '人数', '作答次数', '安全感评分 平均', 'A 更安全 %', 'B 更安全 %', '差不多 %', '说不清 %']);
    expect(table.rows[0]).toEqual(['二年级', 1, 3, 3.17, 33.3, 33.3, 33.3, 0]);
    expect(table.note).toMatch(/来自同一份答卷里的另一道题/);
  });

  test('coverage names every field with its meaning and what was done, and the plan block summarises it', () => {
    expect(run.coverage.map((c) => c.field)).toEqual(plan.fields.map((f) => f.path));
    const status = Object.fromEntries(run.coverage.map((c) => [c.field, c.status]));
    expect(status).toEqual({ round: 'skipped', imageA: 'skipped', imageB: 'skipped', compare: 'analysed', ratingA: 'analysed', ratingB: 'analysed', reasonsA: 'analysed', reasonsB: 'analysed', startedAt: 'skipped', savedAt: 'skipped', durationMs: 'analysed', '@grade': 'analysed' });
    expect(run.coverage.find((c) => c.field === 'imageA').what).toMatch(/左图 A：图片名/);
    expect(run.coverage.find((c) => c.field === 'round').what).toBe('轮次编号');
    expect(run.coverage.find((c) => c.field === '@grade').what).toBe('背景：各取值人数');
    const block = planBlock(plan, run);
    expect(block).toMatchObject({ type: 'coverage', title: '分析方案', summary: CHILD_PLAN.summary });
    expect(block.note).toMatch(/2 人 · 6 条作答/);
    expect(block.note).toMatch(/已分析 7 个字段，跳过 5 个/);
    expect(block.analysed).toHaveLength(7);
    expect(block.skipped).toHaveLength(5);
    expect(block.rows[3]).toEqual(['compare', '哪张更安全', '已分析', expect.stringMatching(/TrueSkill 排名 \+ 各选项比例 \+ 和打分是否一致（2 次平局不进排名）/)]);
  });

  test('the stored shape runs to the same blocks as the submitted shape', () => {
    const fromStored = runPlan(buildAnalysisRecords(storedRows, QUESTION), plan);
    expect(fromStored.blocks).toEqual(run.blocks);
  });

  test('a comparison by a one-level attribute is skipped with the reason, and a plan with no rows yields nothing', () => {
    const oneGrade = buildAnalysisRecords(enrichedRows.map((r) => ({ ...r, responses: { ...r.responses, grade: { type: 'radiogroup', answer: '二年级' } } })), QUESTION);
    const single = runPlan(oneGrade, { ...plan, fields: plan.fields.map((f) => (f.path === '@grade' ? { ...f, compare: true } : f)) });
    expect(single.coverage.find((c) => c.field === '@grade')).toMatchObject({ status: 'skipped', what: expect.stringMatching(/所有人都是“二年级”/) });
    expect(single.blocks.some((b) => /按年级分组/.test(b.title))).toBe(false);
    expect(runPlan([], plan)).toEqual({ blocks: [], coverage: [], rows: 0, participants: 0 });
  });
});

// ── A rural-scenes task: one record per participant, ratings nested as a list of objects, a JSON string, seeds ──

const ITEMS = ['A1', 'M1', 'S3'];
const POOL = ['P027B', 'P034B', 'P051B', 'P057B'];
const url = (id) => `https://media.sp-survey.org/u/p/${id}__1a6d540f.jpg`;
const score = (p, img, item) => ((POOL.indexOf(img) + ITEMS.indexOf(item) + p) % 5) + 1;
function ruralAnswer(p) {
  const shown = [POOL[p % 4], POOL[(p + 1) % 4], POOL[(p + 2) % 4]];
  return {
    result: {
      text: JSON.stringify({ personal: { age: 20 + p, gender: p % 2 ? 'female' : 'male' } }),
      ratings: shown.flatMap((id, i) => ITEMS.map((item) => ({ id: `${id}_${item}`, value: score(p, id, item), itemId: item, imageId: id, imageUrl: url(id), position: i + 1 }))),
    },
    pairIds: shown.map((id) => id.slice(0, 4)),
    seed: 1000 + p,
    shownUrls: shown.map(url),
    elapsedSeconds: 700 + p,
    comment: p === 1 ? '很安静的村子' : '',
  };
}
const RURAL_QUESTION = { name: 'task', type: 'skillquestion', skillId: 'skill_rural', title: '乡村街景感知' };
const ruralRows = [1, 2, 3].map((p) => ({
  id: `r${p}`, participant_id: `P${p}`, created_at: '2026-10-15T00:00:00Z',
  // Submitted shape: the single answer is wrapped as { type, answer, shown_images, ... }.
  responses: enrichSurveyResponses({ responses: { task: ruralAnswer(p) }, questionTypeMap: { task: 'skillquestion' } }).enrichedResponses,
}));

const RURAL_PLAN = {
  summary: '每人看 3 张乡村街景，对每张图按 3 个条目打分。',
  fields: [
    { path: 'result.text{json}.personal.age', use: 'skip', meaning: '年龄', why: '个人信息，人少不分组' },
    { path: 'result.text{json}.personal.gender', use: 'group', meaning: '性别' },
    { path: 'result.ratings[].id', use: 'skip', meaning: '评分记录编号' },
    { path: 'result.ratings[].value', use: 'score', meaning: '对街景的评分', image: 'result.ratings[].imageUrl', item: 'result.ratings[].itemId', measure: '街景评分' },
    { path: 'result.ratings[].itemId', use: 'skip', meaning: '评分条目', why: '作为评分表的列' },
    { path: 'result.ratings[].imageId', use: 'skip', meaning: '图片编号' },
    { path: 'result.ratings[].imageUrl', use: 'image', meaning: '被评的街景图' },
    { path: 'result.ratings[].position', use: 'skip', meaning: '出现顺序' },
    { path: 'pairIds', use: 'skip', meaning: '抽到的图组编号' },
    { path: 'seed', use: 'skip', meaning: '随机种子' },
    { path: 'shownUrls', use: 'skip', meaning: '显示过的图片地址' },
    { path: 'elapsedSeconds', use: 'duration', meaning: '完成全部任务的用时', unit: 's' },
    { path: 'comment', use: 'text', meaning: '留言' },
  ],
};

describe('runPlan on a nested single-answer task', () => {
  const records = buildAnalysisRecords(ruralRows, RURAL_QUESTION);
  const inventory = fieldInventory(records);

  test('the inventory enters arrays of objects and JSON saved as text; containers need no entry of their own', () => {
    const paths = inventory.fields.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['result.text', 'result.text{json}.personal.age', 'result.ratings[].value', 'result.ratings[].imageUrl', 'pairIds', 'seed']));
    expect(inventoryText(inventory)).toMatch(/^result\.ratings {2}array {2}\(3\/3\) {2}\[container/m);
    const required = requiredPaths(inventory);
    expect(required).not.toContain('result');
    expect(required).not.toContain('result.ratings');
    expect(required).not.toContain('result.text');
    expect(checkPlan(RURAL_PLAN, inventory).missing).toEqual([]);
  });

  test('scores with an image and an item field become the image × item table, one observation per rater', () => {
    const plan = checkPlan(RURAL_PLAN, inventory).plan;
    const run = runPlan(records, plan);
    const table = run.blocks.find((b) => /对街景的评分：每张图在每个条目上的平均分/.test(b.title));
    expect(table.note).toMatch(/4 张图 × 3 个条目/);
    expect(table.columns).toEqual(['image', ...ITEMS, 'n']);
    expect(table.rows.map((r) => r[0])).toEqual(POOL.map((id) => `${id}__1a6d540f.jpg`));
    const raters = (img) => [1, 2, 3].filter((p) => [POOL[p % 4], POOL[(p + 1) % 4], POOL[(p + 2) % 4]].includes(img));
    const p027 = table.rows.find((r) => r[0].startsWith('P027B'));
    expect(p027[p027.length - 1]).toBe(raters('P027B').length);
    expect(p027[1]).toBeCloseTo(raters('P027B').reduce((a, p) => a + score(p, 'P027B', 'A1'), 0) / raters('P027B').length, 2);
    // Seeds, ids, orders: skipped with the model's reason, never shown as scores or tags.
    const skipped = run.coverage.filter((c) => c.status === 'skipped').map((c) => c.field);
    expect(skipped).toEqual(expect.arrayContaining(['seed', 'pairIds', 'shownUrls', 'result.ratings[].id', 'result.ratings[].position']));
    expect(run.blocks.some((b) => /随机种子|pairIds/.test(b.title))).toBe(false);
    expect(run.blocks.find((b) => /完成全部任务的用时（秒）/.test(b.title)).values).toEqual([701, 702, 703]);
    expect(run.blocks.find((b) => /留言：文字回答/.test(b.title)).values).toEqual(['很安静的村子']);
    // Gender read out of the JSON string is background, counted per person.
    const background = run.blocks.find((b) => /^参与者背景$/.test(b.title));
    expect(background.rows).toEqual([['性别', 3, 'female 2（67%），male 1（33%）']]);
    expect(run.blocks.some((b) => /按性别分组/.test(b.title))).toBe(false);
  });

  test('the plan replaces the platform guess of the same table and is shown first', () => {
    const plan = checkPlan(RURAL_PLAN, inventory).plan;
    const platform = platformAnalysis(records, { plan });
    expect(platform.blocks.filter((b) => b.type === 'table' && /每张图在每个条目上的平均分/.test(b.title))).toHaveLength(1);
    expect(platform.blocks[0].type).toBe('coverage');
    // Without a plan the platform's own table stands alone.
    const bare = platformAnalysis(records, {});
    expect(bare.blocks.map((b) => b.type)).toEqual(['table']);
    expect(bare.run.blocks).toEqual([]);
  });
});

// Peter's rural task as stored: each scene has its ten ratings as fields (scenes[].ratings.A1 …), the same
// ratings again as a flat list (result.ratings[]), the profile both as an object and inside a JSON string.
describe('runPlan on a task that stores the same ratings and profile twice', () => {
  const ITEM_TEXT = { A1: '单从视觉上看，这处景观是美的。', M1: '这个场景让我感受到乡村日常生活的气息。', S3: '总体而言，这里是一个令我满意的乡村休闲地点。' };
  function answer(p) {
    const shown = [POOL[p % 4], POOL[(p + 1) % 4]];
    const personal = { age: 20 + p * 7, gender: p % 2 ? 'female' : 'male', childhood: ['city', 'town', 'village'][p % 3], stress: 3 + p };
    return {
      scenes: shown.map((id, i) => ({ imageId: id, imageUrl: url(id), position: i + 1, ratings: Object.fromEntries(ITEMS.map((item) => [item, score(p, id, item)])) })),
      result: { ratings: shown.flatMap((id) => ITEMS.map((item) => ({ itemId: item, imageUrl: url(id), value: score(p, id, item) }))), text: JSON.stringify({ personal, attention: { MIDCHECK: 6 } }) },
      personal, groupOrder: p % 2 ? 'AB' : 'BA', elapsedSeconds: 600 + p,
    };
  }
  const rows = [1, 2, 3, 4].map((p) => ({ id: `r${p}`, participant_id: `P${p}`, responses: { task: { type: 'skillquestion', answer: answer(p), shown_images: [] }, research_consent: { type: 'boolean', answer: true } } }));
  const records = buildAnalysisRecords(rows, RURAL_QUESTION);
  const inventory = fieldInventory(records);
  const PLAN = {
    summary: '每人看几张乡村景观，对每张按 10 个条目打 1–7 分。',
    fields: [
      { path: 'scenes[].imageId', use: 'skip', meaning: '图片编号' },
      { path: 'scenes[].imageUrl', use: 'image', meaning: '被评的景观图' },
      { path: 'scenes[].position', use: 'skip', meaning: '出现顺序' },
      ...ITEMS.map((item) => ({ path: `scenes[].ratings.${item}`, use: 'score', meaning: `${ITEM_TEXT[item]}评分`, image: 'scenes[].imageUrl', measure: '乡村景观评分' })),
      { path: 'result.ratings[].itemId', use: 'skip', meaning: '条目编号' },
      { path: 'result.ratings[].imageUrl', use: 'image', meaning: '被评的景观图' },
      // The model read the flat copy as another score of the same measure (as Qwen did on the real data).
      { path: 'result.ratings[].value', use: 'score', meaning: '对特定景观指标的评分值', image: 'result.ratings[].imageUrl', measure: '乡村景观评分' },
      // … and treated the JSON string as free text.
      { path: 'result.text', use: 'text', meaning: '包含个人背景信息的 JSON 字符串' },
      { path: 'result.text{json}.personal.age', use: 'group', meaning: '年龄' },
      { path: 'result.text{json}.personal.gender', use: 'group', meaning: '性别' },
      { path: 'result.text{json}.personal.childhood', use: 'group', meaning: '童年居住地' },
      { path: 'result.text{json}.personal.stress', use: 'group', meaning: '压力程度评分' },
      { path: 'result.text{json}.attention.MIDCHECK', use: 'skip', meaning: '注意力检查' },
      { path: 'personal.age', use: 'group', meaning: '年龄' },
      { path: 'personal.gender', use: 'group', meaning: '性别' },
      { path: 'personal.childhood', use: 'group', meaning: '童年居住地' },
      { path: 'personal.stress', use: 'group', meaning: '压力程度评分' },
      { path: 'groupOrder', use: 'group', meaning: '实验分组顺序（AB 或 BA）' },
      { path: 'elapsedSeconds', use: 'duration', meaning: '完成该问题所花费的时间（秒）', unit: 's' },
      { path: '@research_consent', use: 'group', meaning: '是否同意参与研究' },
    ],
  };
  const checked = checkPlan(PLAN, inventory);
  const run = runPlan(records, checked.plan);
  const what = (path) => run.coverage.find((c) => c.field === path);

  test('the plan is complete and the JSON string is a container, not free text', () => {
    expect(checked.missing).toEqual([]);
    expect(checked.plan.fields.find((f) => f.path === 'result.text')).toMatchObject({ use: 'skip', why: 'JSON 字符串，里面的字段已单独列出' });
    expect(run.blocks.some((b) => b.type === 'text')).toBe(false);
    // A plan saved before this rule still marks it text: the executor skips it too.
    const legacy = runPlan(records, { ...checked.plan, fields: checked.plan.fields.map((f) => (f.path === 'result.text' ? { ...f, use: 'text', why: undefined } : f)) });
    expect(legacy.blocks.some((b) => b.type === 'text')).toBe(false);
    expect(legacy.coverage.find((c) => c.field === 'result.text')).toMatchObject({ status: 'skipped', what: 'JSON 字符串，里面的字段已单独列出' });
  });

  test('the ten per-scene rating fields become one image × item table; the flat copy of the same scores counts once', () => {
    const tables = run.blocks.filter((b) => b.type === 'table' && /每张图在每个条目上的平均分/.test(b.title));
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.title).toBe('乡村景观评分：每张图在每个条目上的平均分');
    expect(table.columns).toEqual(['image', ...ITEMS, 'n']);
    expect(table.note).toMatch(/条目：A1=单从视觉上看，这处景观是美的。评分；M1=/);
    expect(table.rows.map((r) => r[0])).toEqual(POOL.map((id) => `${id}__1a6d540f.jpg`));
    const p027 = table.rows.find((r) => r[0].startsWith('P027B'));
    const raters = [1, 2, 3, 4].filter((p) => [POOL[p % 4], POOL[(p + 1) % 4]].includes('P027B'));
    expect(p027[p027.length - 1]).toBe(raters.length);
    expect(p027[1]).toBeCloseTo(raters.reduce((a, p) => a + score(p, 'P027B', 'A1'), 0) / raters.length, 2);
    expect(run.blocks.some((b) => b.type === 'per_item')).toBe(false);
    expect(what('result.ratings[].value')).toMatchObject({ status: 'skipped', what: expect.stringMatching(/和「乡村景观评分」是同一批分数的另一份存法/) });
    expect(what('scenes[].ratings.A1').status).toBe('analysed');
  });

  test('attributes make one background table, each listed once, with no group comparison unless asked', () => {
    const background = run.blocks.find((b) => b.type === 'table' && b.title === '参与者背景');
    expect(background.rows).toEqual([
      ['年龄', 4, '27 1（25%），34 1（25%），41 1（25%），48 1（25%）'],
      ['性别', 4, 'female 2（50%），male 2（50%）'],
      ['童年居住地', 4, 'town 2（50%），city 1（25%），village 1（25%）'],
      ['压力程度评分', 4, '4 1（25%），5 1（25%），6 1（25%），7 1（25%）'],
      ['实验分组顺序（AB 或 BA）', 4, 'AB 2（50%），BA 2（50%）'],
      ['是否同意参与研究', 4, 'true 4（100%）'],
    ]);
    expect(what('personal.age')).toMatchObject({ status: 'skipped', what: expect.stringMatching(/和「年龄」重复/) });
    expect(what('personal.childhood').what).toMatch(/重复/);
    expect(run.blocks.filter((b) => /分组/.test(b.title))).toEqual([]);
    expect(run.blocks.filter((b) => b.type === 'bar')).toEqual([]);
  });

  test('a numeric attribute with many values is summarised, and a duration named in seconds is not suffixed twice', () => {
    const many = runPlan(records.map((r, i) => ({ ...r, answer: { ...r.answer, answer: { ...r.answer.answer, personal: { ...r.answer.answer.personal, age: 18 + i * 9 }, result: { ...r.answer.answer.result, text: JSON.stringify({ personal: { age: 18 + i * 9 + 1 } }) } } } })), checked.plan);
    // (the JSON copy now differs from the object, so both are listed; eight distinct ages across copies → still few: counts)
    expect(many.blocks.find((b) => b.title === '参与者背景').rows.filter((r) => r[0] === '年龄')).toHaveLength(2);
    const duration = run.blocks.find((b) => b.type === 'rating' && /所花费的时间/.test(b.title));
    expect(duration.title).toBe('完成该问题所花费的时间（秒）');
    expect(duration.values).toEqual([601, 602, 603, 604]);
    const ages = runPlan(records.map((r, i) => ({ ...r, participant_id: `Q${i}`, answer: { ...r.answer, answer: { ...r.answer.answer, personal: { age: 18 + i * 5 } } } })).concat(records.map((r, i) => ({ ...r, participant_id: `Z${i}`, answer: { ...r.answer, answer: { ...r.answer.answer, personal: { age: 40 + i * 5 } } } }))), { fields: [{ path: 'personal.age', use: 'group', meaning: '年龄' }] });
    expect(ages.blocks[0].rows).toEqual([['年龄', 8, '均值 36.5，SD 13.19，中位数 36.5，范围 18–55']]);
  });
});

describe('a saved analysis: plan and/or code', () => {
  const records = buildAnalysisRecords(enrichedRows, QUESTION);
  const plan = checkPlan(CHILD_PLAN, fieldInventory(records)).plan;

  test('savedParts reads the new shape and the legacy code string', () => {
    expect(savedParts({ plan, code: '' })).toEqual({ plan, code: '' });
    expect(savedParts('function analyze() {}')).toEqual({ plan: null, code: 'function analyze() {}' });
    expect(savedParts({ code: 'x', plan: { nope: true } })).toEqual({ plan: null, code: 'x' });
    expect(savedParts(null)).toEqual({ plan: null, code: '' });
  });

  test('a plan without code evaluates on its own; failing code does not take the plan down', async () => {
    const alone = await evaluateAnalysis({ plan, code: '' }, records, syncRunner);
    expect(alone.ok).toBe(true);
    expect(alone.blocks[0].type).toBe('coverage');
    expect(alone.modelBlocks).toEqual([]);
    const broken = await evaluateAnalysis({ plan, code: 'function analyze(r) { return r.nope.deeper; }' }, records, syncRunner);
    expect(broken.ok).toBe(true);
    expect(broken.error).toMatch(/TypeError/);
    expect(broken.platformBlocks.length).toBe(alone.platformBlocks.length);
    // A model block that repeats the platform's choice counts is dropped; a new note stays.
    const extra = await evaluateAnalysis({ plan, code: 'function analyze(records) { var v = []; records.forEach(function (r) { r.answer.trials.forEach(function (t) { v.push(t.answer.compare); }); }); return { blocks: [{ type: "choice", title: "compare", values: v }, { type: "note", text: "hot spots: none" }] }; }' }, records, syncRunner);
    expect(extra.modelBlocks.map((b) => b.type)).toEqual(['note']);
  });
});

describe('generateQuestionAnalysis with a plan', () => {
  const records = buildAnalysisRecords(enrichedRows, QUESTION);

  test('asks for a plan, sends missing fields back once, and saves the plan without any code when the plan covers all', async () => {
    const calls = [];
    const request = async (body) => {
      calls.push(body);
      // First answer forgets the reason lists; the fix round returns the whole plan.
      const fields = calls.length === 1 ? CHILD_PLAN.fields.filter((f) => !/^reasons/.test(f.path)) : CHILD_PLAN.fields;
      return { plan: { summary: CHILD_PLAN.summary, fields }, model: 'qwen3.6-flash', provider: 'qwen' };
    };
    const result = await generateQuestionAnalysis({ question: QUESTION, records, otherQuestions: [{ name: 'grade', title: '年级', type: 'radiogroup' }], instructions: '', request, runner: syncRunner });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ mode: 'plan', recordCount: 2 });
    expect(calls[0].fields).toMatch(/^reasonsA {2}array/m);
    expect(calls[0].fields).toMatch(/^@grade/m);
    expect(calls[1].error).toBe('These fields have no entry: reasonsA, reasonsB.');
    expect(calls[1].previous).toMatch(/"path": "compare"/);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.code).toBe('');
    expect(result.problems).toEqual([]);
    expect(result.saved).toMatchObject({ version: 2, code: '', model: 'qwen3.6-flash', provider: 'qwen', questionTitle: '哪条街更安全？' });
    expect(result.saved.plan.fields).toHaveLength(12);
    expect(result.blocks[0].type).toBe('coverage');
    expect(result.blocks.some((b) => /理由：标签被选的次数/.test(b.title))).toBe(true);
  });

  test('a field marked custom gets code from the model, told what the platform already covers', async () => {
    const calls = [];
    const request = async (body) => {
      calls.push(body);
      if (body.mode === 'plan') {
        const fields = CHILD_PLAN.fields.map((f) => (f.path === 'reasonsA' || f.path === 'reasonsB' ? { ...f, use: 'custom', why: '理由要和年级交叉看' } : f));
        return { plan: { summary: CHILD_PLAN.summary, fields }, model: 'm', provider: 'p' };
      }
      return { code: 'function analyze(records) { return { blocks: [{ type: "note", text: "reasons by grade: todo" }] }; }', model: 'm', provider: 'p' };
    };
    const result = await generateQuestionAnalysis({ question: QUESTION, records, request, runner: syncRunner });
    expect(calls.map((c) => c.mode || 'code')).toEqual(['plan', 'code']);
    expect(calls[1].platformDone).toMatch(/Fields already analysed by the platform: compare, ratingA, ratingB, durationMs, @grade/);
    expect(calls[1].platformDone).toMatch(/Write analyze\(\) for THESE fields only: reasonsA \(觉得 A 安全\/不安全的理由; 理由要和年级交叉看\)/);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.saved.code).toMatch(/^function analyze/);
    expect(result.modelBlocks.map((b) => b.type)).toEqual(['note']);
    const coverage = result.blocks[0];
    expect(coverage.rows.find((r) => r[0] === 'reasonsA')[2]).toBe('模型代码');
    expect(planSummaryForCode(result.plan, runPlan(records, result.plan))).toMatch(/- pairwise: 哪张更安全：图片排名（TrueSkill）/);
  });

  test('when the plan still misses fields after the fix round, the gap is reported but the rest is analysed', async () => {
    const request = async () => ({ plan: { fields: CHILD_PLAN.fields.filter((f) => f.path !== 'durationMs') }, model: 'm', provider: 'p' });
    const result = await generateQuestionAnalysis({ question: QUESTION, records, request, runner: syncRunner });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual(['Fields still not in the plan: durationMs']);
    expect(result.saved.plan.fields).toHaveLength(11);
  });
});
