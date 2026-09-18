import {
  sanitizeForAgent,
  findSecretFields,
  restoreStoredSecrets,
  validateSurveyConfig,
  postProcessAiConfig,
  applyOperations,
  normalizeOperationsArg,
  createDefaultSurveyConfig,
  isSafeProjectId,
  DESIGN_CAPABILITIES,
} from './index';

describe('designProtocol secrets', () => {
  test('strips secret fields', () => {
    const cleaned = sanitizeForAgent({
      title: 'A',
      huggingFaceToken: 'secret',
      nested: { apiKey: 'x', keep: 1 },
    });
    expect(cleaned).toEqual({ title: 'A', nested: { keep: 1 } });
  });

  test('finds secret field paths', () => {
    const paths = findSecretFields({ openaiApiKey: 'a', pages: [{ falApiKey: 'b' }] });
    expect(paths).toEqual(expect.arrayContaining(['openaiApiKey', 'pages[0].falApiKey']));
  });

  test('restores stored secrets after agent replace', () => {
    const restored = restoreStoredSecrets(
      { title: 'new', huggingFaceToken: 'attempt' },
      { title: 'old', huggingFaceToken: 'kept' },
    );
    expect(restored.huggingFaceToken).toBe('kept');
    expect(restored.title).toBe('new');
  });
});

describe('designProtocol validate', () => {
  test('rejects missing pages', () => {
    const report = validateSurveyConfig({});
    expect(report.valid).toBe(false);
  });

  test('flags duplicate question names', () => {
    const report = validateSurveyConfig({
      pages: [{
        name: 'p1',
        elements: [
          { type: 'text', name: 'q1' },
          { type: 'text', name: 'q1' },
        ],
      }],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  test('accepts a default config', () => {
    const report = validateSurveyConfig(createDefaultSurveyConfig('Demo'));
    expect(report.valid).toBe(true);
  });

  test('rejects structured annotation labels because the runtime contract stores strings', () => {
    const report = validateSurveyConfig({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageannotation',
          name: 'hazards',
          annotationLabels: [{ text: 'Danger', value: 'danger' }],
        }],
      }],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path.endsWith('annotationLabels[0]'))).toBe(true);
  });
});

