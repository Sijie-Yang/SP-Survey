/**
 * Local versions of the platform's Assistant helpers, so the self-hosted app
 * has the same features as sp-survey.org:
 *   POST  /api/agent/translate                   translate participant wording (Builder)
 *   POST  /api/agent/results/ai-analysis         write the analysis for one Results question
 *   POST  /api/agent/sp-scheme/fetch-page        fetch a published survey page for SP-Scheme conversion
 *   POST  /api/agent/sp-scheme/switch            switch a study between its SP-Scheme page and the classic editor
 *   GET   /api/agent/projects/:id/metadata       project metadata (saved AI analyses, SP-Scheme backups)
 *   PATCH /api/agent/projects/:id/metadata       { set: { key: value|null } }
 *   POST  /api/street-level/expand               resolve maps.app.goo.gl short links
 *   GET   /api/r2/image-proxy?url=               fetch a public media file when the browser is blocked by CORS
 *
 * The model calls use the researcher's own key from the local credential store.
 * The translation, analysis and page-fetch logic is shared with the platform
 * (src/server/platformShared, copied from SP-Survey-Platform worker-lib).
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { findSecretFields } = require('../lib/secretFields');

const SHARED = path.join(__dirname, 'platformShared');
const loadShared = (name) => import(pathToFileURL(path.join(SHARED, name)).href);

const SP_SCHEME_BACKUPS_KEY = 'spSchemeBackups';
const MAX_SP_SCHEME_BACKUPS = 3;
const METADATA_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function sendError(res, error) {
  res.status(error.status || 500).json({ success: false, error: error.message, ...(error.code ? { code: error.code } : {}) });
}

/** Metadata is kept beside the project in its JSON file (older files kept it on project). */
function metadataOf(stored) {
  const meta = stored?.metadata ?? stored?.project?.metadata;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
}

/** The draft without its page: the page's questions stay as classic question pages. */
function classicConfigFromPage(config, savedAt) {
  const next = JSON.parse(JSON.stringify(config || {}));
  delete next.spSite;
  if (!Array.isArray(next.pages)) next.pages = [];
  next.spSchemeBackupAt = savedAt;
  return next;
}

/** Metadata with the draft added as the newest backup (at most MAX_SP_SCHEME_BACKUPS kept). */
function withBackup(metadata, config, savedAt) {
  const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const list = Array.isArray(meta[SP_SCHEME_BACKUPS_KEY]) ? meta[SP_SCHEME_BACKUPS_KEY] : [];
  meta[SP_SCHEME_BACKUPS_KEY] = [{ savedAt, config }, ...list].slice(0, MAX_SP_SCHEME_BACKUPS);
  return meta;
}

/** The newest backup and the metadata without it; null when there is none. */
function takeBackup(metadata) {
  const list = Array.isArray(metadata?.[SP_SCHEME_BACKUPS_KEY]) ? metadata[SP_SCHEME_BACKUPS_KEY] : [];
  const latest = list.find((item) => item?.config?.spSite?.html);
  if (!latest) return null;
  return {
    backup: latest,
    metadata: { ...metadata, [SP_SCHEME_BACKUPS_KEY]: list.filter((item) => item !== latest) },
  };
}

