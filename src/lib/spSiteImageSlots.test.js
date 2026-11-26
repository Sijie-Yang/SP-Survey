import { findImageSlots, linkImageSlots, prepareSiteDocument } from './spSite';

const page = `<html><head></head><body><script>
const PHOTO_URLS = [];
const IMAGES = ['a.jpg', "b.png"];
const STEPS = ['one', 'two'];
const PIC_GRID = [[1, 2]];
</script><p>const IMG = []</p></body></html>`;

test('finds image lists the page keeps in its own code', () => {
  expect(findImageSlots(page)).toEqual([{ name: 'PHOTO_URLS', count: 0 }, { name: 'IMAGES', count: 2 }]);
});

test('a list is an image list only when a word of its name says so', () => {
  const html = (body) => `<html><body><script>${body}</script></body></html>`;
  expect(findImageSlots(html('const pick=[],seen={}; const picker = []; const topics = [];')).map((s) => s.name)).toEqual([]);
  expect(findImageSlots(html('const pics = []; const imageList = []; let stimuli = []; var mediaUrls = []; const PICTURE_SET = [];')).map((s) => s.name))
    .toEqual(['pics', 'imageList', 'stimuli', 'mediaUrls', 'PICTURE_SET']);
  expect(linkImageSlots(html('const pick=[];'))).toContain('const pick=[];');
});

test('a page that reads SPSite.getMedia is left alone', () => {
  const own = page.replace('</script>', 'SPSite.getMedia("x");</script>');
  expect(findImageSlots(own)).toEqual([]);
  expect(linkImageSlots(own)).toBe(own);
});

test('image lists read the linked folders and keep the page list as fallback', () => {
  const out = linkImageSlots(page);
  expect(out).toContain('const PHOTO_URLS = (window.SPSite && SPSite.imageSlot ? SPSite.imageSlot("PHOTO_URLS", []) : [])');
  expect(out).toContain(`SPSite.imageSlot("IMAGES", ['a.jpg', "b.png"])`);
  expect(out).toContain("const STEPS = ['one', 'two'];");
  expect(out).toContain('<p>const IMG = []</p>');
});

test('lists are only rewritten when media folders are linked', () => {
  expect(prepareSiteDocument(page, { boot: { media: {} } })).not.toContain('SPSite.imageSlot("PHOTO_URLS"');
  expect(prepareSiteDocument(page, { boot: { media: { photos: [{ url: 'https://m/x.jpg', name: 'x.jpg' }] } } })).toContain('SPSite.imageSlot("PHOTO_URLS"');
});

test('the media library root gives the page the files that are in no folder', () => {
  const { siteMediaFolders } = require('./spSite');
  const pool = [
    { url: 'https://m/r1.jpg', name: 'r1.jpg', folder: '' },
    { url: 'https://m/r2.jpg', name: 'r2.jpg' },
    { url: 'https://m/s/a.jpg', name: 'a.jpg', folder: 'streets' },
  ];
  expect(siteMediaFolders(pool, { spSite: { mediaFolders: ['/'] } })).toEqual({
    '': [
      { url: 'https://m/r1.jpg', name: 'r1.jpg', type: 'image', folder: '' },
      { url: 'https://m/r2.jpg', name: 'r2.jpg', type: 'image', folder: '' },
    ],
  });
  expect(Object.keys(siteMediaFolders(pool, { spSite: { mediaFolders: ['/', 'streets'] } })).sort()).toEqual(['', 'streets']);
  expect(siteMediaFolders(pool, { spSite: { mediaFolders: [] } })).toEqual({});
});

test('an entry known only by its storage key is placed in the folder the key names', () => {
  const { siteMediaFolders } = require('./spSite');
  const pool = [{ url: 'https://m/u/p/streets/a.jpg', key: '0b5f1f0e-1c2d-4e3f-8a9b-1c2d3e4f5a6b/proj_1/streets/a.jpg' }, { url: 'https://m/u/p/b.jpg', key: '0b5f1f0e-1c2d-4e3f-8a9b-1c2d3e4f5a6b/proj_1/b.jpg' }];
  const out = siteMediaFolders(pool, { spSite: { mediaFolders: ['/'] } });
  expect((out[''] || []).map((m) => m.url)).toEqual(['https://m/u/p/b.jpg']);
});

test('a page with an empty image list and no folder linked gets the library root', () => {
  const { siteMediaFolders } = require('./spSite');
  const pool = [{ url: 'https://m/r1.jpg', name: 'r1.jpg', folder: '' }, { url: 'https://m/s/a.jpg', name: 'a.jpg', folder: 'streets' }];
  const out = siteMediaFolders(pool, { spSite: { html: page, mediaFolders: [] } });
  expect(out[''].map((m) => m.name)).toEqual(['r1.jpg']);
  // IMAGES names a.jpg itself, so that file comes along as the page's own.
  expect(out.__page_files__.map((m) => m.name)).toEqual(['a.jpg']);
  // A page without such a list is sent nothing it did not ask for.
  expect(siteMediaFolders(pool, { spSite: { html: '<script>const STEPS = [];</script>', mediaFolders: [] } })).toEqual({});
});

test('files the page names by relative path come from the library as if it were the page folder', () => {
  const { pageReferencedFiles, siteMediaFolders, SITE_PAGE_FILES } = require('./spSite');
  const html = '<img src="images/a.jpg"><div style="background:url(\'./b.png\')"></div><img src="https://x.org/c.jpg"><script>const IMGS=["d.jpg"]</script>';
  expect([...pageReferencedFiles(html).keys()].sort()).toEqual(['b.png', 'd.jpg', 'images/a.jpg']);
  const pool = [
    { url: 'https://m/images/a.jpg', name: 'a.jpg', folder: 'images' },
    { url: 'https://m/other/a.jpg', name: 'a.jpg', folder: 'other' },
    { url: 'https://m/x/b.png', name: 'b.png', folder: 'x' },
    { url: 'https://m/c.jpg', name: 'c.jpg', folder: '' },
  ];
  const own = siteMediaFolders(pool, { spSite: { html, mediaFolders: [] } })[SITE_PAGE_FILES];
  expect(own.map((m) => m.url).sort()).toEqual(['https://m/images/a.jpg', 'https://m/x/b.png']);
});
