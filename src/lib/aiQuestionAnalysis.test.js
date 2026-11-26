import {
  aiAnalysisExportFiles,
  analysisCodeExcerpt,
  buildAnalysisRecords,
  computeAnalysisBlocks,
  describeRecordShape,
  evaluateAnalysis,
  generateQuestionAnalysis,
  mediaSummary,
  otherQuestionList,
  normalizeAnalysisResult,
  platformSummaryBlocks,
  questionBrief,
  readSavedAnalyses,
  recordFieldNames,
  runAnalysisUnsandboxed,
  sampleRecords,
} from './aiQuestionAnalysis';

// A converted page (imported as it is): the page keeps its own trial log in
// localStorage, recorded under __sp_page_state, as a JSON string per key.
const IMAGES = ['IMG0101.jpg', 'IMG0102.jpg', 'IMG0103.jpg', 'IMG0104.jpg'];
const quality = { 'IMG0101.jpg': 4, 'IMG0102.jpg': 3, 'IMG0103.jpg': 2, 'IMG0104.jpg': 1 };
function participantRow(p) {
  const trials = [];
  for (let i = 0; i < IMAGES.length; i += 1) {
    for (let j = i + 1; j < IMAGES.length; j += 1) {
      const a = IMAGES[(i + p) % 4];
      const b = IMAGES[(j + p) % 4];
      const left = `https://media.sp-survey.org/proj/images/${a}?v=1`;
      const right = `https://media.sp-survey.org/proj/images/${b}?v=1`;
      // Mostly prefer the better image; participant 2 flips one decision.
      const pickLeft = (quality[a] > quality[b]) !== (p === 2 && i === 0 && j === 1);
      trials.push({ task: 'compare', left, right, choice: pickLeft ? 'left' : 'right', rt: 900 + 100 * i + 10 * p });
    }
  }
  const ratings = IMAGES.map((img) => ({ task: 'rate', image: `images/${img}`, score: quality[img] + (p % 2) }));
  return {
    id: `r${p}`,
    participant_id: `P${p}`,
    created_at: `2026-10-1${p}T10:00:00Z`,
    responses: {
      __sp_page_state: {
        retail_r10_state: JSON.stringify({ done: true, trials: [...trials, ...ratings], comment: p === 1 ? 'The bright shop looks safe and clean' : 'clean shop, safe street' }),
      },
      __sp_requests: [{ at: 'x', method: 'POST', url: '/api/finish', data: { ok: true } }],
    },
  };
}
const ROWS = [1, 2, 3, 4, 5].map(participantRow);
const PAGE_QUESTION = { name: '__page__compare', title: 'Which shop front looks more attractive? (left or right)', type: 'custom', pageOnly: true };

// What the model is expected to write for this page.
const MODEL_CODE = `function analyze(records, helpers) {
  var matches = [];
  var ratings = {};
  var rts = [];
  var comments = [];
  records.forEach(function (r) {
    var state = helpers.parse(helpers.get(r, 'page_state.retail_r10_state')) || {};
    helpers.list(state.trials).forEach(function (t) {
      if (t.task === 'compare' && (t.choice === 'left' || t.choice === 'right')) {
        var l = helpers.file(t.left), rr = helpers.file(t.right);
        matches.push(t.choice === 'left' ? { winner: l, loser: rr } : { winner: rr, loser: l });
        if (helpers.num(t.rt) != null) rts.push(helpers.num(t.rt));
      }
      if (t.task === 'rate') {
        var k = helpers.file(t.image);
        (ratings[k] = ratings[k] || []).push(helpers.num(t.score));
      }
    });
    if (state.comment) comments.push(state.comment);
  });
  return { blocks: [
    { type: 'pairwise', title: 'Attractiveness ranking', matches: matches },
    { type: 'rating', title: 'Ratings per image', items: Object.keys(ratings).map(function (k) { return { label: k, values: ratings[k] }; }) },
    { type: 'text', title: 'Comments', values: comments },
    { type: 'note', text: 'Each compare trial is one A-vs-B decision.' }
  ] };
}`;

const syncRunner = async (code, records) => runAnalysisUnsandboxed(code, records);

