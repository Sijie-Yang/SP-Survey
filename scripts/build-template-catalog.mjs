// Writes the template list in README.md from public/project_templates/catalog.json,
// which `node scripts/sync-templates.mjs` refreshes from the online library.
// Usage: node scripts/build-template-catalog.mjs
//
// The list follows the library's tags (one question per category):
//   scene         the kind of place studied       -> the sections of the list
//   concept       what people judge or feel        -> the columns of the overview table
//   stimulus, task, setting, participants, where it was run -> one line of counts each
// Every count links to the same selection in the online library.
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/project_templates/catalog.json', import.meta.url), 'utf8'));

// Tag names are shared with the app's own Template Library page.
const TAGS = JSON.parse(readFileSync(new URL('../src/lib/templateTags.json', import.meta.url), 'utf8'));
// Sections, in the order they appear. A study about two kinds of place is listed under both.
const SCENES = Object.entries(TAGS.scene);
const NO_SCENE = 'Other';
// Perception tags, in the library's six groups.
const CONCEPT_GROUPS = TAGS.conceptGroups.map((group) => [group.title, group.tags]);
const CONCEPT = Object.assign({}, ...CONCEPT_GROUPS.map(([, values]) => values));
const { stimulus: STIMULUS, task: TASK, setting: SETTING, participants: PARTICIPANTS, location: LOCATION } = TAGS;
// How many perception columns the overview table has, and how many places the "Run in" line names.
const TABLE_CONCEPTS = 7;
const TOP_PLACES = 10;

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const uniq = (list) => [...new Set(list)];
const labels = (ids, map) => uniq((ids || []).map((id) => map[id] || id)).join(', ');
const yearOf = (tpl) => tpl.paper?.year || Number(tpl.id.slice(0, 4));
// The anchor GitHub gives a heading.
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
const countries = (tpl) => uniq((tpl.location || []).map((c) => LOCATION[c] || c));
const placeOf = (tpl) => cell(uniq([...(tpl.city || []), ...countries(tpl)]).join(', '));

// A count that opens the same selection of paper templates in the online library.
const libraryUrl = (filters) => `${data.source}?${new URLSearchParams({ source: 'paper', ...filters })}`;
const counted = (label, n, filters) => `[${label}](${libraryUrl(filters)}) ${n}`;

