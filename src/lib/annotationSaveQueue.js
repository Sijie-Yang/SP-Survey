import { resetR2ProxyUnreachable } from './r2';
import { savePreannotation } from './imageFeaturesR2';

const jobs = new Map();
const listeners = new Set();
const storageKey = (key) => `sp_annotation_pending_v1:${key}`;
export const annotationSaveKey = (prefix, entry) => `${prefix}|${entry?.media_id || entry?.key || entry?.url || ''}`;
const notify = (key, job) => listeners.forEach((fn) => fn(key, { status: job.status, error: job.error, result: job.result }));

export function readPendingAnnotation(key) {
  if (jobs.has(key)) return jobs.get(key).payload;
  try { return JSON.parse(localStorage.getItem(storageKey(key)) || 'null'); } catch { return null; }
}

export function subscribeAnnotationSaves(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function run(key) {
  const job = jobs.get(key);
  if (!job) return Promise.resolve();
  if (job.running) return job.flight;
  clearTimeout(job.timer);
  job.running = true;
  const payload = job.payload;
  job.status = 'saving'; notify(key, job);
  job.flight = (async () => {
    try {
      const result = await savePreannotation(payload.prefix, payload.entry, payload.annotation);
      job.result = result;
      if (job.payload === payload) {
        job.status = 'saved'; job.error = null;
        try { localStorage.removeItem(storageKey(key)); } catch { /* storage unavailable */ }
        notify(key, job);
        jobs.delete(key);
      }
    } catch (error) {
      job.status = 'error'; job.error = error.message || String(error);
      notify(key, job);
    } finally {
      job.running = false;
      if (job.payload !== payload) await run(key);
    }
  })();
  return job.flight;
}

export function queueAnnotationSave(prefix, entry, annotation, delay = 700) {
  const key = annotationSaveKey(prefix, entry);
  const payload = JSON.parse(JSON.stringify({ prefix, entry, annotation }));
  const job = jobs.get(key) || { running: false };
  clearTimeout(job.timer);
  job.payload = payload; job.status = 'saving'; job.error = null;
  try { localStorage.setItem(storageKey(key), JSON.stringify(payload)); }
  catch { job.error = 'Local recovery storage is unavailable. Keep this page open until Saved.'; }
  jobs.set(key, job); notify(key, job);
  job.timer = setTimeout(() => run(key), delay);
  return key;
}

export function retryAnnotationSave(key) {
  resetR2ProxyUnreachable();
  const pending = readPendingAnnotation(key);
  if (!pending) return;
  queueAnnotationSave(pending.prefix, pending.entry, pending.annotation, 0);
}

export async function flushAnnotationSaves({ prefix = '', strict = false } = {}) {
  const keys = [...jobs.keys()].filter((key) => !prefix || key.startsWith(`${prefix}|`));
  await Promise.all(keys.map(run));
  if (strict && keys.some((key) => jobs.has(key))) throw new Error('Save annotations successfully before starting this operation.');
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!jobs.size) return;
    flushAnnotationSaves();
    event.preventDefault(); event.returnValue = '';
  });
  window.addEventListener('online', () => { resetR2ProxyUnreachable(); flushAnnotationSaves(); });
}