function registerAgentPlatformExtrasApi(app, { createProjectIo }) {
  const io = () => createProjectIo();

  const writeProject = async (projectId, stored, changes) => {
    const now = new Date().toISOString();
    const next = { ...stored, ...changes };
    if (changes.surveyConfig) {
      next.project = { ...stored.project, lastModified: now };
      next.savedAt = now;
      next.draftUpdatedAt = now;
    }
    if (next.project && 'metadata' in next.project) {
      const { metadata: _old, ...rest } = next.project;
      next.project = rest;
    }
    await io().persistProject(projectId, next, now);
    return next;
  };

  app.get('/api/agent/projects/:projectId/metadata', async (req, res) => {
    try {
      const stored = await io().readProject(req.params.projectId);
      res.json({ success: true, metadata: metadataOf(stored) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/agent/projects/:projectId/metadata', async (req, res) => {
    try {
      const set = req.body?.set;
      if (!set || typeof set !== 'object' || Array.isArray(set)) throw fail('Send { set: { key: value } }.');
      const keys = Object.keys(set);
      if (!keys.length || keys.some((key) => !METADATA_KEY_RE.test(key))) throw fail('Invalid metadata key.');
      if (findSecretFields(set).length) throw fail('Do not store credentials in project metadata.');
      const { projectId } = req.params;
      const stored = await io().readProject(projectId);
      const metadata = { ...metadataOf(stored) };
      keys.forEach((key) => {
        if (set[key] === null) delete metadata[key];
        else metadata[key] = set[key];
      });
      await writeProject(projectId, stored, { metadata });
      res.json({ success: true, metadata });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/translate', async (req, res) => {
    try {
      const { handleSurveyTranslate } = await loadShared('translate.mjs');
      res.json(await handleSurveyTranslate({}, 'local', req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/results/ai-analysis', async (req, res) => {
    try {
      const { handleResultsAiAnalysis } = await loadShared('resultsAiAnalysis.mjs');
      res.json(await handleResultsAiAnalysis({}, 'local', req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/sp-scheme/fetch-page', async (req, res) => {
    try {
      const { handleSpSchemeFetchPage } = await loadShared('spSchemeFetchPage.mjs');
      res.json(await handleSpSchemeFetchPage(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/sp-scheme/switch', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || '');
      const direction = req.body?.direction;
      if (direction !== 'classic' && direction !== 'spscheme') throw fail('direction must be classic or spscheme');
      const stored = await io().readProject(projectId);
      const draft = stored.surveyConfig || {};
      const stamp = stored.draftUpdatedAt || stored.savedAt || null;
      const now = new Date().toISOString();

      if (direction === 'classic') {
        if (!draft?.spSite?.html) return res.json({ success: true, changed: false, draftUpdatedAt: stamp });
        const next = await writeProject(projectId, stored, {
          metadata: withBackup(metadataOf(stored), draft, now),
          surveyConfig: classicConfigFromPage(draft, now),
        });
        return res.json({ success: true, changed: true, backupAt: now, draftUpdatedAt: next.draftUpdatedAt });
      }

      if (draft?.spSite?.html) return res.json({ success: true, changed: false, draftUpdatedAt: stamp });
      const taken = takeBackup(metadataOf(stored));
      if (!taken) throw fail('There is no saved SP-Scheme page to bring back.', 404, 'NO_BACKUP');
      const next = await writeProject(projectId, stored, {
        metadata: taken.metadata,
        surveyConfig: taken.backup.config,
      });
      return res.json({ success: true, changed: true, restoredFrom: taken.backup.savedAt, draftUpdatedAt: next.draftUpdatedAt });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/street-level/expand', async (req, res) => {
    try {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls : (req.body?.url ? [req.body.url] : []);
      if (!urls.length) throw fail('"urls" is required');
      if (urls.length > 50) throw fail('At most 50 links per request');
      const { expandShortMapsUrls } = await loadShared('streetLevel.mjs');
      res.json({ success: true, results: await expandShortMapsUrls(urls) });
    } catch (error) {
      sendError(res, error);
    }
  });
}

const MAX_PROXY_BYTES = 30 * 1024 * 1024;

function registerMediaProxy(app) {
  app.get('/api/r2/image-proxy', async (req, res) => {
    try {
      const { checkPublicUrl } = await loadShared('spSchemeFetchPage.mjs');
      const url = checkPublicUrl(req.query.url);
      const upstream = await fetch(url.toString(), { redirect: 'follow' });
      if (upstream.status === 404) return res.status(404).send('Not found');
      if (!upstream.ok) return res.status(502).send(`Upstream HTTP ${upstream.status}`);
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length > MAX_PROXY_BYTES) return res.status(413).send('File too large');
      res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (error) {
      return res.status(error.status || 500).send(error.message);
    }
  });
}

module.exports = {
  registerAgentPlatformExtrasApi,
  registerMediaProxy,
  classicConfigFromPage,
  withBackup,
  takeBackup,
};
