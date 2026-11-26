/**
 * SP-Scheme: a copyable context document that lets any external LLM build a
 * whole SP-Survey study as one web page (the "site"), plus the reader and
 * validator for what it returns.
 *
 * The LLM owns every pixel of the site. The platform keeps owning the data:
 * the embedded survey JSON declares each recorded question with a native type,
 * the platform draws the media for each participant, and the site records
 * answers only through SPSite (see spSite.js), which validates them against
 * those native types. Responses, analysis and export therefore stay unchanged.
 */

import { DESIGN_CAPABILITIES } from './designProtocol/capabilities.js';
import { listGenerationContracts } from './designProtocol/generationContracts.js';
import { findSecretFields } from './designProtocol/secrets.js';
import { postProcessAiConfig, normalizeBuilderSurveyJson } from './designProtocol/normalize.js';
import { validateSurveyConfig } from './designProtocol/validate.js';
import { getPresetSkill } from './presetSkills.js';
import { questionHasTrait } from './platformSchema/index.js';
import {
  ANSWER_SHAPES,
  SP_SITE_SCRIPT_HOSTS,
  SP_SITE_VERSION,
  SITE_SHIM_END,
  SITE_SHIM_START,
  answerKindOf,
  checkSiteHtml,
  externalHostsIn,
  extractEmbeddedScheme,
  normalizeAllowedHosts,
  siteMatchLevel,
  stripSitePreviewShim,
  utf8Bytes,
} from './spSiteCore.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MEDIA_FILE_RE } from './mediaUtils.js';

export const SP_SCHEME_VERSION = '2.0';
export const SP_SCHEME_FORMAT = 'sp-scheme-package';

// Agent/MCP-only rules and per-question HTML (Skill) rules do not apply to a site.
const SITE_IRRELEVANT_RULE = /expectedDraftUpdatedAt|survey_publish|Publish to Main Page|deterministic operations|media_import_from_template|media_upload|skill/i;

/**
 * Lets the site run on its own in a model's preview (Claude artifact, ChatGPT
 * canvas, a local browser): builds the questions from the embedded
 * <script id="sp-scheme"> JSON with placeholder images, and shows what would be
 * recorded. Removed on import; on the platform SPSite already exists.
 */