describe('AI question analysis', () => {
  test('records carry the page state for a page imported as it is', () => {
    const records = buildAnalysisRecords(ROWS, PAGE_QUESTION, { site: true });
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ participant_id: 'P1' });
    expect(typeof records[0].page_state.retail_r10_state).toBe('string');
    expect(records[0].answer).toBeUndefined();
  });

  test('a stored answer is passed exactly as stored', () => {
    const rows = [{ participant_id: 'a', responses: { q1: { trials: [{ answer: 'x' }] } }, displayed_images: { q1: ['a.jpg'] } }];
    const records = buildAnalysisRecords(rows, { name: 'q1', type: 'custom' });
    expect(records[0].answer).toEqual({ trials: [{ answer: 'x' }] });
    expect(records[0].shown).toEqual(['a.jpg']);
    expect(records[0].page_state).toBeUndefined();
  });

  test('the model sees a short sample and every field path', () => {
    const records = buildAnalysisRecords(ROWS, PAGE_QUESTION, { site: true });
    const sample = sampleRecords(records);
    expect(sample.length).toBeLessThan(14500);
    const fields = describeRecordShape(records);
    expect(fields).toMatch(/page_state\.retail_r10_state {2}json-string {2}\(5\/5\)/);
    expect(fields).toMatch(/page_state\.retail_r10_state\.trials\[\]\.choice {2}string/);
    expect(fields).toMatch(/page_state\.retail_r10_state\.trials\[\]\.score {2}number/);
    expect(sample).toContain('(JSON string — helpers.parse it)');
    expect(sample).toContain('"choice": "left"');
    expect(questionBrief(PAGE_QUESTION)).toMatch(/attractive/);
  });

  test('model code runs on all records and the platform computes TrueSkill and stats', async () => {
    const records = buildAnalysisRecords(ROWS, PAGE_QUESTION, { site: true });
    const result = await evaluateAnalysis(MODEL_CODE, records, syncRunner);
    expect(result.ok).toBe(true);
    const [pairwise, rating, text, note] = result.blocks;
    expect(pairwise.matchCount).toBe(30);
    const order = pairwise.boards[0].rankings.map((r) => r.imageKey);
    expect(order[0]).toBe('IMG0101.jpg');
    expect(order[3]).toBe('IMG0104.jpg');
    expect(pairwise.table.columns).toContain('mu');
    expect(rating.table.rows[0][0]).toBe('IMG0101.jpg');
    expect(rating.table.rows[0][1]).toBe(5);
    expect(text.words.map((w) => w.word)).toContain('safe');
    expect(note.text).toMatch(/A-vs-B/);
  });

  test('ranking blocks get Borda and Kendall W', () => {
    const { blocks } = normalizeAnalysisResult({ blocks: [{ type: 'ranking', orders: [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'c', 'b']] }] });
    const [ranking] = computeAnalysisBlocks(blocks);
    expect(ranking.boards[0].rankings[0].imageKey).toBe('a');
    expect(ranking.kendall.w).toBeGreaterThan(0.5);
    expect(ranking.table.columns).toEqual(expect.arrayContaining(['borda', 'avg_rank']));
  });

  test('choice blocks count with Wilson intervals', () => {
    const { blocks } = normalizeAnalysisResult([{ type: 'choice', values: ['yes', 'yes', 'no', ['yes', 'maybe']] }]);
    const [choice] = computeAnalysisBlocks(blocks);
    expect(choice.table.rows[0]).toEqual(['yes', 3, 60, expect.any(Number), expect.any(Number)]);
  });

  test('broken code is reported, and a result with no data is explained', async () => {
    const thrown = await evaluateAnalysis('function analyze(records) { return records[0].nope.deeper; }', [{ a: 1 }], syncRunner);
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toMatch(/TypeError/);
    const syntax = await evaluateAnalysis('function analyze( {', [], syncRunner);
    expect(syntax.error).toMatch(/SyntaxError/);
    const empty = await evaluateAnalysis('function analyze() { return { blocks: [{ type: "pairwise", matches: [] }] }; }', [], syncRunner);
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/no matches/);
  });

  test('a failing first answer is sent back once with the error, then saved', async () => {
    const records = buildAnalysisRecords(ROWS, PAGE_QUESTION, { site: true });
    const calls = [];
    const request = async (body) => {
      calls.push(body);
      if (calls.length === 1) {
        // A typical small-model slip: reads the JSON string without parsing it.
        return { code: 'function analyze(records) { var m = []; records.forEach(function (r) { r.page_state.retail_r10_state.trials.forEach(function (t) { m.push(t); }); }); return { blocks: [] }; }', model: 'qwen3.6-flash', provider: 'qwen' };
      }
      return { code: MODEL_CODE, model: 'qwen3.6-flash', provider: 'qwen' };
    };
    const result = await generateQuestionAnalysis({ question: PAGE_QUESTION, records, instructions: 'left/right choice', request, runner: syncRunner });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls[0]).toMatchObject({ recordCount: 5, instructions: 'left/right choice' });
    expect(calls[0].fields).toMatch(/retail_r10_state/);
    expect(calls[1].previous).toMatch(/function analyze/);
    expect(calls[1].error).toMatch(/TypeError/);
    expect(result.saved).toMatchObject({ code: MODEL_CODE, model: 'qwen3.6-flash', instructions: 'left/right choice' });
  });

  test('export files hold a CSV per block and the code', async () => {
    const records = buildAnalysisRecords(ROWS, PAGE_QUESTION, { site: true });
    const result = await evaluateAnalysis(MODEL_CODE, records, syncRunner);
    const files = aiAnalysisExportFiles(PAGE_QUESTION, { code: MODEL_CODE, model: 'qwen3.6-flash', createdAt: '2026-10-15' }, result.blocks);
    expect(files.map((f) => f.path)).toEqual([
      'questions/__page__compare__ai__1_pairwise.csv',
      'questions/__page__compare__ai__2_rating.csv',
      'questions/__page__compare__ai__3_text.csv',
      'questions/__page__compare__ai__analyze.js',
    ]);
    expect(files[0].content).toMatch(/^﻿category,rank,item,mu,sigma/);
    expect(files[3].content).toMatch(/inferred by the model/);
  });

  test('saved analyses are read from project metadata', () => {
    expect(readSavedAnalyses({ metadata: { resultsAiAnalyses: { q: { code: 'x' } } } })).toEqual({ q: { code: 'x' } });
    expect(readSavedAnalyses({})).toEqual({});
  });
});

