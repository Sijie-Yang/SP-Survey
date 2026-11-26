// node --test kit/  — checks the kit runtime and CLI without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite, longRows, imageScores } from './sp.mjs';

const KIT = path.dirname(fileURLToPath(import.meta.url));

function loadRuntime() {
  const window = {};
  const ctx = { window, document: { readyState: 'loading', addEventListener() {} }, Math, JSON, console };
  vm.runInNewContext(fs.readFileSync(path.join(KIT, 'sp-site.js'), 'utf8'), ctx);
  return window.SPSiteKit;
}

test('balanced draws: every file shown equally often, nobody sees one twice', () => {
  const { balancedSlice } = loadRuntime();
  for (const [n, per] of [[12, 7], [40, 6], [9, 2], [5, 5]]) {
    const counts = new Array(n).fill(0);
    const people = n * 3;
    for (let k = 0; k < people; k += 1) {
      const slice = balancedSlice(n, per, k, 'seed');
      assert.equal(new Set(slice).size, slice.length, `repeat for participant ${k}`);
      slice.forEach((i) => { counts[i] += 1; });
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `uneven for n=${n}, per=${per}: ${counts}`);
  }
});

test('the example study passes the check', () => {
  const dir = path.join(KIT, 'example');
  const r = checkSite(dir, { write: false });
  // The example folder ships without sp-site.js (sp.mjs new copies it in).
  assert.deepEqual(r.errors.filter((e) => !/sp-site\.js is missing/.test(e)), []);
  assert.equal(r.elements.length, 3);
});

test('export: image choices resolve to the chosen file, ratings average per file', () => {
  const elements = [{ name: 'duel', type: 'imagepicker' }, { name: 'rate', type: 'imagerating' }];
  const rows = [{
    id: 1, participant_id: 'p', created_at: 'now', survey_metadata: { duration_ms: 3000 },
    responses: { duel: { trials: [{ value: 'image_1', shown_images: ['a.jpg', 'b.jpg'] }] }, rate: 5 },
    displayed_images: { rate: [['c.jpg']] },
  }];
  const long = longRows(rows, elements);
  assert.equal(long.find((r) => r.question === 'duel').chosen, 'b.jpg');
  const scores = imageScores(long, elements);
  assert.equal(scores.find((s) => s.file === 'b.jpg').chosen, 1);
  assert.equal(scores.find((s) => s.file === 'c.jpg').mean_rating, '5.000');
});

test('every template builds a page that passes the check', async () => {
  const { loadTemplates, writeGenericPage } = await import('./sp.mjs');
  const os = await import('node:os');
  for (const study of loadTemplates()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-study-'));
    writeGenericPage(dir, study.survey);
    fs.copyFileSync(path.join(KIT, 'sp-site.js'), path.join(dir, 'sp-site.js'));
    const r = checkSite(dir, { write: false });
    assert.deepEqual(r.errors, [], study.id);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
