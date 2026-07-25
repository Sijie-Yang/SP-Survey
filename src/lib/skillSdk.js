/** Injected into skill iframes via srcdoc. Communicates with SkillQuestionWidget host. */
export const SKILL_SDK_SOURCE = `
(function() {
  var config = {};
  var images = [];
  var value = null;
  var inited = false;

  function post(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: 'sp-survey-skill' }, msg), '*');
    }
  }

  function reportHeight() {
    var app = document.getElementById('app');
    var h = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0,
      app ? app.scrollHeight : 0,
      120
    );
    post({ type: 'height', px: h });
  }

  function fireInit() {
    var detail = { config: config, images: images, value: value };
    // Dispatch on document with bubbles so both document- and window-level
    // listeners receive it (skills typically listen on document).
    document.dispatchEvent(new CustomEvent('spskill-init', { detail: detail, bubbles: true }));
    reportHeight();
  }

  function doFireInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireInit);
    } else {
      fireInit();
    }
  }

  function applyInitData(data) {
    if (!data) return;
    config = data.config || {};
    images = data.images || [];
    value = data.value != null ? data.value : null;
    inited = true;
    // Compatibility for AI skills that read window.__SKILL_CONTEXT__ / skillContext
    // instead of spskill-init / SPSkill.getConfig().
    try {
      var ctx = { config: config, skillConfig: config, images: images, media: images, value: value };
      window.__SKILL_CONTEXT__ = ctx;
      window.skillContext = ctx;
    } catch (e) { /* ignore */ }
    doFireInit();
  }

  window.SPSkill = {
    getConfig: function() { return config; },
    getImages: function() { return images; },
    getValue: function() { return value; },
    setAnswer: function(v) {
      value = v;
      post({ type: 'answer', value: v });
    },
    ready: function() {
      reportHeight();
    }
  };

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.source !== 'sp-survey-host') return;
    if (d.type === 'init') applyInitData(d);
  });

  if (window.__SP_BOOT__) applyInitData(window.__SP_BOOT__);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportHeight);
  } else {
    reportHeight();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  }
  // AI skills often replace #app via innerHTML — remeasure so Done buttons aren't clipped.
  if (window.MutationObserver) {
    var moTimer = null;
    new MutationObserver(function() {
      if (moTimer) return;
      moTimer = setTimeout(function() {
        moTimer = null;
        reportHeight();
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }
  document.addEventListener('load', function(e) {
    if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO')) reportHeight();
  }, true);
  post({ type: 'ready' });
})();
`;