function paperCell(paper) {
  if (!paper) return '';
  const who = paper.n > 1 ? `${paper.author} et al.` : paper.author;
  const url = paper.url.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[${cell(who)} (${paper.year})](${url}), *${cell(paper.venue)}*`;
}

// The title opens the study's live preview in the online library.
const previewLink = (tpl) => `[**${cell(tpl.name).replace(/\[/g, '\\[').replace(/\]/g, '\\]')}**](${data.source}?preview=${encodeURIComponent(tpl.id)})`;

// One study = one row of two lines: the full title, then paper · how people answered · what they judged · where.
function studyRow(tpl) {
  const concepts = uniq((tpl.concept || []).map((id) => CONCEPT[id] || id));
  const judged = concepts.length > 4 ? `${concepts.slice(0, 4).join(', ')} +${concepts.length - 4}` : concepts.join(', ');
  const details = [paperCell(tpl.paper), labels(tpl.task, TASK), judged, placeOf(tpl)].filter(Boolean).join(' · ');
  const by = tpl.contributor ? ` <sub>by @${tpl.contributor}</sub>` : '';
  return `| ${yearOf(tpl)} | ${previewLink(tpl)}${by}<br>${details} |`;
}

const isPaper = (tpl) => tpl.source === 'paper';
// Templates marked online as duplicates waiting to be removed stay out of the list.
const listed = data.templates.filter((tpl) => !/^\[duplicate/i.test(tpl.name || ''));
const papers = listed.filter(isPaper).sort((a, b) => yearOf(b) - yearOf(a) || a.id.localeCompare(b.id));
const others = listed.filter((tpl) => !isPaper(tpl));

// Tag values of one category with how many studies carry each, most used first.
function tally(valuesOf) {
  const counts = new Map();
  papers.forEach((tpl) => uniq(valuesOf(tpl) || []).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
const places = tally(countries).filter(([label]) => !['Global', 'International', 'Europe'].includes(label));

const sections = SCENES.map(([id, title]) => ({ id, title, rows: papers.filter((tpl) => (tpl.scene || []).includes(id)) }));
const rest = { title: NO_SCENE, rows: papers.filter((tpl) => !(tpl.scene || []).some((id) => SCENES.some(([known]) => known === id))) };
const shown = [...sections, rest].filter((section) => section.rows.length);

// Overview: kind of place (rows) by the most studied perceptions (columns).
const topConcepts = tally((tpl) => tpl.concept).filter(([id]) => CONCEPT[id]).slice(0, TABLE_CONCEPTS).map(([id]) => id);
const both = (scene, concept) => papers.filter((tpl) => (tpl.scene || []).includes(scene) && (tpl.concept || []).includes(concept)).length;
const overview = [
  `| | ${topConcepts.map((id) => CONCEPT[id]).join(' | ')} |`,
  `|:--|${topConcepts.map(() => '--:').join('|')}|`,
  ...sections.filter((section) => section.rows.length).map((section) => `| [**${section.title}**](#${slug(section.title)}) ${section.rows.length} | ${
    topConcepts.map((concept) => {
      const n = both(section.id, concept);
      return n ? `[${n}](${libraryUrl({ scene: section.id, concept })})` : '·';
    }).join(' | ')} |`),
];

const line = (title, valuesOf, map, key) => `**${title}:** ${
  tally(valuesOf).filter(([id]) => map[id]).map(([id, n]) => counted(map[id], n, { [key]: id })).join(' · ')}`;
const placeKey = (label) => Object.keys(LOCATION).find((key) => LOCATION[key] === label) || label;
const conceptCounts = new Map(tally((tpl) => tpl.concept));

// The three templates added last, once the catalog knows when each was added.
const recent = papers.filter((tpl) => tpl.added).sort((a, b) => b.added.localeCompare(a.added) || a.id.localeCompare(b.id)).slice(0, 3);
const recentLines = recent.length ? [
  `**Recently added:** ${recent.map((tpl) => cell(tpl.name)).join(' · ')}`,
  '',
] : [];

const block = [
  '<!-- templates:start (written by scripts/build-template-catalog.mjs; do not edit this list by hand) -->',
  `**${papers.length} published perception studies**, from ${Math.min(...papers.map(yearOf))} to ${Math.max(...papers.map(yearOf))}, run in ${places.length} countries and regions. Each one is rebuilt as a ready-to-run survey: [preview, use or download it at sp-survey.org/templates](${data.source}). Snapshot of ${data.snapshot}.`,
  '',
  ...recentLines,
  '### Find a study',
  '',
  'Every study carries the same tags: the kind of place, what people were asked to judge, what they were shown and how they answered. The table counts studies by place and by the perceptions studied most. A place name jumps to its list below; a number opens those studies in the online library.',
  '',
  ...overview,
  '',
  line('Shown', (tpl) => tpl.stimulus, STIMULUS, 'modality'),
  '<br>',
  line('Answered by', (tpl) => tpl.task, TASK, 'task'),
  '<br>',
  line('Setting', (tpl) => tpl.setting, SETTING, 'setting'),
  '<br>',
  line('Participants', (tpl) => tpl.participants, PARTICIPANTS, 'participants'),
  '<br>',
  `**Run in:** ${places.slice(0, TOP_PLACES).map(([label, n]) => counted(label, n, { country: placeKey(label) })).join(' · ')}${
    places.length > TOP_PLACES ? ` · and ${places.length - TOP_PLACES} more` : ''}`,
  '',
  `<details><summary>All ${conceptCounts.size} perception tags</summary>`,
  '',
  ...CONCEPT_GROUPS.map(([group, values]) => `- **${group}:** ${
    Object.entries(values).filter(([id]) => conceptCounts.get(id)).sort((a, b) => conceptCounts.get(b[0]) - conceptCounts.get(a[0]))
      .map(([id, label]) => counted(label, conceptCounts.get(id), { concept: id })).join(' · ')}`),
  '',
  '</details>',
  '',
  ...shown.flatMap((section) => [
    `### ${section.title}`,
    '',
    '| Year | Study |',
    '|---|:---|',
    ...section.rows.map(studyRow),
    '',
  ]),
  '### Demos and examples',
  '',
  '| Template | Task |',
  '|---|---|',
  ...others.map((tpl) => `| ${previewLink(tpl)}${tpl.contributor ? ` <sub>by @${tpl.contributor}</sub>` : ''} | ${labels(tpl.task, TASK)} |`),
  '<!-- templates:end -->',
].join('\n');

const readmeUrl = new URL('../README.md', import.meta.url);
const readme = readFileSync(readmeUrl, 'utf8');
const marked = /<!-- templates:start[\s\S]*?<!-- templates:end -->/;
if (!marked.test(readme)) throw new Error('README.md has no <!-- templates:start --> … <!-- templates:end --> block');
// Round the headline number down to the nearest 50 ("300+") wherever the README uses it.
const rounded = `${Math.floor(papers.length / 50) * 50}+`;
writeFileSync(readmeUrl, readme.replace(marked, () => block).replace(/\b\d{3}\+/g, rounded));
console.log(`README.md: ${papers.length} paper templates in ${shown.length} sections (${shown.map((s) => `${s.title} ${s.rows.length}`).join(', ')}), ${others.length} others`);
