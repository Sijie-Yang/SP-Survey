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
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
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
  post({ type: 'ready' });
})();
`;

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
