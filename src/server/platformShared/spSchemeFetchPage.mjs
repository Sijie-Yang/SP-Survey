/**
 * Fetch a published survey page (for SP-Scheme conversion) on the server, so
 * the browser is not stopped by CORS. Same-site scripts and stylesheets are
 * inlined, a <base> keeps the site's other relative URLs (images, data)
 * pointing at the original site, and small same-site data files the scripts
 * mention are returned for the model to read.
 */

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_ASSET_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DATA_FILES = 20;
const MAX_DATA_BYTES = 200 * 1024;

const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

function fail(message, status = 400, code = 'FETCH_PAGE_FAILED') {
  return Object.assign(new Error(message), { status, code });
}

/** Public http(s) URLs only. */
export function checkPublicUrl(raw) {
  let url;
  try {
    const text = String(raw || '').trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw fail('Enter a full web address, like https://example.org/survey/.');
  }
  if (!/^https?:$/.test(url.protocol)) throw fail('Only http and https addresses can be imported.');
  if (PRIVATE_HOST_RE.test(url.hostname) || !url.hostname.includes('.')) throw fail('This address is not a public web page.');
  url.hash = '';
  return url;
}

async function readLimited(response, limit) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw fail(`The file is larger than ${Math.round(limit / 1048576)} MB.`, 413, 'TOO_LARGE');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > limit) throw fail(`The file is larger than ${Math.round(limit / 1048576)} MB.`, 413, 'TOO_LARGE');
  return buffer;
}

async function getText(fetchImpl, url, limit) {
  const response = await fetchImpl(url.href, { redirect: 'follow', headers: { 'User-Agent': 'SP-Survey page import', Accept: '*/*' } });
  if (!response.ok) throw fail(`${url.href} answered ${response.status}.`, 502);
  const buffer = await readLimited(response, limit);
  return { text: new TextDecoder().decode(buffer), finalUrl: new URL(response.url || url.href), type: response.headers.get('content-type') || '' };
}

function escapeScript(text) {
  return String(text).replace(/<\/script/gi, '<\\/script');
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

/** Quoted relative or same-site paths to data files mentioned in code. */
function dataPathsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/["'`]((?:\.{0,2}\/)?[\w\-./%]+\.(?:json|csv|tsv|txt))(?:\?[^"'`]*)?["'`]/gi)) {
    if (!/^(https?:)?\/\//i.test(m[1])) out.add(m[1]);
  }
  return [...out];
}

/**
 * @returns {{ html, url, host, inlined: string[], dataFiles: { name, text }[], skipped: string[] }}
 */
export async function handleSpSchemeFetchPage(body, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const start = checkPublicUrl(body?.url);
  const page = await getText(fetchImpl, start, MAX_PAGE_BYTES);
  const pageUrl = page.finalUrl;
  if (!/html/i.test(page.type) && !/<(html|body|script|div)\b/i.test(page.text)) {
    throw fail('That address did not return a web page.');
  }
  const sameSite = (u) => u.host === pageUrl.host;
  const inlined = [];
  const skipped = [];
  let total = 0;
  const assetText = async (ref) => {
    let url;
    try { url = new URL(ref, pageUrl); } catch { return null; }
    if (!sameSite(url)) return null;
    if (total > MAX_TOTAL_BYTES) { skipped.push(url.href); return null; }
    try {
      const { text } = await getText(fetchImpl, url, MAX_ASSET_BYTES);
      total += text.length;
      inlined.push(url.pathname);
      return text;
    } catch {
      skipped.push(url.href);
      return null;
    }
  };

  let html = page.text;
  const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi)].map((m) => m[0]);
  const styleTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => /\brel\s*=\s*["']?stylesheet/i.test(tag));
  const scripts = [];
  for (const tag of scriptTags) {
    // eslint-disable-next-line no-await-in-loop
    const text = await assetText(attr(tag, 'src'));
    if (text == null) continue;
    scripts.push(text);
    const type = attr(tag, 'type');
    html = html.replace(tag, () => `<script${type ? ` type="${type}"` : ''} data-sp-inlined="${attr(tag, 'src')}">${escapeScript(text)}</script>`);
  }
  for (const tag of styleTags) {
    // eslint-disable-next-line no-await-in-loop
    const text = await assetText(attr(tag, 'href'));
    if (text == null) continue;
    html = html.replace(tag, () => `<style data-sp-inlined="${attr(tag, 'href')}">${text}</style>`);
  }
  // Remaining relative URLs (images, data, fonts) still resolve against the original site.
  const base = `<base href="${pageUrl.href.replace(/"/g, '%22')}">`;
  const head = html.match(/<head\b[^>]*>/i);
  html = head ? html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length) : base + html;

  const inlineScripts = [...page.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const dataFiles = [];
  for (const path of [...new Set([...scripts, ...inlineScripts].flatMap(dataPathsIn))].slice(0, MAX_DATA_FILES)) {
    let url;
    try { url = new URL(path, pageUrl); } catch { continue; }
    if (!sameSite(url)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { text } = await getText(fetchImpl, url, MAX_DATA_BYTES);
      dataFiles.push({ name: url.pathname, text });
    } catch {
      skipped.push(url.href);
    }
  }
  return { success: true, html, url: pageUrl.href, host: pageUrl.host, inlined, dataFiles, skipped };
}
