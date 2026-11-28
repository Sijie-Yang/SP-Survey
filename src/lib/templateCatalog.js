// The Template Library page reads /project_templates/catalog.json, the light
// list written by scripts/sync-templates.mjs. The full template is one file
// per id next to it and is only fetched when someone uses it.

export const CATALOG_URL = '/project_templates/catalog.json';

export const STIMULUS_LABELS = {
  street_view: 'Street view', panorama: 'Panorama', scene_photo: 'Scene photos', rendered: 'Rendered / simulated',
  indoor: 'Indoor', window_view: 'Window view', video: 'Video', audio: 'Sound', map: 'Map', in_situ: 'In situ', vr: 'VR',
};
export const TASK_LABELS = {
  pairwise: 'Pairwise', rating: 'Rating', multi_rating: 'Multi-scale rating', choose_from_set: 'Choose / rank',
  questionnaire: 'Questionnaire', map_annotation: 'Map annotation', custom_page: 'Custom page', open_ended: 'Open answers',
};
const LOCATION_LABELS = { China: 'Mainland China', USA: 'United States', UK: 'United Kingdom' };

export const locationLabel = (value) => LOCATION_LABELS[value] || value;

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

/** Newest study first; `filters` = { q, stimulus, task, location }, empty = any. */
export function filterCatalog(templates, filters = {}) {
  const words = String(filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const has = (entry, field, value) => !value || (entry[field] || []).includes(value);
  return templates
    .filter((entry) => has(entry, 'stimulus', filters.stimulus) && has(entry, 'task', filters.task) && has(entry, 'location', filters.location))
    .filter((entry) => {
      if (!words.length) return true;
      const text = [
        entry.id, entry.name, entry.paper?.title, entry.paper?.author, entry.paper?.venue,
        ...(entry.concept || []), ...(entry.city || []), ...(entry.location || []).map(locationLabel),
      ].join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => templateYear(b) - templateYear(a) || String(a.id).localeCompare(String(b.id)));
}
