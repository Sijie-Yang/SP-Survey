// Writes the template list in README.md from docs/templates.json, a snapshot
// of the online template library at https://sp-survey.org/templates.
// Usage: node scripts/build-template-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../docs/templates.json', import.meta.url), 'utf8'));

// Groups, in the order they appear. A template is listed once, under the
// first group that matches one of its stimuli.
const GROUPS = [
  ['street_view', 'Street view'],
  ['panorama', 'Panorama and 360°'],
  ['scene_photo', 'Landscape, nature and other scene photos'],
  ['rendered', 'Rendered and simulated scenes'],
  ['indoor', 'Indoor'],
  ['window_view', 'Window view'],
  ['video', 'Video'],
  ['audio', 'Sound'],
  ['map', 'Map'],
  ['in_situ', 'In situ'],
];
const TASK = {
  pairwise: 'Pairwise', rating: 'Rating', multi_rating: 'Multi-scale rating', choose_from_set: 'Choose / rank',
  questionnaire: 'Questionnaire', map_annotation: 'Map annotation', custom_page: 'Custom page', open_ended: 'Open answers',
};
const LOCATION = { China: 'Mainland China', USA: 'United States', UK: 'United Kingdom' };

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const uniq = (list) => [...new Set(list)];
const labels = (ids, map) => uniq((ids || []).map((id) => map[id] || id)).join(', ');
const yearOf = (tpl) => tpl.paper?.year || Number(tpl.id.slice(0, 4));
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
const placeOf = (tpl) => cell(uniq([...(tpl.city || []), ...(tpl.location || []).map((c) => LOCATION[c] || c)]).join(', '));

function paperCell(paper) {
  if (!paper) return '';
  const who = paper.n > 1 ? `${paper.author} et al.` : paper.author;
  const url = paper.url.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[${cell(who)} (${paper.year})](${url}), *${cell(paper.venue)}*`;
}

function studyCell(tpl) {
  // `contributor` is the GitHub login of whoever sent the study in.
  return tpl.contributor ? `${cell(tpl.name)} <sub>by @${tpl.contributor}</sub>` : cell(tpl.name);
}

const isPaper = (tpl) => tpl.paper || tpl.source === 'paper';
const papers = data.templates.filter(isPaper).sort((a, b) => yearOf(b) - yearOf(a) || a.id.localeCompare(b.id));
const others = data.templates.filter((tpl) => !isPaper(tpl));
const places = new Set(papers.flatMap((tpl) => (tpl.location || []).map((c) => LOCATION[c] || c))
  .filter((label) => !['Global', 'International', 'Europe'].includes(label)));

const sections = GROUPS.map(([id, title]) => ({ id, title, rows: [] }));
const rest = { title: 'Other', rows: [] };
papers.forEach((tpl) => {
  const home = sections.find((section) => (tpl.stimulus || []).includes(section.id)) || rest;
  home.rows.push(tpl);
});
const shown = [...sections, rest].filter((section) => section.rows.length);

const block = [
  '<!-- templates:start (written by scripts/build-template-catalog.mjs; edit docs/templates.json, not this list) -->',
  `**${papers.length} published perception studies**, from ${Math.min(...papers.map(yearOf))} to ${Math.max(...papers.map(yearOf))}, across ${places.size} countries and regions. Each one is rebuilt as a ready-to-run survey: [preview, use or download it at sp-survey.org/templates](${data.source}). Snapshot of ${data.snapshot}.`,
  '',
  shown.map((section) => `[${section.title}](#${slug(section.title)}) (${section.rows.length})`).join(' · ')
    + ` · [Demos and examples](#demos-and-examples) (${others.length})`,
  '',
  ...shown.flatMap((section) => [
    `### ${section.title}`,
    '',
    '| Year | Study | Paper | Task | Place |',
    '|---|---|---|---|---|',
    ...section.rows.map((tpl) => `| ${yearOf(tpl)} | ${studyCell(tpl)} | ${paperCell(tpl.paper)} | ${labels(tpl.task, TASK)} | ${placeOf(tpl)} |`),
    '',
  ]),
  '### Demos and examples',
  '',
  '| Template | Task |',
  '|---|---|',
  ...others.map((tpl) => `| ${studyCell(tpl)} | ${labels(tpl.task, TASK)} |`),
  '<!-- templates:end -->',
].join('\n');

const readmeUrl = new URL('../README.md', import.meta.url);
const readme = readFileSync(readmeUrl, 'utf8');
const marked = /<!-- templates:start[\s\S]*?<!-- templates:end -->/;
if (!marked.test(readme)) throw new Error('README.md has no <!-- templates:start --> … <!-- templates:end --> block');
// Round the headline number down to the nearest 50 ("300+") wherever the README uses it.
const rounded = `${Math.floor(papers.length / 50) * 50}+`;
writeFileSync(readmeUrl, readme.replace(marked, () => block).replace(/\b\d{3}\+/g, rounded));
console.log(`README.md: ${papers.length} paper templates in ${shown.length} groups, ${others.length} others`);
