import fs from 'fs';
import path from 'path';
import {
  buildAnalysisRecords, evaluateAnalysis, generateQuestionAnalysis, mapRecordsToMedia, mediaSummary, pageCodeExcerpt, pageIdMediaMap, pageMediaUrls, runAnalysisUnsandboxed,
} from './aiQuestionAnalysis';

// A real converted page: 24 generated scenes S01..S24; the platform fills its
// PHOTO_URLS from the media library and scene i shows PHOTO_URLS[i]. Answers
// name scenes, never images.
const HTML = fs.readFileSync(path.join(__dirname, '__fixtures__/streetPerceptionSurvey.html'), 'utf8');
const LIBRARY = Array.from({ length: 40 }, (_, i) => ({ name: `street_${String(i + 1).padStart(3, '0')}.jpg`, url: `https://media.sp-survey.org/p/streets/street_${String(i + 1).padStart(3, '0')}.jpg`, folder: 'streets' }));
const POOL = [1, 2, 4, 5, 8, 9, 12, 13, 16, 20].map((i) => `S${String(i + 1).padStart(2, '0')}`);
const DIMS = ['safe', 'lively', 'beautiful', 'wealthy', 'boring', 'depressing'];
function row(p) {
  const pairs = Array.from({ length: 18 }, (_, t) => {
    const a = POOL[(t + p) % 10];
    const b = POOL[(t * 3 + p + 1) % 10];
    const better = POOL.indexOf(a) < POOL.indexOf(b);
    return { dim: DIMS[t % 6], left: a, right: b, choice: a === b ? 'E' : better ? 'L' : 'R', rt: 900 + t };
  }).filter((t) => t.left !== t.right);
  const state = { v: 1, done: true, pairs, flash: [0, 3, 7, 11, 15, 19].map((i, k) => ({ scene: `S${String(i + 1).padStart(2, '0')}`, rating: (k + p) % 7 + 1, rt: 500 })) };
  return {
    participant_id: `P${p}`,
    responses: { __sp_page_state: { 'sp-media:PHOTO_URLS': LIBRARY, 'streetscape-survey-v1': JSON.stringify(state), 'svp-theme': 'dark' } },
  };
}
const ROWS = Array.from({ length: 6 }, (_, i) => row(i + 1));
const QUESTION = { name: '__page__pairs', pageName: 'pairs', title: '两条街，选一条：哪条街道看起来更安全/有活力/美丽/富裕/无聊/压抑？', type: 'imagepicker', pageOnly: true };

// What the model should write once it sees the page code.
const CODE = `function analyze(records, helpers) {
  var matches = [];
  records.forEach(function (r) {
    var s = helpers.get(r, 'page_state.streetscape-survey-v1') || {};
    var photos = helpers.media(r);
    var img = function (id) { var n = parseInt(String(id).slice(1), 10) - 1; return photos[n] ? photos[n].name : id; };
    helpers.list(s.pairs).forEach(function (t) {
      if (t.choice !== 'L' && t.choice !== 'R') return;
      var w = t.choice === 'L' ? t.left : t.right, l = t.choice === 'L' ? t.right : t.left;
      matches.push({ winner: img(w), loser: img(l), category: t.dim });
    });
  });
  return { blocks: [{ type: 'pairwise', title: '成对比较（按维度）', matches: matches }] };
}`;