export const SP_SITE_PREVIEW_SHIM = `${SITE_SHIM_START}
<script>
(function () {
  if (window.SPSite) return;
  var KIND = { text: 'text', comment: 'text', number: 'number', rating: 'rating', imagerating: 'rating', mediarating: 'rating',
    boolean: 'boolean', consent: 'boolean', imageboolean: 'boolean', mediaboolean: 'boolean',
    radiogroup: 'choice', dropdown: 'choice', imagepicker: 'choice', mediapicker: 'choice',
    checkbox: 'multiChoice', imagecheckbox: 'multiChoice', mediacheckbox: 'multiChoice',
    ranking: 'ranking', imageranking: 'ranking', mediaranking: 'ranking',
    slidergroup: 'sliders', imageslidergroup: 'sliders', mediaslidergroup: 'sliders',
    matrix: 'matrix', imagematrix: 'matrix', mediamatrix: 'matrix',
    pointallocation: 'allocation', imagepointallocation: 'allocation', mediapointallocation: 'allocation',
    imageannotation: 'annotation', html: 'display', expression: 'display', image: 'display', mediadisplay: 'display' };
  var MEDIA_CHOICE = { imagepicker: 'image_', imageranking: 'image_', mediaranking: 'image_', mediapicker: 'media_' };
  var COLORS = ['#8fb3d9', '#d9a38f', '#9fd98f', '#d9cf8f', '#b38fd9', '#8fd9cf'];
  var questions = [], survey = {}, answers = {}, ready = false, waiters = [], lang = 'en', drawn = 0;
  function text(v) { if (v == null) return ''; if (typeof v === 'object') return String(v[lang] || v['default'] || ''); return String(v); }
  function items(list) {
    return (list || []).map(function (c) {
      if (c && typeof c === 'object') return { value: String(c.value != null ? c.value : c.text), text: text(c.text != null ? c.text : c.value) };
      return { value: String(c), text: String(c) };
    });
  }
  function image(label) {
    drawn += 1;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="' + COLORS[drawn % COLORS.length] + '"/><text x="320" y="225" font-size="40" text-anchor="middle" fill="#222" font-family="sans-serif">' + label + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name: 'placeholder_' + drawn + '.jpg', type: 'image' };
  }
  function build(scheme) {
    var s = (scheme && scheme.survey) || scheme || {};
    lang = s.locale || 'en';
    survey = { title: text(s.title), description: text(s.description), language: lang, preview: true };
    (s.pages || []).forEach(function (page) {
      (page.elements || []).forEach(function (el) {
        if (!el || !el.name) return;
        var kind = (el.type === 'text' && el.inputType === 'number') ? 'number' : (KIND[el.type] || 'unsupported');
        var q = { name: el.name, page: page.name || null, type: el.type, kind: kind, title: text(el.title) || el.name,
          description: text(el.description), required: !!el.isRequired, trialCount: Math.max(1, Math.floor(Number(el.trialCount) || 1)) };
        if (kind === 'number') { q.min = el.min != null ? el.min : null; q.max = el.max != null ? el.max : null; }
        if (kind === 'rating') { q.rateMin = Number(el.rateMin != null ? el.rateMin : 1); q.rateMax = Number(el.rateMax != null ? el.rateMax : 5); if (el.rateValues) q.rateValues = items(el.rateValues); else if (el.rateLabels) q.rateValues = el.rateLabels.map(function (t, i) { return { value: q.rateMin + i * (Number(el.rateStep) || 1), text: text(t) }; }); q.minLabel = text(el.minRateDescription); q.maxLabel = text(el.maxRateDescription); }
        if (kind === 'boolean') { q.labelTrue = text(el.labelTrue); q.labelFalse = text(el.labelFalse); }
        if (kind === 'sliders') q.dimensions = (el.dimensions || []).map(function (d) { return { id: String(d.id), label: text(d.label), left: text(d.left), right: text(d.right), min: d.min != null ? d.min : (el.scaleMin != null ? el.scaleMin : 1), max: d.max != null ? d.max : (el.scaleMax != null ? el.scaleMax : 7), step: d.step != null ? d.step : (el.scaleStep || 1) }; });
        if (kind === 'matrix') { q.rows = items(el.rows); q.columns = items(el.columns); }
        if (kind === 'allocation') q.budget = Number(el.budget != null ? el.budget : 100);
        if (kind === 'annotation') { q.tools = el.allowedTools || ['point', 'line', 'polygon', 'bbox']; q.labels = items(el.annotationLabels).map(function (l) { return l.text; }); q.minShapes = el.minAnnotations || 0; q.maxShapes = el.maxAnnotations || 50; }
        var media = /^(image|media)/.test(el.type) ? Number(el.imageCount) || (MEDIA_CHOICE[el.type] ? 4 : 1) : 0;
        function draw(t) { var m = []; for (var i = 0; i < media; i += 1) m.push(image((q.trialCount > 1 ? 'Trial ' + (t + 1) + ' · ' : '') + 'Image ' + (i + 1))); return m; }
        function choicesFor(m) {
          var list;
          if (MEDIA_CHOICE[el.type]) list = m.map(function (x, i) { return { value: MEDIA_CHOICE[el.type] + i, text: x.name, imageUrl: x.url }; });
          else if (/^(choice|multiChoice|ranking|allocation)$/.test(kind)) list = items(el.choices);
          if (list && el.allowTie && el.tieLabel) list.push({ value: String(el.tieLabel), text: String(el.tieLabel), tie: true });
          return list;
        }
        if (q.trialCount > 1) {
          q.trials = [];
          for (var t = 0; t < q.trialCount; t += 1) { var m = draw(t); q.trials.push({ media: m, choices: choicesFor(m) }); }
        } else {
          q.media = draw(0);
          var c = choicesFor(q.media);
          if (c) q.choices = c;
        }
        questions.push(q);
      });
    });
  }
  function find(name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; }
  function panel() {
    var box = document.getElementById('sp-preview-data');
    if (!box) {
      box = document.createElement('details');
      box.id = 'sp-preview-data';
      box.style.cssText = 'position:fixed;right:8px;bottom:8px;max-width:min(420px,90vw);max-height:45vh;overflow:auto;background:#111;color:#9f9;font:12px monospace;border-radius:6px;padding:6px 10px;opacity:.92;z-index:2147483647';
      box.innerHTML = '<summary style="cursor:pointer;color:#fff">SP-Scheme preview · recorded data</summary><pre style="margin:6px 0 0;white-space:pre-wrap"></pre>';
      document.body.appendChild(box);
    }
    box.querySelector('pre').textContent = JSON.stringify(answers, null, 2);
    return box;
  }
  function done(result) { return Promise.resolve(result); }
  window.SPSite = {
    version: 'preview',
    platform: false,
    onReady: function (cb) { if (ready) cb({ questions: questions, survey: survey, answers: answers }); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: find,
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    allowedHosts: [],
    getMedia: function (folder) {
      // On the platform: the files of a survey-level mediaFolders entry. The preview has none.
      var all = (survey && survey.mediaFolders) || [];
      if (folder === undefined) { var out = {}; all.forEach(function (f) { out[f] = []; }); return out; }
      console.warn('[SPSite preview] getMedia(' + folder + '): the preview has no media library; the platform fills this in');
      return [];
    },
    onSubmit: function () { /* the platform hands intercepted result posts here */ },
    onRequest: function () { /* the platform lets the page answer its own requests here */ },
    answer: function (name, value, options) {
      var q = find(name);
      if (!q) { console.warn('[SPSite preview] unknown question', name); return done({ ok: false, error: 'Unknown question "' + name + '"' }); }
      var key = options && options.key, shown = options && options.shown;
      if (key != null || (shown != null && !(q.trialCount > 1 && options.trial != null))) {
        // Page-drawn media: one record per item, replaced when the same key comes again.
        var rec = answers[name] && answers[name].trials ? answers[name] : { trials: [] };
        var list = [].concat(shown == null ? [] : shown).map(String);
        var at = key == null ? -1 : rec.trials.findIndex(function (x) { return x.key === String(key); });
        if (value == null) { if (at >= 0) rec.trials.splice(at, 1); }
        else { var e = { value: value, shown_images: list, shown_media_ids: list }; if (key != null) e.key = String(key); if (at >= 0) rec.trials[at] = e; else rec.trials.push(e); }
        if (rec.trials.length) answers[name] = rec; else delete answers[name];
      } else if (q.trialCount > 1) {
        var t = options && options.trial;
        if (typeof t !== 'number' || t < 0 || t >= q.trialCount) return done({ ok: false, error: name + ' repeats ' + q.trialCount + ' times: pass { trial: 0…' + (q.trialCount - 1) + ' }' });
        var cur = answers[name] || { trials: [] };
        while (cur.trials.length < q.trialCount) cur.trials.push({ value: null, shown_images: [] });
        cur.trials[t] = { value: value == null ? null : value, shown_images: value == null ? [] : q.trials[t].media.map(function (m) { return m.url.slice(0, 40) + '…'; }) };
        answers[name] = cur;
      } else if (value == null) { delete answers[name]; } else { answers[name] = value; }
      panel();
      return done({ ok: true });
    },
    complete: function () {
      var missing = questions.filter(function (q) {
        if (!q.required || q.kind === 'display') return false;
        var v = answers[q.name];
        if (q.trialCount > 1) return !v || v.trials.some(function (x) { return x.value == null; });
        return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
      }).map(function (q) { return q.name; });
      if (missing.length) return done({ ok: false, missing: missing, error: 'Required questions are unanswered: ' + missing.join(', ') });
      var box = panel();
      box.open = true;
      box.querySelector('summary').textContent = 'Preview finished · on SP-Survey these answers are submitted now';
      return done({ ok: true });
    }
  };
  function start() {
    var node = document.getElementById('sp-scheme');
    try { build(JSON.parse(node ? node.textContent : '{}')); } catch (err) { console.error('[SPSite preview] invalid sp-scheme JSON', err); }
    ready = true;
    var d = { questions: questions, survey: survey, answers: answers };
    waiters.splice(0).forEach(function (cb) { cb(d); });
    document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
</script>
${SITE_SHIM_END}`;

