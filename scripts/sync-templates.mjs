// Mirrors the online template library into public/project_templates/.
//
//   node scripts/sync-templates.mjs            fetch templates that changed
//   node scripts/sync-templates.mjs --all      fetch every template again
//   node scripts/sync-templates.mjs --media    also download media files into
//                                              public/project_templates/<id>/media/
//                                              (large: several GB; Git ignores it)
//   node scripts/sync-templates.mjs --media-only   download media for the template
//                                              files already here, change nothing else
//
// The source is the public API of sp-survey.org (SP_SURVEY_URL overrides it).
// One file per template: public/project_templates/<id>.json. A template that
// was mirrored from the library and has since been deleted there is deleted
// here too. Files that never came from the library, and templates whose media
// ship in this repository (the bundled demos), are left alone. It also writes catalog.json,
// the light list that the Template Library page and the README are built from.
// Afterwards run `node scripts/build-template-catalog.mjs` to refresh the README list and
// `node scripts/build-readme-images.mjs` to redraw the two README images that carry its numbers.
import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE = (process.env.SP_SURVEY_URL || 'https://sp-survey.org').replace(/\/$/, '');
const DIR = fileURLToPath(new URL('../public/project_templates/', import.meta.url));
const ALL = process.argv.includes('--all');
const MEDIA_ONLY = process.argv.includes('--media-only');
const MEDIA = MEDIA_ONLY || process.argv.includes('--media');
const HEADERS = { 'user-agent': 'sp-survey-template-sync' };

async function getJson(url, tries = 3) {
  let last;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`${url}: ${last.message}`);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  }));
}

/** Where a media file of a template lives online → its path under <id>/media/. */
function mediaPath(id, entry) {
  const key = String(entry?.key || '');
  const prefix = `templates/${id}/`;
  if (key.startsWith(prefix)) return key.slice(prefix.length);
  const folder = entry?.folder ? `${entry.folder}/` : '';
  return `${folder}${entry?.name || String(entry?.url || '').split('/').pop()}`;
}