test('the page code excerpt shows how scenes take their pictures from the media list', () => {
  const excerpt = pageCodeExcerpt(HTML, ['PHOTO_URLS']);
  expect(excerpt).toMatch(/const PHOTO_URLS = \[\];/);
  expect(excerpt).toMatch(/id:'S'\+String\(i\+1\)/);
  expect(excerpt).toMatch(/const SCENES=Array\.from\(\{length:24\}/);
  expect(excerpt).toMatch(/PHOTO_URLS\.forEach\(\(u,i\)=>\{if\(SCENES\[i\]&&u\)SCENES\[i\]\.img=u\}\)/);
  expect(excerpt.length).toBeLessThan(5000);
});

test('the model is sent the excerpt, the media list size and the other fields', async () => {
  const records = buildAnalysisRecords(ROWS, QUESTION, { site: true });
  expect(mediaSummary(records)).toMatch(/helpers\.media\(r\); 40 images/);
  let sent;
  const result = await generateQuestionAnalysis({
    question: QUESTION, records, pageHtml: HTML,
    request: async (body) => { sent = body; return { code: CODE, model: 'm' }; },
    runner: async (code, recs) => runAnalysisUnsandboxed(code, recs),
  });
  expect(sent.pageCode).toMatch(/SCENES\[i\]\.img=u/);
  expect(result.ok).toBe(true);
  const [block] = result.blocks;
  // Items are media library images, split by dimension; only the 10 pool scenes are ever compared.
  expect(block.boards.map((b) => b.label).sort()).toEqual([...DIMS].sort());
  const items = new Set(block.boards.flatMap((b) => b.rankings.map((r) => r.imageKey)));
  expect([...items].every((k) => /^street_0\d\d\.jpg$/.test(k))).toBe(true);
  expect(items.size).toBe(10);
  expect(items.has('street_002.jpg')).toBe(true); // S02 = PHOTO_URLS[1]
});

// What a weak model writes: it reads the scene ids and never touches the media list.
const NAIVE = `function analyze(records, helpers) {
  var matches = [], flash = [];
  records.forEach(function (r) {
    var s = helpers.parse(r.page_state['streetscape-survey-v1']) || {};
    (s.pairs || []).forEach(function (t) {
      if (t.choice === 'L') matches.push({ winner: t.left, loser: t.right, category: t.dim });
      if (t.choice === 'R') matches.push({ winner: t.right, loser: t.left, category: t.dim });
    });
    (s.flash || []).forEach(function (f) { flash.push({ item: f.scene, value: f.rating, rater: r.participant_id }); });
  });
  return { blocks: [
    { type: 'pairwise', title: 'pairs', matches: matches },
    { type: 'per_item', title: 'flash', values: flash },
    { type: 'choice', title: 'side', values: ['L', 'R'] },
  ] };
}`;

test('the platform finds how the page names its scenes and which library image each one shows', () => {
  const records = buildAnalysisRecords(ROWS, QUESTION, { site: true });
  const map = pageIdMediaMap(records, HTML);
  expect(map.list).toBe('PHOTO_URLS');
  expect(map.formats).toContainEqual({ prefix: 'S', offset: 1 });
  expect(map.names.slice(0, 3)).toEqual(['street_001.jpg', 'street_002.jpg', 'street_003.jpg']);
  expect(pageMediaUrls(records).get('street_005.jpg')).toBe(LIBRARY[4].url);
  expect(pageIdMediaMap(records, '')).toBeNull();
  expect(pageIdMediaMap(records, '<script>const S = "x";</script>').names).toEqual([]);
});

test('scene ids become library images even when the model never maps them', async () => {
  const records = buildAnalysisRecords(ROWS, QUESTION, { site: true });
  const run = (code, recs) => Promise.resolve(runAnalysisUnsandboxed(code, recs));
  const result = await evaluateAnalysis(NAIVE, records, run, { pageHtml: HTML });
  expect(result.ok).toBe(true);
  const [pairs, flash, side] = result.blocks;
  const items = new Set(pairs.boards.flatMap((b) => b.rankings.map((r) => r.imageKey)));
  expect(pairs.boards.map((b) => b.label).sort()).toEqual([...DIMS].sort());
  expect(items.size).toBe(10);
  expect([...items].every((k) => /^street_0\d\d\.jpg$/.test(k))).toBe(true);
  expect(items.has('street_003.jpg')).toBe(true); // S03 = PHOTO_URLS[2]
  expect(items.has('S03')).toBe(false);
  expect(flash.items.map((r) => r.item).sort()).toEqual(['street_001.jpg', 'street_004.jpg', 'street_008.jpg', 'street_012.jpg', 'street_016.jpg', 'street_020.jpg']);
  expect(pairs.note).toMatch(/媒体库/);
  // Values that are not page ids are left alone.
  expect(side.values).toEqual(['L', 'R']);
  // Without the page code nothing is guessed.
  const plain = await evaluateAnalysis(NAIVE, records, run);
  expect(plain.blocks[0].boards[0].rankings.every((r) => /^S\d\d$/.test(r.imageKey))).toBe(true);
});

test('a short media list maps what it can and says which scenes drew their own picture', async () => {
  const short = ROWS.map((r) => ({ ...r, responses: { __sp_page_state: { ...r.responses.__sp_page_state, 'sp-media:PHOTO_URLS': JSON.stringify(LIBRARY.slice(0, 12)) } } }));
  const records = buildAnalysisRecords(short, QUESTION, { site: true });
  const run = (code, recs) => Promise.resolve(runAnalysisUnsandboxed(code, recs));
  const { blocks: [pairs, flash] } = await evaluateAnalysis(NAIVE, records, run, { pageHtml: HTML });
  const items = new Set(pairs.boards.flatMap((b) => b.rankings.map((r) => r.imageKey)));
  expect(items.has('street_003.jpg')).toBe(true);
  expect(items.has('S14')).toBe(true); // past the 12 library images
  expect(pairs.note).toMatch(/S14.*超出.*12 张图/);
  expect(flash.items.map((r) => r.item)).toContain('street_012.jpg');
});

test('without a media list in the answers the card says why it shows page ids', async () => {
  const bare = ROWS.map((r) => ({ ...r, responses: { __sp_page_state: { 'streetscape-survey-v1': r.responses.__sp_page_state['streetscape-survey-v1'] } } }));
  const records = buildAnalysisRecords(bare, QUESTION, { site: true });
  const run = (code, recs) => Promise.resolve(runAnalysisUnsandboxed(code, recs));
  const { blocks: [pairs, , side] } = await evaluateAnalysis(NAIVE, records, run, { pageHtml: HTML });
  expect(pairs.boards[0].rankings.every((r) => /^S\d\d$/.test(r.imageKey))).toBe(true);
  expect(pairs.note).toMatch(/没有媒体库图片列表（PHOTO_URLS）/);
  expect(side.note || '').not.toMatch(/媒体库/);
});

test('each participant\'s own random list decides which image a scene id was', async () => {
  // The platform hands every participant the library in a different random order.
  const shuffled = (p) => LIBRARY.map((m, i) => ({ m, k: (i * 7 + p * 13) % 41 })).sort((a, b) => a.k - b.k).map((x) => x.m);
  const rows = ROWS.map((r, i) => ({ ...r, responses: { __sp_page_state: { ...r.responses.__sp_page_state, 'sp-media:PHOTO_URLS': shuffled(i + 1) } } }));
  const records = buildAnalysisRecords(rows, QUESTION, { site: true });
  const mapped = mapRecordsToMedia(records, HTML);
  mapped.forEach((record, i) => {
    const state = JSON.parse(record.page_state['streetscape-survey-v1']);
    const list = shuffled(i + 1);
    const original = JSON.parse(records[i].page_state['streetscape-survey-v1']);
    state.pairs.forEach((t, k) => {
      const n = Number(original.pairs[k].left.slice(1)) - 1;
      expect(t.left).toBe(list[n].name);
    });
    expect(state.flash[0].scene).toBe(list[0].name); // S01
    expect(state.pairs[0].dim).toBe(original.pairs[0].dim);
  });
  // The model sees names only, and the stored state is not touched.
  let sent;
  await generateQuestionAnalysis({
    question: QUESTION, records, pageHtml: HTML,
    request: async (body) => { sent = body; return { code: NAIVE, model: 'm' }; },
    runner: async (code, recs) => runAnalysisUnsandboxed(code, recs),
  });
  expect(sent.sample).not.toMatch(/"S\d\d"/);
  expect(records[0].page_state['streetscape-survey-v1']).toMatch(/"S\d\d"/);
  const run = (code, recs) => Promise.resolve(runAnalysisUnsandboxed(code, recs));
  const { blocks: [pairs] } = await evaluateAnalysis(NAIVE, records, run, { pageHtml: HTML });
  expect(pairs.boards.flatMap((b) => b.rankings.map((r) => r.imageKey)).every((k) => /^street_0\d\d\.jpg$/.test(k))).toBe(true);
});

test('stored page state as objects (how the platform saves it) is mapped too', () => {
  const rows = ROWS.slice(0, 2).map((r) => ({ ...r, responses: { __sp_page_state: { 'sp-media:PHOTO_URLS': LIBRARY, 'streetscape-survey-v1': JSON.parse(r.responses.__sp_page_state['streetscape-survey-v1']) } } }));
  const mapped = mapRecordsToMedia(buildAnalysisRecords(rows, QUESTION, { site: true }), HTML);
  expect(mapped[0].page_state['streetscape-survey-v1'].flash[0].scene).toBe('street_001.jpg');
});