const EXAMPLE_SURVEY = {
  title: 'Street perception study',
  description: 'You will compare street images and rate one scene. About 3 minutes.',
  locale: 'en',
  pages: [
    {
      name: 'welcome',
      elements: [
        { type: 'consent', name: 'consent', title: 'I agree to take part in this study', isRequired: true },
      ],
    },
    {
      name: 'duel',
      elements: [
        {
          type: 'imagepicker',
          name: 'safety_duel',
          title: 'Which street feels safer to walk alone at night?',
          imageCount: 2,
          trialCount: 3,
          imageSelectionMode: 'huggingface_random',
          randomImageSelection: true,
          excludePreviouslyUsedImages: true,
          choices: [],
          isRequired: true,
        },
      ],
    },
    {
      name: 'scales',
      elements: [
        {
          type: 'imageslidergroup',
          name: 'scene_scales',
          title: 'How does this street feel?',
          imageCount: 1,
          imageSelectionMode: 'huggingface_random',
          randomImageSelection: true,
          excludePreviouslyUsedImages: true,
          scaleMin: 1,
          scaleMax: 7,
          dimensions: [
            { id: 'safety', label: 'Safety', left: 'Very unsafe', right: 'Very safe' },
            { id: 'lively', label: 'Liveliness', left: 'Dull', right: 'Lively' },
          ],
          isRequired: true,
        },
      ],
    },
  ],
};

const EXAMPLE_PACKAGE = { format: SP_SCHEME_FORMAT, spScheme: SP_SCHEME_VERSION, survey: EXAMPLE_SURVEY };

