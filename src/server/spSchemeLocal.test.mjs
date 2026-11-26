import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../lib/spScheme.js';
import { draftWithPage, modeSwitchNote, runSpSchemeWriteTool } from './spSchemeLocal.mjs';

const GOOD = buildExampleSite().trim();
const ROUTE = { apiKey: 'sk', provider: 'openai', baseUrl: '', model: 'm' };

function store(initial) {
  let project = initial;
  return {
    readProject: async () => project,
    saveDraft: async (_id, stored, nextConfig) => {
      project = { ...stored, surveyConfig: nextConfig, draftUpdatedAt: 'now' };
      return project;
    },
    get: () => project,
  };
}

describe('local SP-Scheme mode', () => {
  it('notes a mode switch only when the mode changed', () => {
    assert.equal(modeSwitchNote('', 'spscheme'), '');
    assert.equal(modeSwitchNote('spscheme', 'spscheme'), '');
    assert.match(modeSwitchNote('agent', 'spscheme'), /SP-Scheme mode/);
    assert.match(modeSwitchNote('spscheme', 'agent'), /Classic mode/);
  });

  it('saves a page that passes the check', async () => {
    const s = store({ surveyConfig: { title: 'x', pages: [] } });
    const chat = async () => ({ content: `Wrote it.\n\`\`\`html\n${GOOD}\n\`\`\`` });
    const out = await runSpSchemeWriteTool({ projectId: 'p', request: 'Rate streets', route: ROUTE, ...s, chat });
    assert.equal(out.saved, true);
    assert.equal(out.changed, 'page_created');
    assert.equal(out.note, 'Wrote it.');
    assert.equal(s.get().surveyConfig.spSite.html.includes('SPSite'), true);
  });

  it('saves nothing when the page fails the check', async () => {
    const s = store({ surveyConfig: { title: 'x', pages: [] } });
    const chat = async () => ({ content: '<!doctype html><html><body>hi</body></html>' });
    const out = await runSpSchemeWriteTool({ projectId: 'p', request: 'Rate streets', route: ROUTE, ...s, chat });
    assert.equal(out.saved, false);
    assert.equal(out.code, 'SP_SCHEME_PAGE_PROBLEMS');
    assert.equal(s.get().surveyConfig.spSite, undefined);
  });

  it('keeps the old media folders when the new page names none', () => {
    const base = { spSite: { html: GOOD, mediaFolders: ['streets'] } };
    const next = draftWithPage(base, GOOD);
    assert.equal(next.ok, true);
    assert.ok(next.nextConfig.spSite.mediaFolders.length >= 1);
  });
});
