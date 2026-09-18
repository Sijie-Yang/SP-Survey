/* global globalThis */
import { PLATFORM_SCHEMA } from './platformSchema/index.js';

// Store only the response contract, never integration credentials or dataset secrets.
const CONTRACT_KEYS = PLATFORM_SCHEMA.responseContract.questionKeys;
const SKILL_CONFIG_KEYS = PLATFORM_SCHEMA.responseContract.skillConfigKeys;
const STATIC_MEDIA_KEYS = PLATFORM_SCHEMA.responseContract.staticMediaKeys;

export function surveyResponseContract(config, resolvedConfig = null) {
  const resolved = new Map((resolvedConfig?.pages || []).flatMap((p) => p.elements || []).map((q) => [q.name, q]));
  const contract = {
    version: PLATFORM_SCHEMA.responseContract.version,
    title: config?.title || '',
    locale: config?.locale || 'en',
    questions: (config?.pages || []).flatMap((p) => p.elements || []).map((q) => {
      const live = resolved.get(q.name);
      if (q.type === 'skillquestion' && live) {
        q = { ...q, ...Object.fromEntries(['skillId', 'skillRevision', 'skillContractVersion', 'skillResultSchema', 'skillConfig']
          .filter((k) => live[k] !== undefined).map((k) => [k, live[k]])) };
      }
      const result = Object.fromEntries([...CONTRACT_KEYS, ...STATIC_MEDIA_KEYS].filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));
      if (q.type === 'skillquestion' && q.skillConfig) {
        result.skillConfig = Object.fromEntries(SKILL_CONFIG_KEYS.filter((k) => q.skillConfig[k] !== undefined).map((k) => [k, q.skillConfig[k]]));
      }
      return result;
    }),
  };
  return JSON.parse(JSON.stringify(contract));
}

function encodeContractBytes(contract) {
  const json = JSON.stringify(contract);
  if (globalThis.TextEncoder) return new TextEncoder().encode(json);
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i += 1) bytes[i] = json.charCodeAt(i) & 255;
  return bytes;
}

export async function surveyRevision(config, resolvedConfig = null) {
  const contract = surveyResponseContract(config, resolvedConfig);
  const data = encodeContractBytes(contract);
  if (!globalThis.crypto?.subtle) {
    // Local phone testing over HTTP may not provide Web Crypto; never block a survey.
    let a = 2166136261; let b = 3339675911;
    for (const byte of data) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 2246822519); }
    return { id: 'contract-v1:' + (a >>> 0).toString(16) + (b >>> 0).toString(16), contract };
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return { id: 'sha256:' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''), contract };
}