// R10-like page: three tasks rate the same random subset of 90 images per
// participant; answers saved per task keyed by image id (no extension).
const R10_IMAGES = Array.from({ length: 90 }, (_, i) => `IMG${String(300 + i).padStart(4, '0')}`);
function r10Row(p) {
  const start = (p * 17) % 90;
  const shown = Array.from({ length: 30 }, (_, i) => R10_IMAGES[(start + i * 3) % 90]);
  const answers = { occupancy: {}, complexity: {}, transparency: {} };
  shown.forEach((id, i) => {
    const n = Number(id.slice(3));
    answers.occupancy[id] = (p % 4 === 0 && i % 5 === 0) ? (n + 1) % 3 : n % 3;
    answers.complexity[id] = (n + p) % 5 + 1;
    answers.transparency[id] = i % 2;
  });
  return {
    participant_id: `P${p}`,
    responses: {
      __sp_page_state: {
        'sp-media:PHOTO_URLS': R10_IMAGES.map((id) => ({ name: `${id}.jpg`, url: `https://media.sp-survey.org/p/images/${id}.jpg`, folder: 'images' })),
        retail_state: JSON.stringify({ done: true, order: shown.map((id) => `images/${id}.jpg`), answers }),
      },
    },
  };
}
const R10_ROWS = Array.from({ length: 8 }, (_, i) => r10Row(i + 1));
const R10_QUESTIONS = [
  { name: 'occupancy', title: 'What is the visible state of the retail storefront? 0 Clean/occupied, 1 Minor issues, 2 Vacant', type: 'radiogroup' },
  { name: 'complexity', title: 'Visual complexity 1-5', type: 'rating' },
  { name: 'transparency', title: 'Is the shopfront transparent?', type: 'boolean' },
];
const OCCUPANCY_CODE = `function analyze(records, helpers) {
  var values = [];
  records.forEach(function (r) {
    var answers = helpers.get(r, 'page_state.retail_state.answers.occupancy') || {};
    Object.keys(answers).forEach(function (id) {
      values.push({ item: id, value: answers[id], rater: r.participant_id });
    });
  });
  return { blocks: [{ type: 'per_item', title: 'Occupancy', measure: 'category', labels: { 0: 'Clean, occupied', 1: 'Minor issues', 2: 'Vacant' }, values: values }] };
}`;

