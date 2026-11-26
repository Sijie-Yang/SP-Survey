import { checkPublishMedia, questionsNeedingLibraryMedia } from './publishMediaCheck.mjs';

const random = (type, name) => ({ type, name, imageSelectionMode: 'huggingface_random', randomImageSelection: true });

test('questions that draw from the library block publishing while it is empty', () => {
  const config = { pages: [{ elements: [random('imagepicker', 'safer'), { type: 'radiogroup', name: 'freq' }] }] };
  expect(checkPublishMedia(config, []).questions).toEqual(['safer']);
  expect(checkPublishMedia(config, [{ url: 'https://x/a.jpg' }])).toBeNull();
});

test('text-only surveys, curated questions and Hugging Face sources are not blocked', () => {
  expect(checkPublishMedia({ pages: [{ elements: [{ type: 'text', name: 'a' }] }] }, [])).toBeNull();
  expect(checkPublishMedia({ pages: [{ elements: [{ ...random('imagerating', 'r'), imageSelectionMode: 'huggingface_manual' }] }] }, [])).toBeNull();
  expect(checkPublishMedia({ huggingfaceDataset: 'org/set', pages: [{ elements: [random('imagerating', 'r')] }] }, [])).toBeNull();
});

test('an SP-Scheme page that reads media folders needs a library too', () => {
  const page = { pages: [], spSite: { html: "<script>SPSite.getMedia('streets')</script>" } };
  expect(questionsNeedingLibraryMedia(page)).toEqual(['page (SPSite.getMedia)']);
  expect(checkPublishMedia(page, []).code).toBe('MEDIA_LIBRARY_EMPTY');
});
