import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../../lib/spScheme.js';
import {
  checkGeneratedPage,
  extractHtml,
  extractReply,
  writeSpSchemePage,
} from './spSchemeGenerate.mjs';

const GOOD = buildExampleSite().trim();
const PLAIN = '<!doctype html><html><head><title>x</title></head><body><p>Hello</p></body></html>';
const ROUTE = { apiKey: 'sk', provider: 'deepseek', baseUrl: 'https://x', model: 'deepseek-flash', modelRecord: { maxTokens: 8000 } };

function fakeChat(answers) {
  const calls = [];
  const chat = async (options) => {
    calls.push(options);
    return { content: answers[Math.min(calls.length - 1, answers.length - 1)] };
  };
  return { chat, calls };
}

const fenced = (html, note = '') => `${note}\n\`\`\`html\n${html}\n\`\`\``;

describe('SP-Scheme page writer', () => {
  it('pulls the page and the note out of an answer', () => {
    assert.equal(extractHtml(fenced(PLAIN, 'Here you go:')), PLAIN);
    assert.equal(extractHtml(`sure ${PLAIN} trailing`), PLAIN);
    assert.equal(extractHtml('no page here'), '');
    assert.equal(extractReply(fenced(PLAIN, 'Added an age question.')), 'Added an age question.');
    assert.equal(extractReply(PLAIN), '');
  });

  it('checks pages with the Studio import check', () => {
    const good = checkGeneratedPage(GOOD);
    assert.equal(good.ok, true);
    assert.equal(good.asIs, false);
    assert.equal(checkGeneratedPage(PLAIN).asIs, true);
  });

  it('rejects an empty request', async () => {
    const { chat } = fakeChat(['']);
    await assert.rejects(writeSpSchemePage({ chat, route: ROUTE, request: '  ' }), /Say what/);
  });

  it('sends problems back and returns the repaired page', async () => {
    const { chat, calls } = fakeChat([fenced(PLAIN, 'Made it.'), fenced(GOOD, 'Fixed.')]);
    const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'Rate street safety' });
    assert.equal(out.rounds, 2);
    assert.equal(out.passed, true);
    assert.equal(out.html, GOOD);
    assert.equal(out.reply, 'Made it.');
    assert.equal(calls[0].model, 'deepseek-flash');
    assert.match(calls[0].messages[0].content, /SP-Scheme/);
    assert.match(calls[1].messages.at(-1).content, /found these problems/);
  });

  it('stops after the repair rounds and reports what is still wrong', async () => {
    const { chat, calls } = fakeChat([fenced(PLAIN)]);
    const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'x' });
    assert.equal(calls.length, 3);
    assert.equal(out.passed, false);
    assert.ok(out.check.problems.length > 0);
  });

  it('changes the current page when one is given', async () => {
    const { chat, calls } = fakeChat([fenced(GOOD)]);
    await writeSpSchemePage({ chat, route: ROUTE, request: 'Make the button green', currentHtml: GOOD });
    assert.equal(calls.length, 1);
    assert.match(calls[0].messages[1].content, /current index\.html/);
    assert.match(calls[0].messages[1].content, /Make the button green/);
  });
});
