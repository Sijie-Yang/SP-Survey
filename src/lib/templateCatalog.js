// The Template Library page reads /project_templates/catalog.json, the light
// list written by scripts/sync-templates.mjs. The full template is one file
// per id next to it and is only fetched when someone uses it.

import TAGS from './templateTags.json';

export const CATALOG_URL = '/project_templates/catalog.json';

// Tag names, shared with the README list (scripts/build-template-catalog.mjs).
const CONCEPT_LABELS = Object.assign({}, ...TAGS.conceptGroups.map((group) => group.tags));
const LABELS = {
  scene: TAGS.scene, concept: CONCEPT_LABELS, stimulus: TAGS.stimulus, task: TAGS.task, location: TAGS.location,
};
/** The filters of the page, in order: catalog field and the name shown above the dropdown. */
export const FILTERS = [
  ['scene', 'Place'], ['concept', 'Perception'], ['stimulus', 'Shown'], ['task', 'Task'], ['location', 'Run in'],
];

export const tagLabel = (field, value) => LABELS[field]?.[value] || value;
export const locationLabel = (value) => tagLabel('location', value);

export function paperCitation(paper) {
  if (!paper) return '';
  const who = paper.n > 1 ? `${paper.author} et al.` : paper.author;
  return [who && `${who} (${paper.year})`, paper.venue].filter(Boolean).join(', ');
}

export const templateYear = (entry) => Number(entry.paper?.year) || Number(String(entry.id).slice(0, 4)) || 0;

/** Values of one field with how many templates carry each, most used first. */
export function facetOptions(templates, field) {
  const counts = new Map();
  templates.forEach((entry) => (entry[field] || []).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
}

/** Newest study first; `filters` = { q, scene, concept, stimulus, task, location }, empty = any. */
export function filterCatalog(templates, filters = {}) {
  const words = String(filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const has = (entry, field, value) => !value || (entry[field] || []).includes(value);
  return templates
    .filter((entry) => FILTERS.every(([field]) => has(entry, field, filters[field])))
    .filter((entry) => {
      if (!words.length) return true;
      const text = [
        entry.id, entry.name, entry.paper?.title, entry.paper?.author, entry.paper?.venue,
        ...(entry.concept || []).flatMap((id) => [id, tagLabel('concept', id)]), ...(entry.city || []), ...(entry.location || []).map(locationLabel),
      ].join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => templateYear(b) - templateYear(a) || String(a.id).localeCompare(String(b.id)));
}