const EXAMPLE_SITE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Street perception study</title>
<script type="application/json" id="sp-scheme">
${JSON.stringify(EXAMPLE_PACKAGE, null, 2)}
</script>
__SHIM__
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
  main { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
  h1, h2 { line-height: 1.25; }
  .duel { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .duel button { padding: 0; border: 4px solid transparent; border-radius: 12px; background: none; cursor: pointer; }
  .duel button:hover, .duel button:focus-visible { border-color: #38bdf8; outline: none; }
  img { width: 100%; display: block; border-radius: 8px; }
  .btn { margin-top: 16px; padding: 12px 20px; border: 0; border-radius: 999px; background: #38bdf8; color: #0f172a; font-size: 16px; font-weight: 700; cursor: pointer; }
  .scale { margin: 18px 0; }
  .scale input { width: 100%; }
  .poles { display: flex; justify-content: space-between; font-size: 13px; opacity: .8; }
  .error { color: #fca5a5; min-height: 1.2em; }
</style>
</head>
<body>
<main id="app"><p>Loading…</p></main>
<script>
SPSite.onReady(function (ctx) {
  var app = document.getElementById('app');
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
  var screens = [welcome, duel, scales];
  var screen = 0;
  var trial = 0;
  function next() { screen += 1; trial = 0; if (screen < screens.length) screens[screen](); }

  function welcome() {
    var q = SPSite.getQuestion('consent');
    app.innerHTML = '<h1>' + esc(ctx.survey.title) + '</h1><p>' + esc(ctx.survey.description) + '</p>'
      + '<label><input type="checkbox" id="agree"> ' + esc(q.title) + '</label><br>'
      + '<button class="btn" id="go">Start</button><p class="error" id="err"></p>';
    document.getElementById('go').onclick = function () {
      if (!document.getElementById('agree').checked) { document.getElementById('err').textContent = 'Please agree to continue.'; return; }
      SPSite.answer('consent', true).then(function (r) { if (r.ok) next(); });
    };
  }

  function duel() {
    var q = SPSite.getQuestion('safety_duel');
    var round = q.trials[trial];
    app.innerHTML = '<h2>' + esc(q.title) + '</h2><p>Round ' + (trial + 1) + ' of ' + q.trialCount + '</p><div class="duel"></div>';
    round.choices.forEach(function (choice, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<img alt="Street ' + (i + 1) + '" src="' + choice.imageUrl + '">';
      b.onclick = function () {
        SPSite.answer('safety_duel', choice.value, { trial: trial }).then(function (r) {
          if (!r.ok) return;
          trial += 1;
          if (trial < q.trialCount) duel(); else next();
        });
      };
      app.querySelector('.duel').appendChild(b);
    });
  }

  function scales() {
    var q = SPSite.getQuestion('scene_scales');
    var values = {};
    app.innerHTML = '<h2>' + esc(q.title) + '</h2><img alt="Street" src="' + q.media[0].url + '"><div id="dims"></div>'
      + '<button class="btn" id="finish">Finish</button><p class="error" id="err"></p>';
    q.dimensions.forEach(function (d) {
      var mid = Math.round((d.min + d.max) / 2);
      values[d.id] = mid;
      var row = document.createElement('div');
      row.className = 'scale';
      row.innerHTML = '<strong>' + esc(d.label) + '</strong><input type="range" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + mid + '">'
        + '<div class="poles"><span>' + esc(d.left) + '</span><span>' + esc(d.right) + '</span></div>';
      row.querySelector('input').oninput = function (e) { values[d.id] = Number(e.target.value); };
      document.getElementById('dims').appendChild(row);
    });
    document.getElementById('finish').onclick = function () {
      SPSite.answer('scene_scales', values)
        .then(function (r) { if (!r.ok) throw new Error(r.error); return SPSite.complete(); })
        .then(function (r) {
          if (!r.ok) { document.getElementById('err').textContent = r.error; return; }
          app.innerHTML = '<h2>Submitting…</h2>';
        })
        .catch(function (err) { document.getElementById('err').textContent = err.message; });
    };
  }

  welcome();
});
</script>
</body>
</html>
`.replace('__SHIM__', SP_SITE_PREVIEW_SHIM);

function compactJson(value) {
  return JSON.stringify(value);
}

function questionCatalogLines() {
  return listGenerationContracts()
    .filter((c) => {
      const kind = answerKindOf({ type: c.type });
      return kind !== 'unsupported' || c.type === 'number';
    })
    .map((c) => {
      const kind = answerKindOf({ type: c.type });
      const required = (c.requiredFields || []).filter((f) => !['type', 'name'].includes(f));
      const parts = [
        `- \`${c.type}\` — ${c.useWhen || c.label || c.type}`,
        kind === 'display' ? 'shows content, records nothing' : `kind \`${kind}\``,
        c.media?.stimulus ? 'media drawn by the platform' : null,
        required.length ? `required: ${required.join(', ')}` : null,
      ].filter(Boolean);
      const example = c.minimumExample ? `\n  example: \`${compactJson(c.minimumExample)}\`` : '';
      return parts.join(' · ') + example;
    }).join('\n');
}

function answerShapeLines() {
  return Object.entries(ANSWER_SHAPES).map(([kind, shape]) => `- \`${kind}\`: ${shape}`).join('\n');
}

/**
 * The SP-Scheme context document (Markdown). Written in English so every model
 * follows it precisely; participant-facing text follows `survey.locale`.
 */
export function buildSpSchemeText() {
  const rules = DESIGN_CAPABILITIES.rules.filter((rule) => !SITE_IRRELEVANT_RULE.test(rule));
  return `# SP-Scheme ${SP_SCHEME_VERSION} — build an SP-Survey study as your own web page

You are helping a researcher build a perception survey for SP-Survey (https://sp-survey.org). The researcher may not be technical.

You design the whole participant experience as ONE web page, \`index.html\`: welcome and consent, every task, page flow, visuals, animation, wording. Participants open the survey link and get exactly this page; the researcher's Builder preview shows exactly this page too. There is no platform form style to fit into.

The platform takes care of three things; how much of your data it can analyse depends on how closely you follow them (the Builder and the Results page say so plainly):
1. **Stimuli.** Images / videos / audio come from the researcher's media pool: either the platform draws them for each participant and hands them to your page, or your page reads whole folders with \`SPSite.getMedia(folder)\` and keeps its own randomisation (section 2). You never choose, invent or hard-code media URLs.
2. **Question description.** Every answer you record belongs to a question declared in the survey JSON embedded in the page (section 1). A native type (section 3) gets the platform's analysis; an answer no native type fits is declared \`custom\` and is stored and exported as is, not analysed.
3. **Answer recording.** You record answers only with \`SPSite.answer(...)\` and finish with \`SPSite.complete()\` (section 4). The platform checks every value, stores it, and handles submission and the thank-you screen.

## 0. Workflow — follow these steps in order

**Step 1 · Understand the study.** Ask briefly for what you need: research question, what participants judge, language, how many images each person sees, roughly how long it should take. Suggest a design in plain language before writing code.
The researcher may instead bring an existing survey: a link or screenshots of a survey on another site (Qualtrics, Google Forms, a lab website), an exported file (.qsf, .docx, .pdf) or a page made earlier. Then fit that survey to SP-Scheme: keep its questions, wording, answer options, order and stimuli as they are, map each question to a native type (section 3) or \`custom\`, and list plainly anything that cannot be kept the same.

**Step 2 · Build index.html and let the researcher try it.** Write the page with the embedded survey JSON (section 1) and the preview shim (section 5), and show it in your preview / canvas / artifact view (or tell the researcher to save it and open it in a browser). The shim fills in placeholder images and shows the recorded data in a small panel, so the page works fully before it reaches the platform. Ask the researcher to click through it on a phone-sized and a desktop-sized window. Change it until they say they are happy. Do NOT hand over the final file before the researcher confirms.

**Step 3 · Hand over the same page, as a zip.** The file the researcher approved IS the deliverable; do not rebuild or simplify it. Put \`index.html\` and every file it uses (images, CSS, JS, data) into one zip, keeping their folders. Stimulus images must be real image files in the zip (for example \`images/street_01.jpg\`), never pictures your code draws (SVG, canvas or CSS art) to stand in for photos: on import they go into the project's media library under the same folders, and the page finds them by the same relative paths. The platform treats the media library as the folder index.html sits in.
If you cannot make files, give the whole page in one \`\`\`html code block and tell the researcher: "save this as index.html, put it in a zip together with the images it uses".
Then tell them how to import it: open SP-Survey Studio, click "New study" (新建研究), drag the zip (or index.html) in, read the check and click Import. An agent connected to the SP-Survey MCP server calls \`sp_scheme_import\` instead (a zip goes up through \`sp_scheme_upload_url\` first). If the check lists problems, they come back to you; return a corrected page.

## 1. The embedded survey JSON

Put this block inside \`<head>\`, before the preview shim:

\`\`\`html
<script type="application/json" id="sp-scheme">
{
  "format": "${SP_SCHEME_FORMAT}",
  "spScheme": "${SP_SCHEME_VERSION}",
  "survey": {
    "title": "...", "description": "...", "locale": "en | zh",
    "pages": [ { "name": "...", "elements": [ /* one entry per recorded question */ ] } ]
  }
}
</script>
\`\`\`

- One element per thing you record, with a native \`type\` from section 3. The type decides the answer format and the analysis the researcher gets; your page decides how it looks. For example a two-image "tap the safer street" game is an \`imagepicker\` with \`imageCount: 2\` (analysed with TrueSkill rankings), a swipe-left/right card is an \`imageboolean\`, a drag-to-sort board is an \`imageranking\`, a set of dials is an \`imageslidergroup\`. Rating one image on a few labelled options ("clean / minor issues / vacant") is an \`imagerating\` with \`imageCount: 1\`, \`rateMin\`/\`rateMax\` and \`rateLabels\` (one label per option); an \`imagepicker\` is only for choosing between two or more images.
- Every element has a unique, stable \`name\` (lowercase letters, digits, underscores). Choice, row, column and dimension ids must be unique within their question.
- \`title\` / \`description\` hold the wording, in the survey's \`locale\` language; your page may show them or its own text.
- Pages group questions for the researcher's overview only; your page decides the real flow.
- Start with a \`consent\` question when the study collects data from people, and mark questions the participant must answer with \`"isRequired": true\`.
- Do not include API keys, tokens, Supabase settings or any credential.

## 2. Stimuli and randomisation

Images, videos and audio come from the researcher's project media pool; you never invent or hard-code media URLs. Two ways to draw them, mixable per question:

**A. Platform draws (default when you design the page from scratch).** The platform draws the files for each participant, records exactly what was shown, and passes them to your page as \`question.media\` (or \`question.trials[i].media\`). Show only these; placeholders exist only in your preview.

**Paths.** The media library is the page's own folder: \`<img src="images/a.jpg">\` (or a CSS \`url(images/a.jpg)\`) shows the library file \`a.jpg\` in folder \`images\`. An empty image list in your code (for example \`const PHOTO_URLS = []\`) is filled with the images of the folders the researcher links in the Builder (the library root when none), in a random order for each participant; record the file names you show, not your own ids.

**B. Your page draws (default when a page already has its own randomisation).** Declare the folders at the survey level by their names in the media library (the same as the folders of the researcher's zip, for example \`"mediaFolders": ["images"]\`), and read them with \`SPSite.getMedia('task_a')\` → \`[{ url, name, type }]\` (the whole folder). Keep the page's own logic for sampling, grouping, pairing and ordering, and record each answer with \`SPSite.answer(name, value, { key, shown })\`: \`shown\` lists the file names shown for that answer and \`key\` (for example the image id) makes a later answer replace an earlier one for the same item. The platform then records what was shown exactly like in A.

Settings for A:
- Default for every media question: \`"imageSelectionMode": "huggingface_random", "randomImageSelection": true, "excludePreviouslyUsedImages": true\` and \`"choices": []\`.
- \`imageCount\` = how many files are drawn per presentation. \`trialCount\` = how many rounds the question repeats, each with a fresh draw; each round is recorded separately, so loop over \`question.trials\` in your page rather than declaring many similar questions.
- \`mediaAssignmentMode\`: \`individual\` (random files, default), \`set\` (one whole folder tagged set; imageCount must equal the folder size) or \`category\` (folders tagged category). \`mediaFolders\` optionally limits eligible folders.
- If the researcher must curate specific files, use \`"imageSelectionMode": "huggingface_manual"\` and tell them to pick the files in the Builder after import.
- Remind the researcher to upload their images to the project's Media Dataset before publishing.

Platform rules:

${rules.map((rule) => `- ${rule}`).join('\n')}

## 3. Native question types

${questionCatalogLines()}

Use a native type whenever the answer fits its shape: the researcher then gets the platform's analysis. When a page records something no native type fits (its own composite record, a trace, a free structure), declare it with \`"type": "custom"\`: the value is any JSON (≤ 32 KB), stored and exported as is, never analysed — the researcher is told so in the Builder and on the Results page. Never force a value into a native type it does not fit.

Answer value for each kind (what you pass to \`SPSite.answer\`):

${answerShapeLines()}

For \`choice\` / \`multiChoice\` / \`ranking\` / \`allocation\`, the allowed values are exactly \`question.choices[].value\` (per round: \`question.trials[i].choices\`). For image and media choice types those choices ARE the drawn files: each has \`value\` (\`image_0\`, \`image_1\`, … or \`media_0\`, …) and \`imageUrl\`; record the \`value\`, never the URL.

## 4. SPSite — the only way to record answers

On the platform \`window.SPSite\` exists before your scripts run. Use it like this:

\`\`\`js
SPSite.onReady(function (ctx) {
  // ctx.questions: array of question objects (below); ctx.survey: { title, description, language }
  // ctx.answers: answers already recorded (after a participant resumes); start your UI here
});
SPSite.getQuestion('safety_duel');            // one question object
SPSite.answer('rate_scene', 5);                // returns a Promise of { ok, error }
SPSite.answer('safety_duel', 'image_1', { trial: 2 });  // repeated question: round index 0…trialCount-1
SPSite.answer('rate_scene', null);             // clear an answer
SPSite.getMedia('task_a');                     // files of a survey-level mediaFolders entry: [{ url, name, type }]
SPSite.answer('task_a', 2, { key: 'IMG0279', shown: ['IMG0279.jpg'] });  // page-drawn media: one record per item
SPSite.complete();                             // Promise of { ok, missing, error }
\`\`\`

A question object: \`{ name, type, kind, answerShape, title, description, required, trialCount, media: [{ url, name, type }], choices: [{ value, text, imageUrl? }], trials: [{ media, choices }] /* when trialCount > 1 */ }\` plus, by kind, \`min/max\`, \`rateMin/rateMax/rateValues/minLabel/maxLabel\`, \`labelTrue/labelFalse\`, \`dimensions: [{ id, label, left, right, min, max, step }]\`, \`rows/columns\`, \`budget\`, \`tools/labels/minShapes/maxShapes\`. \`media[].type\` is \`image\`, \`video\` or \`audio\`.

- Call \`SPSite.answer\` whenever an answer is made or changed. Check \`ok\`; on \`ok: false\` show \`error\` and let the participant fix it (it means the value did not fit the question).
- Call \`SPSite.complete()\` once at the end, when the participant reaches the last screen or presses its finish button; without it the platform never knows the survey is over. A page that keeps its answers in localStorage instead must save a top-level \`"done": true\` in that saved object at the end (the platform then submits). Never tell participants their data stays only in their browser: it is sent to the researcher's project. On \`ok: true\` the platform submits and shows its thank-you screen, so show only a short "Submitting…" state. On \`ok: false\`, \`missing\` lists required questions still unanswered; take the participant back to them.
- Record timing or extra behaviour only through declared questions (for example a \`number\` question for a reaction time in milliseconds).

Runtime limits on the platform (the page runs full-screen in a sandboxed frame):
- No network: \`fetch\`, XHR, WebSocket and form posts are blocked; nothing leaves the page except through SPSite. A researcher can allow named domains in the Builder (\`SPSite.allowedHosts\`) for pages that must load something at run time. Posts to any other host are not sent: they resolve as a success and their payload is passed to \`SPSite.onSubmit(function (item) { /* item.kind, item.url, item.method, item.data */ })\`, so an older page's "send results" call can be mapped onto \`SPSite.answer\`. For a page that expects its own server, \`SPSite.onRequest(function (req) { if (req.url === '/api/state') return { json: { … } }; })\` answers any request that would otherwise be blocked (\`req.url\` is the path for same-page URLs; \`req.method\`, \`req.data\`); returning nothing leaves it blocked.
- Scripts must be inline or loaded from ${SP_SITE_SCRIPT_HOSTS.join(', ')}; styles may also use Google Fonts. Images and media load over https only (the platform's), or data: URLs for your own decoration.
- \`localStorage\` works only in memory for the session; do not rely on it.
- No navigation to other pages, no new windows for survey content, no iframes, no camera or microphone.
- Make it work on a phone (≥360px wide) and by keyboard; give images alt text; keep the file under 3 MB.

## 5. Preview shim

Paste this block unchanged inside \`<head>\`, right after the embedded survey JSON. It provides SPSite with placeholder images in your preview and in a plain browser, and shows the recorded data. The platform removes it on import and supplies the real SPSite and media:

\`\`\`html
${SP_SITE_PREVIEW_SHIM}
\`\`\`

## 6. Example index.html

\`\`\`html
${EXAMPLE_SITE_HTML.trim()}
\`\`\`

## 7. Self-check before handing over

1. The researcher has tried the page and confirmed; you are handing over that same page.
2. index.html contains the \`<script type="application/json" id="sp-scheme">\` block with \`format\`, \`spScheme\`, \`survey.pages\`, and the preview shim right after it.
3. Every recorded answer has a declared question (a native type when the value fits, otherwise \`custom\`); names are unique; required questions have \`isRequired: true\`.
4. No media URLs in the JSON or the page; every image or clip participants judge comes from \`question.media\` / \`question.trials[i].media\` or from \`SPSite.getMedia(folder)\`.
5. Every answer goes through \`SPSite.answer(name, value)\` (with \`{ trial }\` for platform-drawn rounds, or \`{ key, shown }\` when the page draws media itself) in the shape of its kind, and the end calls \`SPSite.complete()\`.
6. Questions the platform cannot analyse are declared as \`custom\`, not squeezed into a native type.
7. No network calls, external scripts outside the allowed hosts, or credentials.
`;
}

// Project zips may carry their stimulus images (uploaded to the media library on import).
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;

function sizeLimitText(bytes) {
  return bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const MANIFEST_NAME = 'sp-scheme.json';
const ASSET_MIME = { css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function isZipBytes(bytes) {
  return bytes?.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function looksLikeHtml(text) {
  return /^\s*(<!doctype html|<html\b|<head\b|<body\b|<!--)/i.test(text) || (/<script\b/i.test(text) && !/^\s*[{[`]/.test(text));
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function resolvePath(base, ref) {
  if (/^(https?:|data:|blob:|\/\/|#)/i.test(ref)) return null;
  const parts = (base + ref.split(/[?#]/)[0]).split('/');
  const out = [];
  parts.forEach((part) => {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  });
  return out.join('/');
}

/** Inline local CSS, JS and small images that sit next to index.html in the zip. */
function inlineLocalAssets(html, entries, base) {
  const inlined = [];
  const read = (ref) => {
    const path = resolvePath(base, ref);
    const data = path != null ? entries[path] : null;
    if (data) inlined.push(path);
    return data;
  };
  let out = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const data = href && read(href);
    return data ? `<style>${strFromU8(data)}</style>` : tag;
  });
  out = out.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before, src, after) => {
    const data = read(src);
    return data ? `<script${`${before}${after}`.replace(/\s+$/, '')}>${strFromU8(data).replace(/<\/script/gi, '<\\/script')}</script>` : tag;
  });
  out = out.replace(/(<img\b[^>]*\bsrc=)["']([^"']+)["']/gi, (match, prefix, src) => {
    const ext = src.split(/[?#]/)[0].split('.').pop().toLowerCase();
    const data = ASSET_MIME[ext]?.startsWith('image/') ? read(src) : null;
    return data ? `${prefix}"data:${ASSET_MIME[ext]};base64,${toBase64(data)}"` : match;
  });
  return { html: out, inlined };
}

const DATA_FILE_RE = /\.(json|csv|tsv|txt|md|py)$/i;
const DATA_FILE_MAX = 60000;
const DATA_TOTAL_MAX = 150000;

/** Text files that came with the page (question lists, configs), for page conversion. */
function readDataFiles(entries, skip = []) {
  let total = 0;
  return Object.keys(entries)
    .filter((name) => DATA_FILE_RE.test(name) && !skip.includes(name) && !/(^|\/)(readme|license)[^/]*$/i.test(name))
    .sort((a, b) => a.length - b.length)
    .map((name) => {
      if (total >= DATA_TOTAL_MAX) return null;
      let text = strFromU8(entries[name]);
      const truncated = text.length > DATA_FILE_MAX;
      if (truncated) text = text.slice(0, DATA_FILE_MAX);
      total += text.length;
      return { name, text, truncated };
    })
    .filter(Boolean);
}

/** The folder every entry sits in, if the zip wraps its content in one. */
function commonTopFolder(names) {
  const first = names[0]?.split('/');
  if (!first || first.length < 2) return '';
  return names.every((name) => name.startsWith(`${first[0]}/`)) ? `${first[0]}/` : '';
}

/**
 * Media in the zip that the page does not embed: the study's stimuli. They are
 * uploaded to the project's media library on import; paths drop the zip's
 * wrapping folder ("images/IMG0279.jpg").
 */
function readMediaFiles(entries, inlined = []) {
  const names = Object.keys(entries);
  const top = commonTopFolder(names);
  return names
    .filter((name) => MEDIA_FILE_RE.test(name) && !inlined.includes(name) && !name.split('/').pop().startsWith('._'))
    .filter((name) => entries[name]?.length)
    .sort()
    .map((name) => ({ path: name.slice(top.length), bytes: entries[name], size: entries[name].length }));
}

/**
 * Read an uploaded package: index.html on its own, a .zip holding it (plus
 * optional sp-scheme.json and local assets), or a bare sp-scheme.json.
 * @param {Uint8Array} bytes
 * @param {{ maxZipBytes?: number, maxUnzippedBytes?: number }} [limits] lower caps for
 *   callers with less memory (the Worker); the defaults suit the browser.
 * @returns {{ pkg: object|null, siteHtml: string|null, siteFile: string|null, files: string[], fromZip: boolean, manifestSource: string|null }}
 */
export function readSpSchemeUpload(bytes, { maxZipBytes = MAX_ZIP_BYTES, maxUnzippedBytes = MAX_UNZIPPED_BYTES } = {}) {
  if (!isZipBytes(bytes)) {
    const text = strFromU8(bytes);
    if (looksLikeHtml(text)) {
      const pkg = extractEmbeddedScheme(text);
      return { pkg, siteHtml: text, siteFile: 'index.html', files: [], fromZip: false, manifestSource: pkg ? 'embedded' : null };
    }
    return { pkg: parseSpSchemePackage(text), siteHtml: null, siteFile: null, files: [], fromZip: false, manifestSource: 'json' };
  }
  if (bytes.length > maxZipBytes) throw new Error(`The zip is larger than ${sizeLimitText(maxZipBytes)}. Upload large media to the Media Dataset first and leave it out of the zip.`);
  let total = 0;
  let entries;
  let tooLarge = null;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(file.name)) return false;
        total += file.originalSize || 0;
        if (total > maxUnzippedBytes) {
          tooLarge = new Error(`The zip expands to more than ${sizeLimitText(maxUnzippedBytes)}.`);
          throw tooLarge;
        }
        return /\.(json|html?|md|txt|csv|tsv|py|css|js|svg)$/i.test(file.name) || MEDIA_FILE_RE.test(file.name);
      },
    });
  } catch (err) {
    throw err === tooLarge ? err : new Error('The zip could not be opened.');
  }
  const names = Object.keys(entries);
  const shallowest = (list) => list.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const sitePath = shallowest(names.filter((name) => /^index\.html?$/i.test(name.split('/').pop())))
    || (() => {
      const pages = names.filter((name) => /\.html?$/i.test(name) && !/^preview\.html?$/i.test(name.split('/').pop()));
      return pages.length === 1 ? pages[0] : null;
    })();
  const manifestPath = shallowest(names.filter((name) => name.split('/').pop().toLowerCase() === MANIFEST_NAME));
  if (!sitePath && !manifestPath) throw new Error('The zip has neither index.html nor sp-scheme.json.');
  const root = (sitePath || manifestPath).replace(/[^/]*$/, '');
  let siteHtml = null;
  let inlined = [];
  if (sitePath) {
    ({ html: siteHtml, inlined } = inlineLocalAssets(strFromU8(entries[sitePath]), entries, sitePath.replace(/[^/]*$/, '')));
  }
  const embedded = siteHtml ? extractEmbeddedScheme(siteHtml) : null;
  const pkg = manifestPath ? parseSpSchemePackage(strFromU8(entries[manifestPath])) : embedded;
  if (manifestPath && embedded && !embedded.__invalid) {
    pkg.__embeddedNames = schemeQuestionNames(embedded);
  }
  return {
    pkg,
    siteHtml,
    siteFile: sitePath ? sitePath.slice(root.length) : null,
    files: names.filter((name) => name.startsWith(root)).map((name) => name.slice(root.length)),
    dataFiles: readDataFiles(entries, [sitePath, manifestPath]),
    mediaFiles: readMediaFiles(entries, inlined),
    fromZip: true,
    manifestSource: manifestPath ? 'json' : (embedded ? 'embedded' : null),
  };
}

/** The example page, ready to upload. */
export function buildExampleSite() {
  return EXAMPLE_SITE_HTML;
}

/** A ready-made example zip for researchers to try the upload flow. */
export function buildExampleZip() {
  return zipSync({ 'street-perception-example/index.html': strToU8(EXAMPLE_SITE_HTML) });
}

/** Accepts raw JSON or a model reply that wraps the JSON in a ```json fence. */
export function parseSpSchemePackage(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The package is empty.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [raw, fenced?.[1]];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('The package is not valid JSON.');
}

function allQuestions(survey) {
  const out = [];
  const walk = (elements, path) => (elements || []).forEach((element, index) => {
    const elementPath = `${path}[${index}]`;
    if (!element || typeof element !== 'object') return;
    out.push({ element, path: elementPath });
    if (Array.isArray(element.elements)) walk(element.elements, `${elementPath}.elements`);
  });
  (survey?.pages || []).forEach((page, i) => walk(page?.elements, `survey.pages[${i}].elements`));
  return out;
}

function schemeQuestionNames(pkg) {
  return allQuestions(pkg?.survey || pkg).map(({ element }) => element.name).filter(Boolean).sort();
}

const URL_RE = /^(https?:|data:|blob:)/i;
function mentionsUrl(value) {
  if (typeof value === 'string') return URL_RE.test(value.trim());
  if (Array.isArray(value)) return value.some(mentionsUrl);
  if (value && typeof value === 'object') {
    return ['url', 'imageUrl', 'imageLink', 'value', 'src'].some((key) => mentionsUrl(value[key]));
  }
  return false;
}

function issue(list, path, message) {
  list.push({ path, message });
}

/** Short stable id for an imported site, recorded with every response. */
export /** Short relative folder names of letters, digits, _ - and /. */
function normalizeMediaFolders(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((f) => String(f || '').trim().replace(/^\/+|\/+$/g, '')).filter((f) => /^[\w-]+(\/[\w-]+)*$/.test(f)))].slice(0, 50);
}

function siteId(html) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < html.length; i += 1) {
    const c = html.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `site-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/**
 * Check a package against the platform contract without saving anything.
 * @param {object|null} pkg survey package (from sp-scheme.json or the page's embedded JSON)
 * @param {{ siteHtml?: string|null }} options the uploaded page, if any
 * @returns {{ ok, errors, warnings, survey, site, summary }}
 */
export function validateSpSchemePackage(pkg, { siteHtml = null, allowedHosts = [] } = {}) {
  const errors = [];
  const warnings = [];
  const empty = { ok: false, errors, warnings, survey: null, site: null, summary: null };

  if (pkg?.__invalid) {
    issue(errors, 'sp-scheme', 'The <script id="sp-scheme"> block in index.html is not valid JSON.');
    return empty;
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    issue(errors, '', siteHtml
      ? 'index.html has no <script type="application/json" id="sp-scheme"> block describing the questions.'
      : 'The package must be a JSON object.');
    return empty;
  }
  if (pkg.format !== SP_SCHEME_FORMAT) {
    issue(warnings, 'format', `Expected "format": "${SP_SCHEME_FORMAT}".`);
  }
  if (pkg.spScheme && String(pkg.spScheme).split('.')[0] !== SP_SCHEME_VERSION.split('.')[0]) {
    issue(errors, 'spScheme', `This package was made with SP-Scheme ${pkg.spScheme}. Copy the current SP-Scheme (${SP_SCHEME_VERSION}) from the Builder and ask the model to rebuild the page with it.`);
  }
  if (Array.isArray(pkg.customInteractions) && pkg.customInteractions.length) {
    issue(errors, 'customInteractions', 'SP-Scheme no longer uses per-question custom interactions: build the whole survey as one index.html page and record answers with SPSite.answer.');
  }
  const secretPaths = findSecretFields(pkg);
  if (secretPaths.length) {
    issue(errors, secretPaths[0], `Remove credential fields: ${secretPaths.slice(0, 5).join(', ')}.`);
  }
  const survey = pkg.survey;
  if (!survey || typeof survey !== 'object' || !Array.isArray(survey.pages)) {
    issue(errors, 'survey.pages', 'survey.pages must be an array of pages.');
    return empty;
  }

  const working = JSON.parse(JSON.stringify(survey));
  const hasSite = Boolean(siteHtml && String(siteHtml).trim());
  allQuestions(working).forEach(({ element, path }) => {
    const label = element.name || path;
    if (element.skillHtml || element.sourceHtml) {
      issue(errors, `${path}.skillHtml`, `${label}: HTML belongs in index.html, not on a question.`);
    }
    if (element.type === 'skillquestion') {
      const sid = String(element.skillId || '');
      if (hasSite) {
        issue(errors, `${path}.type`, `${label}: your page draws the interface, so declare this question with a native type (for a two-image choice use imagepicker with imageCount 2) instead of skillquestion.`);
      } else if (sid.startsWith('custom:')) {
        issue(errors, `${path}.skillId`, `${label}: custom interactions are no longer supported; build the survey as index.html.`);
      } else if (sid.startsWith('preset_') && !getPresetSkill(sid)) {
        issue(errors, `${path}.skillId`, `${label}: unknown built-in task "${sid}".`);
      }
    } else if (hasSite && element.name && answerKindOf(element) === 'unsupported') {
      issue(errors, `${path}.type`, `${label}: type "${element.type}" cannot be answered from a page; pick a type from SP-Scheme section 3.`);
    }
    if ((element.type === 'imagepicker' || element.type === 'mediapicker') && Number(element.imageCount ?? 2) < 2) {
      issue(errors, `${path}.type`, `${label}: ${element.type} asks the participant to choose between images, but it shows only ${Number(element.imageCount) || 1}. To rate one image on a few labelled options, use imagerating with imageCount 1, rateMin/rateMax covering the options and rateLabels (one label per option).`);
    }
    if (questionHasTrait(element.type, 'stimulus') || element.type === 'skillquestion') {
      const manual = element.imageSelectionMode === 'huggingface_manual';
      const urlFields = ['choices', 'imageLinks', 'selectedImageUrls', 'annotationImageUrl']
        .filter((key) => mentionsUrl(element[key]));
      if (urlFields.length && !manual) {
        issue(errors, `${path}.${urlFields[0]}`, `${label}: media URLs are not allowed; the platform draws media from the project pool. Leave ${urlFields.join(', ')} empty.`);
      } else if (urlFields.length) {
        issue(warnings, `${path}.${urlFields[0]}`, `${label}: curated media URLs must already be in this project's media library; re-pick them in the Builder if unsure.`);
      } else if (manual) {
        issue(warnings, path, `${label}: curated media mode — pick the files in the Builder after import.`);
      }
    }
  });

  const normalized = normalizeBuilderSurveyJson(postProcessAiConfig(working));
  const report = validateSurveyConfig(normalized);
  report.errors.forEach((item) => issue(errors, `survey.${String(item.path || '').replace(/^surveyConfig\.?/, '')}`, item.message));
  report.warnings.forEach((item) => issue(warnings, `survey.${String(item.path || '').replace(/^surveyConfig\.?/, '')}`, item.message));

  const questions = allQuestions(normalized);
  const names = questions.map(({ element }) => element.name).filter(Boolean);
  let site = null;
  if (hasSite) {
    const html = stripSitePreviewShim(siteHtml);
    const answerable = questions
      .filter(({ element }) => element.name && !['display', 'unsupported'].includes(answerKindOf(element)))
      .map(({ element }) => element.name);
    const hosts = normalizeAllowedHosts(allowedHosts);
    const checked = checkSiteHtml(html, answerable, { allowedHosts: hosts, raw: answerable.length === 0 });
    checked.errors.forEach((message) => issue(errors, 'index.html', message));
    checked.warnings.forEach((message) => issue(warnings, 'index.html', message));
    if (pkg.__embeddedNames && pkg.__embeddedNames.join(',') !== [...names].sort().join(',')) {
      issue(warnings, 'index.html', 'The questions embedded in index.html differ from sp-scheme.json; sp-scheme.json is used.');
    }
    const mediaFolders = normalizeMediaFolders(survey.mediaFolders);
    site = { html, bytes: utf8Bytes(html), id: siteId(html), allowedHosts: hosts, externalHosts: externalHostsIn(html), mediaFolders, completeOn: typeof survey.completeOn === 'string' ? survey.completeOn.slice(0, 200) : null };
  } else {
    issue(warnings, 'index.html', 'No index.html in the upload, so participants will see the platform\'s standard question style. Upload the page the model built to use its interface.');
  }

  const types = {};
  questions.forEach(({ element }) => { types[element.type] = (types[element.type] || 0) + 1; });
  const match = siteMatchLevel({ pages: normalized.pages });
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    survey: normalized,
    site,
    summary: {
      title: normalized.title || '',
      pageCount: normalized.pages.length,
      questionCount: questions.length,
      hasSite: Boolean(site),
      siteBytes: site?.bytes || 0,
      types,
      // full: every question a platform type; partial / custom: some or all
      // recorded as is; none: nothing declared, the page's requests are kept raw.
      match: match.level,
      nativeCount: match.native,
      customCount: match.custom,
    },
  };
}

/**
 * Return the survey config to load into the Builder. Call only with a
 * validated report. The site (if any) is stored on the config as `spSite`.
 * @param {object} report validateSpSchemePackage result with ok=true
 * @param {{ baseConfig?: object }} deps
 */
export function applySpSchemePackage(report, { baseConfig = {} } = {}) {
  if (!report?.ok) throw new Error('Fix the package errors before importing.');
  const survey = JSON.parse(JSON.stringify(report.survey));
  const importedAt = new Date().toISOString();
  // Keep project-level settings the package does not describe (theme, logo, runtime context).
  const next = {
    ...baseConfig,
    ...survey,
    theme: survey.theme || baseConfig.theme,
    spScheme: { version: SP_SCHEME_VERSION, importedAt },
  };
  // Site-level settings live on spSite, not on the survey.
  delete next.mediaFolders;
  delete next.completeOn;
  if (report.site) {
    next.spSite = { html: report.site.html, id: report.site.id, version: SP_SITE_VERSION, importedAt };
    // Domains the researcher allowed this page to reach; recorded with the survey.
    if (report.site.allowedHosts?.length) next.spSite.allowedHosts = [...report.site.allowedHosts];
    // Folders the page draws from itself (SPSite.getMedia) and, with no questions
    // declared, which of its requests means it is finished.
    if (report.site.mediaFolders?.length) next.spSite.mediaFolders = [...report.site.mediaFolders];
    if (report.site.completeOn) next.spSite.completeOn = report.site.completeOn;
  } else {
    delete next.spSite;
  }
  return next;
}

export const SP_SCHEME_EXAMPLE_PACKAGE = EXAMPLE_PACKAGE;

/** Sections 1-4 of SP-Scheme (rules, types, SPSite API): the reference for page conversion. */
export function buildConvertReference() {
  // Only the question types, answer shapes and the SPSite API: the rest of
  // SP-Scheme is about designing a page from scratch, which conversion does not do.
  const text = buildSpSchemeText();
  const from = text.indexOf('## 3.');
  const cut = text.indexOf('## 5.');
  return from >= 0 && cut > from ? text.slice(from, cut).trim() : text;
}
