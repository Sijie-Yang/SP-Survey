/**
 * Built-in preset Question Skills — media-rich examples for SP-Survey Platform.
 * Import into personal library via SkillLibraryPage.
 */

const BASE_CSS = `
:root {
  --primary: #1976d2;
  --primary-dark: #1565c0;
  --primary-light: #e3f2fd;
  --success: #2e7d32;
  --warning: #ed6c02;
  --text: #1a1a2e;
  --muted: #5c6b7a;
  --border: #e0e6ed;
  --bg: #f5f7fa;
  --card: #ffffff;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.5;
}
.card {
  background: var(--card); border-radius: var(--radius); padding: 16px;
  border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(25, 118, 210, 0.06);
}
.title { margin: 0 0 4px; font-size: 1.05rem; font-weight: 600; color: var(--primary-dark); }
.subtitle { margin: 0 0 14px; font-size: 0.85rem; color: var(--muted); }
.btn {
  border: none; border-radius: 8px; padding: 8px 14px; font-size: 0.85rem;
  cursor: pointer; font-weight: 600; transition: all .15s;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-dark); }
.btn-outline { background: #fff; color: var(--primary); border: 1px solid var(--primary); }
.btn-outline:hover { background: var(--primary-light); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  background: var(--primary-light); color: var(--primary-dark); font-size: 0.75rem; font-weight: 600;
}
.media-frame {
  position: relative; border-radius: 10px; overflow: hidden;
  background: #e8eef5; border: 1px solid var(--border);
}
.media-frame img, .media-frame video { display: block; width: 100%; max-height: 320px; object-fit: cover; background: #e8eef5; }
.slider-row { margin: 12px 0; }
.slider-row label { display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--muted); margin-bottom: 4px; }
input[type=range] { width: 100%; accent-color: var(--primary); cursor: pointer; touch-action: pan-x; }
button,.btn { cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
html, body { touch-action: manipulation; }
.scale-labels { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
.dim-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
.dim-row:last-child { border-bottom: none; }
.hint { font-size: 0.78rem; color: var(--muted); margin-top: 8px; }
`;

const HELPERS = `
function spAbsUrl(url) {
  if (!url) return url;
  if (url.indexOf('http') === 0 || url.indexOf('data:') === 0) return url;
  try {
    if (window.parent && window.parent.location && window.parent.location.origin) {
      return window.parent.location.origin + (url.charAt(0) === '/' ? url : '/' + url);
    }
  } catch (e) { /* sandbox */ }
  return url;
}
function spBootImages() {
  try {
    if (window.__SP_BOOT__ && window.__SP_BOOT__.images && window.__SP_BOOT__.images.length) {
      return window.__SP_BOOT__.images;
    }
  } catch (e) { /* ignore */ }
  return [];
}
function spMedia(type, index) {
  var pool = [];
  try { pool = SPSkill.getImages() || []; } catch (e) { /* SPSkill not ready */ }
  if (!pool.length) pool = spBootImages();
  var list = type ? pool.filter(function(m) { return !m.type || m.type === type; }) : pool;
  var item = list[index != null ? index : 0];
  return item && item.url ? item : null;
}
function spUrl(type, index) {
  var m = spMedia(type, index);
  return m && m.url ? spAbsUrl(m.url) : '';
}
function spName(type, index) {
  var m = spMedia(type, index);
  return m ? (m.name || 'media') : '';
}
function spSetImg(el, type, index, label) {
  if (!el) return;
  var url = spUrl(type, index);
  el.onerror = function() {
    el.onerror = null;
    el.removeAttribute('src');
    el.alt = label || 'Media unavailable';
  };
  if (url) {
    el.alt = label || '';
    el.src = url;
  } else {
    el.removeAttribute('src');
    el.alt = label || 'No media';
  }
}
`;

