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
function spPlaceholder(label) {
  var palettes = [
    { sky: '#87CEEB', ground: '#78909C', accent: '#1976d2', title: 'Main Street' },
    { sky: '#64B5F6', ground: '#BCAAA4', accent: '#1565c0', title: 'City Plaza' },
    { sky: '#CFD8DC', ground: '#616161', accent: '#455a64', title: 'Alleyway' },
    { sky: '#B0BEC5', ground: '#757575', accent: '#37474f', title: 'Before' },
    { sky: '#81D4FA', ground: '#A5D6A7', accent: '#2e7d32', title: 'After' },
  ];
  var idx = 0;
  if (label && label.indexOf('B') >= 0) idx = 1;
  if (label && label.indexOf('Before') >= 0) idx = 3;
  if (label && label.indexOf('After') >= 0) idx = 4;
  var p = palettes[idx] || palettes[0];
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">' +
    '<rect width="800" height="500" fill="' + p.sky + '"/>' +
    '<rect y="340" width="800" height="160" fill="' + p.ground + '"/>' +
    '<rect x="80" y="120" width="140" height="220" fill="#90A4AE" opacity="0.85"/>' +
    '<rect x="560" y="100" width="160" height="240" fill="#A1887F" opacity="0.85"/>' +
    '<ellipse cx="400" cy="300" rx="60" ry="75" fill="#43A047"/>' +
    '<rect x="388" y="300" width="24" height="50" fill="#6D4C41"/>' +
    '<text x="400" y="470" text-anchor="middle" fill="' + p.accent + '" font-family="sans-serif" font-size="16" font-weight="600">' + p.title + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
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
function spDemoFromConfig(type, index) {
  var cfg = {};
  try { cfg = SPSkill.getConfig() || {}; } catch (e) { /* ignore */ }
  if (!cfg.demoImages && window.__SP_BOOT__ && window.__SP_BOOT__.config) {
    cfg = window.__SP_BOOT__.config;
  }
  var demos = cfg.demoImages || [];
  var idx = index != null ? index : 0;
  if (type) {
    var typed = demos.filter(function(d) { return !d.type || d.type === type; });
    if (typed[idx]) return typed[idx];
  }
  return demos[idx] || null;
}
function spUrl(type, index, label) {
  var m = spMedia(type, index);
  if (m && m.url) return spAbsUrl(m.url);
  var d = spDemoFromConfig(type, index);
  if (d && d.url) return spAbsUrl(d.url);
  return spPlaceholder(label);
}
function spName(type, index) {
  var m = spMedia(type, index) || spDemoFromConfig(type, index);
  return m ? (m.name || 'media') : 'demo';
}
function spSetImg(el, type, index, label) {
  if (!el) return;
  el.onerror = function() { el.onerror = null; el.src = spPlaceholder(label); };
  el.src = spUrl(type, index, label);
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

export const PRESET_DEMO_IMAGES = {
  streetA: { name: 'demo-street-a.svg', url: '/preset_skills/demo-street-a.svg', type: 'image' },
  streetB: { name: 'demo-street-b.svg', url: '/preset_skills/demo-street-b.svg', type: 'image' },
  alley: { name: 'demo-alley.svg', url: '/preset_skills/demo-alley.svg', type: 'image' },
  before: { name: 'demo-before.svg', url: '/preset_skills/demo-before.svg', type: 'image' },
  after: { name: 'demo-after.svg', url: '/preset_skills/demo-after.svg', type: 'image' },
};

const INLINE_DEMO_PALETTES = [
  { sky: '#87CEEB', ground: '#78909C', accent: '#1976d2', title: 'Main Street' },
  { sky: '#64B5F6', ground: '#BCAAA4', accent: '#1565c0', title: 'City Plaza' },
  { sky: '#CFD8DC', ground: '#616161', accent: '#455a64', title: 'Alleyway' },
  { sky: '#B0BEC5', ground: '#757575', accent: '#37474f', title: 'Before' },
  { sky: '#81D4FA', ground: '#A5D6A7', accent: '#2e7d32', title: 'After' },
];

/** Self-contained demo image (data URI) — works inside sandboxed iframe without network. */
export function inlineDemoSvgDataUri(sceneIndex = 0) {
  const p = INLINE_DEMO_PALETTES[sceneIndex % INLINE_DEMO_PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">`
    + `<rect width="800" height="500" fill="${p.sky}"/>`
    + `<rect y="340" width="800" height="160" fill="${p.ground}"/>`
    + `<rect x="80" y="120" width="140" height="220" fill="#90A4AE" opacity="0.85"/>`
    + `<rect x="560" y="100" width="160" height="240" fill="#A1887F" opacity="0.85"/>`
    + `<ellipse cx="400" cy="300" rx="60" ry="75" fill="#43A047"/>`
    + `<rect x="388" y="300" width="24" height="50" fill="#6D4C41"/>`
    + `<text x="400" y="470" text-anchor="middle" fill="${p.accent}" font-family="sans-serif" font-size="16" font-weight="600">${p.title}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Resolve bundled / preset demo images for a skill question element. */
export function buildFallbackDemoImages(count = 1, mediaType = 'image', skillId = null) {
  if (skillId?.startsWith('preset_')) {
    const preset = getPresetSkill(skillId.replace(/^preset_/, ''));
    if (preset?.defaultConfig?.demoImages?.length) {
      return preset.defaultConfig.demoImages.map((img, i) => ({ ...img, type: img.type || 'image' }));
    }
  }
  const n = Math.max(1, count || 1);
  if (mediaType === 'video') {
    return [{ name: 'demo-poster.svg', url: inlineDemoSvgDataUri(0), type: 'image' }];
  }
  if (n >= 2) {
    return [
      { name: 'demo-a.svg', url: inlineDemoSvgDataUri(0), type: 'image' },
      { name: 'demo-b.svg', url: inlineDemoSvgDataUri(1), type: 'image' },
    ].slice(0, n);
  }
  return [{ name: 'demo.svg', url: inlineDemoSvgDataUri(0), type: 'image' }];
}

function demoImg(index, name) {
  return { name: name || `demo-${index}.svg`, url: inlineDemoSvgDataUri(index), type: 'image' };
}

export const PRESET_SKILLS = [
  {
    id: 'image_preference_slider',
    name: 'Pairwise Preference Slider',
    description: 'Shows two spatial images side by side; participants express preference strength on a continuous slider. Ideal for urban design A/B comparisons and AI-generated image evaluation.',
    category: 'image',
    configSchema: [
      { key: 'leftLabel', label: 'Left label', type: 'string' },
      { key: 'rightLabel', label: 'Right label', type: 'string' },
      { key: 'prompt', label: 'Prompt', type: 'string' },
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
      demoImages: [demoImg(0, 'street-a.svg'), demoImg(1, 'street-b.svg')],
    },
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
    id: 'video_moment_tag',
    name: 'Video Key Moment Tagging',
    description: 'Plays a project video and lets participants mark start/end times of key events on the timeline. Suited for behavioral observation and spatial experience video analysis.',
    category: 'video',
    configSchema: [
      { key: 'prompt', label: 'Prompt', type: 'string' },
      { key: 'maxSegments', label: 'Max segments', type: 'number' },
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
      demoImages: [demoImg(0, 'street-a.svg')],
    },
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
    description: 'After viewing an environment image, participants pick the color on a wheel that best represents their emotional response and tune its intensity. For emotional geography and place perception research.',
    category: 'image',
    configSchema: [
      { key: 'prompt', label: 'Prompt', type: 'string' },
    ],
    resultSchema: [
      { key: 'color.hex', label: 'Emotion color', type: 'color' },
      { key: 'color.intensity', label: 'Emotion intensity (0–100)', type: 'number' },
    ],
    defaultConfig: {
      mediaCount: 1,
      mediaType: 'image',
      prompt: 'Look at the image and pick the color that best matches your first emotional response',
      demoImages: [demoImg(2, 'alley.svg')],
    },
    sourceHtml: buildSkill(`
<div class="card">
  <p class="title">Emotion Color Mapping</p>
  <p class="subtitle" id="prompt"></p>
  <div class="media-frame" style="margin-bottom:14px;"><img id="scene" alt="scene"/></div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
    <canvas id="wheel" width="160" height="160" style="cursor:crosshair;border-radius:50%;box-shadow:0 2px 12px rgba(0,0,0,.12);"></canvas>
    <div style="flex:1;min-width:160px;">
      <div style="width:100%;height:48px;border-radius:10px;border:1px solid var(--border);margin-bottom:10px;" id="swatch"></div>
      <div class="slider-row">
        <label><span>Emotion intensity</span><span class="badge" id="int">70</span></label>
        <input type="range" id="intensity" min="0" max="100" value="70"/>
      </div>
      <p style="margin:8px 0 0;font-size:0.85rem;color:var(--muted);">Selected color: <code id="hex">#1976d2</code></p>
    </div>
  </div>
</div>`,
      `
var color = { h: 210, s: 72, l: 48, hex: '#1976d2' };
var canvas, wctx;

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
function drawWheel() {
  var cx = 80, cy = 80, r = 78;
  for (var a = 0; a < 360; a++) {
    wctx.beginPath();
    wctx.strokeStyle = hslToHex(a, 85, 52);
    wctx.lineWidth = 3;
    wctx.arc(cx, cy, r, (a - 1) * Math.PI / 180, (a + 1) * Math.PI / 180);
    wctx.stroke();
  }
}
function pick(ev) {
  var rect = canvas.getBoundingClientRect();
  var x = ev.clientX - rect.left - 80, y = ev.clientY - rect.top - 80;
  var ang = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  var dist = Math.sqrt(x * x + y * y);
  if (dist > 78) return;
  color.h = Math.round(ang);
  color.hex = hslToHex(color.h, 72, 48);
  document.getElementById('swatch').style.background = color.hex;
  document.getElementById('hex').textContent = color.hex;
  report();
}
function report() {
  SPSkill.setAnswer({
    imageUrl: spUrl('image', 0, 'Place'),
    color: { hex: color.hex, hue: color.h, intensity: parseInt(document.getElementById('intensity').value, 10) },
  });
}
document.addEventListener('spskill-init', function(e) {
  var cfg = e.detail.config || {};
  document.getElementById('prompt').textContent = cfg.prompt || '';
  spSetImg(document.getElementById('scene'), 'image', 0, 'Place');
  canvas = document.getElementById('wheel');
  wctx = canvas.getContext('2d');
  drawWheel();
  canvas.onclick = pick;
  if (e.detail.value && e.detail.value.color) {
    color = e.detail.value.color;
    document.getElementById('intensity').value = color.intensity || 70;
    document.getElementById('swatch').style.background = color.hex || '#1976d2';
    document.getElementById('hex').textContent = color.hex || '#1976d2';
  } else {
    document.getElementById('swatch').style.background = color.hex;
  }
  document.getElementById('int').textContent = document.getElementById('intensity').value;
  SPSkill.ready();
});
document.getElementById('intensity').oninput = function() {
  document.getElementById('int').textContent = this.value;
  report();
};
`),
  },
  {
    id: 'best_worst_choice',
    name: 'Best–Worst Image Choice',
    description: 'Shows a grid of scene images; participants pick the single best and single worst option. Best–Worst Scaling (MaxDiff) produces more stable preference scores than independent ratings.',
    category: 'image',
    configSchema: [
      { key: 'prompt', label: 'Prompt', type: 'string' },
      { key: 'mediaCount', label: 'Number of options', type: 'number', min: 2, max: 6 },
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
      demoImages: [demoImg(0, 'opt-a.svg'), demoImg(1, 'opt-b.svg'), demoImg(2, 'opt-c.svg'), demoImg(4, 'opt-d.svg')],
    },
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
    description: 'While a walkthrough video plays, participants continuously adjust a slider to report their momentary experience; ratings are sampled per second into a timeline. For dynamic spatial experience measurement.',
    category: 'video',
    configSchema: [
      { key: 'prompt', label: 'Prompt', type: 'string' },
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
      demoImages: [demoImg(0, 'street-a.svg')],
    },
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
    description: 'Assemble a custom question from preset building blocks — media display, rating slider groups, word chips, single choice, and free text — purely through configuration. No HTML editing needed; ideal starting point for AI generation or manual composition.',
    category: 'media',
    configSchema: [
      { key: 'prompt', label: 'Prompt', type: 'string' },
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
      demoImages: [demoImg(0, 'street-a.svg')],
    },
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

/** Demo media for gallery preview — inline SVG (no network). */
export const PRESET_SKILL_DEMO_IMAGES = [
  demoImg(0, 'street-a.svg'),
  demoImg(1, 'street-b.svg'),
  demoImg(2, 'alley.svg'),
];

export function getPresetSkill(presetId) {
  return PRESET_SKILLS.find((p) => p.id === presetId) || null;
}
