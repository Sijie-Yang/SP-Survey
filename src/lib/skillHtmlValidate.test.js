import { validateSkillSourceHtml, prepareSkillForSave } from './skillHtmlValidate';

describe('validateSkillSourceHtml', () => {
  test('rejects missing setAnswer', () => {
    const r = validateSkillSourceHtml('<script>parent.postMessage({type:"skill-result"},"*")</script>');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/SPSkill\.setAnswer/);
  });

  test('accepts SPSkill.setAnswer', () => {
    const r = validateSkillSourceHtml(`
      <script>
      document.addEventListener('spskill-init', function(){});
      SPSkill.setAnswer({ score: 1 });
      </script>
    `);
    expect(r.ok).toBe(true);
  });
});

describe('prepareSkillForSave', () => {
  const strictHtml = `
    <script>
      document.addEventListener('spskill-init', function() {});
      SPSkill.setAnswer({ choice: 'a' });
    </script>
  `;

  test('normalizes string schemas', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({x:1})</script>',
      configSchema: ['prompt'],
      resultSchema: ['score'],
    });
    expect(r.ok).toBe(true);
    expect(r.skill.configSchema[0].key).toBe('prompt');
    expect(r.skill.resultSchema[0].key).toBe('score');
  });

  test('warns on unknown result types but still saves', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({graph:{}})</script>',
      resultSchema: [{ key: 'graph', label: 'Graph', type: 'customGraph' }],
      analysisHtml: '<div id="app"></div>',
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Unknown resultSchema type/);
    expect(r.skill.analysisHtml).toContain('app');
  });

  test('accepts archetype types without warning', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({marks:[]})</script>',
      resultSchema: [{ key: 'marks', label: 'Marks', type: 'points' }],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/Unknown resultSchema type/);
  });

  test('strict contracts reject custom result layers and non-native shapes', () => {
    const json = prepareSkillForSave({
      contractVersion: 1,
      sourceHtml: strictHtml,
      resultSchema: [{ key: 'choice', label: 'Choice', type: 'json' }],
      exampleAnswer: { choice: { custom: true } },
    });
    expect(json.ok).toBe(false);
    expect(json.errors.join(' ')).toMatch(/exact native result\/export family/);

    const customAnalysis = prepareSkillForSave({
      contractVersion: 1,
      sourceHtml: strictHtml,
      resultSchema: [{ key: 'choice', label: 'Choice', type: 'choice', options: ['a', 'b'] }],
      exampleAnswer: { choice: 'a' },
      analysisHtml: '<div>custom result</div>',
    });
    expect(customAnalysis.ok).toBe(false);
    expect(customAnalysis.errors.join(' ')).toMatch(/analysisHtml is not allowed/);
  });

  test('preserves and requires native question settings', () => {
    const valid = prepareSkillForSave({
      contractVersion: 1,
      sourceHtml: strictHtml,
      resultSchema: [{
        key: 'choice', label: 'Choice', type: 'choice', options: ['a', 'b'], min: 0, max: 1,
      }],
      exampleAnswer: { choice: 'a' },
    });
    expect(valid.ok).toBe(true);
    expect(valid.skill.resultSchema[0]).toMatchObject({ options: ['a', 'b'], min: 0, max: 1 });

    const missing = prepareSkillForSave({
      contractVersion: 1,
      sourceHtml: strictHtml,
      resultSchema: [{ key: 'choice', label: 'Choice', type: 'choice' }],
      exampleAnswer: { choice: 'a' },
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(' ')).toMatch(/requires non-empty options/);
  });

  test('strict contracts require exactly one native family', () => {
    const result = prepareSkillForSave({
      contractVersion: 1,
      sourceHtml: strictHtml,
      resultSchema: [
        { key: 'choice', label: 'Choice', type: 'choice', options: ['a', 'b'] },
        { key: 'note', label: 'Note', type: 'text' },
      ],
      exampleAnswer: { choice: 'a', note: 'ok' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/exactly one native result field/);
  });
});