function buildSkill(bodyHtml, script) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
${bodyHtml}
<script>
${HELPERS}
${script}
</script></body></html>`;
}

export const PRESET_SKILLS = [
  {
    id: 'image_preference_slider',
    name: 'Pairwise Preference Slider',
    /** Shown in survey builder type list (first-class question type). */
    builderLabel: 'Pairwise Preference (A/B slider)',
    builderHint: 'Shows two random images; participants rate preference strength on a continuous slider.',
    description: 'Shows two spatial images side by side; participants express preference strength on a continuous slider. Ideal for urban design A/B comparisons and AI-generated image evaluation.',
    category: 'image',
    configSchema: [
      { key: 'leftLabel', label: 'Left label (A)', type: 'string' },
      { key: 'rightLabel', label: 'Right label (B)', type: 'string' },
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
    ],
    resultSchema: [
      { key: 'preference', label: 'Preference score (-100 = A, +100 = B)', type: 'number' },
      { key: 'interpretation', label: 'Preference direction', type: 'choice' },
      { key: 'hardToDecide', label: 'Hard to decide', type: 'boolean' },
    ],
    defaultConfig: {
      mediaCount: 2,
      mediaType: 'image',
      leftLabel: 'Prefer A',
      rightLabel: 'Prefer B',
      prompt: 'Which one do you prefer? Drag the slider to express how strongly.',
    },
    // Pairwise UI always shows exactly two images — count/type are not researcher knobs.
    mediaConstraints: { countFixed: 2, typeFixed: 'image', countLabel: 'Always 2 images (A vs B)' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Pairwise Preference</p>
  <p class="subtitle" id="prompt"></p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
    <div><div class="badge" style="margin-bottom:6px;">Option A</div><div class="media-frame"><img id="imgA" alt="A"/></div></div>
    <div><div class="badge" style="margin-bottom:6px;">Option B</div><div class="media-frame"><img id="imgB" alt="B"/></div></div>
  </div>
  <div class="slider-row">
    <label><span id="labL">A</span><span id="val">0</span><span id="labR">B</span></label>
    <input type="range" id="slider" min="-100" max="100" value="0" step="1"/>
    <div class="scale-labels"><span>Strongly prefer A</span><span>Neutral</span><span>Strongly prefer B</span></div>
  </div>
  <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--muted);margin-top:8px;">
    <input type="checkbox" id="hard"/> Hard to decide / about the same
  </label>
</div>`,
      `
var cfg = {};
function report() {
  var v = parseInt(document.getElementById('slider').value, 10);
  SPSkill.setAnswer({
    preference: v,
    hardToDecide: document.getElementById('hard').checked,
    imageA: spUrl('image', 0, 'Option A'),
    imageB: spUrl('image', 1, 'Option B'),
    interpretation: v < -20 ? 'prefer_A' : v > 20 ? 'prefer_B' : 'neutral',
  });
}
document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  document.getElementById('labL').textContent = cfg.leftLabel || 'A';
  document.getElementById('labR').textContent = cfg.rightLabel || 'B';
  spSetImg(document.getElementById('imgA'), 'image', 0, 'Option A');
  spSetImg(document.getElementById('imgB'), 'image', 1, 'Option B');
  if (e.detail.value) {
    document.getElementById('slider').value = e.detail.value.preference || 0;
    document.getElementById('hard').checked = !!e.detail.value.hardToDecide;
  }
  document.getElementById('val').textContent = document.getElementById('slider').value;
  SPSkill.ready();
});
document.getElementById('slider').oninput = function() {
  document.getElementById('val').textContent = this.value;
  report();
};
document.getElementById('hard').onchange = report;
`),
  },
  {
    id: 'image_preference_forced',
    name: 'Forced-Choice A/B Preference',
    builderLabel: 'Forced-Choice A/B',
    builderHint: 'Shows two random images; participants must pick A or B (no intensity slider).',
    description: 'Strict binary preference between two images for logistic / Bradley–Terry analyses without continuous intensity.',
    category: 'image',
    configSchema: [
      { key: 'leftLabel', label: 'Option A label', type: 'string' },
      { key: 'rightLabel', label: 'Option B label', type: 'string' },
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
    ],
    resultSchema: [
      { key: 'choice', label: 'Chosen side (A or B)', type: 'choice' },
      { key: 'chosenIndex', label: 'Chosen index (0=A, 1=B)', type: 'number' },
    ],
    defaultConfig: {
      mediaCount: 2,
      mediaType: 'image',
      leftLabel: 'Option A',
      rightLabel: 'Option B',
      prompt: 'Which one do you prefer? Choose one.',
    },
    mediaConstraints: { countFixed: 2, typeFixed: 'image', countLabel: 'Always 2 images (A vs B)' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Forced-Choice Preference</p>
  <p class="subtitle" id="prompt"></p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
    <button type="button" id="pickA" class="choice-btn" style="border:2px solid var(--border,#ddd);border-radius:8px;padding:8px;background:#fff;cursor:pointer;text-align:left;">
      <div class="badge" style="margin-bottom:6px;" id="labA">Option A</div>
      <div class="media-frame"><img id="imgA" alt="A"/></div>
    </button>
    <button type="button" id="pickB" class="choice-btn" style="border:2px solid var(--border,#ddd);border-radius:8px;padding:8px;background:#fff;cursor:pointer;text-align:left;">
      <div class="badge" style="margin-bottom:6px;" id="labB">Option B</div>
      <div class="media-frame"><img id="imgB" alt="B"/></div>
    </button>
  </div>
  <p class="subtitle" id="chosen" style="min-height:1.2em;"></p>
</div>`,
      `
var cfg = {};
var selected = null;
function paint() {
  document.getElementById('pickA').style.borderColor = selected === 'A' ? 'var(--primary,#1976d2)' : 'var(--border,#ddd)';
  document.getElementById('pickB').style.borderColor = selected === 'B' ? 'var(--primary,#1976d2)' : 'var(--border,#ddd)';
  document.getElementById('chosen').textContent = selected
    ? ('Selected: ' + (selected === 'A' ? (cfg.leftLabel || 'Option A') : (cfg.rightLabel || 'Option B')))
    : '';
}
function report(side) {
  selected = side;
  paint();
  SPSkill.setAnswer({
    choice: side,
    chosenIndex: side === 'A' ? 0 : 1,
    imageA: spUrl('image', 0, 'Option A'),
    imageB: spUrl('image', 1, 'Option B'),
    chosenUrl: spUrl('image', side === 'A' ? 0 : 1, side === 'A' ? 'Option A' : 'Option B'),
  });
}
document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  document.getElementById('labA').textContent = cfg.leftLabel || 'Option A';
  document.getElementById('labB').textContent = cfg.rightLabel || 'Option B';
  spSetImg(document.getElementById('imgA'), 'image', 0, 'Option A');
  spSetImg(document.getElementById('imgB'), 'image', 1, 'Option B');
  if (e.detail.value && e.detail.value.choice) {
    selected = e.detail.value.choice;
    paint();
  }
  SPSkill.ready();
});
document.getElementById('pickA').onclick = function() { report('A'); };
document.getElementById('pickB').onclick = function() { report('B'); };
`),
  },
  {
    id: 'video_moment_tag',
    name: 'Video Key Moment Tagging',
    builderLabel: 'Video Key Moments',
    builderHint: 'Participants watch one video and mark start/end times of key events.',
    description: 'Plays a project video and lets participants mark start/end times of key events on the timeline. Suited for behavioral observation and spatial experience video analysis.',
    category: 'video',
    configSchema: [
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
      { key: 'maxSegments', label: 'Max segments allowed', type: 'number' },
    ],
    resultSchema: [
      { key: 'segments', label: 'Key moments marked', type: 'count' },
      { key: 'duration', label: 'Video duration (s)', type: 'number' },
    ],
    defaultConfig: {
      mediaCount: 1,
      mediaType: 'video',
      prompt: 'Watch the video and mark the moments you consider key or important (click "Mark start" then "Mark end")',
      maxSegments: 5,
    },
    mediaConstraints: { countFixed: 1, typeFixed: 'video', countLabel: 'Always 1 video' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Video Key Moment Tagging</p>
  <p class="subtitle" id="prompt"></p>
  <div class="media-frame" id="vframe">
    <video id="vid" controls playsinline style="display:none;"></video>
    <img id="poster" alt="video preview"/>
  </div>
  <div id="demoTimeline" style="display:none;margin-top:8px;">
    <input type="range" id="demoTime" min="0" max="60" value="0" style="width:100%;accent-color:var(--primary);"/>
    <p class="hint" style="margin-top:4px;">Preview mode: drag the timeline to simulate playback and mark key moments</p>
  </div>
  <div style="margin:10px 0;font-size:0.82rem;color:var(--muted);">Current time: <strong id="cur">0:00</strong></div>
  <div class="toolbar">
    <button class="btn btn-outline" id="markStart">Mark start</button>
    <button class="btn btn-outline" id="markEnd">Mark end</button>
    <span class="badge" id="segCount">0 segments</span>
  </div>
  <ul id="list" style="margin:10px 0 0;padding-left:18px;font-size:0.85rem;color:var(--text);"></ul>
</div>`,
      `
var cfg = {};
var segments = [];
var pendingStart = null;
var vid, poster, demoMode, demoTime;

function currentTime() {
  if (demoMode && demoTime) return parseFloat(demoTime.value) || 0;
  return vid && vid.duration ? vid.currentTime : 0;
}
function hasDuration() {
  return demoMode || (vid && vid.duration && isFinite(vid.duration));
}

function fmt(t) {
  var m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function renderList() {
  var ul = document.getElementById('list');
  ul.innerHTML = segments.map(function(s, i) {
    return '<li>Segment ' + (i+1) + ': ' + fmt(s.start) + ' → ' + fmt(s.end) + ' (' + (s.end - s.start).toFixed(1) + 's)</li>';
  }).join('') || '<li style="color:var(--muted);list-style:none;margin-left:-18px;">Nothing marked yet</li>';
  document.getElementById('segCount').textContent = segments.length + ' segments';
}
function report() {
  SPSkill.setAnswer({
    videoUrl: spMedia('video', 0) ? spUrl('video', 0, 'Walkthrough Video') : null,
    posterUrl: spUrl('image', 0, 'Walkthrough'),
    videoName: spName('video', 0),
    segments: segments,
    duration: vid && vid.duration ? vid.duration : (demoMode ? 60 : null),
    demoMode: demoMode,
  });
}
document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  vid = document.getElementById('vid');
  poster = document.getElementById('poster');
  demoTime = document.getElementById('demoTime');
  var posterUrl = spUrl('image', 0, 'Walkthrough');
  spSetImg(poster, 'image', 0, 'Walkthrough');
  poster.style.display = 'block';
  var realVideo = spMedia('video', 0);
  if (realVideo && realVideo.url) {
    demoMode = false;
    vid.style.display = 'block';
    poster.style.display = 'none';
    vid.src = realVideo.url;
    vid.poster = posterUrl;
    vid.ontimeupdate = function() { document.getElementById('cur').textContent = fmt(vid.currentTime); };
  } else {
    demoMode = true;
    vid.style.display = 'none';
    document.getElementById('demoTimeline').style.display = 'block';
    demoTime.oninput = function() { document.getElementById('cur').textContent = fmt(parseFloat(this.value)); };
    document.getElementById('cur').textContent = '0:00';
  }
  if (e.detail.value && e.detail.value.segments) segments = e.detail.value.segments;
  renderList();
  SPSkill.ready();
});
document.getElementById('markStart').onclick = function() {
  if (!hasDuration()) return;
  pendingStart = currentTime();
};
document.getElementById('markEnd').onclick = function() {
  if (pendingStart == null) return;
  var max = cfg.maxSegments || 5;
  if (segments.length >= max) return;
  var end = currentTime();
  if (end <= pendingStart) return;
  segments.push({ start: pendingStart, end: end });
  pendingStart = null;
  renderList(); report();
};
`),
  },
  {
    id: 'emotion_color_picker',
    name: 'Emotion Color Mapping',
    builderLabel: 'Emotion Color Mapping',
    builderHint: 'Stimulus image + choose a color (palette chips, hue wheel, and/or sample from image).',
    description: 'Participants view a scene and pick an emotion color. Survey authors choose response mode (palette / wheel / image+wheel) and palette type (12 hue bins, basic color terms, or Plutchik-inspired emotion colors). Palette mode is categorical only; vividness is derived only for wheel/image picks from saturation/lightness.',
    category: 'image',
    configSchema: [
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
      {
        key: 'responseMode',
        label: 'How participants pick a color',
        type: 'select',
        options: [
          { value: 'palette', label: 'Palette chips only (recommended)' },
          { value: 'wheel', label: 'Hue wheel (radius ≈ strength)' },
          { value: 'image_or_wheel', label: 'Sample from image or use wheel' },
        ],
      },
      {
        key: 'palette',
        label: 'Color palette / categories',
        type: 'select',
        options: [
          { value: 'hue12', label: '12 equal hue bins (30°) — not a psych standard' },
          { value: 'basic', label: 'Basic color terms (Berlin–Kay–inspired)' },
          { value: 'emotion', label: 'Emotion colors (Plutchik-inspired)' },
        ],
      },
    ],
    resultSchema: [
      { key: 'color.hex', label: 'Emotion color', type: 'color' },
      { key: 'color.hue', label: 'Hue (0–360)', type: 'number' },
      { key: 'color.intensity', label: 'Derived intensity (0–100)', type: 'number' },
      { key: 'color.optionId', label: 'Palette option id', type: 'string' },
      { key: 'color.label', label: 'Palette option label', type: 'string' },
      { key: 'color.source', label: 'palette / wheel / image', type: 'string' },
    ],
    defaultConfig: {
      mediaCount: 1,
      mediaType: 'image',
      responseMode: 'palette',
      palette: 'hue12',
      prompt: 'Look at the image and choose the color that best matches your feeling',
    },
    mediaConstraints: { countFixed: 1, typeFixed: 'image', countLabel: 'Always 1 image' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Emotion Color Mapping</p>
  <p class="subtitle" id="prompt"></p>
  <div class="media-frame" id="scene-frame" style="margin-bottom:8px;position:relative;">
    <img id="scene" alt="scene"/>
    <div id="sample-dot" style="display:none;position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.45);pointer-events:none;"></div>
  </div>
  <p class="hint" id="mode-hint"></p>
  <div class="toolbar" id="eye-wrap" style="margin:0 0 8px;display:none;">
    <button type="button" class="btn btn-outline" id="eyedropper-btn">Eyedropper</button>
  </div>
  <div id="palette-panel" style="display:none;margin:10px 0 4px;">
    <div id="palette-grid" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
  </div>
  <div id="wheel-panel" style="display:none;margin-top:10px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
      <canvas id="wheel" width="160" height="160" style="cursor:crosshair;border-radius:50%;box-shadow:0 2px 12px rgba(0,0,0,.12);"></canvas>
      <div style="flex:1;min-width:140px;">
        <div style="width:100%;height:48px;border-radius:10px;border:1px solid var(--border);margin-bottom:8px;" id="swatch"></div>
        <p style="margin:0;font-size:0.85rem;color:var(--muted);">
          Selected: <code id="hex">—</code>
          <span id="source-label" class="badge" style="margin-left:6px;">none</span>
        </p>
        <p id="int-wrap" style="margin:6px 0 0;font-size:0.78rem;color:var(--muted);display:none;">
          Vividness: <span class="badge" id="int-badge">—</span>
          <span style="opacity:.85;">(from saturation/lightness — same hue at same radius ≈ same value)</span>
        </p>
      </div>
    </div>
  </div>
  <div id="selection-bar" style="display:none;margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafbfd;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div id="sel-swatch" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);"></div>
      <div>
        <div style="font-size:0.9rem;font-weight:600;" id="sel-label">No color selected</div>
        <div style="font-size:0.75rem;color:var(--muted);">
          <code id="sel-hex">—</code>
          <span id="sel-inten-row" style="display:none;"> · vividness <span id="sel-int">—</span></span>
        </div>
      </div>
    </div>
  </div>
</div>`,
      `
var color = null;
var canvas, wctx;
var sampleCanvas = null;
var sampleReady = false;
var responseMode = 'palette';
var paletteId = 'hue12';
var paletteColors = [];
var selectedOptionId = null;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2, r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  var toHex = function(n) { var v = Math.round((n + m) * 255).toString(16); return v.length === 1 ? '0' + v : v; };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}
function toHexByte(n) {
  var v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
  return v.length === 1 ? '0' + v : v;
}
function intensityFromHsl(s, l) {
  var vivid = 1 - Math.abs(l - 50) / 50;
  return Math.round(Math.max(0, Math.min(100, s * Math.max(0, vivid))));
}
function updateSelectionUI() {
  var bar = document.getElementById('selection-bar');
  bar.style.display = 'block';
  var intenRow = document.getElementById('sel-inten-row');
  if (!color) {
    document.getElementById('sel-label').textContent = 'No color selected';
    document.getElementById('sel-hex').textContent = '—';
    if (document.getElementById('sel-int')) document.getElementById('sel-int').textContent = '—';
    document.getElementById('sel-swatch').style.background = 'transparent';
    if (intenRow) intenRow.style.display = 'none';
    return;
  }
  document.getElementById('sel-swatch').style.background = color.hex;
  document.getElementById('sel-label').textContent = color.label || (color.source === 'image' ? 'From image' : color.source === 'wheel' ? 'From wheel' : 'Selected');
  document.getElementById('sel-hex').textContent = color.hex;
  var showInt = color.intensity != null && color.source !== 'palette';
  if (intenRow) intenRow.style.display = showInt ? '' : 'none';
  if (showInt && document.getElementById('sel-int')) {
    document.getElementById('sel-int').textContent = String(color.intensity);
  }
  var hexEl = document.getElementById('hex');
  var srcEl = document.getElementById('source-label');
  var intEl = document.getElementById('int-badge');
  var intWrap = document.getElementById('int-wrap');
  var sw = document.getElementById('swatch');
  if (hexEl) hexEl.textContent = color.hex;
  if (srcEl) srcEl.textContent = color.source || 'palette';
  if (intWrap) intWrap.style.display = showInt ? '' : 'none';
  if (intEl && showInt) intEl.textContent = String(color.intensity);
  if (sw) sw.style.background = color.hex;
  Array.prototype.forEach.call(document.querySelectorAll('.palette-chip'), function(btn) {
    var on = btn.getAttribute('data-id') === selectedOptionId;
    btn.style.outline = on ? '2px solid var(--primary)' : 'none';
    btn.style.outlineOffset = on ? '2px' : '0';
  });
}
function applyColor(next, source, option) {
  color = {
    h: next.h,
    s: next.s != null ? next.s : 72,
    l: next.l != null ? next.l : 48,
    hex: next.hex || hslToHex(next.h, next.s != null ? next.s : 72, next.l != null ? next.l : 48),
    source: source || 'palette',
    optionId: option ? option.id : null,
    label: option ? option.label : null,
  };
  // Palette chips are categories — display HSL is nearly uniform, so intensity is N/A.
  // Wheel/image: intensity = vividness from saturation × mid-lightness (hue does not affect it).
  if (source === 'palette') {
    color.intensity = null;
  } else {
    color.intensity = intensityFromHsl(color.s, color.l);
  }
  selectedOptionId = option ? option.id : null;
  updateSelectionUI();
  report();
}
function drawWheel() {
  if (!wctx) return;
  var cx = 80, cy = 80, r = 78, a;
  for (a = 0; a < 360; a++) {
    wctx.beginPath();
    wctx.moveTo(cx, cy);
    wctx.arc(cx, cy, r, (a - 0.5) * Math.PI / 180, (a + 0.5) * Math.PI / 180);
    wctx.closePath();
    wctx.fillStyle = hslToHex(a, 85, 52);
    wctx.fill();
  }
}
function pickWheel(ev) {
  var rect = canvas.getBoundingClientRect();
  var x = ev.clientX - rect.left - 80, y = ev.clientY - rect.top - 80;
  var ang = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  var dist = Math.sqrt(x * x + y * y);
  if (dist > 78) return;
  var t = Math.min(1, Math.max(0, dist / 78));
  var s = Math.round(12 + t * 80);
  var l = Math.round(62 - t * 18);
  var h = Math.round(ang);
  applyColor({ h: h, s: s, l: l, hex: hslToHex(h, s, l) }, 'wheel', null);
  document.getElementById('sample-dot').style.display = 'none';
}
function mapClickToNatural(img, clientX, clientY) {
  var rect = img.getBoundingClientRect();
  var x = clientX - rect.left;
  var y = clientY - rect.top;
  var nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return null;
  var scale = Math.max(rect.width / nw, rect.height / nh);
  var dispW = nw * scale, dispH = nh * scale;
  var offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
  var ix = Math.floor((x - offX) / scale);
  var iy = Math.floor((y - offY) / scale);
  if (ix < 0 || iy < 0 || ix >= nw || iy >= nh) return null;
  return { ix: ix, iy: iy, localX: x, localY: y };
}
function samplePixel(ix, iy) {
  if (!sampleCanvas || !sampleReady) return null;
  var ctx = sampleCanvas.getContext('2d');
  var r0 = Math.max(0, ix - 2), c0 = Math.max(0, iy - 2);
  var r1 = Math.min(sampleCanvas.width - 1, ix + 2), c1 = Math.min(sampleCanvas.height - 1, iy + 2);
  var w = r1 - r0 + 1, h = c1 - c0 + 1;
  var data = ctx.getImageData(r0, c0, w, h).data;
  var r = 0, g = 0, b = 0, n = 0, i;
  for (i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  }
  if (!n) return null;
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  var hsl = rgbToHsl(r, g, b);
  return { h: hsl.h, s: hsl.s, l: hsl.l, hex: '#' + toHexByte(r) + toHexByte(g) + toHexByte(b) };
}
function prepareSampleCanvas(url) {
  sampleCanvas = null;
  sampleReady = false;
  if (!url || responseMode !== 'image_or_wheel') return;
  var im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = function() {
    var c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    var ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    try {
      ctx.getImageData(0, 0, 1, 1);
      sampleCanvas = c;
      sampleReady = true;
      document.getElementById('mode-hint').textContent =
        'Click the image to sample a color, or use the wheel (edge = stronger).';
    } catch (err) {
      sampleReady = false;
      document.getElementById('mode-hint').textContent =
        'Image sampling blocked (CORS) — use the hue wheel or Eyedropper.';
    }
  };
  im.onerror = function() { sampleReady = false; };
  im.src = url;
}
function pickFromImage(ev) {
  if (responseMode !== 'image_or_wheel') return;
  if (!sampleReady) return;
  var img = document.getElementById('scene');
  var mapped = mapClickToNatural(img, ev.clientX, ev.clientY);
  if (!mapped) return;
  var picked = samplePixel(mapped.ix, mapped.iy);
  if (!picked) return;
  applyColor(picked, 'image', null);
  var dot = document.getElementById('sample-dot');
  dot.style.display = 'block';
  dot.style.left = mapped.localX + 'px';
  dot.style.top = mapped.localY + 'px';
  dot.style.background = picked.hex;
}
async function pickEyedropper() {
  if (!window.EyeDropper) return;
  try {
    var dropper = new window.EyeDropper();
    var result = await dropper.open();
    var hex = (result && result.sRGBHex) || '';
    if (!hex) return;
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return;
    var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    var hsl = rgbToHsl(r, g, b);
    applyColor({ h: hsl.h, s: hsl.s, l: hsl.l, hex: '#' + toHexByte(r) + toHexByte(g) + toHexByte(b) }, 'image', null);
    document.getElementById('sample-dot').style.display = 'none';
  } catch (err) { /* cancelled */ }
}
function renderPalette() {
  var grid = document.getElementById('palette-grid');
  grid.innerHTML = '';
  paletteColors.forEach(function(opt) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-chip';
    btn.setAttribute('data-id', opt.id);
    btn.title = opt.label;
    btn.style.cssText = 'width:56px;min-height:64px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer;padding:6px;display:flex;flex-direction:column;align-items:center;gap:4px;';
    var sw = document.createElement('div');
    sw.style.cssText = 'width:36px;height:36px;border-radius:8px;border:1px solid rgba(0,0,0,.15);background:' + opt.hex + ';';
    var lab = document.createElement('div');
    lab.textContent = opt.label;
    lab.style.cssText = 'font-size:0.68rem;color:var(--muted);text-align:center;line-height:1.15;';
    btn.appendChild(sw);
    btn.appendChild(lab);
    btn.onclick = function() { applyColor(opt, 'palette', opt); };
    grid.appendChild(btn);
  });
}
function applyModeUI() {
  var palettePanel = document.getElementById('palette-panel');
  var wheelPanel = document.getElementById('wheel-panel');
  var frame = document.getElementById('scene-frame');
  var hint = document.getElementById('mode-hint');
  var eyeWrap = document.getElementById('eye-wrap');
  if (responseMode === 'palette') {
    palettePanel.style.display = 'block';
    wheelPanel.style.display = 'none';
    frame.style.cursor = 'default';
    hint.textContent = 'Choose one color category below.';
    eyeWrap.style.display = 'none';
  } else if (responseMode === 'wheel') {
    palettePanel.style.display = 'none';
    wheelPanel.style.display = 'block';
    frame.style.cursor = 'default';
    hint.textContent = 'Use the hue wheel (edge = stronger, center = weaker).';
    eyeWrap.style.display = 'none';
  } else {
    palettePanel.style.display = 'none';
    wheelPanel.style.display = 'block';
    frame.style.cursor = 'crosshair';
    hint.textContent = 'Click the image to sample a color, or use the wheel.';
    eyeWrap.style.display = window.EyeDropper ? 'flex' : 'none';
  }
}
function report() {
  if (!color) {
    SPSkill.setAnswer(null);
    return;
  }
  SPSkill.setAnswer({
    imageUrl: spUrl('image', 0, 'Place'),
    color: {
      hex: color.hex,
      hue: color.h,
      s: color.s,
      l: color.l,
      intensity: color.intensity,
      intensityDerived: color.source !== 'palette' && color.intensity != null,
      source: color.source,
      optionId: color.optionId,
      label: color.label,
      paletteId: paletteId,
    },
  });
}
document.addEventListener('spskill-init', function(e) {
  var cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  responseMode = cfg.responseMode || 'palette';
  paletteId = cfg.palette || 'hue12';
  paletteColors = Array.isArray(cfg.paletteColors) ? cfg.paletteColors : [];
  var scene = document.getElementById('scene');
  spSetImg(scene, 'image', 0, 'Place');
  applyModeUI();
  renderPalette();
  prepareSampleCanvas(spUrl('image', 0));
  scene.onclick = pickFromImage;
  canvas = document.getElementById('wheel');
  if (canvas) {
    wctx = canvas.getContext('2d');
    drawWheel();
    canvas.onclick = pickWheel;
  }
  var eyeBtn = document.getElementById('eyedropper-btn');
  if (eyeBtn) eyeBtn.onclick = pickEyedropper;
  if (e.detail.value && e.detail.value.color) {
    var v = e.detail.value.color;
    var opt = null;
    if (v.optionId) {
      for (var i = 0; i < paletteColors.length; i++) {
        if (paletteColors[i].id === v.optionId) { opt = paletteColors[i]; break; }
      }
    }
    applyColor({
      h: v.hue != null ? v.hue : 210,
      s: v.s != null ? v.s : 72,
      l: v.l != null ? v.l : 48,
      hex: v.hex || '#1976d2',
    }, v.source || (opt ? 'palette' : 'wheel'), opt);
  } else {
    color = null;
    selectedOptionId = null;
    updateSelectionUI();
    document.getElementById('selection-bar').style.display = responseMode === 'palette' ? 'block' : 'none';
  }
  SPSkill.ready();
});
`),
  },

  {
    id: 'best_worst_choice',
    name: 'Best–Worst Image Choice',
    builderLabel: 'Best–Worst Choice (MaxDiff)',
    builderHint: 'Shows several random images; participants pick one best and one worst option.',
    description: 'Shows a grid of scene images; participants pick the single best and single worst option. Best–Worst Scaling (MaxDiff) produces more stable preference scores than independent ratings.',
    category: 'image',
    configSchema: [
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
      { key: 'mediaCount', label: 'Images shown per trial', type: 'number', min: 2, max: 6 },
      { key: 'bestLabel', label: 'Best button label', type: 'string' },
      { key: 'worstLabel', label: 'Worst button label', type: 'string' },
    ],
    resultSchema: [
      { key: 'bestIndex', label: 'Best option index', type: 'number' },
      { key: 'worstIndex', label: 'Worst option index', type: 'number' },
      { key: 'complete', label: 'Both selections made', type: 'boolean' },
    ],
    defaultConfig: {
      mediaCount: 4,
      mediaType: 'image',
      prompt: 'Among these scenes, select the one you like MOST and the one you like LEAST',
      bestLabel: 'Best',
      worstLabel: 'Worst',
    },
    // Count is adjustable (2–6); type stays image-only for this grid UI.
    mediaConstraints: { countMin: 2, countMax: 6, typeFixed: 'image', countLabel: 'Number of image options (2–6)' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Best–Worst Choice</p>
  <p class="subtitle" id="prompt"></p>
  <div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"></div>
  <p class="hint" id="status">Select one Best and one Worst image.</p>
</div>`,
      `
var cfg = {};
var best = null, worst = null, n = 4;

function cellHtml(i) {
  var letter = String.fromCharCode(65 + i);
  return '<div style="border:2px solid var(--border);border-radius:10px;padding:6px;" id="cell' + i + '">' +
    '<div class="badge" style="margin-bottom:6px;">Option ' + letter + '</div>' +
    '<div class="media-frame"><img id="img' + i + '" alt="Option ' + letter + '" style="max-height:180px;"/></div>' +
    '<div class="toolbar" style="margin-top:8px;">' +
    '<button class="btn btn-outline bw-best" data-i="' + i + '">' + (cfg.bestLabel || 'Best') + '</button>' +
    '<button class="btn btn-outline bw-worst" data-i="' + i + '">' + (cfg.worstLabel || 'Worst') + '</button>' +
    '</div></div>';
}
function refresh() {
  for (var i = 0; i < n; i++) {
    var cell = document.getElementById('cell' + i);
    if (!cell) continue;
    cell.style.borderColor = i === best ? 'var(--success)' : i === worst ? '#c62828' : 'var(--border)';
  }
  document.querySelectorAll('.bw-best').forEach(function(b) {
    b.className = 'btn bw-best ' + (parseInt(b.dataset.i, 10) === best ? 'btn-primary' : 'btn-outline');
  });
  document.querySelectorAll('.bw-worst').forEach(function(b) {
    var on = parseInt(b.dataset.i, 10) === worst;
    b.className = 'btn bw-worst ' + (on ? 'btn-primary' : 'btn-outline');
    if (on) b.style.background = '#c62828'; else b.style.background = '';
  });
  document.getElementById('status').textContent =
    best == null && worst == null ? 'Select one Best and one Worst image.' :
    best == null ? 'Now select the Best image.' :
    worst == null ? 'Now select the Worst image.' : 'Done — you can still change your choices.';
}
function report() {
  var urls = [];
  for (var i = 0; i < n; i++) urls.push(spUrl('image', i, 'Option ' + String.fromCharCode(65 + i)));
  SPSkill.setAnswer({
    bestIndex: best, worstIndex: worst,
    bestUrl: best != null ? spUrl('image', best, 'Best') : null,
    worstUrl: worst != null ? spUrl('image', worst, 'Worst') : null,
    shownUrls: urls,
    complete: best != null && worst != null,
  });
}
document.addEventListener('click', function(ev) {
  var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-i]') : null;
  if (!btn || !document.getElementById('grid') || !document.getElementById('grid').contains(btn)) return;
  var i = parseInt(btn.dataset.i, 10);
  if (btn.classList.contains('bw-best')) {
    best = best === i ? null : i;
    if (worst === best) worst = null;
  } else if (btn.classList.contains('bw-worst')) {
    worst = worst === i ? null : i;
    if (best === worst) best = null;
  } else return;
  refresh(); report();
});
document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  n = cfg.mediaCount || 4;
  document.getElementById('prompt').textContent = cfg.prompt || '';
  var grid = document.getElementById('grid');
  var html = '';
  for (var i = 0; i < n; i++) html += cellHtml(i);
  grid.innerHTML = html;
  for (var j = 0; j < n; j++) spSetImg(document.getElementById('img' + j), 'image', j, 'Option ' + String.fromCharCode(65 + j));
  if (e.detail.value) {
    if (e.detail.value.bestIndex != null) best = e.detail.value.bestIndex;
    if (e.detail.value.worstIndex != null) worst = e.detail.value.worstIndex;
  } else {
    best = null;
    worst = null;
  }
  refresh();
  SPSkill.ready();
});
`),
  },
  {
    id: 'video_continuous_rating',
    name: 'Continuous Video Rating',
    builderLabel: 'Continuous Video Rating',
    builderHint: 'One video; participants keep adjusting a slider while watching (sampled over time).',
    description: 'While a walkthrough video plays, participants continuously adjust a slider to report their momentary experience; ratings are sampled per second into a timeline. For dynamic spatial experience measurement.',
    category: 'video',
    configSchema: [
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
      { key: 'lowLabel', label: 'Low end label', type: 'string' },
      { key: 'highLabel', label: 'High end label', type: 'string' },
    ],
    resultSchema: [
      { key: 'sampleCount', label: 'Rating samples', type: 'number' },
      { key: 'mean', label: 'Mean rating (0–100)', type: 'number' },
    ],
    defaultConfig: {
      mediaCount: 1,
      mediaType: 'video',
      prompt: 'While the video plays, keep adjusting the slider to match how pleasant the environment feels right now',
      lowLabel: 'Very unpleasant',
      highLabel: 'Very pleasant',
    },
    mediaConstraints: { countFixed: 1, typeFixed: 'video', countLabel: 'Always 1 video' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Continuous Video Rating</p>
  <p class="subtitle" id="prompt"></p>
  <div class="media-frame">
    <video id="vid" controls playsinline style="display:none;"></video>
    <img id="poster" alt="video preview"/>
  </div>
  <div id="demoTimeline" style="display:none;margin-top:8px;">
    <input type="range" id="demoTime" min="0" max="60" value="0" style="width:100%;accent-color:var(--primary);"/>
    <p class="hint" style="margin-top:4px;">Preview mode: drag the timeline to simulate playback</p>
  </div>
  <div class="slider-row" style="margin-top:14px;">
    <label><span id="labL">Unpleasant</span><span class="badge" id="val">50</span><span id="labR">Pleasant</span></label>
    <input type="range" id="rate" min="0" max="100" value="50"/>
  </div>
  <p class="hint"><span id="sampleCount">0</span> samples recorded — keep the slider updated while watching.</p>
</div>`,
      `
var cfg = {};
var samples = {};
var vid, demoMode = false, demoTime;

function currentTime() {
  if (demoMode) return parseFloat(demoTime.value) || 0;
  return vid && vid.currentTime ? vid.currentTime : 0;
}
function record() {
  var t = Math.floor(currentTime());
  samples[t] = parseInt(document.getElementById('rate').value, 10);
  document.getElementById('sampleCount').textContent = Object.keys(samples).length;
  report();
}
function report() {
  var keys = Object.keys(samples);
  var arr = keys.map(function(k) { return { t: parseInt(k, 10), v: samples[k] }; })
    .sort(function(a, b) { return a.t - b.t; });
  var mean = arr.length ? Math.round(arr.reduce(function(s, p) { return s + p.v; }, 0) / arr.length) : null;
  SPSkill.setAnswer({
    videoUrl: spMedia('video', 0) ? spUrl('video', 0, 'Walkthrough') : null,
    samples: arr,
    sampleCount: arr.length,
    mean: mean,
    demoMode: demoMode,
  });
}
document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  document.getElementById('labL').textContent = cfg.lowLabel || 'Low';
  document.getElementById('labR').textContent = cfg.highLabel || 'High';
  vid = document.getElementById('vid');
  demoTime = document.getElementById('demoTime');
  var poster = document.getElementById('poster');
  spSetImg(poster, 'image', 0, 'Walkthrough');
  var realVideo = spMedia('video', 0);
  if (realVideo && realVideo.url) {
    vid.style.display = 'block';
    poster.style.display = 'none';
    vid.src = realVideo.url;
    vid.ontimeupdate = record;
  } else {
    demoMode = true;
    document.getElementById('demoTimeline').style.display = 'block';
    demoTime.oninput = record;
  }
  document.getElementById('rate').oninput = function() {
    document.getElementById('val').textContent = this.value;
    record();
  };
  if (e.detail.value && e.detail.value.samples) {
    e.detail.value.samples.forEach(function(p) { samples[p.t] = p.v; });
    document.getElementById('sampleCount').textContent = Object.keys(samples).length;
  }
  SPSkill.ready();
});
`),
  },
  {
    id: 'composite_blocks',
    name: 'Composite Question (Blocks)',
    builderLabel: 'Composite Blocks (flexible)',
    builderHint: 'Combine media, sliders, word chips, choice, and text via configuration. More flexible; slightly more advanced.',
    description: 'Assemble a custom question from preset building blocks — media display, rating slider groups, word chips, single choice, and free text — purely through configuration. No HTML editing needed; ideal starting point for AI generation or manual composition.',
    category: 'media',
    configSchema: [
      { key: 'prompt', label: 'Task instructions (inside the question)', type: 'string' },
      { key: 'scaleMin', label: 'Scale minimum (sliders)', type: 'number', min: 0, max: 10 },
      { key: 'scaleMax', label: 'Scale maximum (sliders)', type: 'number', min: 2, max: 101 },
      { key: 'blocks', label: 'Blocks (JSON) — see skill description', type: 'json' },
    ],
    resultSchema: [
      { key: 'ratings', label: 'Slider ratings', type: 'scaleGroup' },
      { key: 'words', label: 'Selected words', type: 'count' },
      { key: 'choice', label: 'Choice answer', type: 'choice' },
      { key: 'text', label: 'Free text', type: 'text' },
    ],
    defaultConfig: {
      mediaCount: 1,
      mediaType: 'image',
      prompt: 'Look at the scene below and answer the questions',
      scaleMin: 1,
      scaleMax: 7,
      blocks: [
        { type: 'media', index: 0 },
        {
          type: 'sliders',
          title: 'Rate the scene',
          dimensions: [
            { id: 'safety', left: 'Unsafe', right: 'Safe' },
            { id: 'beauty', left: 'Ugly', right: 'Beautiful' },
          ],
        },
        {
          type: 'words',
          title: 'Pick up to 3 words that describe this place',
          max: 3,
          options: ['green', 'noisy', 'open', 'crowded', 'clean', 'historic'],
        },
        {
          type: 'choice',
          title: 'Would you visit this place?',
          options: ['Yes', 'Maybe', 'No'],
        },
        { type: 'text', title: 'Any other comments?', placeholder: 'Optional…' },
      ],
    },
    // Default demo uses 1 image; researchers can raise count if blocks reference more indices.
    mediaConstraints: { countMin: 1, countMax: 6, countLabel: 'Media files available to blocks' },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title" id="skillTitle">Composite Question</p>
  <p class="subtitle" id="prompt"></p>
  <div id="blocks"></div>
</div>`,
      `
var cfg = {};
var state = { ratings: {}, words: [], choice: null, text: '' };

function scaleMin() { return cfg.scaleMin != null ? cfg.scaleMin : 1; }
function scaleMax() { return cfg.scaleMax != null ? cfg.scaleMax : 7; }
function midValue() { return Math.round((scaleMin() + scaleMax()) / 2); }

var dimIndex = {};
function report() {
  var ratings = [];
  Object.keys(state.ratings).forEach(function(id) {
    var d = dimIndex[id] || {};
    ratings.push({ id: id, left: d.left, right: d.right, value: state.ratings[id] });
  });
  var stimulusUrl = null;
  (cfg.blocks || []).forEach(function(b) {
    if (b.type === 'media' && !stimulusUrl) {
      stimulusUrl = spUrl(b.mediaType || 'image', b.index || 0, 'Scene');
    }
  });
  SPSkill.setAnswer({
    ratings: ratings,
    words: state.words,
    choice: state.choice,
    text: state.text,
    scaleMin: scaleMin(),
    scaleMax: scaleMax(),
    imageUrl: stimulusUrl,
  });
}

function blockTitle(text) {
  if (!text) return '';
  return '<p style="font-size:0.85rem;font-weight:600;color:var(--text);margin:14px 0 6px;">' + text + '</p>';
}

function renderMedia(root, block) {
  var idx = block.index || 0;
  var type = block.mediaType || null;
  var m = spMedia(type, idx);
  var wrap = document.createElement('div');
  if (m && m.type === 'audio') {
    wrap.innerHTML = '<div style="background:var(--primary-light);border-radius:10px;padding:12px;margin-bottom:10px;">' +
      '<audio controls style="width:100%;" src="' + spAbsUrl(m.url) + '"></audio></div>';
  } else if (m && m.type === 'video') {
    wrap.innerHTML = '<div class="media-frame" style="margin-bottom:10px;"><video controls style="width:100%;max-height:320px;" src="' + spAbsUrl(m.url) + '"></video></div>';
  } else {
    wrap.innerHTML = '<div class="media-frame" style="margin-bottom:10px;"><img alt="media"/></div>';
    spSetImg(wrap.querySelector('img'), 'image', idx, 'Scene');
  }
  root.appendChild(wrap);
}

function renderSliders(root, block) {
  var box = document.createElement('div');
  box.innerHTML = blockTitle(block.title);
  (block.dimensions || []).forEach(function(d) {
    dimIndex[d.id] = d;
    var row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = '<label><span>' + (d.left || '') + '</span><span class="badge" id="v_' + d.id + '">' + midValue() + '</span><span>' + (d.right || '') + '</span></label>' +
      '<input type="range" data-id="' + d.id + '" min="' + scaleMin() + '" max="' + scaleMax() + '" value="' + midValue() + '"/>' +
      '<div class="scale-labels"><span>' + scaleMin() + '</span><span>' + scaleMax() + '</span></div>';
    var sl = row.querySelector('input');
    state.ratings[d.id] = midValue();
    sl.oninput = function() {
      state.ratings[d.id] = parseInt(sl.value, 10);
      row.querySelector('.badge').textContent = sl.value;
      report();
    };
    box.appendChild(row);
  });
  root.appendChild(box);
}

function renderWordsBlock(root, block) {
  var box = document.createElement('div');
  box.innerHTML = blockTitle(block.title) + '<div style="display:flex;flex-wrap:wrap;gap:6px;" class="wordwrap"></div>';
  var wrap = box.querySelector('.wordwrap');
  function paint() {
    wrap.innerHTML = '';
    (block.options || []).forEach(function(w) {
      var on = state.words.indexOf(w) >= 0;
      var chip = document.createElement('button');
      chip.className = 'btn ' + (on ? 'btn-primary' : 'btn-outline');
      chip.style.cssText = 'padding:5px 12px;font-size:0.8rem;border-radius:999px;';
      chip.textContent = w;
      chip.onclick = function() {
        var max = block.max || 3;
        var idx = state.words.indexOf(w);
        if (idx >= 0) state.words.splice(idx, 1);
        else if (state.words.length < max) state.words.push(w);
        paint(); report();
      };
      wrap.appendChild(chip);
    });
  }
  paint();
  root.appendChild(box);
}

function renderChoice(root, block) {
  var box = document.createElement('div');
  box.innerHTML = blockTitle(block.title) + '<div style="display:flex;flex-wrap:wrap;gap:8px;" class="choicewrap"></div>';
  var wrap = box.querySelector('.choicewrap');
  function paint() {
    wrap.innerHTML = '';
    (block.options || []).forEach(function(opt) {
      var on = state.choice === opt;
      var b = document.createElement('button');
      b.className = 'btn ' + (on ? 'btn-primary' : 'btn-outline');
      b.textContent = opt;
      b.onclick = function() { state.choice = opt; paint(); report(); };
      wrap.appendChild(b);
    });
  }
  paint();
  root.appendChild(box);
}

function renderText(root, block) {
  var box = document.createElement('div');
  box.innerHTML = blockTitle(block.title) +
    '<textarea style="width:100%;min-height:70px;border:1px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-size:0.85rem;" placeholder="' + (block.placeholder || '') + '"></textarea>';
  var ta = box.querySelector('textarea');
  ta.oninput = function() { state.text = ta.value; report(); };
  root.appendChild(box);
}

document.addEventListener('spskill-init', function(e) {
  cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  if (cfg.title) document.getElementById('skillTitle').textContent = cfg.title;
  var root = document.getElementById('blocks');
  root.innerHTML = '';
  (cfg.blocks || []).forEach(function(block) {
    if (block.type === 'media') renderMedia(root, block);
    else if (block.type === 'sliders') renderSliders(root, block);
    else if (block.type === 'words') renderWordsBlock(root, block);
    else if (block.type === 'choice') renderChoice(root, block);
    else if (block.type === 'text') renderText(root, block);
  });
  if (e.detail.value) {
    var v = e.detail.value;
    (v.ratings || []).forEach(function(r) {
      state.ratings[r.id] = r.value;
      var sl = document.querySelector('input[data-id="' + r.id + '"]');
      if (sl) {
        sl.value = r.value;
        var badge = document.getElementById('v_' + r.id);
        if (badge) badge.textContent = r.value;
      }
    });
    if (v.words) state.words = v.words;
    if (v.choice) state.choice = v.choice;
    if (v.text) state.text = v.text;
  }
  SPSkill.ready();
});
`),
  },
];


