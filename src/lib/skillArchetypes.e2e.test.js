/**
 * End-to-end contract: custom skill with declared archetypes + analysisHtml
 * is answerable, savable, analyzable (typed + custom view payload), and exportable.
 */
import { prepareSkillForSave } from './skillHtmlValidate';
import { checkAnswerAgainstResultSchema } from './skillResultTypes';
import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';
import {
  buildAnalysisSrcdoc,
  buildSyntheticAnalysisResponses,
  shapeAnalysisResponses,
} from './skillSdk';

const SOURCE = `<!DOCTYPE html><html><body>
<div id="app"></div>
<script>
document.addEventListener('spskill-init', function(e) {
  var images = e.detail.images || [];
  SPSkill.setAnswer({
    imageUrl: images[0] && images[0].url,
    marks: [{ x: 0.4, y: 0.5, label: 'door' }],
    budget: { trees: 40, seats: 60 },
    order: ['A', 'B'],
    score: 70
  });
  SPSkill.ready();
});
</script></body></html>`;

const ANALYSIS = `<!DOCTYPE html><html><body>
<div id="app"><h3>Custom analysis</h3><pre id="out"></pre></div>
<script>
document.addEventListener('spanalysis-init', function(e) {
  document.getElementById('out').textContent = JSON.stringify(SPAnalysis.getResponses().length);
});
</script></body></html>`;

describe('skill archetypes e2e contract', () => {
  test('save → answer check → analysis payload → export', () => {
    const prepared = prepareSkillForSave({
      name: 'Street marks',
      sourceHtml: SOURCE,
      analysisHtml: ANALYSIS,
      resultSchema: [
        { key: 'marks', label: 'Marks', type: 'points' },
        { key: 'budget', label: 'Budget', type: 'allocation' },
        { key: 'order', label: 'Order', type: 'rankedList' },
        { key: 'score', label: 'Score', type: 'number' },
      ],
      defaultConfig: { mediaCount: 1, mediaType: 'image' },
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.skill.analysisHtml).toContain('spanalysis-init');
    expect(prepared.warnings.join(' ')).not.toMatch(/Unknown resultSchema type/);

    const answer = {
      imageUrl: 'https://cdn.example/street.jpg',
      marks: [{ x: 0.4, y: 0.5, label: 'door' }],
      budget: { trees: 40, seats: 60 },
      order: ['A', 'B'],
      score: 70,
    };
    const check = checkAnswerAgainstResultSchema(answer, prepared.skill.resultSchema);
    expect(check.recorded).toBe(true);
    expect(check.fields.every((f) => f.ok)).toBe(true);

    const srcdoc = buildAnalysisSrcdoc(prepared.skill.analysisHtml, null);
    expect(srcdoc).toContain('SPAnalysis');
    const synth = buildSyntheticAnalysisResponses(prepared.skill.resultSchema, [{ url: answer.imageUrl }], 3);
    const shaped = shapeAnalysisResponses(synth.map((r) => ({ ...r, answer: r.answer })));
    expect(shaped.length).toBe(3);

    const question = {
      name: 'q1',
      type: 'skillquestion',
      skillId: 'skill_street_marks',
      skillResultSchema: prepared.skill.resultSchema,
      skillAnalysisHtml: prepared.skill.analysisHtml,
    };
    const rows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        q1: { answer, shown_images: [answer.imageUrl] },
      },
    }];
    const long = buildQuestionLongCsv(question, rows, null);
    const summary = buildQuestionSummaryCsv(question, rows);
    expect(long).toContain('points');
    expect(long).toContain('allocation');
    expect(long).toContain('rankedList');
    expect(long).toContain('answer_json');
    expect(summary).toContain('street.jpg');
    expect(summary).toContain('label_count');
    expect(summary).toContain('avg_rank');
  });
});
