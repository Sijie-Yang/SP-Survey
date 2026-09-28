const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
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

function publicCatalog(catalog, { providerId = null, summariesOnly = false } = {}) {
  return catalog.listCatalogProviders()
    .filter((provider) => !providerId || provider.id === providerId)
    .map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      label: provider.displayName,
      recommended: !!provider.recommended,
      auth: provider.auth,
      authHint: provider.authHint || null,
      protocol: provider.protocol,
      defaultBaseUrl: provider.defaultBaseUrl,
      keyDocs: provider.keyDocs || null,
      group: provider.group,
      configurable: catalog.isApiKeyAuth(provider.id),
      defaultModels: provider.defaultModels,
      modelCount: (provider.models || []).length,
      catalog: summariesOnly
        ? []
        : (provider.models || []).map((model) => catalog.normalizeModelRecord(model)),
    }));
}

function directoryFromStore(catalog, store) {
  const creds = store.providers || {};
  return catalog.listCatalogProviders().map((provider) => {
    const saved = creds[provider.id] || null;
    const models = (saved?.models?.length
      ? saved.models
      : (saved || provider.recommended) ? (provider.models || []) : [])
      .map((model) => catalog.normalizeModelRecord(model, { provider: provider.id }));
    return {
      id: provider.id,
      displayName: saved?.displayName || provider.displayName,
      label: saved?.displayName || provider.displayName,
      recommended: !!provider.recommended,
      auth: provider.auth,
      authHint: provider.authHint || null,
      protocol: saved?.protocol || provider.protocol || 'openai-completions',
      defaultBaseUrl: provider.defaultBaseUrl,
      baseUrl: saved?.baseUrl || provider.defaultBaseUrl || '',
      keyDocs: provider.keyDocs || null,
      group: provider.group,
      configurable: catalog.isApiKeyAuth(provider.id),
      configured: Boolean(saved?.apiKey),
      userConfigured: Boolean(saved?.apiKey),
      custom: Boolean(saved?.custom),
      hint: saved?.hint || '',
      defaultModels: provider.defaultModels,
      models,
      modelCount: (provider.models || []).length,
      catalog: Boolean(provider.models?.length),
    };
  });
}

function resolveProviderRequest(store, { provider, apiKey, baseUrl, model } = {}) {
  const saved = (provider && store.providers?.[provider]) || null;
  const key = String(apiKey || saved?.apiKey || '').trim();
  if (!key) return null;
  const resolvedProvider = provider || saved?.provider || (key.startsWith('sk-or-') ? 'openrouter' : 'openai');
  return {
    provider: resolvedProvider,
    apiKey: key,
    baseUrl: baseUrl || saved?.baseUrl || '',
    protocol: saved?.protocol || 'openai-completions',
    model: model || '',
    headers: saved?.headers || {},
  };
}

function registerAgentCredentialsApi(app) {
  app.get('/api/agent/credentials/status', async (_req, res) => {
    try {
      const catalog = await loadCatalog();
      const store = await readStore();
      const directory = directoryFromStore(catalog, store);
      const configured = directory.filter((row) => row.configured && row.userConfigured);
      const settings = store.settings || {};
      const assistantProvider = settings.assistant_provider || configured[0]?.id || '';
      const siliconProvider = settings.silicon_provider || configured[0]?.id || '';
      const assistant = directory.find((row) => row.id === assistantProvider) || configured[0] || null;
      const silicon = directory.find((row) => row.id === siliconProvider) || configured[0] || null;
      res.json({
        success: true,
        catalogVersion: catalog.CATALOG_VERSION,
        catalog: publicCatalog(catalog, { summariesOnly: true }),
        directory,
        configuredProviders: configured.map((row) => row.id),
        assistantConfigured: configured.length > 0,
        openai: { configured: configured.some((row) => row.id === 'openai') },
        defaultRoute: assistant ? {
          provider: assistant.id,
          model: settings.assistant_model || assistant.defaultModels?.assistant || assistant.models[0]?.id || '',
          reasoningEffort: settings.assistant_reasoning_effort || null,
        } : null,
        siliconRoute: silicon ? {
          provider: silicon.id,
          model: settings.silicon_model || silicon.defaultModels?.silicon || silicon.models[0]?.id || '',
          reasoningEffort: settings.silicon_reasoning_effort || null,
        } : null,
        settings,
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
        providers: publicCatalog(catalog, {
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
      store.providers[provider] = {
        provider,
        apiKey,
        hint: hintFor(apiKey),
        baseUrl: req.body?.baseUrl || previous.baseUrl || '',
        displayName: req.body?.displayName || previous.displayName || '',
        protocol: req.body?.protocol || previous.protocol || 'openai-completions',
        models: Array.isArray(req.body?.models) ? req.body.models : (previous.models || []),
        custom: Boolean(req.body?.custom),
        retryPolicy: req.body?.retryPolicy || previous.retryPolicy || null,
        updatedAt: new Date().toISOString(),
      };
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
    store.providers[provider] = {
      ...(store.providers[provider] || {}),
      ...req.body,
      provider,
      updatedAt: new Date().toISOString(),
    };
    await writeStore(store);
    res.json({ success: true, provider });
  });

  app.get('/api/agent/credentials/models', async (req, res) => {
    try {
      const catalog = await loadCatalog();
      const providerId = String(req.query.provider || '');
      const provider = catalog.catalogProvider(providerId);
      res.json({
        success: true,
        models: (provider?.models || []).map((model) => catalog.normalizeModelRecord(model, { provider: providerId })),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/agent/credentials/models', async (req, res) => {
    try {
      const catalog = await loadCatalog();
      const providerId = String(req.body?.provider || '');
      const provider = catalog.catalogProvider(providerId);
      const baseUrl = req.body?.baseUrl || provider?.defaultBaseUrl;
      const apiKey = String(req.body?.apiKey || '').trim();
      if (!apiKey || !baseUrl) {
        return res.json({
          success: true,
          models: (provider?.models || []).map((model) => catalog.normalizeModelRecord(model, { provider: providerId })),
        });
      }
      const url = new URL(baseUrl.replace(/\/$/, ''));
      if (!url.pathname.endsWith('/models')) url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...catalog.extraHeaders(providerId),
        },
      });
      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          code: response.status === 401 ? 'MISSING_CREDENTIAL' : 'DISCOVERY_UNSUPPORTED',
          error: `Provider returned ${response.status}`,
        });
      }
      const body = await response.json();
      const models = (body.data || body.models || []).map((model) => catalog.normalizeModelRecord({
        id: model.id,
        name: model.name || model.id,
        input: model.architecture?.input_modalities || ['text'],
      }, { provider: providerId }));
      res.json({ success: true, models });
    } catch (error) {
      res.status(400).json({ success: false, code: 'MALFORMED_JSON', error: error.message });
    }
  });
}

module.exports = {
  registerAgentCredentialsApi,
  readStore,
  resolveProviderRequest,
  hintFor,
};
