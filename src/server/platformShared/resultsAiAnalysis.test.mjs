import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handleResultsAiAnalysis, parseAnalysisAnswer, parsePlanAnswer, buildAnalysisUserMessage, normalizeAnalysisRequest } from './resultsAiAnalysis.mjs';

const settings = async () => ({ assistant_provider: 'deepseek', assistant_model: 'deepseek-v4-pro' });
const deps = (chat) => ({
  loadUserAiSettings: settings,
  listProviderProfiles: async () => [],
  resolveAssistantBinding: async () => ({ credential: { apiKey: 'k' } }),
  chatCompletions: chat,
});

describe('Results AI analysis', () => {
  it('takes the analyze function out of the answer', () => {
    const code = parseAnalysisAnswer('<think>hm</think>Sure:\n```javascript\nfunction analyze(records, helpers) {\n  return { blocks: [] };\n}\n```\nDone.');
    assert.match(code, /^function analyze\(records, helpers\)/);
    assert.match(parseAnalysisAnswer('function analyze(r) { return []; }'), /function analyze/);
    assert.equal(parseAnalysisAnswer('```json\n{"blocks":[]}\n```'), null);
  });

  it('takes the JSON plan out of the answer', () => {
    const plan = parsePlanAnswer('<think>…</think>Here is the plan:\n```json\n{"summary": "two photos per round", "fields": [{"path": "compare", "use": "pick", "images": ["imageA", "imageB"]}]}\n```');
    assert.equal(plan.summary, 'two photos per round');
    assert.equal(plan.fields[0].path, 'compare');
    assert.deepEqual(parsePlanAnswer('{"fields":[]}').fields, []);
    assert.equal(parsePlanAnswer('```javascript\nfunction analyze() {}\n```'), null);
    assert.equal(parsePlanAnswer(''), null);
  });

  it('in plan mode the plan prompt is used, the fields are sent and an incomplete plan is sent back whole', async () => {
    const chat = mock.fn(async () => ({ content: '```json\n{"fields":[{"path":"a","use":"score","meaning":"rating"}]}\n```' }));
    const res = await handleResultsAiAnalysis({}, 'user', {
      mode: 'plan', question: 'name: q1', sample: '[{"a":1,"b":2}]', fields: 'a  number  (3/3)\nb  number  (3/3)',
      previous: '{"fields":[{"path":"a","use":"score"}]}', error: 'These fields have no entry: b.',
    }, deps(chat));
    assert.deepEqual(res.plan, { fields: [{ path: 'a', use: 'score', meaning: 'rating' }] });
    assert.equal(res.code, undefined);
    const [call] = chat.mock.calls;
    const messages = call.arguments[0].messages;
    assert.match(messages[0].content, /what each stored field means/);
    assert.match(messages[0].content, /EVERY path in FIELDS/);
    assert.match(messages[1].content, /FIELDS \(path/);
    assert.match(messages[1].content, /YOUR PREVIOUS PLAN/);
    assert.match(messages[1].content, /IT IS INCOMPLETE\nThese fields have no entry: b\./);
    assert.doesNotMatch(messages[1].content, /YOUR PREVIOUS CODE/);
  });

  it('needs a question and records', () => {
    assert.throws(() => normalizeAnalysisRequest({ question: '', sample: '[]' }), (e) => e.status === 400);
    assert.throws(() => normalizeAnalysisRequest({ question: 'q', sample: ' ' }), (e) => e.status === 400);
  });

  it('does not call the model without a usable route', async () => {
    const chat = mock.fn(async () => ({ content: '' }));
    await assert.rejects(
      () => handleResultsAiAnalysis({}, 'user', { question: 'q', sample: '[{}]' }, { ...deps(chat), resolveAssistantBinding: async () => ({ credential: null }) }),
      (e) => e.code === 'CREDENTIALS_MISSING',
    );
    assert.equal(chat.mock.calls.length, 0);
  });

  it('sends question, fields, sample and the failed code for the one fix', async () => {
    const chat = mock.fn(async () => ({ content: '```js\nfunction analyze(records, helpers) { return { blocks: [{ type: "note", text: "x" }] }; }\n```' }));
    const res = await handleResultsAiAnalysis({}, 'user', {
      question: 'name: q1\ntitle: Which is safer?',
      sample: '[{"answer":"left"}]',
      fields: 'answer  string  (3/3)',
      recordCount: 3,
      instructions: 'left means the left image',
      otherQuestions: '- complexity (rating): Visual complexity',
      media: '90 distinct media files appear in the records',
      pageCode: '177: const SCENES=Array.from({length:24},(_,i)=>genParams(i));',
      previous: 'function analyze() { throw 1 }',
      error: 'TypeError: x',
    }, deps(chat));
    assert.match(res.code, /function analyze/);
    const call = chat.mock.calls[0].arguments[0];
    assert.match(call.messages[0].content, /type: "pairwise"/);
    const user = call.messages[1].content;
    assert.match(user, /QUESTION\nname: q1/);
    assert.match(user, /RESEARCHER NOTES \(follow these\)\nleft means/);
    assert.match(user, /RECORDS: 3 in total/);
    assert.match(user, /OTHER QUESTIONS ON THE PAGE \(do not analyse these\)\n- complexity/);
    assert.match(user, /MEDIA\n90 distinct/);
    assert.match(user, /PAGE CODE \(excerpt[^\n]*\n177: const SCENES/);
    assert.match(call.messages[0].content, /ALREADY replaced those ids with the library image names/);
    assert.match(call.messages[0].content, /type: "per_item"/);
    assert.match(user, /FIELDS .*\nanswer {2}string/);
    assert.match(user, /YOUR PREVIOUS CODE/);
    assert.match(user, /IT FAILED ON THE REAL RECORDS\nTypeError: x/);
  });

  it('says what the model began with when there is no function', async () => {
    const chat = mock.fn(async () => ({ content: 'I cannot help with that.' }));
    await assert.rejects(() => handleResultsAiAnalysis({}, 'user', { question: 'q', sample: '[{}]' }, deps(chat)), (e) => e.code === 'ANALYSIS_UNPARSEABLE' && /cannot help/.test(e.message));
  });

  it('first request has no fix section', () => {
    const text = buildAnalysisUserMessage(normalizeAnalysisRequest({ question: 'q', sample: '[{}]' }));
    assert.doesNotMatch(text, /PREVIOUS/);
  });
});
