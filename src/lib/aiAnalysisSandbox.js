/**
 * Run model-written analysis code away from the app: a sandboxed frame with
 * an opaque origin (no cookies, storage or session) whose policy blocks all
 * network, and inside it a Worker so a runaway loop cannot freeze the page.
 * The frame is removed when the run ends or times out.
 */
import { ANALYSIS_RUNTIME_SOURCE } from './aiQuestionAnalysis';

const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

export function buildSandboxSrcdoc() {
  const runtime = JSON.stringify(ANALYSIS_RUNTIME_SOURCE).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>
var RUNTIME = ${runtime};
window.addEventListener('message', function (event) {
  var port = event.ports && event.ports[0];
  var msg = event.data;
  if (!port || !msg || msg.type !== 'sp-ai-analysis-run') return;
  var worker = null;
  try {
    var src = RUNTIME + '\\nself.onmessage = function (e) { self.postMessage(runAnalysis(e.data.code, e.data.records)); };';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (e) { worker = null; }
  if (worker) {
    worker.onmessage = function (e) { port.postMessage(e.data); worker.terminate(); };
    worker.onerror = function (e) { e.preventDefault && e.preventDefault(); port.postMessage({ ok: false, error: String(e.message || 'The code stopped with an error.') }); worker.terminate(); };
    worker.postMessage({ code: msg.code, records: msg.records });
    return;
  }
  try {
    var run = new Function(RUNTIME + '\\nreturn runAnalysis;')();
    port.postMessage(run(msg.code, msg.records));
  } catch (e) {
    port.postMessage({ ok: false, error: String(e && e.message || e) });
  }
});
parent.postMessage({ type: 'sp-ai-analysis-ready' }, '*');
</script>`;
}

/** Resolves { ok, result } or { ok: false, error }; never rejects. */
export function runAnalysisInSandbox(code, records, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ ok: false, error: 'No browser sandbox is available here.' });
      return;
    }
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'analysis sandbox';
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onReady);
      frame.remove();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish({ ok: false, error: `The code did not finish within ${Math.round(timeoutMs / 1000)} s (an endless loop, or far too much work).` }), timeoutMs);
    const onReady = (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'sp-ai-analysis-ready') return;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => finish(e.data && typeof e.data === 'object' ? e.data : { ok: false, error: 'No result.' });
      try {
        frame.contentWindow.postMessage({ type: 'sp-ai-analysis-run', code, records }, '*', [channel.port2]);
      } catch (err) {
        finish({ ok: false, error: `Could not send the records to the sandbox: ${err?.message || err}` });
      }
    };
    window.addEventListener('message', onReady);
    frame.srcdoc = buildSandboxSrcdoc();
    document.body.appendChild(frame);
  });
}
