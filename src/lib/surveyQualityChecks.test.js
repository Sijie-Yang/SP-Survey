import { runSurveyQualityChecks } from './surveyQualityChecks';

describe('survey quality checks', () => {
  test('reports missing stems and rating anchors without rewriting the survey', () => {
    const config = {
      pages: [{
        name: 'p1',
        elements: [
          { name: 'q1', type: 'imagerating' },
          { name: 'q2', type: 'skillquestion', title: 'Task' },
        ],
      }],
    };
    const reports = runSurveyQualityChecks(config);
    expect(reports).toHaveLength(3);
    expect(reports[0].findings.some((item) => item.questionName === 'q1')).toBe(true);
    expect(reports[2].findings.some((item) => item.questionName === 'q2')).toBe(true);
    expect(config.pages[0].elements[0].title).toBeUndefined();
  });
});