function wrapSkillHtml(sourceHtml, { touchCss, boot, sdk }) {
  if (/<\/html>/i.test(sourceHtml)) {
    let html = sourceHtml;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${touchCss}${boot}`);
    } else {
      html = html.replace(/<body([^>]*)>/i, `<body$1>${touchCss}${boot}`);
    }
    return html.replace(/<\/body>/i, `${sdk}</body>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${touchCss}${boot}<style>body{margin:0;padding:8px;font-family:sans-serif;}</style></head><body>${sourceHtml}${sdk}</body></html>`;
}

export function buildSkillSrcdoc(sourceHtml, bootstrap) {
  const touchCss = `<style>
html,body{margin:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
input[type=range]{touch-action:pan-x;cursor:pointer;width:100%;}
button,.btn{cursor:pointer;touch-action:manipulation;}
</style>`;
  const boot = bootstrap
    ? `<script>window.__SP_BOOT__=${JSON.stringify(bootstrap).replace(/</g, '\\u003c')};<\/script>`
    : '';
  const sdk = `<script>${SKILL_SDK_SOURCE}<\/script>`;
  return wrapSkillHtml(sourceHtml, { touchCss, boot, sdk });
}

/** Injected into skill-authored analysis iframes (Results Analysis). */
export const ANALYSIS_SDK_SOURCE = `
(function() {
  var responses = [];
  var config = {};
  var mediaUrlMap = {};

  function post(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: 'sp-survey-skill' }, msg), '*');
    }
  }

  function reportHeight() {
    var app = document.getElementById('app');
    var h = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0,
      app ? app.scrollHeight : 0,
      120
    );
    post({ type: 'height', px: h });
  }

  function fireInit() {
    var detail = { responses: responses, config: config, mediaUrlMap: mediaUrlMap };
    document.dispatchEvent(new CustomEvent('spanalysis-init', { detail: detail, bubbles: true }));
    reportHeight();
  }

  function applyInitData(data) {
    if (!data) return;
    responses = Array.isArray(data.responses) ? data.responses : [];
    config = data.config || {};
    mediaUrlMap = data.mediaUrlMap || {};
    try {
      window.__ANALYSIS_CONTEXT__ = { responses: responses, config: config, mediaUrlMap: mediaUrlMap };
    } catch (e) { /* ignore */ }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireInit);
    } else {
      fireInit();
    }
  }

  window.SPAnalysis = {
    getResponses: function() { return responses; },
    getConfig: function() { return config; },
    getMediaUrlMap: function() { return mediaUrlMap; },
    ready: function() { reportHeight(); }
  };

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.source !== 'sp-survey-host') return;
    if (d.type === 'analysis-init') applyInitData(d);
  });

  if (window.__SP_ANALYSIS_BOOT__) applyInitData(window.__SP_ANALYSIS_BOOT__);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportHeight);
  } else {
    reportHeight();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  }
  if (window.MutationObserver) {
    var moTimer = null;
    new MutationObserver(function() {
      if (moTimer) return;
      moTimer = setTimeout(function() {
        moTimer = null;
        reportHeight();
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }
  post({ type: 'ready' });
})();
`;

export function buildAnalysisSrcdoc(analysisHtml, bootstrap) {
  const touchCss = `<style>
html,body{margin:0;font-family:system-ui,sans-serif;}
</style>`;
  const boot = bootstrap
    ? `<script>window.__SP_ANALYSIS_BOOT__=${JSON.stringify(bootstrap).replace(/</g, '\\u003c')};<\/script>`
    : '';
  const sdk = `<script>${ANALYSIS_SDK_SOURCE}<\/script>`;
  return wrapSkillHtml(analysisHtml || '', { touchCss, boot, sdk });
}

/** Cap responses sent into analysisHtml sandboxes. */
export const ANALYSIS_RESPONSES_CAP = 2000;

export function shapeAnalysisResponses(answers, { cap = ANALYSIS_RESPONSES_CAP } = {}) {
  const list = Array.isArray(answers) ? answers : [];
  return list.slice(0, cap).map((a, idx) => ({
    answer: a?.answer ?? a,
    shown_images: a?.shown_images || a?.shownImages || [],
    participant_id: a?.participant_id || a?.participantId || `p${idx + 1}`,
    created_at: a?.created_at || a?.createdAt || null,
  }));
}

/** Build a few synthetic responses from resultSchema for Skill Editor analysis preview. */
export function buildSyntheticAnalysisResponses(resultSchema = [], images = [], count = 4) {
  const schema = Array.isArray(resultSchema) ? resultSchema : [];
  const img = images[0]?.url || images[0] || '';
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const answer = {};
    if (img) answer.imageUrl = img;
    schema.forEach((f) => {
      const t = f.type || 'text';
      if (t === 'number') answer[f.key] = 40 + i * 10 + (i % 3);
      else if (t === 'boolean') answer[f.key] = i % 2 === 0;
      else if (t === 'choice') answer[f.key] = ['A', 'B', 'C'][i % 3];
      else if (t === 'color') answer[f.key] = ['#e53935', '#1e88e5', '#43a047', '#fb8c00'][i % 4];
      else if (t === 'count') answer[f.key] = i + 1;
      else if (t === 'scaleGroup' || t === 'allocation') {
        answer[f.key] = { a: 20 + i * 5, b: 30 + i * 3, c: 50 - i * 4 };
      } else if (t === 'points') {
        answer[f.key] = [
          { x: 0.2 + i * 0.05, y: 0.3 + (i % 2) * 0.1, label: 'mark' },
          { x: 0.6, y: 0.55, label: 'mark' },
        ];
      } else if (t === 'path') {
        answer[f.key] = [
          { x: 0.1, y: 0.8, t: 0 },
          { x: 0.4 + i * 0.05, y: 0.5, t: 1 },
          { x: 0.85, y: 0.2, t: 2 },
        ];
      } else if (t === 'rankedList') {
        const opts = ['Scene A', 'Scene B', 'Scene C'];
        answer[f.key] = [...opts.slice(i % 3), ...opts.slice(0, i % 3)];
      } else {
        answer[f.key] = `sample ${i + 1}`;
      }
    });
    out.push({
      answer,
      shown_images: img ? [img] : [],
      participant_id: `synth_${i + 1}`,
      created_at: new Date().toISOString(),
    });
  }
  return out;
}
