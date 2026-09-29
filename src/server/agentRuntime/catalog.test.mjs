import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { localDirectory } from './localRoutes.mjs';
import {
  CATALOG_PAYLOAD_SHA256,
  CATALOG_PROVIDERS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
  authUnsupported,
  catalogProvider,
  isProviderId,
} from './catalog.mjs';
import {
  availableModelId,
  effortOptions,
  modelAcceptsImage,
  publicCatalog,
  resolveModel,
  resolveModelRoute,
  resolveModels,
} from './registry.mjs';

describe('catalog registry', () => {
  it('exactly matches the pinned Harness provider and model inventory', () => {
    assert.equal(CATALOG_VERSION, 'harness-0.1.6-alpha.1/pi-ai-0.85.1/ff87cfcb3c1d+sp1');
    assert.equal(CATALOG_SOURCE.harnessVersion, '0.1.6-alpha.1');
    assert.equal(CATALOG_SOURCE.piAiVersion, '0.85.1');
    assert.equal(CATALOG_SOURCE.providerCount, 39);
    assert.equal(CATALOG_SOURCE.modelCount, 1354);
    assert.match(CATALOG_PAYLOAD_SHA256, /^[a-f0-9]{64}$/);
    const ids = CATALOG_PROVIDERS.map((p) => p.id);
    for (const id of ['deepseek', 'openai', 'openrouter', 'anthropic', 'amazon-bedrock', 'google-vertex', 'azure-openai-responses', 'openai-codex']) {
      assert.equal(ids.includes(id), true, id);
    }
    assert.equal(CATALOG_SOURCE.generatedProviderCount, 40);
    assert.equal(CATALOG_SOURCE.generatedModelCount, 1372);
    assert.equal(CATALOG_PROVIDERS.length, 40);
    assert.equal(CATALOG_PROVIDERS.reduce((sum, provider) => sum + provider.models.length, 0), 1372);
    for (const provider of CATALOG_PROVIDERS) {
      assert.equal(new Set(provider.models.map((model) => model.id)).size, provider.models.length);
      for (const modelId of Object.values(provider.defaultModels)) {
        if (modelId) assert.ok(provider.models.some((model) => model.id === modelId), `${provider.id}/${modelId}`);
      }
    }
  });

  it('adds Qwen DashScope with the complete Token Plan model inventory', () => {
    const source = catalogProvider('qwen-token-plan');
    const dashScope = catalogProvider('qwen-dashscope');
    assert.deepEqual(
      dashScope.models.map((model) => model.id),
      source.models.map((model) => model.id),
    );
    assert.equal(dashScope.models.length, 18);
    assert.equal(
      dashScope.models.every((model) => model.baseUrl === 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      true,
    );
  });

  it('marks native-auth providers as AUTH_UNSUPPORTED', () => {
    const blocked = authUnsupported('amazon-bedrock');
    assert.equal(blocked.code, 'AUTH_UNSUPPORTED');
    assert.equal(authUnsupported('deepseek'), null);
  });

  it('resolves vision from catalog input, not name regex', () => {
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-v4-flash-vision-exp'), true);
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-v4-pro'), false);
    assert.equal(resolveModel('openai', 'gpt-5.6-sol').vision, true);
    assert.equal(resolveModel('openai', 'gpt-5.6-sol').runtimeApi, 'openai-responses');
  });

  it('routes mixed and compatibility providers per model', () => {
    const openrouter = catalogProvider('openrouter');
    const anthropicModel = openrouter.models.find((model) => model.api === 'anthropic-messages');
    const openAiModel = openrouter.models.find((model) => model.api === 'openai-completions');
    assert.equal(resolveModelRoute('openrouter', anthropicModel.id).protocol, 'anthropic-messages');
    assert.equal(resolveModelRoute('openrouter', openAiModel.id).protocol, 'openai-completions');
    const google = resolveModelRoute('google', 'gemini-3.8-flash');
    assert.equal(google.protocol, 'google-generative-ai');
    assert.equal(google.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
    assert.equal(resolveModel('google', 'gemini-3.8-flash').api, 'google-generative-ai');
  });

  it('uses pi-ai thinking-level support instead of requiring a custom map', () => {
    assert.deepEqual(
      effortOptions('qwen-token-plan-cn', 'deepseek-v3.2'),
      ['off', 'minimal', 'low', 'medium', 'high'],
    );
    assert.deepEqual(
      Object.keys(resolveModel('deepseek', 'deepseek-v4-flash').reasoningEfforts),
      ['off', 'low', 'high', 'max'],
    );
  });

  it('inherits installed catalog models instead of stale profile snapshots', () => {
    const models = resolveModels('deepseek', {
      models: [{ id: 'deepseek-chat', name: 'Legacy snapshot' }],
    });
    assert.equal(models.length, 3);
    assert.equal(models.some((model) => model.id === 'deepseek-chat'), false);
    assert.equal(availableModelId('deepseek', 'deepseek-chat'), 'deepseek-v4-pro');
    assert.equal(
      availableModelId('deepseek', 'deepseek-vl', { vision: true }),
      'deepseek-v4-flash-vision-exp',
    );
  });

  it('exposes a public catalog without secrets', () => {
    const catalog = publicCatalog();
    assert.equal(isProviderId(catalog[0].id), true);
    assert.equal(JSON.stringify(catalog).includes('sk-'), false);
    assert.equal(catalog.find((p) => p.id === 'amazon-bedrock').configurable, false);
    assert.equal(publicCatalog({ summariesOnly: true }).every((provider) => provider.catalog.length === 0), true);
  });
});

describe('parity with SP-Survey-Platform', () => {
  // Same value as worker-lib/agent/runtime/catalog.generated.mjs in SP-Survey-Platform.
  const PLATFORM_PAYLOAD_SHA256 = 'a1f3f69fcc33bde63a9392dd787d41b5f809b5c8657f33114f6baa258f47afee';

  it('ships the exact catalog payload Platform ships', () => {
    assert.equal(CATALOG_PAYLOAD_SHA256, PLATFORM_PAYLOAD_SHA256);
  });

  it('matches a Platform checkout byte for byte when one is available', async (t) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const platformDir = process.env.SP_SURVEY_PLATFORM_DIR || resolve(here, '../../../../sp-survey-platform');
    const platformFile = resolve(platformDir, 'worker-lib/agent/runtime/catalog.generated.mjs');
    const platform = await readFile(platformFile, 'utf8').catch(() => null);
    if (platform == null) {
      t.skip('No SP-Survey-Platform checkout next to this repo');
      return;
    }
    assert.equal(await readFile(resolve(here, 'catalog.generated.mjs'), 'utf8'), platform);
  });

  it('reports the same reasoning levels as pi-ai for every model', () => {
    for (const provider of CATALOG_PROVIDERS) {
      for (const model of provider.models) {
        assert.deepEqual(
          effortOptions(provider.id, model.id),
          getSupportedThinkingLevels(resolveModel(provider.id, model.id)),
          `${provider.id}/${model.id}`,
        );
      }
    }
  });

  it('lists every API-key provider and model with no subsidized routes', () => {
    const store = {
      providers: Object.fromEntries(CATALOG_PROVIDERS.map((provider) => [
        provider.id,
        { provider: provider.id, apiKey: 'sk-test-0000', hint: 'sk-t…0000' },
      ])),
    };
    const directory = localDirectory(store);
    assert.equal(directory.length, 40);
    for (const row of directory) {
      const source = catalogProvider(row.id);
      assert.equal(row.displayName, source.displayName);
      assert.equal(row.group, source.group);
      assert.deepEqual(row.defaultModels, source.defaultModels);
      assert.equal('shared' in row, false);
      if (row.authUnsupported) continue;
      assert.equal(row.models.length, source.models.length, row.id);
      for (const model of row.models) {
        const raw = source.models.find((item) => item.id === model.id);
        assert.equal(model.vision, raw.input.includes('image'), `${row.id}/${model.id} vision`);
        assert.equal(model.tools, true);
        assert.equal('shared' in model, false);
      }
    }
    const routable = directory
      .filter((row) => !row.authUnsupported)
      .reduce((sum, row) => sum + row.models.filter((model) => model.runtimeSupported).length, 0);
    assert.equal(routable, 1094);
    assert.equal(JSON.stringify(directory).includes('sk-test-0000'), false);
  });
});