let missed = 0;
async function downloadMedia(template) {
  // Files that ship in this repository have a path, not a web address: nothing to fetch.
  const entries = (template.preloadedImages || []).filter((entry) => /^https?:\/\//.test(String(entry?.url || '')));
  let fetched = 0;
  await pool(entries, 8, async (entry) => {
    const rel = mediaPath(template.id, entry);
    if (!rel || rel.includes('..')) return;
    const file = path.join(DIR, template.id, 'media', rel);
    const existing = await stat(file).catch(() => null);
    if (existing && (!entry.size || existing.size === entry.size)) return;
    const TRIES = 6;
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      let wait = 1500 * (attempt + 1);
      try {
        const res = await fetch(entry.url, { headers: HEADERS });
        if (res.status === 429) {
          // The media host is asking us to slow down: wait as long as it says, or longer each time.
          const asked = Number(res.headers.get('retry-after'));
          wait = Math.min(60000, asked > 0 ? asked * 1000 : 10000 * (attempt + 1));
        }
        if (!res.ok) throw new Error(String(res.status));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        fetched += 1;
        return;
      } catch (error) {
        if (attempt === TRIES - 1) { missed += 1; console.warn(`  media ${template.id}/${rel}: ${error.message}`); }
        else await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  });
  return fetched;
}

if (MEDIA_ONLY) {
  const names = (await readdir(DIR)).filter((name) => name.endsWith('.json') && !['index.json', 'catalog.json'].includes(name));
  let total = 0;
  for (const name of names) {
    const template = await readJson(path.join(DIR, name));
    if (template?.id) total += await downloadMedia(template);
  }
  console.log(`${names.length} templates: ${total} media files downloaded, ${missed} could not be fetched.`);
  process.exit(missed > 50 ? 1 : 0);
}

const { templates: online } = await getJson(`${SOURCE}/api/public/templates`);
if (!Array.isArray(online) || !online.length) throw new Error('The library came back empty; nothing was changed.');
await mkdir(DIR, { recursive: true });

let written = 0;
let unchanged = 0;
let mediaFiles = 0;
const failed = [];
const bundled = [];
const bundlesMedia = (template) => (template.preloadedImages || []).some((entry) => String(entry?.url || '').startsWith('/project_templates/'));
await pool(online, 4, async (row) => {
  const file = path.join(DIR, `${row.id}.json`);
  let template = await readJson(file);
  const fresh = !ALL && template && template.updatedAt && template.updatedAt === row.updatedAt;
  try {
    if (template && bundlesMedia(template)) {
      // Its media files ship in this repository, so the local file stays.
      bundled.push(row.id);
    } else if (!fresh) {
      template = (await getJson(`${SOURCE}/api/public/templates?id=${encodeURIComponent(row.id)}`)).template;
      await writeFile(file, `${JSON.stringify(template, null, 1)}\n`);
      written += 1;
    } else {
      unchanged += 1;
    }
    if (MEDIA) mediaFiles += await downloadMedia(template);
  } catch (error) {
    failed.push(`${row.id}: ${error.message}`);
  }
});

// A mirrored file carries the library's `updatedAt`. When its template is no
// longer online it was deleted there, so it goes here as well. If a tenth of
// the mirror would go at once, the list is more likely wrong than the mirror.
const onlineNow = new Set(online.map((row) => row.id));
const allFiles = (await readdir(DIR)).filter((name) => name.endsWith('.json') && !['index.json', 'catalog.json'].includes(name));
const allLoaded = await Promise.all(allFiles.map(async (name) => ({ name, tpl: await readJson(path.join(DIR, name)) })));
const mirrored = allLoaded.filter(({ tpl }) => tpl?.updatedAt && !bundlesMedia(tpl));
const gone = mirrored.filter(({ tpl }) => !onlineNow.has(tpl.id));
const removed = [];
if (gone.length * 10 > mirrored.length) {
  failed.push(`${gone.length} of ${mirrored.length} mirrored templates are missing online; none was removed`);
} else {
  for (const { name, tpl } of gone) {
    await rm(path.join(DIR, name));
    await rm(path.join(DIR, tpl.id, 'media'), { recursive: true, force: true });
    removed.push(tpl.id);
  }
}

// index.json lists every template file, newest study first.
const loaded = allLoaded.filter(({ tpl }) => !removed.includes(tpl?.id));
const files = loaded.map(({ name }) => name);
const meta = loaded.map(({ name, tpl }) => (
  { name, year: Number(tpl?.paper?.year || tpl?.year) || 0, pinned: !!tpl?.isPinned }
));
meta.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.year - a.year || a.name.localeCompare(b.name));
await writeFile(path.join(DIR, 'index.json'), `${JSON.stringify({ templates: meta.map((m) => m.name) }, null, 2)}\n`);

// catalog.json: one light entry per online template. `contributor` (the GitHub
// login of whoever sent the study in) is kept from the previous catalog.
const facet = (tpl, key) => (tpl.tags || [])
  .filter((tag) => String(tag).startsWith(`${key}:`)).map((tag) => String(tag).slice(key.length + 1));
// Hong Kong and Macau are listed as their own places, never under "China".
const OWN_PLACE = ['Hong Kong', 'Macau'];
function placeOf(countries, cities) {
  const own = OWN_PLACE.filter((place) => cities.includes(place));
  if (!own.length) return countries;
  const onlyThere = cities.every((city) => OWN_PLACE.includes(city));
  return [...new Set([...countries.filter((country) => !(onlyThere && country === 'China')), ...own])];
}
const authorName = (author) => (typeof author === 'string' ? author : author?.name || '');
const previous = new Map(((await readJson(path.join(DIR, 'catalog.json')))?.templates || []).map((entry) => [entry.id, entry]));
const wanted = new Set(online.map((row) => row.id));
const catalog = loaded.filter(({ tpl }) => tpl && wanted.has(tpl.id)).map(({ tpl }) => {
  const paper = tpl.paper && (tpl.paper.url || tpl.paper.doi) ? {
    title: tpl.paper.title || '',
    author: authorName((tpl.paper.authors || [])[0]),
    n: (tpl.paper.authors || []).length,
    year: tpl.paper.year,
    venue: tpl.paper.venue || '',
    url: tpl.paper.url || `https://doi.org/${tpl.paper.doi}`,
  } : null;
  const entry = {
    id: tpl.id,
    name: tpl.name,
    source: facet(tpl, 'source')[0] || (paper ? 'paper' : 'demo'),
    scene: facet(tpl, 'scene'),
    stimulus: facet(tpl, 'modality'),
    task: facet(tpl, 'task'),
    concept: facet(tpl, 'concept'),
    setting: facet(tpl, 'setting'),
    participants: facet(tpl, 'participants'),
    sample: facet(tpl, 'sample')[0] || '',
    location: placeOf(facet(tpl, 'country'), facet(tpl, 'city')),
    city: facet(tpl, 'city'),
    media: (tpl.preloadedImages || []).length,
    added: String(tpl.createdAt || '').slice(0, 10),
  };
  if (paper) entry.paper = paper;
  const contributor = previous.get(tpl.id)?.contributor;
  if (contributor) entry.contributor = contributor;
  return entry;
}).sort((a, b) => a.id.localeCompare(b.id));
if (!failed.length) {
  await writeFile(path.join(DIR, 'catalog.json'), `${JSON.stringify({
    snapshot: new Date().toISOString().slice(0, 10), source: `${SOURCE}/templates`, templates: catalog,
  })}\n`);
}

const onlineIds = new Set(online.map((row) => `${row.id}.json`));
const localOnly = files.filter((name) => !onlineIds.has(name));
console.log(`${online.length} templates online: ${written} written, ${unchanged} unchanged${MEDIA ? `, ${mediaFiles} media files downloaded` : ''}.`);
if (bundled.length) console.log(`Kept as they are (their media ship in this repository): ${bundled.join(', ')}`);
if (removed.length) console.log(`Removed (deleted from the online library): ${removed.join(', ')}`);
if (localOnly.length) console.log(`Only in this repository (left as they are): ${localOnly.join(', ')}`);
if (failed.length) { console.error(`Failed:\n  ${failed.join('\n  ')}`); process.exitCode = 1; }
