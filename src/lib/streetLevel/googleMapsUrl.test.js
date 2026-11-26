import {
  buildGoogleMapUrl,
  buildStreetViewUrl,
  extractUrls,
  isShortMapsUrl,
  parseGoogleMapsText,
  parseGoogleMapsUrl,
  viewPatchFromStreetViewUrl,
} from './googleMapsUrl';

const SV = 'https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,90.5h,95.3t/data=!3m6!1e1!3m4!1sAbCdEfGhIjKlMnOpQrStUv!2e0!7i16384!8i8192?entry=ttu';

describe('parseGoogleMapsUrl', () => {
  it('parses a Street View URL: lat/lng, fov (y), heading (h), pitch = t − 90, pano id', () => {
    const r = parseGoogleMapsUrl(SV);
    expect(r).toMatchObject({
      ok: true,
      kind: 'pano',
      lat: 48.8583701,
      lng: 2.2944813,
      fov: 75,
      heading: 90.5,
      pitch: 5.3,
      panoId: 'AbCdEfGhIjKlMnOpQrStUv',
      userUploaded: false,
      sourceUrl: SV,
    });
  });

  it('handles missing view tokens and negative coordinates', () => {
    const r = parseGoogleMapsUrl('https://www.google.com/maps/@-33.8568,151.2153,3a,60y/data=!3m4!1e1!3m2!1sXyZ_123-abcDEF456ghi!2e0');
    expect(r).toMatchObject({ ok: true, lat: -33.8568, lng: 151.2153, fov: 60, heading: null, pitch: null, panoId: 'XyZ_123-abcDEF456ghi' });
  });

  it('flags user-uploaded photospheres (!2e10)', () => {
    const r = parseGoogleMapsUrl('https://www.google.com/maps/@35.6,139.7,3a,90y,120h,80t/data=!3m8!1e1!3m6!1sAF1QipMxyzAbc123!2e10!3e11!7i8000!8i4000');
    expect(r.userUploaded).toBe(true);
    expect(r.panoId).toBe('AF1QipMxyzAbc123');
    expect(r.pitch).toBe(-10);
  });

  it('normalizes heading into [0, 360)', () => {
    const r = parseGoogleMapsUrl('https://www.google.com/maps/@1,2,3a,75y,-30h,90t/data=!3m4!1e1!3m2!1sPANO_ID_ABCDEFGHIJ!2e0');
    expect(r.heading).toBe(330);
    expect(r.pitch).toBe(0);
  });

  it('parses a place URL as a map point without taking the feature id as a pano id', () => {
    const r = parseGoogleMapsUrl('https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813');
    expect(r).toMatchObject({ ok: true, kind: 'map', lat: 48.8583701, lng: 2.2919064, zoom: 17, panoId: null });
  });

  it('parses documented api=1 pano and map URLs', () => {
    const pano = parseGoogleMapsUrl('https://www.google.com/maps/@?api=1&map_action=pano&pano=tu510ie_z4ptBZYo2BGEJg&viewpoint=48.857832%2C2.295226&heading=-45&pitch=38&fov=80');
    expect(pano).toMatchObject({ ok: true, kind: 'pano', lat: 48.857832, lng: 2.295226, heading: 315, pitch: 38, fov: 80, panoId: 'tu510ie_z4ptBZYo2BGEJg' });
    const map = parseGoogleMapsUrl('https://www.google.com/maps/@?api=1&map_action=map&center=-33.712206%2C150.311941&zoom=12');
    expect(map).toMatchObject({ ok: true, kind: 'map', lat: -33.712206, lng: 150.311941, zoom: 12 });
  });

  it('accepts regional Google hosts and maps.google.com', () => {
    expect(parseGoogleMapsUrl('https://www.google.co.uk/maps/@51.5,-0.12,15z').ok).toBe(true);
    expect(parseGoogleMapsUrl('https://maps.google.com/?q=40.7,-74.0').ok).toBe(true);
  });

  it('rejects short links, non-Google hosts and URLs without a location', () => {
    expect(parseGoogleMapsUrl('https://maps.app.goo.gl/AbC123').reason).toBe('short-link');
    expect(parseGoogleMapsUrl('https://example.com/maps/@1,2,3a').reason).toBe('not-google');
    expect(parseGoogleMapsUrl('https://www.google.com/search?q=maps').reason).toBe('not-google');
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/coffee').reason).toBe('no-location');
    expect(parseGoogleMapsUrl('not a url').reason).toBe('invalid');
    expect(parseGoogleMapsUrl('').reason).toBe('empty');
    expect(parseGoogleMapsUrl('https://www.google.com/maps/@95,2,15z').reason).toBe('no-location');
  });
});

describe('bulk paste and URL builders', () => {
  it('extracts many URLs from mixed text, in order', () => {
    const text = `first ${SV}\nsecond: https://maps.app.goo.gl/xyz, and\thttps://www.google.com/maps/@1,2,15z.`;
    expect(extractUrls(text)).toEqual([SV, 'https://maps.app.goo.gl/xyz', 'https://www.google.com/maps/@1,2,15z']);
    const parsed = parseGoogleMapsText(text);
    expect(parsed.map((p) => p.ok)).toEqual([true, false, true]);
  });

  it('detects short links', () => {
    expect(isShortMapsUrl('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isShortMapsUrl('https://goo.gl/maps/abc')).toBe(true);
    expect(isShortMapsUrl('https://goo.gl/other')).toBe(false);
  });

  it('builds keyless Maps URLs for map and pano actions', () => {
    expect(buildGoogleMapUrl({ lat: 1.23456789, lng: 103.8, zoom: 16.6 }))
      .toBe('https://www.google.com/maps/@?api=1&map_action=map&center=1.2345679%2C103.8&zoom=17');
    const sv = new URL(buildStreetViewUrl({ lat: 1.3, lng: 103.8, heading: 90, pitch: -5, fov: 120, panoId: 'P1' }));
    expect(Object.fromEntries(sv.searchParams)).toEqual({
      api: '1', map_action: 'pano', viewpoint: '1.3,103.8', pano: 'P1', heading: '90', pitch: '-5', fov: '100',
    });
    expect(sv.searchParams.has('key')).toBe(false);
  });

  it('round-trips a built pano URL through the parser', () => {
    const r = parseGoogleMapsUrl(buildStreetViewUrl({ lat: 22.3, lng: 114.17, heading: 45, pitch: 10, fov: 70 }));
    expect(r).toMatchObject({ ok: true, kind: 'pano', lat: 22.3, lng: 114.17, heading: 45, pitch: 10, fov: 70 });
  });
});

describe('viewPatchFromStreetViewUrl', () => {
  it('replaces one point’s view and pano id from a single Street View URL', () => {
    const result = viewPatchFromStreetViewUrl(SV);
    expect(result.ok).toBe(true);
    expect(result.patch).toEqual({
      heading: 90.5,
      pitch: 5.3,
      fov: 75,
      panoId: 'AbCdEfGhIjKlMnOpQrStUv',
      sourceUrl: SV,
    });
  });

  it('rejects several URLs and a map URL that is not a panorama', () => {
    expect(viewPatchFromStreetViewUrl(`${SV}\nhttps://www.google.com/maps/@1,2,3a,60y/data=!3m4!1e1!3m2!1sXyZ!2e0`).reason).toBe('several');
    expect(viewPatchFromStreetViewUrl('').reason).toBe('empty');
    expect(viewPatchFromStreetViewUrl('https://www.google.com/maps/@51.5,-0.12,15z').reason).toBe('not-pano');
  });
});
