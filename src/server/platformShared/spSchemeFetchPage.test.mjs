import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPublicUrl, handleSpSchemeFetchPage } from './spSchemeFetchPage.mjs';

function site(files) {
  return async (href) => {
    const file = files[href];
    if (!file) return new Response('missing', { status: 404 });
    return Object.assign(new Response(file.body, { status: 200, headers: { 'Content-Type': file.type } }), {});
  };
}

const PAGE = 'https://lab.github.io/rating/';
const files = {
  [PAGE]: { type: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="assets/app.css"><script type="module" src="./assets/app.js"></script><script src="https://cdn.jsdelivr.net/npm/x.js"></script></head><body><div id="root"></div></body></html>' },
  'https://lab.github.io/rating/assets/app.js': { type: 'text/javascript', body: 'fetch("data/pairs.json").then(r=>r.json());fetch("https://script.google.com/macros/s/x/exec",{method:"POST"});' },
  'https://lab.github.io/rating/assets/app.css': { type: 'text/css', body: 'body{color:red}' },
  'https://lab.github.io/rating/data/pairs.json': { type: 'application/json', body: '[{"a":"img/1.jpg","b":"img/2.jpg"}]' },
  'https://lab.github.io/rating/img/1.jpg': { type: 'image/jpeg', body: 'JPEG' },
  'https://lab.github.io/rating/notes.txt': { type: 'text/plain', body: 'hi' },
};

describe('SP-Scheme page import', () => {
  it('refuses private and non-web addresses', () => {
    assert.throws(() => checkPublicUrl('http://localhost:8000/'), /not a public/);
    assert.throws(() => checkPublicUrl('http://192.168.1.4/'), /not a public/);
    assert.throws(() => checkPublicUrl('ftp://x.org/'), /http/);
    assert.equal(checkPublicUrl('lab.github.io/rating/').href, PAGE);
  });

  it('inlines same-site code, keeps a base for the rest, and returns mentioned data files', async () => {
    const res = await handleSpSchemeFetchPage({ url: PAGE }, { fetch: site(files) });
    assert.equal(res.host, 'lab.github.io');
    assert.match(res.html, /<head><base href="https:\/\/lab\.github\.io\/rating\/">/);
    assert.match(res.html, /<script type="module" data-sp-inlined="\.\/assets\/app\.js">fetch\("data\/pairs\.json"\)/);
    assert.match(res.html, /<style data-sp-inlined="assets\/app\.css">body\{color:red\}<\/style>/);
    assert.match(res.html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/x\.js"><\/script>/);
    assert.deepEqual(res.dataFiles, [{ name: '/rating/data/pairs.json', text: '[{"a":"img/1.jpg","b":"img/2.jpg"}]' }]);
  });
});
