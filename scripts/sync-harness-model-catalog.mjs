#!/usr/bin/env node
/**
 * Deterministically materialize the model catalog consumed by the Worker.
 *
 * DeepSeek Harness 0.1.6-alpha.1 resolves its built-in providers through
 * @earendil-works/pi-ai 0.85.1. We read that exact installed npm artifact,
 * retain the model facts SP-Survey needs, and check in the result so requests
 * never depend on npm, GitHub, or models.dev.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  builtinProviders,
  getBuiltinModels,
  getBuiltinProviders,
} from '@earendil-works/pi-ai/providers/all';

const HARNESS_VERSION = '0.1.6-alpha.1';
const HARNESS_COMMIT = '0a15e36e7f82b6ed45af6fa9759f29b40dcd965d';
const PI_AI_VERSION = '0.85.1';
const PI_AI_COMMIT = 'd981de1229ef899957bbe968bc8dcda02a21f477';
const PI_AI_INTEGRITY = 'sha512-+VgVIJDkDO2efYJKEEqvPTH4zmnIaXdAppGbO+vKFA9qy5PdhFiAenuFAkU+oiCSfOC4dMHDyrjdQeL4ZoC5CQ==';
const EXPECTED_PROVIDER_COUNT = 39;
const EXPECTED_MODEL_COUNT = 1354;
const SUPPORTED_RUNTIME_APIS = new Set([
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
  'openai-completions',
  'openai-responses',
]);

const NATIVE_AUTH = {
  'amazon-bedrock': {
    auth: 'aws',
    authHint: 'Requires AWS credentials and a region. An API key alone cannot configure Bedrock.',
  },
  'google-vertex': {
    auth: 'adc',
    authHint: 'Requires Application Default Credentials and a GCP project. An API key alone cannot configure Vertex.',
  },
  'azure-openai-responses': {
    auth: 'azure',
    authHint: 'Requires an Azure resource, deployment name, and api-version. An API key field alone is not enough.',
  },
  'openai-codex': {
    auth: 'oauth',
    authHint: 'Uses ChatGPT / Codex OAuth. An API key field does not configure this provider.',
  },
  'github-copilot': {
    auth: 'oauth',
    authHint: 'Uses GitHub Copilot OAuth. An API key field does not configure this provider.',
  },
};

const KEY_DOCS = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
  together: 'https://api.together.ai/',
  mistral: 'https://console.mistral.ai/api-keys',
  moonshotai: 'https://platform.moonshot.ai/console/api-keys',
  'moonshotai-cn': 'https://platform.moonshot.cn/console/api-keys',
  minimax: 'https://platform.minimax.io',
  'minimax-cn': 'https://platform.minimaxi.com',
  xai: 'https://console.x.ai',
  zai: 'https://z.ai',
  'zai-coding-cn': 'https://open.bigmodel.cn',
  cerebras: 'https://cloud.cerebras.ai',
  huggingface: 'https://huggingface.co/settings/tokens',
  nvidia: 'https://build.nvidia.com',
  baseten: 'https://app.baseten.co',
  'kimi-coding': 'https://www.kimi.com/code',
  'qwen-token-plan': 'https://www.alibabacloud.com/help/en/model-studio',
  'qwen-token-plan-cn': 'https://help.aliyun.com/zh/model-studio',
  'qwen-token-plan-individual': 'https://www.alibabacloud.com/help/en/model-studio',
  'vercel-ai-gateway': 'https://vercel.com/docs/ai-gateway',
  'cloudflare-ai-gateway': 'https://developers.cloudflare.com/ai-gateway/',
  'cloudflare-workers-ai': 'https://developers.cloudflare.com/workers-ai/',
};

const DEFAULT_MODELS = {
  deepseek: { assistant: 'deepseek-v4-pro', silicon: 'deepseek-v4-flash-vision-exp' },
  openai: { assistant: 'gpt-5.6-sol', silicon: 'gpt-5.6-sol' },
  openrouter: { assistant: 'openai/gpt-5.6-sol', silicon: 'openai/gpt-5.6-sol' },
  anthropic: { assistant: 'claude-sonnet-5', silicon: 'claude-sonnet-5' },
  google: { assistant: 'gemini-3.8-flash', silicon: 'gemini-3.8-flash' },
  mistral: { assistant: 'mistral-large-latest', silicon: 'pixtral-large-latest' },
  minimax: { assistant: 'MiniMax-M3', silicon: 'MiniMax-M3' },
  'minimax-cn': { assistant: 'MiniMax-M3', silicon: 'MiniMax-M3' },
  'kimi-coding': { assistant: 'k3', silicon: 'k3' },
  moonshotai: { assistant: 'kimi-k3', silicon: 'kimi-k3' },
  'moonshotai-cn': { assistant: 'kimi-k3', silicon: 'kimi-k3' },
  xai: { assistant: 'grok-4.6', silicon: 'grok-4.6' },
};

function runtimeRoute(model) {
  if (SUPPORTED_RUNTIME_APIS.has(model.api)) {
    return { runtimeApi: model.api, runtimeBaseUrl: model.baseUrl };
  }
  return { runtimeApi: null, runtimeBaseUrl: model.baseUrl };
}

function compactModel(providerId, model) {
  const route = runtimeRoute(model);
  const out = {
    id: model.id,
    name: model.name,
    api: model.api,
    provider: model.provider || providerId,
    baseUrl: model.baseUrl,
    runtimeApi: route.runtimeApi,
    runtimeBaseUrl: route.runtimeBaseUrl,
    reasoning: Boolean(model.reasoning),
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
  if (model.thinkingLevelMap) out.thinkingLevelMap = model.thinkingLevelMap;
  if (model.samplingParams && Object.keys(model.samplingParams).length) {
    out.samplingParams = model.samplingParams;
  }
  if (model.compat && Object.keys(model.compat).length) out.compat = model.compat;
  if (model.headers && Object.keys(model.headers).length) out.headers = model.headers;
  return out;
}

function fallbackDefaults(models) {
  const assistant = models.find((model) => model.runtimeApi && model.reasoning)
    || models.find((model) => model.runtimeApi)
    || null;
  const silicon = models.find((model) => model.runtimeApi && model.input?.includes('image')) || null;
  return {
    assistant: assistant?.id || '',
    silicon: silicon?.id || '',
  };
}

function checkedDefaults(providerId, models) {
  const defaults = { ...fallbackDefaults(models), ...(DEFAULT_MODELS[providerId] || {}) };
  const ids = new Set(models.map((model) => model.id));
  for (const [kind, id] of Object.entries(defaults)) {
    if (id && !ids.has(id)) {
      throw new Error(`Default ${providerId}.${kind} refers to missing model ${id}`);
    }
  }
  return defaults;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

const providerModulePath = fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/providers/all'));
const packageRoot = resolve(dirname(providerModulePath), '..', '..');
const packagePath = resolve(packageRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.version !== PI_AI_VERSION) {
  throw new Error(`Expected pi-ai ${PI_AI_VERSION}, found ${packageJson.version}`);
}
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'dist/providers/data/.manifest.json'), 'utf8'));
const providerObjects = new Map(builtinProviders().map((provider) => [provider.id, provider]));
const providerIds = [...getBuiltinProviders()].sort();
const providers = providerIds.map((id) => {
  const provider = providerObjects.get(id);
  if (!provider) throw new Error(`Missing provider factory for ${id}`);
  const models = getBuiltinModels(id)
    .map((model) => compactModel(id, model))
    .sort((a, b) => a.id.localeCompare(b.id));
  const native = NATIVE_AUTH[id];
  return {
    id,
    displayName: provider.name || id,
    group: native ? 'native-auth' : (id === 'deepseek' ? 'recommended' : 'catalog'),
    auth: native?.auth || 'api-key',
    protocol: models.find((model) => model.runtimeApi)?.runtimeApi || models[0]?.api || 'openai-completions',
    defaultBaseUrl: provider.baseUrl || models.find((model) => model.runtimeBaseUrl)?.runtimeBaseUrl || '',
    recommended: id === 'deepseek',
    ...(KEY_DOCS[id] ? { keyDocs: KEY_DOCS[id] } : {}),
    ...(native?.authHint ? { authHint: native.authHint } : {}),
    defaultModels: checkedDefaults(id, models),
    models,
  };
});

const upstreamModelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
if (providers.length !== EXPECTED_PROVIDER_COUNT || upstreamModelCount !== EXPECTED_MODEL_COUNT) {
  throw new Error(`Unexpected upstream catalog size: ${providers.length} providers, ${upstreamModelCount} models`);
}

const dashScopeBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const qwenTokenPlan = providers.find((provider) => provider.id === 'qwen-token-plan');
if (!qwenTokenPlan) throw new Error('Qwen Token Plan provider is missing');
providers.push({
  ...qwenTokenPlan,
  id: 'qwen-dashscope',
  displayName: 'Qwen DashScope',
  defaultBaseUrl: dashScopeBaseUrl,
  keyDocs: 'https://help.aliyun.com/zh/model-studio/get-api-key',
  models: qwenTokenPlan.models.map((model) => ({
    ...model,
    provider: 'qwen-dashscope',
    baseUrl: dashScopeBaseUrl,
    runtimeBaseUrl: dashScopeBaseUrl,
  })),
});
providers.sort((a, b) => a.id.localeCompare(b.id));

const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
const duplicate = providers.flatMap((provider) => {
  const ids = provider.models.map((model) => model.id);
  return ids.length === new Set(ids).size ? [] : [provider.id];
});
if (duplicate.length) throw new Error(`Duplicate model IDs in: ${duplicate.join(', ')}`);

const source = stable({
  harnessVersion: HARNESS_VERSION,
  harnessCommit: HARNESS_COMMIT,
  piAiVersion: PI_AI_VERSION,
  piAiCommit: PI_AI_COMMIT,
  piAiIntegrity: PI_AI_INTEGRITY,
  generatedAt: manifest.generatedAt,
  structureHash: manifest.structureHash,
  providerCount: EXPECTED_PROVIDER_COUNT,
  modelCount: EXPECTED_MODEL_COUNT,
  generatedProviderCount: providers.length,
  generatedModelCount: modelCount,
  extensions: [{
    id: 'qwen-dashscope',
    derivedFrom: 'qwen-token-plan',
    modelCount: qwenTokenPlan.models.length,
  }],
});
const payload = stable(providers);
const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const version = `harness-${HARNESS_VERSION}/pi-ai-${PI_AI_VERSION}/${manifest.structureHash.slice(0, 12)}+sp1`;
const output = `/**\n * Generated by scripts/sync-harness-model-catalog.mjs from the pinned pi-ai\n * npm artifact used by DeepSeek Harness. Do not edit by hand.\n */\n\nexport const CATALOG_VERSION = ${JSON.stringify(version)};\nexport const CATALOG_SOURCE = ${JSON.stringify(source, null, 2)};\nexport const CATALOG_PAYLOAD_SHA256 = ${JSON.stringify(payloadHash)};\nexport const CATALOG_PROVIDERS = ${JSON.stringify(payload, null, 2)};\n`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(repoRoot, 'src/server/agentRuntime/catalog.generated.mjs');
const current = await readFile(outputPath, 'utf8').catch(() => '');
const check = process.argv.includes('--check');
if (check) {
  if (current !== output) {
    console.error('Harness model catalog is stale. Run: npm run catalog:sync');
    process.exitCode = 1;
  }
} else if (current !== output) {
  await writeFile(outputPath, output);
}

// SP-Survey-Platform generates the same file from the same pinned artifact.
// Pass --platform <checkout> (or SP_SURVEY_PLATFORM_DIR) to prove the two match.
const platformFlag = process.argv.indexOf('--platform');
const platformDir = platformFlag >= 0 ? process.argv[platformFlag + 1] : process.env.SP_SURVEY_PLATFORM_DIR;
let platformMatch = null;
if (platformDir) {
  const platformPath = resolve(platformDir, 'worker-lib/agent/runtime/catalog.generated.mjs');
  const platformCatalog = await readFile(platformPath, 'utf8').catch(() => null);
  platformMatch = platformCatalog === output;
  if (!platformMatch) {
    console.error(platformCatalog == null
      ? `Platform catalog not found at ${platformPath}`
      : 'Model catalog differs from SP-Survey-Platform. Update the pinned pi-ai version in both repos.');
    process.exitCode = 1;
  }
}
console.log(JSON.stringify({
  version,
  providers: providers.length,
  models: modelCount,
  payloadHash,
  changed: current !== output,
  check,
  ...(platformDir ? { platformMatch } : {}),
}, null, 2));
