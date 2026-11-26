import { pageMediaFolderNames, sitePreviewMediaFolders } from './spSite';

const pool = [
  { url: 'https://media.example/preview/a.jpg', name: 'a.jpg', type: 'image' },
  { url: 'https://media.example/preview/b.jpg', name: 'b.jpg' },
  { url: 'https://media.example/preview/c.mp4', name: 'c.mp4', type: 'video' },
];
const page = (body) => `<html><body><script>${body}</script></body></html>`;

describe('sitePreviewMediaFolders', () => {
  it('gives every folder the page asks for the whole preview library', () => {
    const media = sitePreviewMediaFolders(pool, { spSite: { html: page("SPSite.getMedia('streets'); SPSite.getMedia(\"other/\")"), mediaFolders: [] } });
    expect(Object.keys(media).sort()).toEqual(['other', 'streets']);
    expect(media.streets.map((m) => m.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('includes linked folders and falls back to the root', () => {
    expect(Object.keys(sitePreviewMediaFolders(pool, { spSite: { html: page('SPSite.getMedia(name)'), mediaFolders: ['images'] } }))).toEqual(['images']);
    expect(Object.keys(sitePreviewMediaFolders(pool, { spSite: { html: page('SPSite.getMedia(name)') } }))).toEqual(['']);
  });

  it('puts the library at the root for a page with its own empty image list', () => {
    const media = sitePreviewMediaFolders(pool, { spSite: { html: page('const PHOTO_URLS = [];') } });
    expect(Object.keys(media)).toEqual(['']);
    expect(media[''].length).toBe(2);
  });

  it('gives nothing when the preview library is empty', () => {
    expect(sitePreviewMediaFolders([], { spSite: { html: page("SPSite.getMedia('streets')") } })).toEqual({});
  });

  it('reads literal getMedia folder names', () => {
    expect(pageMediaFolderNames("SPSite.getMedia('a'); SPSite . getMedia( `b/c` ); SPSite.getMedia(x)")).toEqual(['a', 'b/c']);
  });
});