describe('AI analysis of one question on a page with random images', () => {
  const question = { name: '__page__occupancy', pageName: 'occupancy', title: R10_QUESTIONS[0].title, type: 'radiogroup', pageOnly: true };
  const records = buildAnalysisRecords(R10_ROWS, question, { site: true });

  test('the model is told the other questions and where the images are', () => {
    const others = otherQuestionList(R10_QUESTIONS, question);
    expect(others).not.toMatch(/^- occupancy/m);
    expect(others).toMatch(/^- complexity \(rating\)/m);
    const media = mediaSummary(records);
    expect(media).toMatch(/^90 distinct images/);
    expect(media).toMatch(/Per submission: 30–30 distinct files\. Each participant saw only a subset\./);
    expect(media).toMatch(/page_state\["sp-media:PHOTO_URLS"\]/);
    expect(media).toMatch(/page_state\.retail_state\.order\[\] \(240\)/);
    expect(media).toMatch(/Answers keyed by image .*page_state\.retail_state\.answers\.occupancy\.\{image\}/);
    const fields = describeRecordShape(records);
    expect(fields).toMatch(/page_state\.retail_state\.answers\.occupancy {2}object {2}\(8\/8\) {2}map keyed by id, up to 30 keys/);
    expect(fields).toMatch(/page_state\.retail_state\.answers\.occupancy\.\{key\} {2}number/);
    expect(fields.split('\n').length).toBeLessThan(40);
  });

  test('per-item answers are summarised per image with agreement across raters', async () => {
    const result = await evaluateAnalysis(OCCUPANCY_CODE, records, syncRunner);
    expect(result.ok).toBe(true);
    const [block] = result.blocks;
    expect(block.measure).toBe('category');
    expect(block.raterCount).toBe(8);
    expect(block.itemCount).toBe(90);
    expect(block.categories).toEqual(['0', '1', '2']);
    expect(block.overall.map((o) => o.label)).toEqual(['0 · Clean, occupied', '1 · Minor issues', '2 · Vacant']);
    expect(block.alpha).toBeGreaterThan(0.5);
    expect(block.alpha).toBeLessThan(1);
    expect(block.table.columns).toEqual(['item', 'n', 'majority', 'majority_share', 'n_0', 'n_1', 'n_2']);
  });

  test('numeric per-item answers give per-image means', async () => {
    const code = OCCUPANCY_CODE.replace('answers.occupancy', 'answers.complexity').replace("measure: 'category', labels: { 0: 'Clean, occupied', 1: 'Minor issues', 2: 'Vacant' }, ", '');
    const result = await evaluateAnalysis(code, records, syncRunner);
    const [block] = result.blocks;
    expect(block.measure).toBe('number');
    expect(block.table.columns.slice(0, 3)).toEqual(['item', 'n', 'mean']);
    expect(block.items[0].mean).toBeGreaterThanOrEqual(block.items[block.items.length - 1].mean);
  });

  test('a result about many questions is cut to three blocks', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ type: 'choice', title: `q${i}`, values: ['a'] }));
    const { blocks, problems } = normalizeAnalysisResult({ blocks: many });
    expect(blocks).toHaveLength(3);
    expect(problems[0]).toMatch(/this one question only/);
  });
});