describe('designProtocol normalize + operations', () => {
  test('capabilities expose the same 34 base types as the Builder', () => {
    expect(DESIGN_CAPABILITIES.questionTypes).toHaveLength(34);
    expect(DESIGN_CAPABILITIES.questionTypes).toEqual(expect.arrayContaining([
      'number', 'expression', 'skillquestion', 'imageannotation', 'mediamatrix',
      'imagecheckbox', 'mediacheckbox',
    ]));
  });

  test('postProcessAiConfig defaults imagecheckbox choices and annotation tools', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [
          { type: 'imagecheckbox', name: 'ic1' },
          { type: 'imageannotation', name: 'ann1', allowedTools: ['path', 'points', 'region'] },
        ],
      }],
    });
    const ic = out.pages[0].elements[0];
    expect(ic.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'tag_a' }),
    ]));
    expect(out.pages[0].elements[1].allowedTools).toEqual(['line', 'point', 'polygon']);
  });

  test('postProcessAiConfig repairs structured annotation labels from model output', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageannotation',
          name: 'ann1',
          annotationLabels: [{ text: '危险点', value: 'danger' }, '遮挡'],
        }],
      }],
    });
    expect(out.pages[0].elements[0].annotationLabels).toEqual(['危险点', '遮挡']);
  });

  test('postProcessAiConfig persists slider id/pole aliases as survey settings', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageslidergroup',
          name: 'scene_semantic_diff',
          dimensions: [
            { id: 'safety', left: '感觉不安全', right: '感觉很安全' },
            { id: 'walkability', leftLabel: '不适合步行', rightLabel: '非常适合步行' },
          ],
        }],
      }],
    });
    expect(out.pages[0].elements[0].dimensions).toEqual([
      expect.objectContaining({ id: 'safety', label: 'safety', left: '感觉不安全', right: '感觉很安全' }),
      expect.objectContaining({ id: 'walkability', label: 'walkability', left: '不适合步行', right: '非常适合步行' }),
    ]);
  });

  test('postProcessAiConfig sets image defaults', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [{ type: 'imagerating', name: 'r1', imageSelectionMode: 'random' }],
      }],
    });
    expect(out.pages[0].elements[0].imageSelectionMode).toBe('huggingface_random');
    expect(out.pages[0].elements[0].choices).toEqual([]);
  });

  test('postProcessAiConfig normalizes media* and skillquestion', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [
          { type: 'mediapicker', name: 'm1' },
          {
            type: 'skillquestion',
            name: 's1',
            skillId: 'image_preference_slider',
            skillConfig: { mediaCount: 2 },
            skillHtml: '<html>nope</html>',
          },
          {
            type: 'skillquestion',
            name: 's2',
            skillId: 'skill_123_abc',
          },
          {
            type: 'skillquestion',
            name: 's3',
            skillId: 'preset_skill_123_abc',
          },
        ],
      }],
    });
    const media = out.pages[0].elements[0];
    expect(media.imageSelectionMode).toBe('huggingface_random');
    expect(media.mediaSlots).toEqual([]);
    expect(media.mediaPresentation).toBe('stack');
    const skill = out.pages[0].elements[1];
    expect(skill.skillId).toBe('preset_image_preference_slider');
    expect(skill.imageCount).toBe(2);
    expect(skill.skillHtml).toBeUndefined();
    expect(out.pages[0].elements[2].skillId).toBe('skill_123_abc');
    expect(out.pages[0].elements[3].skillId).toBe('skill_123_abc');
  });

  test('applyOperations add/remove question with inverse', () => {
    const base = createDefaultSurveyConfig('Demo');
    const result = applyOperations(base, [{
      op: 'addQuestion',
      pageName: 'page1',
      question: { type: 'text', name: 'age', title: 'Age' },
    }]);
    expect(result.validation.valid).toBe(true);
    expect(result.surveyConfig.pages[0].elements).toHaveLength(1);

    const undone = applyOperations(result.surveyConfig, result.inverse);
    expect(undone.surveyConfig.pages[0].elements).toHaveLength(0);
  });

  test('applyOperations updates survey, theme, and order without replaceConfig', () => {
    const base = createDefaultSurveyConfig('Demo');
    base.pages.push({ name: 'page2', title: 'Second', elements: [] });
    const result = applyOperations(base, [
      { op: 'updateSurvey', patch: { title: '中文问卷', locale: 'zh' } },
      { op: 'updatePage', pageName: 'page1', patch: { title: '第一页' } },
      { op: 'setTheme', theme: { primaryColor: '#123456' } },
      { op: 'reorderPages', pageNames: ['page2', 'page1'] },
    ]);
    expect(result.surveyConfig.title).toBe('中文问卷');
    expect(result.surveyConfig.locale).toBe('zh');
    expect(result.surveyConfig.pages[0].name).toBe('page2');
    expect(result.surveyConfig.pages[1].title).toBe('第一页');
    expect(result.surveyConfig.theme.primaryColor).toBe('#123456');
    expect(result.surveyConfig.theme.secondaryColor).toBeUndefined();
    const themed = applyOperations({
      ...result.surveyConfig,
      theme: { primaryColor: '#111111', secondaryColor: '#222222', accentColor: '#333333' },
    }, [{ op: 'setTheme', theme: { primaryColor: '#abcdef' } }]);
    expect(themed.surveyConfig.theme).toEqual({
      primaryColor: '#abcdef',
      secondaryColor: '#222222',
      accentColor: '#333333',
    });
    const undone = applyOperations(result.surveyConfig, result.inverse);
    expect(undone.surveyConfig.title).toBe('Demo');
    expect(undone.surveyConfig.pages[0].name).toBe('page1');
  });

  test('applyOperations reorders questions and inverts the change', () => {
    const base = createDefaultSurveyConfig('Demo');
    base.pages[0].elements = [
      { type: 'text', name: 'a', title: 'A' },
      { type: 'text', name: 'b', title: 'B' },
    ];
    const result = applyOperations(base, [{
      op: 'reorderQuestions',
      pageName: 'page1',
      questionNames: ['b', 'a'],
    }]);
    expect(result.surveyConfig.pages[0].elements.map((el) => el.name)).toEqual(['b', 'a']);
    const undone = applyOperations(result.surveyConfig, result.inverse);
    expect(undone.surveyConfig.pages[0].elements.map((el) => el.name)).toEqual(['a', 'b']);
  });

  test('applyOperations accepts a single replaceConfig object from weaker models', () => {
    const base = createDefaultSurveyConfig('Demo');
    const result = applyOperations(base, {
      op: 'replaceConfig',
      surveyConfig: { title: '街景视觉感知', pages: [{ name: 'p1', elements: [{ type: 'text', name: 'q1' }] }] },
    });
    expect(result.surveyConfig.title).toBe('街景视觉感知');
    expect(normalizeOperationsArg({ 0: { op: 'addPage', page: { name: 'p2' } } })).toEqual([
      { op: 'addPage', page: { name: 'p2' } },
    ]);
    expect(() => applyOperations(base, 'not-ops')).toThrow(/operations must be an array/);
  });

  test('isSafeProjectId', () => {
    expect(isSafeProjectId('proj_123_abc')).toBe(true);
    expect(isSafeProjectId('../evil')).toBe(false);
  });
});
