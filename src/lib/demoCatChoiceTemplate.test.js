import fs from 'fs';
import path from 'path';
import { Model } from 'survey-core';
import 'survey-core/survey.i18n';
import { validateSurveyConfig } from './designProtocol/validate';
import { normalizeRecommendation } from './analysisRecommendation';
import { applySurveyLocale } from './surveyLocale';
import { pickTrialMediaSetsForQuestion } from './surveyMediaInjection';
import { registerMediaPairingProps } from '../components/SurveyCustomComponents';

const DIR = path.join(__dirname, '..', '..', 'public', 'project_templates');
const ID = '2026-demo-cat-choice';
const ALLOWED_LICENSE = /^(CC0( 1\.0)?|CC BY( [0-9.]+)?( [a-z]{2})?|Public domain|PDM|PD)$/i;

function loadTemplate() {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${ID}.json`), 'utf8'));
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a jpeg');
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('jpeg size not found');
}

function parseCredits(text) {
  const rows = [];
  let current = null;
  text.split('\n').forEach((line) => {
    const file = line.match(/^- file: (\S+)/);
    if (file) {
      current = { file: file[1] };
      rows.push(current);
      return;
    }
    const field = line.match(/^  (author|source|license|licenseUrl): (.*)$/);
    if (field && current) current[field[1]] = field[2];
  });
  return rows;
}

test('cat pairwise demo is a listed builtin template of real breed photographs', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  expect(index.templates).toContain(`${ID}.json`);

  const tpl = loadTemplate();
  expect(tpl.id).toBe(ID);
  expect(tpl.showOnLanding).toBe(false);
  expect(tpl.config.locale).toBe('zh');
  expect(JSON.stringify(tpl)).toMatch(/你更喜欢哪只猫/);
  expect(JSON.stringify(tpl)).toMatch(/Which cat do you prefer/);
  expect(tpl.description).toMatch(/非街道|Non-street/);
  expect(tpl.tags).toEqual(expect.arrayContaining(['demo', 'pairwise', 'non-street']));
  expect(tpl.tags.join(' ')).not.toMatch(/streetscape|street-view|gsv/i);

  const result = validateSurveyConfig(tpl.config);
  expect(result.errors || []).toEqual([]);
  const names = tpl.config.pages.flatMap((page) => page.elements || []).map((q) => q.name);
  expect(new Set(names).size).toBe(names.length);
  const { items } = normalizeRecommendation(tpl.config);
  expect(items.length).toBeGreaterThan(0);
  items.forEach((item) => item.questions.forEach((q) => expect(names).toContain(q)));

  const choice = tpl.config.pages.flatMap((page) => page.elements).find((q) => q.name === 'cat_choice');
  expect(choice).toMatchObject({
    type: 'imagepicker',
    imageCount: 2,
    allowTie: false,
    multiSelect: false,
    mediaAssignmentMode: 'category',
    mediaCategoryMode: 'sample',
    mediaPerCategory: 1,
  });
  expect(choice.trialCount).toBeGreaterThanOrEqual(6);
  expect(choice.mediaFolders.length).toBeGreaterThanOrEqual(36);

  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, ID, 'images.json'), 'utf8'));
  expect(manifest.templateId).toBe(ID);
  expect(manifest.images.length).toBeGreaterThanOrEqual(36 * 3);
  const byFolder = new Map();
  manifest.images.forEach((rel) => {
    const file = path.join(DIR, ID, rel);
    const buf = fs.readFileSync(file);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
    const size = jpegSize(buf);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(800);
    expect(Math.max(size.width, size.height)).toBeGreaterThanOrEqual(200);
    const folder = rel.split('/')[0];
    byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
    expect(manifest.notes[rel]).toMatch(/\p{Script=Han}/u);
    expect(manifest.notes[rel]).toMatch(/[A-Za-z]/);
  });
  expect(byFolder.size).toBeGreaterThanOrEqual(36);
  byFolder.forEach((count) => expect(count).toBeGreaterThanOrEqual(3));

  const bundledUrls = manifest.images.map((rel) => `/project_templates/${ID}/${rel}`);
  expect(tpl.preloadedImages.map((img) => img.url)).toEqual(bundledUrls);
  expect(new Set(tpl.preloadedImages.map((img) => img.folder))).toEqual(new Set(byFolder.keys()));
  tpl.preloadedImages.forEach((img) => {
    expect(img.type).toBe('image');
    expect(tpl.imageDatasetConfig.mediaFolderTags[img.folder]).toBe('category');
  });
  expect(choice.mediaFolders.slice().sort()).toEqual([...byFolder.keys()].sort());

  const participantText = [
    tpl.config.title,
    tpl.config.description,
    ...tpl.config.pages.flatMap((page) => [
      page.title,
      page.description,
      ...(page.elements || []).flatMap((element) => [element.title, element.description, element.html]),
    ]),
  ].filter(Boolean).join('\n');
  expect(participantText).toMatch(/你更喜欢哪只猫/);
  expect(participantText).toMatch(/Which cat do you prefer/);
  expect(participantText).toMatch(/请选出你更喜欢的一只/);
  expect(participantText).toMatch(/Choose the cat you prefer/);
  expect(participantText).not.toMatch(/演示|非街道|demo|street|folder|抽样|sampling|维基|CREDITS/i);
  Object.values(manifest.notes).forEach((note) => {
    const [label] = note.split(' — ');
    expect(label).toMatch(/\p{Script=Han}/u);
    expect(label).toMatch(/[A-Za-z]/);
  });

  const credits = parseCredits(fs.readFileSync(path.join(DIR, ID, 'CREDITS.md'), 'utf8'));
  expect(credits.map((row) => row.file).sort()).toEqual([...manifest.images].sort());
  credits.forEach((row) => {
    expect(row.author.length).toBeGreaterThan(0);
    expect(row.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(row.license).toMatch(ALLOWED_LICENSE);
    expect(row.licenseUrl).toMatch(/^https?:\/\//);
  });

  const covers = JSON.parse(fs.readFileSync(path.join(DIR, 'cover_images', 'index.json'), 'utf8'));
  expect(covers.covers[ID]).toBe('2026-demo-cat-choice.jpg');
  expect(fs.statSync(path.join(DIR, 'cover_images', covers.covers[ID])).size).toBeGreaterThan(1000);
});

test('each trial compares two breeds and can show another photo of the same breed', () => {
  const tpl = loadTemplate();
  const choice = tpl.config.pages.flatMap((page) => page.elements).find((q) => q.name === 'cat_choice');
  const tags = tpl.imageDatasetConfig.mediaFolderTags;
  const { trialMediaSets } = pickTrialMediaSetsForQuestion(
    tpl.preloadedImages,
    choice,
    choice.trialCount,
    new Set(),
    new Set(),
    null,
    tags,
  );
  expect(trialMediaSets).toHaveLength(choice.trialCount);
  trialMediaSets.forEach((trial) => {
    expect(trial).toHaveLength(2);
    const folders = trial.map((img) => img.folder);
    expect(new Set(folders).size).toBe(2);
    folders.forEach((folder) => expect(tags[folder]).toBe('category'));
  });

  const seen = new Map();
  for (let i = 0; i < 40; i += 1) {
    const again = pickTrialMediaSetsForQuestion(
      tpl.preloadedImages,
      { ...choice, excludePreviouslyUsedImages: false },
      1,
      new Set(),
      new Set(),
      null,
      tags,
    );
    again.trialMediaSets.flat().forEach((img) => {
      const names = seen.get(img.folder) || new Set();
      names.add(img.name);
      seen.set(img.folder, names);
    });
  }
  expect([...seen.values()].some((names) => names.size > 1)).toBe(true);
});

test('the choice trial opens in Chinese and keeps the English prompt', () => {
  registerMediaPairingProps();
  const tpl = loadTemplate();
  const model = new Model(tpl.config);
  applySurveyLocale(model, tpl.config);
  expect(model.locale).toBe('zh-cn');
  expect(model.pageNextText).toBe('下一页');
  const question = model.getQuestionByName('cat_choice');
  expect(question.title).toContain('你更喜欢哪只猫');
  expect(question.title).toContain('Which cat do you prefer');
  expect(question.mediaCategoryMode).toBe('sample');
});
