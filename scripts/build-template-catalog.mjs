// Renders TEMPLATES.md from docs/templates.json (a snapshot of the online
// template library at https://sp-survey.org/templates).
// Usage: node scripts/build-template-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../docs/templates.json', import.meta.url), 'utf8'));

const STIMULUS = {
  street_view: 'Street view', panorama: 'Panorama', video: 'Video', audio: 'Audio', window_view: 'Window view',
  indoor: 'Indoor', scene_photo: 'Scene photos', map: 'Map', in_situ: 'In situ', vr: 'VR', rendered: 'Rendered',
};
const TASK = {
  pairwise: 'Pairwise', rating: 'Rating', multi_rating: 'Multi-scale rating', choose_from_set: 'Choose / rank',
  questionnaire: 'Questionnaire', map_annotation: 'Map annotation', custom_page: 'Custom page', open_ended: 'Open answers',
};
const LOCATION = { China: 'Mainland China', USA: 'United States', UK: 'United Kingdom' };

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const uniq = (list) => [...new Set(list)];
const labels = (ids, map) => uniq((ids || []).map((id) => map[id] || id)).join(', ');
const yearOf = (tpl) => tpl.paper?.year || Number(tpl.id.slice(0, 4));

function paperCell(paper) {
  if (!paper) return '';
  const who = paper.n > 1 ? `${paper.author} et al.` : paper.author;
  return `[${cell(who)} (${paper.year})](${paper.url.replace(/\(/g, '%28').replace(/\)/g, '%29')}), *${cell(paper.venue)}*`;
}

function countBy(list, key, map) {
  const counts = new Map();
  list.forEach((tpl) => uniq((tpl[key] || []).map((id) => map[id] || id)).forEach((label) => counts.set(label, (counts.get(label) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const isPaper = (tpl) => tpl.paper || tpl.source === 'paper';
const papers = data.templates.filter(isPaper).sort((a, b) => yearOf(b) - yearOf(a) || a.id.localeCompare(b.id));
const others = data.templates.filter((tpl) => !isPaper(tpl));
const places = countBy(papers, 'location', LOCATION).filter(([label]) => !['Global', 'International', 'Europe'].includes(label));

const lines = [
  '# Template library',
  '',
  `**${papers.length} perception studies from published papers, rebuilt as ready-to-run surveys**, plus ${others.length} demos and examples. Each template has the questions, the task design and a media library, so you can rerun the study, swap in your own images, or use it as a starting point.`,
  '',
  `Browse, preview, use or download every template (ZIP with the survey and its media) at **[sp-survey.org/templates](${data.source})**. This list is a snapshot from ${data.snapshot}; the website is always current.`,
  '',
  '> A template is our rebuild of a study from its paper. Some use the paper\'s own stimuli, others follow the method with new images; each template page says which. The papers belong to their authors, and none of them endorse this project. If a template of your paper needs a correction, please [open an issue](https://github.com/Sijie-Yang/SP-Survey/issues).',
  '',
  '## At a glance',
  '',
  `- **Stimuli:** ${countBy(papers, 'stimulus', STIMULUS).map(([label, n]) => `${label} ${n}`).join(' · ')}`,
  `- **Tasks:** ${countBy(papers, 'task', TASK).map(([label, n]) => `${label} ${n}`).join(' · ')}`,
  `- **Study places:** ${places.length} countries and regions. Most common: ${places.slice(0, 8).map(([label, n]) => `${label} ${n}`).join(' · ')}`,
  `- **Years:** ${Math.min(...papers.map(yearOf))}–${Math.max(...papers.map(yearOf))}`,
  '',
  '## Paper replications',
  '',
  '| Year | Template | Paper | Stimuli | Task | Place |',
  '|---|---|---|---|---|---|',
  ...papers.map((tpl) => `| ${yearOf(tpl)} | ${cell(tpl.name)} | ${paperCell(tpl.paper)} | ${labels(tpl.stimulus, STIMULUS)} | ${labels(tpl.task, TASK)} | ${cell(uniq([...(tpl.city || []), ...(tpl.location || []).map((c) => LOCATION[c] || c)]).join(', '))} |`),
  '',
  '## Demos and examples',
  '',
  '| Template | Stimuli | Task |',
  '|---|---|---|',
  ...others.map((tpl) => `| ${cell(tpl.name)} | ${labels(tpl.stimulus, STIMULUS)} | ${labels(tpl.task, TASK)} |`),
  '',
  '## Add your study',
  '',
  'See [Add your study to the library](./README.md#add-your-study-to-the-library) in the README: send the paper, submit a survey you built, or let your AI submit it. Every submission is reviewed before it is listed.',
  '',
];

writeFileSync(new URL('../TEMPLATES.md', import.meta.url), lines.join('\n'));

// The README shows the same numbers and a few well-known studies.
const FEATURED = [
  '2016-dubey-place', '2013-salesses-collaborative', '2014-naik-streetscore', '2017-seresinhe-scenic',
  '2014-quercia-aesthetic', '2009-ewing-measuring', '1995-kaplan-art', '1990-nasar-evaluative',
  '1976-daniel-scenic', '1876-fechner-golden',
];
const byId = new Map(papers.map((tpl) => [tpl.id, tpl]));
const block = [
  '<!-- templates:start (written by scripts/build-template-catalog.mjs) -->',
  `**${papers.length} published perception studies** are rebuilt as ready-to-run surveys, from ${Math.min(...papers.map(yearOf))} to ${Math.max(...papers.map(yearOf))}, across ${places.length} countries and regions.`,
  '',
  `- **Stimuli:** ${countBy(papers, 'stimulus', STIMULUS).slice(0, 7).map(([label, n]) => `${label} ${n}`).join(' · ')}`,
  `- **Tasks:** ${countBy(papers, 'task', TASK).slice(0, 6).map(([label, n]) => `${label} ${n}`).join(' · ')}`,
  '',
  '| Study | Paper | Task |',
  '|---|---|---|',
  ...FEATURED.map((id) => byId.get(id)).filter(Boolean).map((tpl) => `| ${cell(tpl.name)} | ${paperCell(tpl.paper)} | ${labels(tpl.task, TASK)} |`),
  '',
  `**[See all ${papers.length} in TEMPLATES.md](./TEMPLATES.md)** · [browse and preview them online](${data.source})`,
  '<!-- templates:end -->',
].join('\n');
const readmeUrl = new URL('../README.md', import.meta.url);
const readme = readFileSync(readmeUrl, 'utf8');
const marked = /<!-- templates:start[\s\S]*?<!-- templates:end -->/;
// Round the headline number down to the nearest 50 ("300+") wherever the README uses it.
const rounded = `${Math.floor(papers.length / 50) * 50}+`;
if (marked.test(readme)) writeFileSync(readmeUrl, readme.replace(marked, () => block).replace(/\b\d{3}\+/g, rounded));
console.log(`TEMPLATES.md: ${papers.length} paper templates, ${others.length} others`);
