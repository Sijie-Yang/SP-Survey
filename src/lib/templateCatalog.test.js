import { facetOptions, filterCatalog, locationLabel, paperCitation, tagLabel } from './templateCatalog';

const templates = [
  { id: '2016-dubey-place', name: 'Place Pulse', scene: ['street'], stimulus: ['street_view'], task: ['pairwise'], location: ['Global'], concept: ['safety'], paper: { author: 'Dubey A.', n: 5, year: 2016, venue: 'ECCV' } },
  { id: '2026-kim-fear', name: 'Fear of Crime', scene: ['street'], stimulus: ['street_view'], task: ['pairwise'], location: ['South Korea'], city: ['Seoul'], paper: { author: 'Kim S.', n: 3, year: 2026, venue: 'IJGI' } },
  { id: '2024-li-window', name: 'Window views', scene: ['window_view'], concept: ['thermal_comfort'], stimulus: ['scene_photo'], task: ['rating'], location: ['China'] },
];

test('filters by facet and by every search word, newest first', () => {
  expect(filterCatalog(templates).map((t) => t.id)).toEqual(['2026-kim-fear', '2024-li-window', '2016-dubey-place']);
  expect(filterCatalog(templates, { stimulus: 'street_view', q: 'seoul fear' }).map((t) => t.id)).toEqual(['2026-kim-fear']);
  expect(filterCatalog(templates, { q: 'mainland' }).map((t) => t.id)).toEqual(['2024-li-window']);
  expect(filterCatalog(templates, { task: 'rating', location: 'Global' })).toEqual([]);
  expect(filterCatalog(templates, { scene: 'street', concept: 'safety' }).map((t) => t.id)).toEqual(['2016-dubey-place']);
  expect(filterCatalog(templates, { q: 'thermal comfort' }).map((t) => t.id)).toEqual(['2024-li-window']);
});

test('counts facet values and writes citations', () => {
  expect(facetOptions(templates, 'stimulus')).toEqual([{ value: 'street_view', count: 2 }, { value: 'scene_photo', count: 1 }]);
  expect(paperCitation(templates[0].paper)).toBe('Dubey A. et al. (2016), ECCV');
  expect(paperCitation(null)).toBe('');
  expect(locationLabel('China')).toBe('Mainland China');
  expect(tagLabel('concept', 'safety')).toBe('Safe');
  expect(tagLabel('task', 'unknown_id')).toBe('unknown_id');
});
