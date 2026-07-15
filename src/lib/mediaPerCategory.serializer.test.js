import { Serializer, Question, Model } from 'survey-core';
import { registerMediaPairingProps } from '../components/SurveyCustomComponents';

describe('mediaPerCategory SurveyJS serialization', () => {
  beforeAll(() => {
    class ImageRatingQ extends Question {
      getType() { return 'imagerating'; }
    }
    if (!Serializer.findClass('imagerating')) {
      Serializer.addClass(
        'imagerating',
        [
          { name: 'imageCount:number', default: 1, category: 'general' },
          { name: 'randomImageSelection:boolean', default: false, category: 'general' },
        ],
        () => new ImageRatingQ(),
        'question',
      );
    }
    registerMediaPairingProps();
  });

  test('mediaPerCategory survives Model round-trip', () => {
    const model = new Model({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imagerating',
          name: 'q1',
          mediaAssignmentMode: 'category',
          mediaPerCategory: 3,
          mediaFolders: ['cats/urban'],
          randomImageSelection: true,
        }],
      }],
    });
    const q = model.getQuestionByName('q1');
    expect(q.mediaAssignmentMode).toBe('category');
    expect(Number(q.mediaPerCategory)).toBe(3);
    expect([...(q.mediaFolders || [])]).toEqual(['cats/urban']);

    const json = model.toJSON();
    const restored = new Model(json);
    const q2 = restored.getQuestionByName('q1');
    expect(Number(q2.mediaPerCategory)).toBe(3);
    expect(q2.mediaAssignmentMode).toBe('category');
  });

  test('missing mediaPerCategory defaults to 1', () => {
    const model = new Model({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imagerating',
          name: 'q2',
          mediaAssignmentMode: 'category',
        }],
      }],
    });
    expect(Number(model.getQuestionByName('q2').mediaPerCategory)).toBe(1);
  });
});