export function getPresetSkill(presetId) {
  const id = String(presetId || '').replace(/^preset_/, '');
  return PRESET_SKILLS.find((p) => p.id === id) || null;
}

/** Stable skillId used in survey JSON for built-in presets. */
export function presetSkillId(presetId) {
  const id = String(presetId || '').replace(/^preset_/, '');
  return id ? `preset_${id}` : '';
}

/** Builder type-list entries for built-in experimental tasks (not labeled "Skill"). */
export function getPresetBuilderTypeOptions() {
  return PRESET_SKILLS.map((p) => ({
    value: `skill:${presetSkillId(p.id)}`,
    label: p.builderLabel || p.name,
    hint: p.builderHint || p.description,
    group: 'perception',
  }));
}

/** Resolve a skill definition for the builder (preset or library row). */
export function resolveBuilderSkill(skillId, librarySkills = []) {
  if (!skillId) return null;
  const fromLibrary = librarySkills.find((s) => s.id === skillId);
  if (skillId.startsWith('preset_') || (!fromLibrary && getPresetSkill(skillId))) {
    const preset = getPresetSkill(skillId);
    if (!preset) return fromLibrary || null;
    return {
      id: presetSkillId(preset.id),
      name: preset.name,
      description: preset.description,
      builderLabel: preset.builderLabel || preset.name,
      builderHint: preset.builderHint || preset.description,
      sourceHtml: preset.sourceHtml,
      configSchema: preset.configSchema || [],
      defaultConfig: preset.defaultConfig || {},
      resultSchema: preset.resultSchema || [],
      mediaConstraints: preset.mediaConstraints,
      scope: 'preset',
    };
  }
  return fromLibrary || null;
}

/**
 * Resolve media UI constraints for a skill question.
 * Preset skills declare mediaConstraints; custom skills stay fully adjustable.
 */
export function getSkillMediaConstraints(skillId, skillDef) {
  const id = skillId?.replace(/^preset_/, '');
  const def = skillDef?.mediaConstraints
    ? skillDef
    : (id ? getPresetSkill(id) : null) || skillDef;
  const c = def?.mediaConstraints || {};
  return {
    countFixed: c.countFixed ?? null,
    countMin: c.countMin ?? 1,
    countMax: c.countMax ?? 6,
    typeFixed: c.typeFixed ?? null,
    countLabel: c.countLabel || null,
    countAdjustable: c.countFixed == null,
    typeAdjustable: c.typeFixed == null,
  };
}
