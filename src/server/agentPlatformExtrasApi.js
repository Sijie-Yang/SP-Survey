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
 *   GET   /api/r2/list?prefix=                   } used by the street-level helper (sp_streetlevel)
 *   POST  /api/r2/upload                         } to put downloaded street views into the
 *   GET   /api/street-level/projects/:id         } project's own Supabase Storage and media
 *   POST  /api/street-level/projects/:id/register} library (this machine only)
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


/* ---------- Street-level helper (sp_streetlevel) on the local server ---------- */

const LOCAL_USER_ID = 'local';
const MEDIA_BUCKET = 'survey-images';
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const HELPER_IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress || req.ip || '');
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

/** `local/<projectId>/<rest>` → projectId, or null for any other key or prefix. */
function projectIdFromKey(key) {
  const text = String(key || '');
  if (!text || text.includes('..') || text.includes('\\')) return null;
  const match = /^local\/([A-Za-z0-9_-]+)\//.exec(text);
  return match ? match[1] : null;
}

/** A Supabase client with the key saved on the project's Dataset tab; throws when there is none. */
function storageClientFor(stored) {
  const cfg = stored?.project?.imageDatasetConfig || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    throw fail('Set up Supabase storage on the Dataset tab of this project first.', 400, 'SUPABASE_NOT_CONFIGURED');
  }
  // eslint-disable-next-line global-require
  const { createClient } = require('@supabase/supabase-js');
  return createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
}

async function ensureMediaBucket(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw error;
  if (!(buckets || []).some((b) => b.name === MEDIA_BUCKET)) {
    const { error: createError } = await client.storage.createBucket(MEDIA_BUCKET, { public: true });
    if (createError && !/already exists/i.test(createError.message)) throw createError;
  }
}

async function listStorageKeys(client, prefix, out = []) {
  const dir = prefix.replace(/\/$/, '');
  for (let offset = 0; ; offset += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.storage.from(MEDIA_BUCKET).list(dir, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data || []) {
      const path = dir ? `${dir}/${item.name}` : item.name;
      // eslint-disable-next-line no-await-in-loop
      if (item.id === null) await listStorageKeys(client, path, out);
      else out.push({ key: path });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

function registerStreetLevelHelperApi(app, { createProjectIo }) {
  const io = () => createProjectIo();

  // The helper runs on this machine and sends no account token: these routes answer only locally.
  const localOnly = (handler) => async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ success: false, error: 'Available only from this machine.' });
    try {
      return await handler(req, res);
    } catch (error) {
      return sendError(res, error);
    }
  };

  app.get('/api/r2/list', localOnly(async (req, res) => {
    const prefix = String(req.query.prefix || '');
    const projectId = projectIdFromKey(prefix.endsWith('/') ? prefix : `${prefix}/`);
    if (!projectId) throw fail('prefix must be local/<projectId>/…', 403, 'FORBIDDEN');
    const client = storageClientFor(await io().readProject(projectId));
    await ensureMediaBucket(client);
    const images = await listStorageKeys(client, prefix);
    res.json({ success: true, images });
  }));

  app.post('/api/r2/upload', localOnly(async (req, res) => {
    const key = String(req.body?.key || '');
    const projectId = projectIdFromKey(key);
    if (!projectId || !HELPER_IMAGE_RE.test(key)) throw fail('key must be local/<projectId>/…/<image>.jpg|png|webp', 403, 'FORBIDDEN');
    const data = Buffer.from(String(req.body?.data || ''), 'base64');
    if (!data.length) throw fail('data is required');
    if (data.length > MAX_UPLOAD_BYTES) throw fail('File too large', 413);
    const client = storageClientFor(await io().readProject(projectId));
    await ensureMediaBucket(client);
    const ext = key.split('.').pop().toLowerCase();
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(key, data, {
      upsert: true,
      cacheControl: '3600',
      contentType: IMAGE_TYPES[ext] || String(req.body?.contentType || 'application/octet-stream'),
    });
    if (error) throw fail(error.message, 502, 'STORAGE_UPLOAD_FAILED');
    const { data: pub } = client.storage.from(MEDIA_BUCKET).getPublicUrl(key);
    res.json({ success: true, key, url: pub.publicUrl });
  }));

  app.get('/api/street-level/projects/:projectId', localOnly(async (req, res) => {
    const { projectId } = req.params;
    const stored = await io().readProject(projectId);
    const sl = stored.project?.imageDatasetConfig?.streetLevel || {};
    res.json({
      success: true,
      projectId,
      mediaPrefix: `${LOCAL_USER_ID}/${projectId}/`,
      publicBase: '',
      points: Array.isArray(sl.points) ? sl.points : [],
      capture: sl.capture || {},
    });
  }));

  app.post('/api/street-level/projects/:projectId/register', localOnly(async (req, res) => {
    const { projectId } = req.params;
    const { mergeRegistration } = await loadShared('streetLevel.mjs');
    const stored = await io().readProject(projectId);
    const project = stored.project || {};
    const merged = mergeRegistration(
      { preloaded_images: project.preloadedImages || [], image_dataset_config: project.imageDatasetConfig || {} },
      req.body || {},
      { prefix: `${LOCAL_USER_ID}/${projectId}/`, publicBase: '' },
    );
    const now = new Date().toISOString();
    await io().persistProject(projectId, {
      ...stored,
      project: {
        ...project,
        preloadedImages: merged.preloadedImages,
        imageDatasetConfig: merged.imageDatasetConfig,
        preloadedAt: now,
        preloadedSource: 'r2',
        lastModified: now,
      },
      savedAt: now,
    }, now);
    res.json({ success: true, projectId, registered: merged.registered });
  }));
}

module.exports = {
  registerAgentPlatformExtrasApi,
  registerMediaProxy,
  registerStreetLevelHelperApi,
  projectIdFromKey,
  classicConfigFromPage,
  withBackup,
  takeBackup,
};
