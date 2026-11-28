// Draws the two README images whose numbers come from the template library:
//   docs/cover.jpg     the cover: totals and the map of where studies were run
//   docs/library.jpg   the library at a glance: studies by each kind of tag
// Usage: node scripts/build-readme-images.mjs        (after sync-templates.mjs)
//
// Both are web pages screenshotted with Playwright, which is not a dependency of
// this project: run it where Playwright and Chromium are installed. The fixed
// parts live in scripts/readme-images/: the photo wall behind the cover, one
// photograph per kind of place, and the dotted world map as data.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const json = (relative) => JSON.parse(readFileSync(file(relative), 'utf8'));
const TAGS = json('../src/lib/templateTags.json');
const WORLD = json('./readme-images/world.json');
const catalog = json('../public/project_templates/catalog.json');
const asset = (name) => pathToFileURL(file(`./readme-images/${name}`)).href;

// The same studies the README list counts.
const papers = catalog.templates.filter((tpl) => tpl.source === 'paper' && !/^\[duplicate/i.test(tpl.name || ''));
const uniq = (list) => [...new Set(list)];
const number = (n) => n.toLocaleString('en-US');
const yearOf = (tpl) => tpl.paper?.year || Number(tpl.id.slice(0, 4));
/** Tag values of one category with how many studies carry each, most used first. */
function tally(valuesOf, known) {
  const counts = new Map();
  papers.forEach((tpl) => uniq(valuesOf(tpl) || []).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
  return [...counts].filter(([id]) => !known || known[id]).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

// ---------- numbers ----------
const years = papers.map(yearOf);
const SAME_PLACE = { Türkiye: 'Turkey' };
const places = tally((tpl) => (tpl.location || []).map((name) => SAME_PLACE[name] || name))
  .filter(([name]) => !['Global', 'International', 'Europe'].includes(name));
// Media files of every template that is listed, by kind.
const media = { image: 0, video: 0, audio: 0 };
catalog.templates.filter((tpl) => !/^\[duplicate/i.test(tpl.name || '')).forEach((tpl) => {
  let full;
  try { full = json(`../public/project_templates/${tpl.id}.json`); } catch { return; }
  (full.preloadedImages || []).forEach((entry) => {
    const ext = String(entry.url || entry.name || '').split('?')[0].split('.').pop().toLowerCase();
    if (/^(mp4|webm|mov|m4v)$/.test(ext)) media.video += 1;
    else if (/^(mp3|wav|ogg|m4a|flac|aac)$/.test(ext)) media.audio += 1;
    else if (/^(jpe?g|png|webp|gif|avif)$/.test(ext)) media.image += 1;
  });
});

const BASE = `*{box-sizing:border-box;margin:0}
body{width:1600px;overflow:hidden;background:#05080f;color:#fff;font-family:Inter,"Helvetica Neue",Arial,sans-serif;position:relative}`;

// ---------- cover ----------
// Names the map data uses for places the library spells differently, and the places it labels.
const MAP_NAME = { USA: 'United States of America', UK: 'United Kingdom', 'Czech Republic': 'Czechia' };
const MAP_LABEL = {
  China: ['Mainland China', -8, -34, 'middle'], USA: ['USA', -10, 5, 'end'], UK: ['UK', -16, -4, 'end'],
  Germany: ['Germany', 6, -26, 'start'], Singapore: ['Singapore', -12, 16, 'end'], Brazil: ['Brazil', 14, 5, 'start'],
  Australia: ['Australia', -12, 26, 'end'], Japan: ['Japan', 14, -6, 'start'],
};

function mapSvg() {
  const { width, height, dots, centre } = WORLD;
  // Taiwan is drawn in the same colour as the mainland: one land mass colouring, no separate status implied.
  const lit = new Set([...places.map(([name]) => MAP_NAME[name] || name), 'Taiwan']);
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const circles = Object.entries(dots).map(([country, xy]) => {
    let out = '';
    for (let i = 0; i < xy.length; i += 2) {
      const t = xy[i] / width; const u = xy[i + 1] / height;
      const fill = lit.has(country) ? `rgb(${mix(64, 70, t)},${mix(215, 150, (t + u) / 2)},${mix(190, 255, t)})` : '#3a4354';
      out += `<circle cx="${xy[i]}" cy="${xy[i + 1]}" r="2.1" fill="${fill}"/>`;
    }
    return out;
  }).join('');
  const rings = []; const labels = [];
  places.forEach(([name, n]) => {
    const at = centre[MAP_NAME[name] || name];
    if (!at) { console.warn(`cover map: no position for "${name}", left out`); return; }
    const [x, y] = at; const r = 3.2 + Math.sqrt(n) * 2.6;
    rings.push({ x, y, r });
    if (!MAP_LABEL[name]) return;
    const [text, dx, dy, anchor] = MAP_LABEL[name];
    const off = anchor === 'middle' ? 0 : (anchor === 'end' ? -r : r);
    labels.push(`<text x="${(x + dx + off).toFixed(1)}" y="${(y + dy + (anchor === 'middle' ? -r * 0.55 : 0)).toFixed(1)}" text-anchor="${anchor}">${text} <tspan font-weight="700">${n}</tspan></text>`);
  });
  rings.sort((a, b) => b.r - a.r);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${circles}
${rings.map((d) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="rgba(255,176,66,.20)" stroke="#ffb042" stroke-width="1.6"/>`).join('')}
<g font-family="Inter,Arial,sans-serif" font-size="14.5" fill="#fff" style="paint-order:stroke;stroke:#05080f;stroke-width:3.5px;stroke-linejoin:round">${labels.join('')}</g></svg>`;
}

const stat = (value, label) => `<div><b>${value}</b><span>${label}</span></div>`;
const coverHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body{height:800px;background:#05080f url("${asset('cover-wall.jpg')}") 0 0/1600px 800px no-repeat}
.text{position:absolute;left:96px;top:182px;width:820px}
h1{font-size:104px;line-height:1;font-weight:800;letter-spacing:-.03em;margin:0 0 18px}
h2{font-size:31px;font-weight:500;line-height:1.25;color:#dbe7f5}
.stats{display:flex;gap:44px;margin-top:38px}
.stats b{display:block;font-size:46px;font-weight:800;letter-spacing:-.02em}
.stats span{font-size:19px;color:#9fb6cf;letter-spacing:.04em}
.stats div{border-left:3px solid #2f8cff;padding-left:16px}
.stats.two{margin-top:26px;align-items:flex-end}
.stats.two div{border-left-color:#35d0a5}
.stats.two b{font-size:38px}
.map{position:absolute;right:30px;top:18px;width:760px}
.map svg{width:100%;height:auto}
.map .cap{position:absolute;left:215px;bottom:-6px;font-size:16px;color:#a9c6e6;letter-spacing:.05em;display:flex;align-items:center;gap:8px}
.map .cap i{width:11px;height:11px;border-radius:50%;background:rgba(255,176,66,.25);border:1.6px solid #ffb042}
.mapshade{position:absolute;right:0;top:0;width:1000px;height:480px;background:radial-gradient(ellipse 70% 78% at 62% 38%,rgba(5,8,15,.93) 0%,rgba(5,8,15,.82) 55%,rgba(5,8,15,0) 100%)}
</style></head><body>
<div class="mapshade"></div><div class="map">${mapSvg()}<div class="cap"><i></i>Number of studies by country or region</div></div>
<div class="text"><h1>SP-Survey</h1>
<h2>Open-Source Platform &amp; Template Library<br>For Visual Assessment of Urban Environment</h2>
<div class="stats">${stat(number(papers.length), 'published studies')}${stat(places.length, 'countries &amp; regions')}${
  stat(`${Math.min(...years)}–${Math.max(...years)}`, `${Math.round((Math.max(...years) - Math.min(...years)) / 10) * 10} years of research`)}</div>
<div class="stats two">${stat(number(media.image), 'images')}${stat(number(media.video), 'videos')}${stat(number(media.audio), 'audio clips')}</div></div>
</body></html>`;

// ---------- library at a glance ----------
// Shorter names where the tag name does not fit beside a bar.
const SHORT = { measures: 'Behaviour & physiology', rendered: 'Rendered or edited' };
const CONCEPT = Object.assign({}, ...TAGS.conceptGroups.map((group) => group.tags));
const PERCEPTIONS_SHOWN = 7;

function libraryHtml() {
  const scenes = Object.entries(TAGS.scene).map(([id, label]) => [id, label, papers.filter((tpl) => (tpl.scene || []).includes(id)).length]);
  const perceptions = tally((tpl) => tpl.concept, CONCEPT);
  const charts = [
    ['What people judge', `top ${PERCEPTIONS_SHOWN} of ${perceptions.length} perceptions`, perceptions.slice(0, PERCEPTIONS_SHOWN), CONCEPT],
    ['What they are shown', '', tally((tpl) => tpl.stimulus, TAGS.stimulus), TAGS.stimulus],
    ['How they answer', '', tally((tpl) => tpl.task, TAGS.task), TAGS.task],
  ];
  // One scale for every bar, so lengths compare across the three lists.
  const longest = Math.max(...charts.flatMap(([, , rows]) => rows.map(([, n]) => n)));
  const bars = (rows, names) => rows.map(([id, n]) => `<div class="row"><span class="name">${SHORT[id] || names[id]}</span><span class="track"><i style="width:${(n / longest * 100).toFixed(1)}%"></i><b>${n}</b></span></div>`).join('');
  const strip = (title, rows, names) => `<div class="strip"><h3>${title}</h3>${rows.map(([id, n]) => `<span>${names[id]} <b>${n}</b></span>`).join('')}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body{padding:64px 72px 60px;background:
 radial-gradient(circle at 82% -6%,rgba(60,150,255,.22),transparent 46%),
 radial-gradient(circle at 4% 104%,rgba(53,208,165,.10),transparent 40%),
 linear-gradient(180deg,#070c18,#05080f)}
.kicker{font-size:20px;letter-spacing:.32em;color:#7fc0ff;font-weight:600;text-transform:uppercase}
h1{font-size:54px;line-height:1.08;font-weight:800;letter-spacing:-.025em;margin:16px 0 0}
h1 em{font-style:normal;color:#9fb6cf;font-weight:500}
h3{font-size:16px;letter-spacing:.2em;color:#7fc0ff;font-weight:600;text-transform:uppercase}
h3 small{font-size:15px;letter-spacing:.04em;color:#7f97b1;font-weight:400;text-transform:none;margin-left:10px}
.scenes{display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin-top:16px}
.scene .photo{position:relative;height:150px;border-radius:10px;background-size:cover;background-position:center;box-shadow:0 0 0 1px rgba(120,190,255,.22);overflow:hidden}
.scene .photo::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,8,15,0) 35%,rgba(5,8,15,.82) 100%)}
.scene .photo b{position:absolute;left:14px;bottom:8px;z-index:1;font-size:44px;font-weight:800;letter-spacing:-.02em}
.scene p{font-size:19px;line-height:1.25;color:#dbe7f5;margin-top:10px}
.block{margin-top:44px}
.charts{display:grid;grid-template-columns:repeat(3,1fr);gap:56px;margin-top:44px}
.row{display:flex;align-items:center;height:37px}
.row:first-of-type{margin-top:12px}
.name{flex:0 0 222px;font-size:19px;color:#dbe7f5;white-space:nowrap}
.track{flex:1;display:flex;align-items:center;gap:10px}
.track i{height:10px;border-radius:5px;background:linear-gradient(90deg,#2f8cff,#45c8d6);min-width:6px}
.track b{font-size:19px;font-weight:700}
.strips{margin-top:34px;padding-top:26px;border-top:1px solid rgba(120,190,255,.16)}
.strip{display:flex;align-items:baseline;height:37px}
.strip h3{flex:0 0 222px}
.strip span{font-size:19px;color:#9fb6cf;white-space:nowrap;margin-right:34px}
.strip b{color:#fff;font-weight:700;margin-left:4px}
</style></head><body>
<div class="kicker">Template library</div>
<h1>${number(papers.length)} published studies, <em>all tagged the same way</em></h1>
<div class="block"><h3>Kind of place</h3><div class="scenes">${scenes.map(([id, label, n]) => `<div class="scene"><div class="photo" style="background-image:url('${asset(`scene-${id}.jpg`)}')"><b>${n}</b></div><p>${label}</p></div>`).join('')}</div></div>
<div class="charts">${charts.map(([title, note, rows, names]) => `<div><h3>${title}${note ? `<small>${note}</small>` : ''}</h3>${bars(rows, names)}</div>`).join('')}</div>
<div class="strips">${strip('Where it is run', tally((tpl) => tpl.setting, TAGS.setting), TAGS.setting)}${strip('Who takes part', tally((tpl) => tpl.participants, TAGS.participants), TAGS.participants)}</div>
</body></html>`;
}

// ---------- screenshots ----------
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed here. Run this script where Playwright and Chromium are available.');
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1 });
// A page may only load the local pictures when it is itself a local file.
const work = mkdtempSync(path.join(tmpdir(), 'readme-images-'));
for (const [name, html] of [['cover', coverHtml()], ['library', libraryHtml()]]) {
  const htmlFile = path.join(work, `${name}.html`);
  writeFileSync(htmlFile, html);
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file(`../docs/${name}.jpg`), type: 'jpeg', quality: 90, fullPage: name === 'library' });
}
rmSync(work, { recursive: true, force: true });
await browser.close();
// The cover's description in the README repeats its numbers.
const readmeFile = file('../README.md');
const readme = readFileSync(readmeFile, 'utf8');
const described = readme.replace(
  /(<img src="\.\/docs\/cover\.jpg" alt=")[^"]*"/,
  `$1SP-Survey: open-source platform and template library for visual assessment of urban environment. ${number(papers.length)} published studies run in ${places.length} countries and regions, ${number(media.image)} images, ${media.video} videos and ${media.audio} audio clips, with a world map of study locations"`,
);
if (described !== readme) writeFileSync(readmeFile, described);
console.log(`docs/cover.jpg and docs/library.jpg: ${papers.length} studies, ${places.length} countries and regions, ${number(media.image)} images, ${media.video} videos, ${media.audio} audio clips`);
