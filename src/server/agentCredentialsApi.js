const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = process.env.SP_SURVEY_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'ai-credentials.json');

function hintFor(key) {
  const value = String(key || '');
  if (value.length < 8) return value ? '••••' : '';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function emptyStore() {
  return {
    providers: {},
    settings: {
      assistant_provider: '',
      assistant_model: '',
      assistant_reasoning_effort: '',
      silicon_provider: '',
      silicon_model: '',
      silicon_reasoning_effort: '',
    },
  };
}

async function loadCatalog() {
  return import('./agentRuntime/catalog.mjs');
}

async function loadRuntime() {
  const [catalog, registry, routes, ssrf] = await Promise.all([
    import('./agentRuntime/catalog.mjs'),
    import('./agentRuntime/registry.mjs'),
    import('./agentRuntime/localRoutes.mjs'),
    import('./agentRuntime/ssrf.mjs'),
  ]);
  return { catalog, registry, routes, ssrf };
}

async function readStore() {
  await fs.ensureDir(DATA_DIR);
  if (!await fs.pathExists(STORE_PATH)) return emptyStore();
  try {
    return { ...emptyStore(), ...JSON.parse(await fs.readFile(STORE_PATH, 'utf8')) };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store) {
  await fs.ensureDir(DATA_DIR);
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function routeFor({ registry, routes }, store, directory, kind) {
  const settings = store.settings || {};
  const vision = kind === 'silicon';
  const configured = directory.filter((row) => row.configured && row.userConfigured);
  const preferred = vision
    ? (settings.silicon_provider || settings.default_provider || settings.assistant_provider)
    : (settings.assistant_provider || settings.default_provider);
  const provider = configured.find((row) => row.id === preferred) || configured[0] || null;
  if (!provider) return null;
  const saved = store.providers?.[provider.id];
  const profile = saved ? routes.profileFromSaved(saved) : {};
  const requested = provider.id === preferred
    ? (vision ? settings.silicon_model : settings.assistant_model)
    : '';
  return {
    provider: provider.id,
    model: registry.availableModelId(provider.id, requested, { profile, vision }),
    reasoningEffort: (vision ? settings.silicon_reasoning_effort : settings.assistant_reasoning_effort) || null,
  };
}

const SAVED_PROVIDER_FIELDS = ['baseUrl', 'displayName', 'protocol', 'models', 'custom', 'retryPolicy', 'compat', 'defaultInput'];

function registerAgentCredentialsApi(app) {
  app.get('/api/agent/credentials/status', async (_req, res) => {
    try {
      const runtime = await loadRuntime();
      const { catalog, registry, routes } = runtime;
      const store = await readStore();
      const directory = routes.localDirectory(store);
      const configured = directory.filter((row) => row.configured && row.userConfigured);
      const settings = store.settings || {};
      const defaultRoute = routeFor(runtime, store, directory, 'assistant');
      const siliconRoute = routeFor(runtime, store, directory, 'silicon');
      res.json({
        success: true,
        catalogVersion: catalog.CATALOG_VERSION,
        catalog: registry.publicCatalog({ summariesOnly: true }),
        directory,
        configuredProviders: configured.map((row) => row.id),
        assistantConfigured: configured.length > 0,
        openai: { configured: configured.some((row) => row.id === 'openai') },
        defaultRoute,
        siliconRoute,
        settings: {
          ...settings,
          ...(defaultRoute ? { assistant_model: defaultRoute.model } : {}),
          ...(siliconRoute ? { silicon_model: siliconRoute.model } : {}),
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/agent/credentials/providers', async (req, res) => {
    try {
      const catalog = await loadCatalog();
      res.json({
        success: true,
        catalogVersion: catalog.CATALOG_VERSION,
        protocols: catalog.PROTOCOLS,
        providers: (await import('./agentRuntime/registry.mjs')).publicCatalog({
          providerId: req.query.provider || null,
          summariesOnly: !req.query.provider,
        }),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/agent/credentials/providers', async (req, res) => {
    try {
      const catalog = await loadCatalog();
      const provider = String(req.body?.provider || '').trim();
      if (!catalog.isProviderId(provider)) {
        return res.status(400).json({ success: false, error: 'Invalid provider id' });
      }
      const store = await readStore();
      const previous = store.providers[provider] || {};
      const apiKey = String(req.body?.apiKey || previous.apiKey || '').trim();
      if (!apiKey && catalog.isApiKeyAuth(provider)) {
        return res.status(400).json({ success: false, error: 'API key is required' });
      }
      const { authUnsupported } = catalog;
      const unsupported = authUnsupported(provider);
      if (unsupported) {
        return res.status(400).json({ success: false, error: unsupported.message, code: unsupported.code });
      }
      const installed = Boolean(catalog.catalogProvider(provider));
      const custom = !installed;
      if (custom && !String(req.body?.baseUrl || previous.baseUrl || '').trim()) {
        return res.status(400).json({ success: false, error: 'A custom provider needs a base URL.', code: 'BASE_URL_REQUIRED' });
      }
      if (req.body?.baseUrl) {
        const { assertSafeBaseUrl } = await import('./agentRuntime/ssrf.mjs');
        try {
          assertSafeBaseUrl(req.body.baseUrl);
        } catch (error) {
          return res.status(400).json({ success: false, error: error.message, code: error.code });
        }
      }
      const next = { ...previous, provider, apiKey, hint: hintFor(apiKey), custom };
      SAVED_PROVIDER_FIELDS.forEach((field) => {
        if (field === 'custom' || req.body?.[field] === undefined) return;
        next[field] = req.body[field];
      });
      if (installed) {
        delete next.protocol;
        delete next.models;
        delete next.displayName;
      } else {
        next.protocol = next.protocol || 'openai-completions';
        next.models = Array.isArray(next.models) ? next.models : [];
      }
      next.updatedAt = new Date().toISOString();
      store.providers[provider] = next;
      if (!store.settings.assistant_provider) store.settings.assistant_provider = provider;
      if (!store.settings.silicon_provider) store.settings.silicon_provider = provider;
      await writeStore(store);
      res.json({ success: true, provider, hint: hintFor(apiKey) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/agent/credentials/providers/:provider', async (req, res) => {
    const store = await readStore();
    delete store.providers[req.params.provider];
    await writeStore(store);
    res.json({ success: true });
  });

  app.put('/api/agent/credentials/settings', async (req, res) => {
    const store = await readStore();
    store.settings = { ...store.settings, ...(req.body || {}) };
    await writeStore(store);
    res.json({ success: true, settings: store.settings });
  });

  app.put('/api/agent/credentials/profiles', async (req, res) => {
    const store = await readStore();
    const provider = String(req.body?.provider || '').trim();
    if (!provider) return res.status(400).json({ success: false, error: 'provider is required' });
    const patch = Object.fromEntries(SAVED_PROVIDER_FIELDS
      .filter((field) => req.body?.[field] !== undefined)
      .map((field) => [field, req.body[field]]));
    store.providers[provider] = {
      ...(store.providers[provider] || {}),
      ...patch,
      provider,
      updatedAt: new Date().toISOString(),
    };
    await writeStore(store);
    res.json({ success: true, provider });
  });

  app.get('/api/agent/credentials/models', async (req, res) => {
    try {
      const { registry, routes } = await loadRuntime();
      const providerId = String(req.query.provider || '');
      const store = await readStore();
      const saved = store.providers?.[providerId];
      res.json({
        success: true,
        source: 'catalog',
        models: registry.resolveModels(providerId, saved ? routes.profileFromSaved(saved) : {}),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/agent/credentials/models', async (req, res) => {
    try {
      const { catalog, registry, ssrf } = await loadRuntime();
      const providerId = String(req.body?.provider || '');
      if (catalog.catalogProvider(providerId)) {
        return res.json({
          success: true,
          fetched: false,
          source: 'catalog',
          models: registry.resolveModels(providerId),
        });
      }
      const protocol = req.body?.protocol || 'openai-completions';
      if (protocol !== 'openai-completions' && protocol !== 'openai-responses') {
        return res.json({ success: false, code: 'DISCOVERY_UNSUPPORTED', error: 'This protocol does not support model discovery.' });
      }
      const store = await readStore();
      const saved = store.providers?.[providerId] || {};
      const apiKey = String(req.body?.apiKey || saved.apiKey || '').trim();
      let endpoint;
      try {
        endpoint = ssrf.assertSafeBaseUrl(req.body?.baseUrl || saved.baseUrl);
      } catch (error) {
        return res.status(400).json({ success: false, code: error.code, error: error.message });
      }
      const response = await fetch(`${endpoint}/models`, {
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...catalog.extraHeaders(providerId),
        },
        redirect: 'manual',
      });
      ssrf.assertProviderResponseNotRedirect(response);
      if (!response.ok) {
        return res.json({
          success: false,
          code: response.status === 401 ? 'MISSING_CREDENTIAL' : 'DISCOVERY_FAILED',
          error: `Discovery failed (${response.status}).`,
        });
      }
      const body = await response.json().catch(() => null);
      const rows = body?.data || body?.models;
      if (!Array.isArray(rows)) {
        return res.json({ success: false, code: 'MALFORMED_JSON', error: 'Provider returned malformed JSON.' });
      }
      const models = rows.filter((row) => row?.id).map((row) => catalog.normalizeModelRecord({
        id: row.id,
        name: row.name || row.display_name || row.id,
        contextWindow: row.context_window || row.context_length,
        maxTokens: row.max_output_tokens || row.max_tokens,
        input: row.architecture?.input_modalities?.includes('image') ? ['text', 'image'] : ['text'],
      }, { provider: providerId }));
      res.json({ success: true, fetched: true, models, empty: models.length === 0 });
    } catch (error) {
      res.status(400).json({ success: false, code: error.code || 'DISCOVERY_FAILED', error: error.message });
    }
  });
}

module.exports = {
  registerAgentCredentialsApi,
  readStore,
  hintFor,
  STORE_PATH,
};
