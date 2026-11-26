import { buildSiteQuestions, prepareSiteDocument } from './spSite';

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;charset=utf-8,'
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#ccc"/></svg>');

function flatElements(pages = []) {
  const out = [];
  const walk = (elements = []) => elements.forEach((el) => {
    if (!el) return;
    out.push(el);
    if (Array.isArray(el.elements)) walk(el.elements);
    if (Array.isArray(el.templateElements)) walk(el.templateElements);
  });
  pages.forEach((page) => walk(page?.elements));
  return out;
}

/**
 * The questions a converted page would get, with grey placeholder images in
 * place of the media the platform draws (named after the planned files, so an
 * adapter that reads file names still works).
 */
export function smokeQuestions(survey, mediaPlan = null) {
  const byFolder = new Map();
  (mediaPlan?.files || []).forEach((f) => {
    const list = byFolder.get(f.folder) || [];
    list.push(String(f.path || '').split('/').pop());
    byFolder.set(f.folder, list);
  });
  const config = JSON.parse(JSON.stringify(survey || {}));
  let counter = 0;
  flatElements(config.pages).forEach((el) => {
    const folders = Array.isArray(el.mediaFolders) ? el.mediaFolders : [];
    if (!folders.length && !el.imageCount) return;
    const names = folders.flatMap((folder) => byFolder.get(folder) || []);
    const perTrial = Math.max(1, Number(el.imageCount) || 1);
    const trials = Math.max(1, Number(el.trialCount) || 1);
    const next = () => {
      const name = names.length ? names[counter % names.length] : `stimulus_${counter + 1}.jpg`;
      counter += 1;
      return { url: PLACEHOLDER_IMAGE, name, type: 'image' };
    };
    if (trials > 1) el.trialMediaSets = Array.from({ length: trials }, () => Array.from({ length: perTrial }, next));
    else el.mediaItems = Array.from({ length: perTrial }, next);
  });
  return buildSiteQuestions(config);
}

/** Placeholder files for the folders a page draws from itself (survey.mediaFolders). */
export function smokeMedia(survey, mediaPlan = null) {
  const byFolder = new Map();
  (mediaPlan?.files || []).forEach((f) => {
    const list = byFolder.get(f.folder) || [];
    list.push(String(f.path || '').split('/').pop());
    byFolder.set(f.folder, list);
  });
  const out = {};
  (survey?.mediaFolders || []).forEach((folder) => {
    const names = byFolder.get(folder) || Array.from({ length: 3 }, (_, i) => `stimulus_${i + 1}.jpg`);
    out[folder] = names.map((name) => ({ url: PLACEHOLDER_IMAGE, name, type: 'image', folder }));
  });
  return out;
}

/**
 * Load a page the way participants get it, in a hidden sandboxed frame, and
 * report what goes wrong while it starts: script errors, failed requests, and
 * requests its adapter never answers (a page stuck on "Loading…").
 *
 * @returns {Promise<{ ran: boolean, problems: string[], warnings: string[] }>}
 */
export function smokeTestSite(html, {
  questions = [], media = {}, survey = {}, allowedHosts = [], waitMs = 3500, maxWaitMs = 9000,
} = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined' || /jsdom/i.test(navigator?.userAgent || '')) {
    return Promise.resolve({ ran: false, problems: [] });
  }
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: 'fixed', left: '-12000px', top: '0', width: '1024px', height: '768px', border: '0', visibility: 'hidden',
    });
    const problems = [];
    const warnings = [];
    const pending = new Map();
    let heard = false;
    const started = Date.now();
    const add = (text) => { if (text && !problems.includes(text)) problems.push(text); };
    const onMessage = (event) => {
      const data = event.data;
      if (event.source !== frame.contentWindow || !data || data.source !== 'sp-site') return;
      heard = true;
      // A file that does not load (a logo the page's server used to serve) is
      // worth showing but does not stop the page; script errors and stuck requests do.
      if (data.type === 'problem' && data.kind === 'resource') { if (!warnings.includes(data.message)) warnings.push(String(data.message || '')); }
      else if (data.type === 'problem') add(String(data.message || ''));
      else if (data.type === 'net' && data.phase === 'start') pending.set(data.id, `${data.method} ${data.url}`);
      else if (data.type === 'net' && data.phase === 'end') pending.delete(data.id);
      else if (data.type === 'answer' || data.type === 'complete') {
        frame.contentWindow.postMessage({ source: 'sp-site-host', type: 'result', requestId: data.requestId, name: data.name, stored: data.value, result: { ok: true } }, '*');
      }
    };
    const finish = () => {
      window.removeEventListener('message', onMessage);
      frame.remove();
      const seconds = Math.round((Date.now() - started) / 1000);
      pending.forEach((label) => add(`${label} was still waiting after ${seconds} s: the SPSite.onRequest handler never answered it, so the page stays stuck (for example on "Loading…").`));
      resolve({ ran: heard, problems, warnings });
    };
    const check = () => {
      const elapsed = Date.now() - started;
      if (elapsed >= maxWaitMs || (elapsed >= waitMs && !pending.size)) finish();
      else setTimeout(check, 250);
    };
    window.addEventListener('message', onMessage);
    frame.srcdoc = prepareSiteDocument(html, { boot: { questions, media, survey: { ...survey, preview: true }, answers: {} }, allowedHosts });
    document.body.appendChild(frame);
    setTimeout(check, 250);
  });
}
