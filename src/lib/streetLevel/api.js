/** Browser calls for the street-level panel that go to the Platform (Worker / Express bridge). */

import { authHeaders, getR2ServerUrl } from '../r2';

/** Resolve maps.app.goo.gl links server-side (redirect headers only). */
export async function expandShortLinks(urls) {
  const res = await fetch(`${getR2ServerUrl()}/api/street-level/expand`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* ignore */ }
    throw new Error(`Short link expansion HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const body = await res.json();
  return Array.isArray(body?.results) ? body.results : [];
}

/** Bearer token of the signed-in browser session ('' in local file mode). */
export async function currentAccessToken() {
  const headers = await authHeaders();
  return String(headers.Authorization || '').replace(/^Bearer\s+/i, '');
}
