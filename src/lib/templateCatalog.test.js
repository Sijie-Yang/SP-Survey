import { facetOptions, filterCatalog, locationLabel, paperCitation } from './templateCatalog';

const templates = [
  { id: '2016-dubey-place', name: 'Place Pulse', stimulus: ['street_view'], task: ['pairwise'], location: ['Global'], concept: ['safety'], paper: { author: 'Dubey A.', n: 5, year: 2016, venue: 'ECCV' } },
  { id: '2026-kim-fear', name: 'Fear of Crime', stimulus: ['street_view'], task: ['pairwise'], location: ['South Korea'], city: ['Seoul'], paper: { author: 'Kim S.', n: 3, year: 2026, venue: 'IJGI' } },
  { id: '2024-li-window', name: 'Window views', stimulus: ['window_view'], task: ['rating'], location: ['China'] },
];

test('filters by facet and by every search word, newest first', () => {
  expect(filterCatalog(templates).map((t) => t.id)).toEqual(['2026-kim-fear', '2024-li-window', '2016-dubey-place']);
  expect(filterCatalog(templates, { stimulus: 'street_view', q: 'seoul fear' }).map((t) => t.id)).toEqual(['2026-kim-fear']);
  expect(filterCatalog(templates, { q: 'mainland' }).map((t) => t.id)).toEqual(['2024-li-window']);
  expect(filterCatalog(templates, { task: 'rating', location: 'Global' })).toEqual([]);
});

test('counts facet values and writes citations', () => {
  expect(facetOptions(templates, 'stimulus')).toEqual([{ value: 'street_view', count: 2 }, { value: 'window_view', count: 1 }]);
  expect(paperCitation(templates[0].paper)).toBe('Dubey A. et al. (2016), ECCV');
  expect(paperCitation(null)).toBe('');
  expect(locationLabel('China')).toBe('Mainland China');
});
