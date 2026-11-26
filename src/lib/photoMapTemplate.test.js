import fs from 'fs';
import path from 'path';
import { validateSurveyConfig } from './designProtocol/validate';
import { insideStudyArea, resolveStudyArea } from './mapAnnotation';

const DIR = path.join(__dirname, '..', '..', 'public', 'project_templates');
const ID = '2026-photo-map';
const IMAGE = '/project_templates/2026-photo-map/riverfront.svg';

const template = JSON.parse(fs.readFileSync(path.join(DIR, `${ID}.json`), 'utf8'));

test('photo and map template is listed, valid, bilingual, and kept on one page', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  expect(index.templates.filter((name) => name === `${ID}.json`)).toEqual([`${ID}.json`]);
  expect(template.id).toBe(ID);
  expect(fs.existsSync(path.join(DIR, ID, 'riverfront.svg'))).toBe(true);

  const result = validateSurveyConfig(template.config);
  expect(result.errors || []).toEqual([]);

  expect(template.config.locale).toBe('zh');
  expect(template.config.spMapTaskOrder).toBeUndefined();
  expect(template.config.pages).toHaveLength(1);

  const page = template.config.pages[0];
  expect(page.questionsOrder).toBe('initial');
  expect(page.elements.map((element) => element.type)).toEqual(['image', 'mapannotation']);
  expect(page.elements.map((element) => element.name)).toEqual(['scene_view', 'photo_location']);

  const photo = page.elements[0];
  expect(photo.randomImageSelection).toBe(false);
  expect(photo.imageSelectionMode).toBe('huggingface_manual');
  expect(photo.imageLink).toBe(IMAGE);
  expect(photo.imageLinks).toEqual([IMAGE]);
  expect(photo.selectedImageUrls).toEqual([IMAGE]);
  expect(photo.title).toMatch(/请看这张图/);
  expect(photo.title).toMatch(/Look at this picture/);
  expect(photo.description).toBe('');

  const map = page.elements[1];
  expect(map.mapTools).toEqual(['point']);
  expect(map.cityQuestion).toBeUndefined();
  expect(map.mapPair).toBeUndefined();
  expect(map.mapPolarity).toBe('single');
  expect(map.minAnnotations).toBe(1);
  expect(map.maxAnnotations).toBe(1);
  expect(map.studyAreas).toHaveLength(1);
  expect(map.title).toMatch(/请在上海地图上标出一个点/);
  expect(map.title).toMatch(/Mark one point on the Shanghai map/);
  expect(map.description).toBe('');
  expect(page.title).toMatch(/这个画面在哪里/);
  expect(page.title).toMatch(/Where is this view/);
  expect(page.description).toMatch(/请看这张图/);
  expect(page.description).toMatch(/Look at this picture/);

  const participantText = [
    template.config.title,
    template.config.description,
    template.config.completedHtml,
    page.title,
    page.description,
    photo.title,
    photo.description,
    photo.altText,
    map.title,
    map.description,
    map.studyAreas[0].label,
  ].join('\n');
  expect(participantText).not.toMatch(/随机|random|插画|illustration|模板|template|选择“?点|Choose Point|\/ Point/i);

  const area = resolveStudyArea(map, null);
  expect(area.id).toBe('shanghai-photo-map');
  expect(area.cityId).toBe('shanghai');
  expect(insideStudyArea([121.49, 31.23], area)).toBe(true);
  expect(insideStudyArea([0, 0], area)).toBe(false);
});
