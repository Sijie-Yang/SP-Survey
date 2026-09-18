import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PRESET_SKILLS } from '../presetSkills';
import {
  getQuestionMediaConstraints,
  isMediaStimulusQuestion,
  TRIAL_LOOP_EDITOR_TYPES,
} from '../questionTypeConstraints';
import {
  ENTITY_SCHEMAS,
  OPERATION_CONTRACT_SCHEMA,
  OPERATION_ITEM_SCHEMA,
  OPERATION_TYPES,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
  getEntitySchema,
  getOperationContract,
  getQuestionFieldDefinitions,
  getQuestionJsonSchema,
  getQuestionTypeDefinition,
  isKnownQuestionType,
  questionHasTrait,
} from './index';

const root = path.join(__dirname, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('canonical platform schema', () => {
  test('is JSON-compatible, deterministic, and hashed', () => {
    const roundTrip = JSON.parse(JSON.stringify(PLATFORM_SCHEMA));
    expect(roundTrip).toEqual(PLATFORM_SCHEMA);
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(PLATFORM_SCHEMA))
      .digest('hex');
    expect(PLATFORM_SCHEMA_HASH).toBe(`sha256:${digest}`);
  });

  test('covers project, survey, page, theme, media, and skill entities', () => {
    const expected = [
      'project', 'survey', 'page', 'theme', 'mediaItem', 'mediaDataset',
      'mediaSlot', 'skill', 'skillConfigField', 'skillResultField',
    ];
    expect(Object.keys(ENTITY_SCHEMAS)).toEqual(expect.arrayContaining(expected));
    expected.forEach((entity) => {
      expect(getEntitySchema(entity)).toEqual(expect.objectContaining({
        type: 'object',
        properties: expect.any(Object),
      }));
    });
    expect(ENTITY_SCHEMAS.project.required).toEqual(['id', 'name']);
    expect(ENTITY_SCHEMAS.survey.required).toEqual(['pages']);
    expect(ENTITY_SCHEMAS.page.required).toEqual(['name', 'elements']);
  });

  test('covers exactly the 34 base types exposed by QuestionEditor', () => {
    const source = read('src/components/admin/QuestionEditor.js');
    const start = source.indexOf('const questionTypes = [');
    const end = source.indexOf('\n  ];', start);
    const editorTypes = [...source.slice(start, end).matchAll(/\{\s*value:\s*'([^']+)'/g)]
      .map((match) => match[1]);

    expect(QUESTION_TYPE_IDS).toHaveLength(34);
    expect(QUESTION_TYPE_IDS).toEqual(editorTypes);
    expect(new Set(QUESTION_TYPE_IDS).size).toBe(34);
  });

  test.each(QUESTION_TYPE_IDS)('%s has complete field metadata', (type) => {
    const definition = getQuestionTypeDefinition(type);
    expect(isKnownQuestionType(type)).toBe(true);
    expect(definition).toEqual(expect.objectContaining({
      label: expect.any(String),
      group: expect.any(String),
      defaults: expect.any(Object),
      allFields: expect.arrayContaining(['type', 'name', 'title']),
    }));
    const fields = getQuestionFieldDefinitions(type);
    expect(Object.keys(fields)).toEqual(definition.allFields);
    Object.values(fields).forEach((field) => expect(field).toBeDefined());
    expect(getQuestionJsonSchema(type)).toEqual(expect.objectContaining({
      type: 'object',
      required: ['type', 'name'],
    }));
  });

  test('covers every direct QuestionEditor field mutation', () => {
    const source = read('src/components/admin/QuestionEditor.js');
    const editedFields = [...source.matchAll(/handleQuestionChange\('([^']+)'/g)]
      .map((match) => match[1]);
    editedFields.forEach((field) => {
      expect(PLATFORM_SCHEMA.questionFields[field]).toBeDefined();
    });
  });

  test('covers every survey response-contract question field', () => {
    const source = read('src/lib/surveyRevision.js');
    const contractFields = [
      ...PLATFORM_SCHEMA.responseContract.questionKeys,
      ...PLATFORM_SCHEMA.responseContract.staticMediaKeys,
    ];
    contractFields.forEach((field) => {
      expect(PLATFORM_SCHEMA.questionFields[field]).toBeDefined();
    });
    expect(source).toContain('PLATFORM_SCHEMA.responseContract.questionKeys');
  });

  test('media and trial constraints agree with schema traits', () => {
    QUESTION_TYPE_IDS.forEach((type) => {
      expect(isMediaStimulusQuestion(type)).toBe(
        questionHasTrait(type, 'stimulus') && type !== 'skillquestion',
      );
      expect(getQuestionMediaConstraints(type).hasStimuli).toBe(
        questionHasTrait(type, 'stimulus'),
      );
    });
    TRIAL_LOOP_EDITOR_TYPES.forEach((type) => {
      expect(isKnownQuestionType(type)).toBe(true);
      expect(questionHasTrait(type, 'trial')).toBe(true);
    });
  });

  test('custom runtime registrations refer to canonical question types', () => {
    const source = read('src/components/SurveyCustomComponents.js');
    const registered = [
      ...source.matchAll(/makeMediaQuestion\('([^']+)'/g),
      ...source.matchAll(/registerTrialAwareQuestion\('([^']+)'/g),
    ].map((match) => match[1]);
    registered.forEach((type) => expect(isKnownQuestionType(type)).toBe(true));
    [
      'trialMediaSets', 'spTrialsAnswer', 'mediaSlotsResolved',
      'slotIds', 'slotUrls', 'slotTypes', 'slotRoles', 'slotNames',
      'skillHtml', 'skillAnalysisHtml', 'skillAnswerSnapshot',
    ].forEach((field) => {
      expect(PLATFORM_SCHEMA.questionFields[field]).toEqual(
        expect.objectContaining({ agentWritable: false }),
      );
    });
  });

  test('preset skill config and result field types are represented', () => {
    const configTypes = new Set(
      PLATFORM_SCHEMA.entities.skillConfigField.fields.type.enum,
    );
    const resultTypes = new Set(
      PLATFORM_SCHEMA.entities.skillResultField.fields.type.enum,
    );
    PRESET_SKILLS.forEach((preset) => {
      expect(preset.id).toEqual(expect.any(String));
      expect(preset.defaultConfig).toEqual(expect.any(Object));
      expect(preset.resultSchema.length).toBeGreaterThan(0);
      preset.configSchema.forEach((field) => expect(configTypes.has(field.type)).toBe(true));
      preset.resultSchema.forEach((field) => expect(resultTypes.has(field.type)).toBe(true));
    });
  });
});

describe('canonical operation contracts', () => {
  test('preserve the public operation names and expose strict contracts', () => {
    expect(OPERATION_TYPES).toEqual([
      'addPage', 'removePage', 'addQuestion', 'updateQuestion',
      'removeQuestion', 'setAllRatingScales', 'replaceConfig',
      'updateSurvey', 'updatePage', 'setTheme', 'reorderPages', 'reorderQuestions',
    ]);
    expect(OPERATION_ITEM_SCHEMA.properties.op.enum).toEqual(OPERATION_TYPES);
    expect(JSON.stringify(OPERATION_ITEM_SCHEMA)).not.toContain('"$ref"');
    expect(OPERATION_CONTRACT_SCHEMA.oneOf).toHaveLength(OPERATION_TYPES.length);
    OPERATION_TYPES.forEach((operation) => {
      const contract = getOperationContract(operation);
      expect(contract.public).toBe(true);
      expect(contract.required).toContain('op');
      expect(contract.properties.op.const).toBe(operation);
    });
  });

  test('retains restoreRatingScales as an internal inverse contract', () => {
    expect(OPERATION_TYPES).not.toContain('restoreRatingScales');
    expect(getOperationContract('restoreRatingScales')).toEqual(
      expect.objectContaining({ public: false }),
    );
  });

  test('browser schema covers the same public operations and result families', () => {
    const workerOpsPath = path.join(root, 'worker-lib/designProtocol.mjs');
    if (fs.existsSync(workerOpsPath)) {
      const workerOps = read('worker-lib/designProtocol.mjs');
      OPERATION_TYPES.forEach((operation) => {
        expect(workerOps).toContain(`case '${operation}'`);
      });
    }
    const families = PLATFORM_SCHEMA.entities.skillResultField.fields.type.enum;
    expect(families).toEqual(expect.arrayContaining([
      'rating', 'number', 'points', 'path', 'polygon', 'bbox',
      'multiChoice', 'matrix', 'rankedList', 'compositeBlocks',
    ]));
    QUESTION_TYPE_IDS.forEach((type) => {
      expect(isKnownQuestionType(type)).toBe(true);
    });
  });
});
