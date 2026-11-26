/** Self-hosted: one chat completion through aiClient.js with the researcher's own key. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveAiRequest, aiChat } = require('../../../../aiClient');

export async function chatCompletions({
  apiKey, provider, baseUrl, model, protocol, temperature, maxTokens, messages,
}) {
  const resolved = resolveAiRequest(apiKey, { provider, baseUrl: baseUrl || undefined, protocol });
  const completion = await aiChat(resolved, 'default', {
    model,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });
  const message = completion?.choices?.[0]?.message || {};
  return { content: typeof message.content === 'string' ? message.content : '', usage: completion?.usage || null };
}
