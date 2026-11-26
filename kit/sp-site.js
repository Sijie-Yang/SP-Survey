/*!
 * sp-site.js — SP-Survey Kit runtime (self-hosted SP-Scheme pages)
 * MIT License · https://github.com/Sijie-Yang/SP-Survey
 *
 * Gives an SP-Scheme page (one index.html with an embedded
 * <script type="application/json" id="sp-scheme"> block) the same `window.SPSite`
 * it gets on sp-survey.org, but runs on any static host:
 *
 *   - media come from the folders next to index.html (listed in media.json,
 *     written by `node kit/sp.mjs check <site>`);
 *   - every media question draws its files per participant, either at random
 *     (Fisher–Yates) or balanced ("pairingMode": "balanced"): each participant
 *     claims a number from your own Supabase and takes that stretch of a seeded
 *     queue, so every image is shown equally often;
 *   - answers are checked against the declared question type, then stored in
 *     your own Supabase (`survey_responses`, via submit_survey_response), or in
 *     local files when the page is served by `node kit/sp.mjs serve`.
 *
 * Nothing here uses a model; the same number and the same library always give
 * the same images. No dependencies.
 */
(function () {
  'use strict';
  if (window.SPSite) return;

  var VERSION = 'kit-1.0';
  var KIND = { text: 'text', comment: 'text', number: 'number', rating: 'rating', imagerating: 'rating', mediarating: 'rating',
    boolean: 'boolean', consent: 'boolean', imageboolean: 'boolean', mediaboolean: 'boolean',
    radiogroup: 'choice', dropdown: 'choice', imagepicker: 'choice', mediapicker: 'choice',
    checkbox: 'multiChoice', imagecheckbox: 'multiChoice', mediacheckbox: 'multiChoice',
    ranking: 'ranking', imageranking: 'ranking', mediaranking: 'ranking',
    slidergroup: 'sliders', imageslidergroup: 'sliders', mediaslidergroup: 'sliders',
    matrix: 'matrix', imagematrix: 'matrix', mediamatrix: 'matrix',
    pointallocation: 'allocation', imagepointallocation: 'allocation', mediapointallocation: 'allocation',
    imageannotation: 'annotation', custom: 'custom',
    html: 'display', expression: 'display', image: 'display', mediadisplay: 'display' };
  var MEDIA_CHOICE = { imagepicker: 'image_', imageranking: 'image_', mediaranking: 'image_', mediapicker: 'media_' };
  var MEDIA_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac)$/i;
  var COLORS = ['#8fb3d9', '#d9a38f', '#9fd98f', '#d9cf8f', '#b38fd9', '#8fd9cf'];
  var LOCAL_NUMBER_RANGE = 4096;

  // ---------- deterministic randomness (same as the platform's src/lib/shuffle.js) ----------
  function shuffled(list, rand) {
    var out = list.slice();
    rand = rand || Math.random;
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rand() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }
  function hashSeed() {
    var text = Array.prototype.map.call(arguments, function (p) { return String(p == null ? '' : p); }).join('␟');
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function seededRandom(seed) {
    var a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Positions (0..n-1) participant `number` takes when each takes `perPerson` (platform: balancedDraw.js).
  function balancedSlice(n, perPerson, number, seed) {
    var size = Math.max(0, Math.floor(n) || 0);
    if (!size) return [];
    var m = Math.max(1, Math.min(Math.floor(perPerson) || 1, size));
    var k = Math.max(0, Math.floor(number) || 0);
    var first = k * m;
    var lastPass = Math.floor((first + m - 1) / size);
    var firstPass = Math.floor(first / size);
    var prev = null, kept = {};
    for (var q = 0; q <= lastPass; q += 1) {
      var order = shuffled(range(size), seededRandom(hashSeed(seed, 'pass', q)));
      if (q > 0) {
        var passStart = q * size;
        var stretchStart = Math.floor(passStart / m) * m;
        if (stretchStart < passStart) {
          var head = Math.min(stretchStart + m - passStart, size);
          var tail = prev.slice(stretchStart - (q - 1) * size);
          for (var i = 0; i < head; i += 1) {
            if (tail.indexOf(order[i]) < 0) continue;
            for (var j = head; j < size; j += 1) {
              if (tail.indexOf(order[j]) < 0) { var t = order[i]; order[i] = order[j]; order[j] = t; break; }
            }
          }
        }
      }
      if (q >= firstPass) kept[q] = order;
      prev = order;
    }
    var out = [];
    for (var s = first; s < first + m; s += 1) out.push(kept[Math.floor(s / size)][s % size]);
    return out;
  }
  function range(n) { var a = []; for (var i = 0; i < n; i += 1) a.push(i); return a; }

  // ---------- state ----------
  var questions = [], survey = {}, answers = {}, displayed = {}, ready = false, waiters = [];
  var lang = 'en', config = {}, files = [], usedPlaceholders = false, assignment = null, participantId = '', startedAt = Date.now();
  var submitted = false, storeKey = '';

  function text(v) { if (v == null) return ''; if (typeof v === 'object') return String(v[lang] || v['default'] || v.en || ''); return String(v); }
  function items(list) {
    return (list || []).map(function (c) {
      if (c && typeof c === 'object') return { value: String(c.value != null ? c.value : c.text), text: text(c.text != null ? c.text : c.value) };
      return { value: String(c), text: String(c) };
    });
  }
  function folderOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
  function baseName(path) { return path.slice(path.lastIndexOf('/') + 1); }
  function cleanFolder(f) { return String(f || '').replace(/^\.?\/+|\/+$/g, ''); }
  function mediaType(path) { return /\.(mp4|webm|mov|m4v)$/i.test(path) ? 'video' : (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(path) ? 'audio' : 'image'); }
  function fileItem(path) { return { url: encodeURI(path), name: baseName(path), path: path, type: mediaType(path) }; }
  function inFolders(path, folders) {
    if (!folders || !folders.length) return true;
    return folders.some(function (f) { f = cleanFolder(f); return !f || path === f || path.indexOf(f + '/') === 0; });
  }
  var placeholderCount = 0;
  function placeholder(label) {
    placeholderCount += 1;
    usedPlaceholders = true;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="' + COLORS[placeholderCount % COLORS.length] + '"/><text x="320" y="225" font-size="36" text-anchor="middle" fill="#222" font-family="sans-serif">' + label + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name: 'placeholder_' + placeholderCount + '.svg', path: 'placeholder_' + placeholderCount + '.svg', type: 'image', placeholder: true };
  }

  // ---------- media drawing ----------
  function mediaCount(el) {
    if (!/^(image|media)/.test(el.type)) return 0;
    return Math.max(1, Number(el.imageCount) || (MEDIA_CHOICE[el.type] ? 4 : 1));
  }
  function trialCountOf(el) { return Math.max(1, Math.floor(Number(el.trialCount) || 1)); }
  function poolFor(el) { return files.filter(function (p) { return inFolders(p, el.mediaFolders); }); }
  function setsFor(el, size) {
    var byFolder = {};
    poolFor(el).forEach(function (p) { var f = folderOf(p); (byFolder[f] = byFolder[f] || []).push(p); });
    return Object.keys(byFolder).sort().filter(function (f) { return byFolder[f].length === size; })
      .map(function (f) { return { key: f, files: byFolder[f].sort() }; });
  }
  function isSetMode(el) { return el.mediaAssignmentMode === 'set'; }
  function isBalanced(el) { return /^(balanced|adaptive|uncertain|high_sigma)$/.test(String(el.pairingMode || '')); }

  // One queue per library that balanced questions share (platform: balanceGroupsForSurvey).
  function balancePlan(elements, number, seed) {
    var groups = {}, order = [];
    elements.forEach(function (el) {
      var n = mediaCount(el);
      if (!n || !isBalanced(el)) return;
      var keys = isSetMode(el) ? setsFor(el, n).map(function (s) { return s.key; }) : poolFor(el).slice().sort();
      if (keys.length < 2) return;
      var per = isSetMode(el) ? trialCountOf(el) : trialCountOf(el) * n;
      var shared = el.excludePreviouslyUsedImages !== false;
      var id = (isSetMode(el) ? 'set' + n : 'file') + '|' + (shared ? 'shared' : 'own:' + el.name) + '|' + keys.length + '|' + keys.join('␟');
      if (!groups[id]) { groups[id] = { id: id, keys: keys, perPerson: 0, questions: [] }; order.push(id); }
      groups[id].perPerson += per;
      groups[id].questions.push(el.name);
    });
    var byQuestion = {};
    order.forEach(function (id) {
      var g = groups[id];
      var gSeed = hashSeed(seed, g.id);
      var slice = balancedSlice(g.keys.length, g.perPerson, number, gSeed).map(function (i) { return g.keys[i]; });
      var queue = { keys: shuffled(slice, seededRandom(hashSeed(gSeed, 'order', number))), at: 0 };
      g.questions.forEach(function (q) { byQuestion[q] = queue; });
    });
    return {
      any: order.length > 0,
      take: function (name, count) {
        var q = byQuestion[name];
        if (!q || q.at + count > q.keys.length) return null;
        var out = q.keys.slice(q.at, q.at + count);
        q.at += count;
        return out;
      },
    };
  }

  function drawFor(el, plan, usedFiles, usedSets, trial) {
    var n = mediaCount(el);
    if (!n) return [];
    var exclude = el.excludePreviouslyUsedImages !== false;
    if (isSetMode(el)) {
      var sets = setsFor(el, n);
      var key = plan && isBalanced(el) ? (plan.take(el.name, 1) || [])[0] : null;
      var pick = key ? sets.filter(function (s) { return s.key === key; })[0] : null;
      if (!pick) {
        var free = sets.filter(function (s) { return !exclude || !usedSets[s.key]; });
        pick = free.length ? free[Math.floor(Math.random() * free.length)] : null;
      }
      if (!pick) return range(n).map(function (i) { return placeholder((trial != null ? 'Trial ' + (trial + 1) + ' · ' : '') + 'Image ' + (i + 1)); });
      usedSets[pick.key] = true;
      return shuffled(pick.files).map(fileItem);
    }
    var chosen = plan && isBalanced(el) ? plan.take(el.name, n) : null;
    if (!chosen) {
      var pool = poolFor(el);
      var fresh = pool.filter(function (p) { return !exclude || !usedFiles[p]; });
      if (fresh.length < n) fresh = pool; // library too small: allow repeats rather than fail
      chosen = shuffled(fresh).slice(0, n);
    }
    chosen.forEach(function (p) { usedFiles[p] = true; });
    var out = chosen.map(fileItem);
    while (out.length < n) out.push(placeholder((trial != null ? 'Trial ' + (trial + 1) + ' · ' : '') + 'Image ' + (out.length + 1)));
    return out;
  }

  // ---------- questions ----------
  function flatElements(pages) {
    var out = [];
    function walk(list, page) {
      (list || []).forEach(function (el) {
        if (!el || typeof el !== 'object') return;
        if (el.type === 'panel' || el.type === 'paneldynamic') { walk(el.elements || el.templateElements, page); return; }
        out.push({ el: el, page: page });
      });
    }
    (pages || []).forEach(function (p) { walk(p.elements, p.name || null); });
    return out;
  }

  function buildQuestions(s, plan, saved) {
    var usedFiles = {}, usedSets = {};
    flatElements(s.pages).forEach(function (entry) {
      var el = entry.el;
      if (!el.name) return;
      var kind = (el.type === 'text' && el.inputType === 'number') ? 'number' : (KIND[el.type] || 'unsupported');
      var q = { name: el.name, page: entry.page, type: el.type, kind: kind, title: text(el.title) || el.name,
        description: text(el.description), required: !!el.isRequired, trialCount: trialCountOf(el) };
      if (kind === 'number') { q.min = el.min != null ? el.min : null; q.max = el.max != null ? el.max : null; }
      if (kind === 'text' && el.maxLength) q.maxLength = el.maxLength;
      if (kind === 'rating') {
        q.rateMin = Number(el.rateMin != null ? el.rateMin : 1); q.rateMax = Number(el.rateMax != null ? el.rateMax : 5);
        if (el.rateValues) q.rateValues = items(el.rateValues);
        else if (el.rateLabels) q.rateValues = el.rateLabels.map(function (t, i) { return { value: q.rateMin + i * (Number(el.rateStep) || 1), text: text(t) }; });
        q.minLabel = text(el.minRateDescription); q.maxLabel = text(el.maxRateDescription);
      }
      if (kind === 'boolean') { q.labelTrue = text(el.labelTrue); q.labelFalse = text(el.labelFalse); }
      if (kind === 'sliders') q.dimensions = (el.dimensions || []).map(function (d) { return { id: String(d.id), label: text(d.label), left: text(d.left), right: text(d.right), min: d.min != null ? d.min : (el.scaleMin != null ? el.scaleMin : 1), max: d.max != null ? d.max : (el.scaleMax != null ? el.scaleMax : 7), step: d.step != null ? d.step : (el.scaleStep || 1) }; });
      if (kind === 'matrix') { q.rows = items(el.rows); q.columns = items(el.columns); }
      if (kind === 'allocation') q.budget = Number(el.budget != null ? el.budget : 100);
      if (kind === 'annotation') { q.tools = el.allowedTools || ['point', 'line', 'polygon', 'bbox']; q.labels = items(el.annotationLabels).map(function (l) { return l.text; }); q.minShapes = el.minAnnotations || 0; q.maxShapes = el.maxAnnotations || 50; }
      function choicesFor(m) {
        var list;
        if (MEDIA_CHOICE[el.type]) list = m.map(function (x, i) { return { value: MEDIA_CHOICE[el.type] + i, text: x.name, imageUrl: x.url }; });
        else if (/^(choice|multiChoice|ranking|allocation)$/.test(kind)) list = items(el.choices);
        if (list && el.allowTie && el.tieLabel) list.push({ value: String(el.tieLabel), text: String(el.tieLabel), tie: true });
        return list;
      }
      function restore(paths) { return paths.map(function (p) { return /^placeholder_/.test(p) ? placeholder('Image') : fileItem(p); }); }
      var hasMedia = mediaCount(el) > 0;
      if (q.trialCount > 1) {
        q.trials = [];
        for (var t = 0; t < q.trialCount; t += 1) {
          var prev = saved && saved[el.name] && saved[el.name][t];
          var m = hasMedia ? (prev ? restore(prev) : drawFor(el, plan, usedFiles, usedSets, t)) : [];
          q.trials.push({ media: m, choices: choicesFor(m) });
        }
        if (hasMedia) displayed[el.name] = q.trials.map(function (tr) { return tr.media.map(function (x) { return x.path; }); });
      } else {
        var prev1 = saved && saved[el.name] && saved[el.name][0];
        q.media = hasMedia ? (prev1 ? restore(prev1) : drawFor(el, plan, usedFiles, usedSets, null)) : [];
        var c = choicesFor(q.media);
        if (c) q.choices = c;
        if (hasMedia) displayed[el.name] = [q.media.map(function (x) { return x.path; })];
      }
      questions.push(q);
    });
  }
  function find(name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; }

  // ---------- answer checks (platform: validateSiteAnswer) ----------
  function fail(msg) { return { ok: false, error: msg }; }
  function asValue(v) { return v == null ? v : String(v); }
  function check(q, value, choices) {
    var allowed = (choices || []).map(function (c) { return c.value; });
    var n, list;
    switch (q.kind) {
      case 'custom': { var s; try { s = JSON.stringify(value); } catch (e) { return fail('Expected a JSON value'); } if (s === undefined) return fail('Expected a JSON value'); if (s.length > 32768) return fail('Value larger than 32 KB'); return { ok: true, value: JSON.parse(s) }; }
      case 'text': { var tx = typeof value === 'string' ? value : String(value); if (q.maxLength && tx.length > q.maxLength) return fail('Text longer than ' + q.maxLength + ' characters'); return { ok: true, value: tx }; }
      case 'number': n = Number(value); if (value === '' || typeof value === 'boolean' || !isFinite(n)) return fail('Expected a number'); if (q.min != null && n < q.min) return fail('Expected a number ≥ ' + q.min); if (q.max != null && n > q.max) return fail('Expected a number ≤ ' + q.max); return { ok: true, value: n };
      case 'rating':
        if (q.rateValues && q.rateValues.length) {
          var hit = q.rateValues.filter(function (r) { return String(r.value) === asValue(value); })[0];
          if (!hit) return fail('Expected one of ' + q.rateValues.map(function (r) { return r.value; }).join(', '));
          n = Number(hit.value); return { ok: true, value: isFinite(n) ? n : hit.value };
        }
        n = Number(value); if (!isFinite(n) || n < q.rateMin || n > q.rateMax) return fail('Expected a number from ' + q.rateMin + ' to ' + q.rateMax); return { ok: true, value: n };
      case 'boolean': if (typeof value !== 'boolean') return fail('Expected true or false'); return { ok: true, value: value };
      case 'choice': if (allowed.indexOf(asValue(value)) < 0) return fail('Expected one of ' + allowed.join(', ')); return { ok: true, value: asValue(value) };
      case 'multiChoice':
        if (!Array.isArray(value)) return fail('Expected an array of choice values');
        list = value.map(asValue);
        if (list.some(function (v) { return allowed.indexOf(v) < 0; })) return fail('Every item must be one of ' + allowed.join(', '));
        return { ok: true, value: list };
      case 'ranking': {
        if (!Array.isArray(value)) return fail('Expected an array of choice values, best first');
        list = value.map(asValue);
        var ranked = (choices || []).filter(function (c) { return !c.tie; }).map(function (c) { return c.value; });
        if (list.some(function (v) { return ranked.indexOf(v) < 0; }) || list.length !== ranked.length) return fail('Rank all ' + ranked.length + ' items: ' + ranked.join(', '));
        return { ok: true, value: list };
      }
      case 'sliders': {
        if (!value || typeof value !== 'object') return fail('Expected { <dimension id>: number }');
        var out = {};
        for (var i = 0; i < q.dimensions.length; i += 1) {
          var d = q.dimensions[i]; n = Number(value[d.id]);
          if (!isFinite(n) || n < d.min || n > d.max) return fail('Dimension ' + d.id + ' needs a number from ' + d.min + ' to ' + d.max);
          out[d.id] = n;
        }
        return { ok: true, value: out };
      }
      case 'matrix': {
        if (!value || typeof value !== 'object') return fail('Expected { <row value>: <column value> }');
        var cols = q.columns.map(function (c) { return c.value; });
        var bad = q.rows.filter(function (r) { return cols.indexOf(asValue(value[r.value])) < 0; });
        if (bad.length) return fail('Rows need a column value: ' + bad.map(function (r) { return r.value; }).join(', '));
        return { ok: true, value: value };
      }
      case 'allocation': {
        if (!value || typeof value !== 'object') return fail('Expected { <choice value>: points }');
        var sum = 0;
        for (var key in value) { if (allowed.indexOf(key) < 0) return fail('Unknown choice ' + key); sum += Number(value[key]) || 0; }
        if (Math.abs(sum - q.budget) > 1e-9) return fail('Points must add up to ' + q.budget);
        return { ok: true, value: value };
      }
      case 'annotation': if (!value || !Array.isArray(value.shapes)) return fail('Expected { shapes: [...] }'); return { ok: true, value: value };
      case 'display': return fail(q.name + ' only shows content and records nothing');
      default: return fail('Question type ' + q.type + ' cannot record answers');
    }
  }

  // ---------- persistence in this browser (resume after reload) ----------
  function save() {
    if (!storeKey) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ answers: answers, displayed: displayed, assignment: assignment, participantId: participantId, startedAt: startedAt })); } catch (e) { /* private mode */ }
  }
  function load() { try { return JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { return null; } }

  // ---------- Supabase ----------
  function hasSupabase() { return !!(config.supabaseUrl && config.supabaseAnonKey); }
  function rpc(name, body) {
    return fetch(String(config.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey, Authorization: 'Bearer ' + config.supabaseAnonKey },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(name + ' failed (' + r.status + '): ' + t.slice(0, 200)); });
      return r.json();
    });
  }
  function claimNumber() {
    if (hasSupabase()) {
      return rpc('claim_balance_number', { p_project_id: config.projectId })
        .then(function (r) { return { n: Number(r.n), claim: 'server', claim_id: r.claim_id || null }; })
        .catch(function (err) { console.warn('[SPSite] balanced number from Supabase failed; drawing at random', err); return local(); });
    }
    return fetch('__sp/claim?project=' + encodeURIComponent(config.projectId), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('no local server'); return r.json(); })
      .then(function (r) { return { n: Number(r.n), claim: 'local-server', claim_id: r.claim_id || null }; })
      .catch(local);
    function local() { return { n: Math.floor(Math.random() * LOCAL_NUMBER_RANGE), claim: 'local', claim_id: null }; }
  }

  // ---------- submit ----------
  function payload() {
    var params = {};
    try { new URLSearchParams(location.search).forEach(function (v, k) { params[k] = v; }); } catch (e) { /* old browser */ }
    var finished = Date.now();
    return {
      project_id: config.projectId,
      participant_id: participantId,
      responses: answers,
      displayed_images: displayed,
      survey_metadata: {
        completion_code: participantId + '-' + startedAt,
        sp_site: { runtime: 'sp-survey-kit', version: VERSION, title: survey.title },
        balanced_draw: assignment,
        preview_media: usedPlaceholders,
        url_params: params,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date(finished).toISOString(),
        duration_ms: finished - startedAt,
        locale: lang,
        user_agent: navigator.userAgent,
      },
    };
  }
  function send(body) {
    if (hasSupabase()) return rpc('submit_survey_response', { p_response: body }).then(function () { return 'supabase'; });
    return fetch('__sp/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('No place to store responses: set supabaseUrl and supabaseAnonKey in sp-config.json'); return 'local'; });
  }
  function sendWithRetry(body, tries) {
    return send(body).catch(function (err) {
      if (tries <= 1) throw err;
      return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return sendWithRetry(body, tries - 1); });
    });
  }
  function screen(html) {
    var box = document.createElement('div');
    box.id = 'sp-site-screen';
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#fff;color:#111;font:18px/1.5 system-ui,sans-serif;text-align:center;z-index:2147483647';
    box.innerHTML = '<div style="max-width:520px">' + html + '</div>';
    var old = document.getElementById('sp-site-screen');
    if (old) old.remove();
    document.body.appendChild(box);
    return box;
  }
  var T = {
    en: { thanks: 'Thank you! Your answers have been recorded.', sending: 'Submitting…', failed: 'Your answers could not be sent.', retry: 'Try again', download: 'Download my answers', placeholder: 'Preview images: add image files to this study\'s media folders, then run "node kit/sp.mjs check".' },
    zh: { thanks: '感谢参与！您的回答已记录。', sending: '正在提交…', failed: '回答没有发送成功。', retry: '重试', download: '下载我的回答', placeholder: '这是占位图：把图片放进研究的媒体文件夹，再运行 "node kit/sp.mjs check"。' },
  };
  function t(key) { return (T[lang] || T.en)[key]; }

  function finish() {
    var body = payload();
    screen('<p>' + t('sending') + '</p>');
    return sendWithRetry(body, 3).then(function (where) {
      submitted = true;
      try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ }
      var url = config.completionUrl ? String(config.completionUrl).replace('{participant}', encodeURIComponent(participantId)) : '';
      screen('<p>' + (text(config.thankYou) || t('thanks')) + '</p>');
      if (url) setTimeout(function () { location.href = url; }, 1500);
      return { ok: true, storedIn: where };
    }).catch(function (err) {
      console.error('[SPSite] submit failed', err);
      var box = screen('<p>' + t('failed') + '</p><p style="font-size:14px;color:#666">' + String(err.message || err).replace(/</g, '&lt;') + '</p><button id="sp-retry" style="margin:8px;padding:10px 18px">' + t('retry') + '</button><button id="sp-dl" style="margin:8px;padding:10px 18px">' + t('download') + '</button>');
      box.querySelector('#sp-retry').onclick = function () { finish(); };
      box.querySelector('#sp-dl').onclick = function () {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
        a.download = 'sp-survey-response-' + participantId + '.json';
        a.click();
      };
      return { ok: false, error: String(err.message || err) };
    });
  }

  // ---------- public API (same names as on sp-survey.org) ----------
  window.SPSite = {
    version: VERSION,
    platform: false,
    selfHosted: true,
    allowedHosts: [],
    onReady: function (cb) { if (ready) cb({ questions: questions, survey: survey, answers: answers }); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: find,
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    getMedia: function (folder) {
      var list = (survey.mediaFolders || []);
      if (folder === undefined) { var all = {}; list.forEach(function (f) { all[f] = window.SPSite.getMedia(f); }); return all; }
      var f = cleanFolder(folder);
      var hits = files.filter(function (p) { return inFolders(p, [f]); }).map(fileItem);
      if (!hits.length) console.warn('[SPSite] getMedia("' + folder + '"): no files in that folder. Add images, then run node kit/sp.mjs check');
      return hits;
    },
    onSubmit: function () { /* platform-only hook; nothing is intercepted when self-hosted */ },
    onRequest: function () { /* platform-only hook */ },
    answer: function (name, value, options) {
      var q = find(name);
      if (!q) return Promise.resolve(fail('Unknown question "' + name + '"'));
      if (submitted) return Promise.resolve(fail('Already submitted'));
      var key = options && options.key, shown = options && options.shown;
      if (key != null || (shown != null && !(q.trialCount > 1 && options.trial != null))) {
        // Page-drawn media: one record per item, replaced when the same key comes again.
        var rec = answers[name] && answers[name].trials ? answers[name] : { trials: [] };
        var list = [].concat(shown == null ? [] : shown).map(String);
        var at = -1;
        if (key != null) for (var i = 0; i < rec.trials.length; i += 1) if (rec.trials[i].key === String(key)) at = i;
        if (value == null) { if (at >= 0) rec.trials.splice(at, 1); }
        else {
          var ok = q.kind === 'custom' || q.kind === 'unsupported' ? { ok: true, value: value } : check(q, value, q.choices);
          if (!ok.ok) return Promise.resolve(ok);
          var e = { value: ok.value, shown_images: list, shown_media_ids: list };
          if (key != null) e.key = String(key);
          if (at >= 0) rec.trials[at] = e; else rec.trials.push(e);
        }
        if (rec.trials.length) answers[name] = rec; else delete answers[name];
      } else if (q.trialCount > 1) {
        var tr = options && options.trial;
        if (typeof tr !== 'number' || tr < 0 || tr >= q.trialCount) return Promise.resolve(fail(name + ' repeats ' + q.trialCount + ' times: pass { trial: 0…' + (q.trialCount - 1) + ' }'));
        var cur = answers[name] || { trials: [] };
        while (cur.trials.length < q.trialCount) cur.trials.push({ value: null, shown_images: [] });
        if (value == null) cur.trials[tr] = { value: null, shown_images: [] };
        else {
          var r = check(q, value, q.trials[tr].choices);
          if (!r.ok) return Promise.resolve(r);
          var shownPaths = q.trials[tr].media.map(function (m) { return m.path; });
          cur.trials[tr] = { value: r.value, shown_images: shownPaths, shown_media_ids: shownPaths };
        }
        answers[name] = cur;
      } else if (value == null) {
        delete answers[name];
      } else {
        var r1 = check(q, value, q.choices);
        if (!r1.ok) return Promise.resolve(r1);
        answers[name] = r1.value;
      }
      save();
      return Promise.resolve({ ok: true });
    },
    complete: function () {
      if (submitted) return Promise.resolve({ ok: true });
      var missing = questions.filter(function (q) {
        if (!q.required || q.kind === 'display') return false;
        var v = answers[q.name];
        if (v && v.trials) {
          if (v.trials.some(function (x) { return x.key != null; })) return false; // page-drawn records
          return v.trials.length < q.trialCount || v.trials.some(function (x) { return x.value == null; });
        }
        if (q.trialCount > 1) return true;
        return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
      }).map(function (q) { return q.name; });
      if (missing.length) return Promise.resolve({ ok: false, missing: missing, error: 'Required questions are unanswered: ' + missing.join(', ') });
      return finish();
    },
  };

  // ---------- start ----------
  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function newId() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function banner(msg) {
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:min(420px,90vw);background:#fff7d6;color:#5c4400;border:1px solid #e6c15a;border-radius:6px;padding:6px 10px;font:12px/1.4 system-ui,sans-serif;z-index:2147483646';
    b.textContent = msg;
    document.body.appendChild(b);
  }

  function start() {
    var node = document.getElementById('sp-scheme');
    var scheme = {};
    try { scheme = JSON.parse(node ? node.textContent : '{}'); } catch (err) { console.error('[SPSite] invalid sp-scheme JSON', err); }
    var s = (scheme && scheme.survey) || scheme || {};
    Promise.all([getJson('sp-config.json'), getJson('media.json')]).then(function (res) {
      config = res[0] || {};
      var manifest = res[1] || {};
      files = (manifest.files || []).filter(function (p) { return MEDIA_RE.test(p); }).sort();
      config.projectId = config.projectId || s.id || (text(s.title) || 'sp-survey-study').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      lang = s.locale || 'en';
      try { var forced = new URLSearchParams(location.search).get('locale'); if (forced) lang = forced; } catch (e) { /* ignore */ }
      survey = { title: text(s.title), description: text(s.description), language: lang, mediaFolders: s.mediaFolders || [], preview: false, selfHosted: true };
      storeKey = 'sp-site:' + config.projectId;
      var saved = load();
      var urlId = '';
      try { var u = new URLSearchParams(location.search); urlId = u.get('PROLIFIC_PID') || u.get('participant') || u.get('pid') || u.get('workerId') || ''; } catch (e) { /* ignore */ }
      if (saved && (!urlId || urlId === saved.participantId)) {
        participantId = saved.participantId; answers = saved.answers || {}; assignment = saved.assignment || null; startedAt = saved.startedAt || startedAt;
      } else {
        participantId = urlId || newId(); saved = null;
      }
      var elements = flatElements(s.pages).map(function (e) { return e.el; });
      var needsNumber = elements.some(function (el) { return mediaCount(el) && isBalanced(el); });
      var numberReady = assignment || !needsNumber ? Promise.resolve(assignment) : claimNumber();
      return numberReady.then(function (a) {
        assignment = a;
        var plan = a ? balancePlan(elements, a.n, config.projectId) : null;
        buildQuestions(s, plan, saved && saved.displayed);
        save();
        if (usedPlaceholders) banner(t('placeholder'));
        ready = true;
        var d = { questions: questions, survey: survey, answers: answers };
        waiters.splice(0).forEach(function (cb) { cb(d); });
        document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
      });
    }).catch(function (err) { console.error('[SPSite] start failed', err); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);

  // Exposed for tests and for `sp.mjs` to stay in step with the runtime.
  window.SPSiteKit = { balancedSlice: balancedSlice, hashSeed: hashSeed, seededRandom: seededRandom, shuffled: shuffled, VERSION: VERSION };
})();