// An advanced custom task that shows each participant several images and asks
// ten rating items per image. The page stores the ratings twice: nested under
// scenes[].ratings and as a flat list under result.ratings, plus a profile as
// a JSON string. Three participants, three images each from a pool of four.
describe('Platform summary of per-image item ratings', () => {
  const ITEMS = ['A1', 'M1', 'M2', 'M3', 'N1', 'R1', 'R2', 'R3', 'R4', 'S3'];
  const POOL = ['P027B', 'P034B', 'P051B', 'P057B'];
  const url = (id) => `https://media.sp-survey.org/u/p/${id}__1a6d540f.jpg`;
  const score = (p, img, item) => ((POOL.indexOf(img) + ITEMS.indexOf(item) + p) % 5) + 1;
  function taskAnswer(p) {
    const shown = [POOL[p % 4], POOL[(p + 1) % 4], POOL[(p + 2) % 4]];
    const scenes = shown.map((id, i) => ({
      pairId: id.slice(0, 4), imageId: id, imageName: `${id}__1a6d540f.jpg`, imageUrl: url(id), position: i + 1,
      ratings: Object.fromEntries(ITEMS.map((item) => [item, score(p, id, item)])), panoramaMs: 9000 + p, staticLoaded: true,
    }));
    const flat = shown.flatMap((id, i) => ITEMS.map((item) => ({ id: `${id}_${item}`, label: `${id} · ${item}`, value: score(p, id, item), itemId: item, pairId: id.slice(0, 4), imageId: id, imageUrl: url(id), position: i + 1 })));
    return {
      result: { text: JSON.stringify({ personal: { age: 20 + p }, attention: { MIDCHECK: 6 } }), ratings: flat },
      scenes, pairIds: shown.map((id) => id.slice(0, 4)), version: 'rural-static12-10items', complete: true,
      personal: { age: 20 + p, gender: 'female', stress: 6 }, attention: { MIDCHECK: 6, FINALCHECK: 6 },
      shownUrls: shown.map(url), elapsedSeconds: 700 + p,
    };
  }
  const QUESTION = { name: 'task', type: 'skillquestion', skillId: 'skill_rural', title: 'Rural scenes' };
  const rows = [1, 2, 3].map((p) => ({ id: `r${p}`, participant_id: `P${p}`, created_at: '2026-10-15T00:00:00Z', responses: { task: taskAnswer(p) } }));
  const records = buildAnalysisRecords(rows, QUESTION);

  test('a table of the mean per image and item, one observation per participant, image and item', () => {
    const blocks = platformSummaryBlocks(records);
    expect(blocks).toHaveLength(1);
    const [table] = blocks;
    expect(table.type).toBe('table');
    expect(table.platform).toBe(true);
    expect(table.columns).toEqual(['image', ...ITEMS, 'n']);
    // Four images in the pool, labelled by their file names; each shown to the participants whose window covered it.
    expect(table.rows.map((r) => r[0])).toEqual(POOL.map((id) => `${id}__1a6d540f.jpg`));
    const p027 = table.rows.find((r) => r[0].startsWith('P027B'));
    // P027B was shown to participants 2 (index 0) and 3 (index 1) only; its A1 scores are 1+0+2→3 and 1+0+3→4... computed below.
    const raters = [1, 2, 3].filter((p) => [POOL[p % 4], POOL[(p + 1) % 4], POOL[(p + 2) % 4]].includes('P027B'));
    expect(p027[p027.length - 1]).toBe(raters.length);
    const expectedA1 = raters.reduce((a, p) => a + score(p, 'P027B', 'A1'), 0) / raters.length;
    expect(p027[1]).toBeCloseTo(expectedA1, 2);
    // The nested and the flat copy of the same rating count once: the mean is a plain average of the raters' scores.
    const p051 = table.rows.find((r) => r[0].startsWith('P051B'));
    const raters051 = [1, 2, 3].filter((p) => [POOL[p % 4], POOL[(p + 1) % 4], POOL[(p + 2) % 4]].includes('P051B'));
    expect(p051[1 + ITEMS.indexOf('S3')]).toBeCloseTo(raters051.reduce((a, p) => a + score(p, 'P051B', 'S3'), 0) / raters051.length, 2);
  });

  test('records without such a shape give no platform table', () => {
    expect(platformSummaryBlocks(ROWS.map((row) => ({ participant_id: row.participant_id, answer: row.responses.__sp_page_state })))).toEqual([]);
    expect(platformSummaryBlocks([])).toEqual([]);
  });

  test('the platform table comes first in an evaluated code-only analysis and in the export', async () => {
    const code = 'function analyze(records) { return { blocks: [{ type: "note", text: "n=" + records.length }] }; }';
    const run = await evaluateAnalysis(code, records, syncRunner);
    expect(run.ok).toBe(true);
    // A legacy saved analysis is code only: the image × item table the platform recognises itself, then the model's note. No plan, so no coverage block.
    expect(run.blocks.map((b) => b.type)).toEqual(['table', 'note']);
    expect(run.blocks[0].table.rows).toHaveLength(4);
    const files = aiAnalysisExportFiles(QUESTION, { code }, run.blocks);
    const csv = files.find((f) => /\.csv$/.test(f.path));
    expect(csv.path).toMatch(/platform_table/);
    expect(csv.content).toContain('image,A1,M1');
    expect(csv.content).toContain('P027B__1a6d540f.jpg');
    expect(files.some((f) => /analyze\.js$/.test(f.path))).toBe(true);
  });

  test('the model gets the task code that records the answer and names the fields it stores', () => {
    const html = `<!doctype html><html><body><script>
const POOL = ['P027B', 'P034B'];
function draw() { document.title = 'x'; }
function finish() {
  const flat = scenes.flatMap((s) => Object.keys(s.ratings).map((itemId) => ({ itemId, value: s.ratings[itemId], imageId: s.imageId })));
  SPSkill.setAnswer({ result: { ratings: flat, text: JSON.stringify(profile) }, scenes, pairIds, personal, attention });
}
</script></body></html>`;
    const names = recordFieldNames(records);
    expect(names).toEqual(expect.arrayContaining(['scenes', 'ratings', 'imageId', 'itemId', 'personal', 'attention']));
    expect(names).not.toContain('id');
    const excerpt = analysisCodeExcerpt(html, records);
    expect(excerpt).toContain('SPSkill.setAnswer');
    expect(excerpt).toContain('s.ratings[itemId]');
    expect(excerpt).not.toContain('document.title');
    expect(analysisCodeExcerpt('', records)).toBe('');
  });
});
