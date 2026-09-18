import { PLATFORM_SCHEMA, QUESTION_TYPE_IDS } from '../platformSchema/generated.js';

export const GENERATION_CONTRACT_VERSION = '1.1.0';

const GENERIC_SLIDER_EXAMPLE = [
  { id: 'attr_a', label: 'Attribute A', left: 'Low', right: 'High' },
  { id: 'attr_b', label: 'Attribute B', left: 'Low', right: 'High' },
];

const GENERIC_CHOICES = [
  { value: 'opt_a', text: 'Option A' },
  { value: 'opt_b', text: 'Option B' },
  { value: 'opt_c', text: 'Option C' },
];

const GENERIC_ROWS = [
  { value: 'row_a', text: 'Row A' },
  { value: 'row_b', text: 'Row B' },
];

const GENERIC_COLUMNS = [
  { value: 'col_low', text: 'Low' },
  { value: 'col_high', text: 'High' },
];

const MEDIA_SAMPLING = {
  imageSelectionMode: 'huggingface_random',
  randomImageSelection: true,
  excludePreviouslyUsedImages: true,
};

const PRESET_SKILLS = [
  {
    skillId: 'preset_image_preference_slider',
    useWhen: 'Pairwise A/B preference strength',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: {
      leftLabel: { type: 'string' },
      rightLabel: { type: 'string' },
      prompt: { type: 'string' },
      mediaCount: { type: 'integer', const: 2 },
      mediaType: { type: 'string', enum: ['image'] },
    },
    imageCount: 2,
    answerShape: 'scaleGroup',
    analysisFamily: 'scaleGroup',
  },
  {
    skillId: 'preset_image_preference_forced',
    useWhen: 'Forced-choice A/B',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: {
      leftLabel: { type: 'string' },
      rightLabel: { type: 'string' },
      prompt: { type: 'string' },
      mediaCount: { type: 'integer', const: 2 },
      mediaType: { type: 'string', enum: ['image'] },
    },
    imageCount: 2,
    answerShape: 'pairwiseChoice',
    analysisFamily: 'pairwiseChoice',
  },
  {
    skillId: 'preset_best_worst_choice',
    useWhen: 'Best–worst / MaxDiff among scenes',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: {
      prompt: { type: 'string' },
      mediaCount: { type: 'integer', minimum: 3 },
      mediaType: { type: 'string' },
      bestLabel: { type: 'string' },
      worstLabel: { type: 'string' },
    },
    imageCount: 4,
    answerShape: 'bestWorst',
    analysisFamily: 'bestWorst',
  },
  {
    skillId: 'preset_emotion_color_picker',
    useWhen: 'Map a feeling to a color',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: { prompt: { type: 'string' }, mediaCount: { type: 'integer' }, mediaType: { type: 'string' } },
    imageCount: 1,
    answerShape: 'color',
    analysisFamily: 'color',
  },
  {
    skillId: 'preset_video_moment_tag',
    useWhen: 'Tag moments on a video timeline',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: { prompt: { type: 'string' }, mediaCount: { type: 'integer' }, mediaType: { type: 'string', enum: ['video'] } },
    imageCount: 1,
    answerShape: 'timeRanges',
    analysisFamily: 'timeRanges',
  },
  {
    skillId: 'preset_video_continuous_rating',
    useWhen: 'Continuous rating while watching video',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: {
      prompt: { type: 'string' },
      mediaCount: { type: 'integer' },
      mediaType: { type: 'string', enum: ['video'] },
      lowLabel: { type: 'string' },
      highLabel: { type: 'string' },
    },
    imageCount: 1,
    answerShape: 'timeSeries',
    analysisFamily: 'timeSeries',
  },
  {
    skillId: 'preset_composite_blocks',
    useWhen: 'Several mini-questions about one scene',
    required: ['skillId', 'skillConfig', 'imageCount'],
    skillConfig: { prompt: { type: 'string' }, mediaCount: { type: 'integer' }, mediaType: { type: 'string' } },
    imageCount: 1,
    answerShape: 'compositeBlocks',
    analysisFamily: 'compositeBlocks',
  },
];

const TYPE_OVERLAYS = {
  text: {
    useWhen: 'Short typed answer',
    answerOptions: 'none',
    answerShape: 'text',
    analysisFamily: 'text',
    minimumExample: { type: 'text', name: 'open_note', title: 'What stands out?' },
  },
  comment: {
    useWhen: 'Long typed answer',
    answerOptions: 'none',
    fieldConstraints: { rows: { type: 'integer', minimum: 1, not: 'matrix-rows-array' } },
    answerShape: 'text',
    analysisFamily: 'text',
    minimumExample: { type: 'comment', name: 'open_comment', title: 'Describe the scene', rows: 4 },
  },
  number: {
    useWhen: 'Numeric value',
    answerOptions: 'none',
    answerShape: 'number',
    analysisFamily: 'number',
    minimumExample: { type: 'number', name: 'count_people', title: 'How many people?', min: 0, max: 50 },
  },
  radiogroup: {
    useWhen: 'Single text choice',
    answerOptions: 'researcher_defined',
    answerShape: 'choice',
    analysisFamily: 'choice',
    minimumExample: { type: 'radiogroup', name: 'single_choice', title: 'Which statement fits?', choices: GENERIC_CHOICES },
  },
  checkbox: {
    useWhen: 'Multi text tags without a stimulus image',
    answerOptions: 'researcher_defined',
    answerShape: 'multiChoice',
    analysisFamily: 'multiChoice',
    minimumExample: { type: 'checkbox', name: 'text_tags', title: 'Which apply?', choices: GENERIC_CHOICES },
  },
  ranking: {
    useWhen: 'Rank researcher-defined text items',
    answerOptions: 'researcher_defined',
    answerShape: 'rankedList',
    analysisFamily: 'rankedList',
    minimumExample: { type: 'ranking', name: 'rank_qualities', title: 'Rank these qualities', choices: GENERIC_CHOICES },
  },
  rating: {
    useWhen: 'Numeric rating without media',
    answerOptions: 'none',
    answerShape: 'rating',
    analysisFamily: 'rating',
    minimumExample: {
      type: 'rating', name: 'overall_rating', title: 'Overall rating',
      rateMin: 1, rateMax: 7, minRateDescription: 'Low', maxRateDescription: 'High',
    },
  },
  boolean: {
    useWhen: 'Yes/No without media',
    answerOptions: 'none',
    answerShape: 'boolean',
    analysisFamily: 'boolean',
    minimumExample: { type: 'boolean', name: 'yes_no', title: 'Does this apply?', labelTrue: 'Yes', labelFalse: 'No' },
  },
  dropdown: {
    useWhen: 'Compact single choice',
    answerOptions: 'researcher_defined',
    answerShape: 'choice',
    analysisFamily: 'choice',
    minimumExample: { type: 'dropdown', name: 'dropdown_choice', title: 'Select one', choices: GENERIC_CHOICES },
  },
  matrix: {
    useWhen: 'Text matrix of statements × scale',
    answerOptions: 'researcher_defined',
    answerShape: 'matrix',
    analysisFamily: 'matrix',
    minimumExample: { type: 'matrix', name: 'text_matrix', title: 'Rate each statement', rows: GENERIC_ROWS, columns: GENERIC_COLUMNS },
  },
  expression: {
    useWhen: 'Instruction only',
    answerOptions: 'none',
    answerShape: 'none',
    analysisFamily: 'none',
    minimumExample: { type: 'expression', name: 'intro_note', title: 'Please look at the following scenes.' },
  },
  consent: {
    useWhen: 'Required consent',
    answerOptions: 'none',
    answerShape: 'boolean',
    analysisFamily: 'boolean',
    minimumExample: {
      type: 'consent', name: 'consent', title: 'I consent to participate',
      isRequired: true, labelTrue: 'I agree', labelFalse: 'I do not agree',
    },
  },
  slidergroup: {
    useWhen: 'Several bipolar scales without media',
    answerOptions: 'researcher_defined',
    requiredFields: ['dimensions'],
    fieldConstraints: {
      dimensions: { type: 'array', minItems: 1, items: { required: ['id', 'label', 'left', 'right'] } },
    },
    answerShape: 'scaleGroup',
    analysisFamily: 'scaleGroup',
    minimumExample: {
      type: 'slidergroup', name: 'text_sliders', title: 'Rate these attributes',
      scaleMin: 0, scaleMax: 100, dimensions: GENERIC_SLIDER_EXAMPLE,
    },
  },
  pointallocation: {
    useWhen: 'Allocate a budget across researcher-defined items',
    answerOptions: 'researcher_defined',
    answerShape: 'allocation',
    analysisFamily: 'allocation',
    minimumExample: {
      type: 'pointallocation', name: 'allocate_points', title: 'Allocate 100 points',
      budget: 100, choices: GENERIC_CHOICES,
    },
  },
  imagepicker: {
    useWhen: 'Choose among images drawn from the media pool',
    answerOptions: 'runtime_media_pool',
    answerShape: 'mediaChoice',
    analysisFamily: 'mediaChoice',
    minimumExample: { type: 'imagepicker', name: 'pick_scene', title: 'Which scene do you prefer?', imageCount: 4, ...MEDIA_SAMPLING },
  },
  imageranking: {
    useWhen: 'Rank images drawn from the media pool',
    answerOptions: 'runtime_media_pool',
    answerShape: 'mediaRankedList',
    analysisFamily: 'mediaRankedList',
    minimumExample: { type: 'imageranking', name: 'rank_scenes', title: 'Rank these scenes', imageCount: 4, ...MEDIA_SAMPLING },
  },
  imagerating: {
    useWhen: 'Rate one or more images',
    answerOptions: 'runtime_media_pool',
    answerShape: 'rating',
    analysisFamily: 'rating',
    minimumExample: {
      type: 'imagerating', name: 'rate_scene', title: 'How would you rate this scene?',
      imageCount: 1, rateMin: 1, rateMax: 7, ...MEDIA_SAMPLING,
    },
  },
  imageboolean: {
    useWhen: 'Yes/No about an image',
    answerOptions: 'runtime_media_pool',
    answerShape: 'boolean',
    analysisFamily: 'boolean',
    minimumExample: { type: 'imageboolean', name: 'scene_yes_no', title: 'Is this walkable?', imageCount: 1, ...MEDIA_SAMPLING },
  },
  imagecheckbox: {
    useWhen: 'Researcher-defined text tags about an image',
    answerOptions: 'researcher_defined',
    answerShape: 'multiChoice',
    analysisFamily: 'multiChoice',
    minimumExample: {
      type: 'imagecheckbox', name: 'scene_tags', title: 'Which features apply?',
      imageCount: 1, choices: GENERIC_CHOICES, ...MEDIA_SAMPLING,
    },
  },
  imagematrix: {
    useWhen: 'Matrix under an image',
    answerOptions: 'researcher_defined',
    answerShape: 'mediaMatrix',
    analysisFamily: 'mediaMatrix',
    minimumExample: {
      type: 'imagematrix', name: 'scene_matrix', title: 'Rate each aspect of this scene',
      imageCount: 1, rows: GENERIC_ROWS, columns: GENERIC_COLUMNS, ...MEDIA_SAMPLING,
    },
  },
  image: {
    useWhen: 'Display-only image',
    answerOptions: 'runtime_media_pool',
    answerShape: 'none',
    analysisFamily: 'none',
    minimumExample: { type: 'image', name: 'show_scene', title: 'Look at this scene', imageCount: 1, ...MEDIA_SAMPLING },
  },
  imageannotation: {
    useWhen: 'Draw on an image',
    answerOptions: 'runtime_media_pool',
    answerShape: 'points|path|polygon|bbox',
    analysisFamily: 'annotation',
    minimumExample: {
      type: 'imageannotation', name: 'mark_scene', title: 'Mark the relevant areas',
      imageCount: 1, allowedTools: ['point', 'bbox'], annotationLabels: ['object'], ...MEDIA_SAMPLING,
    },
  },
  imageslidergroup: {
    useWhen: 'Bipolar sliders about an image',
    answerOptions: 'researcher_defined',
    requiredFields: ['dimensions'],
    fieldConstraints: {
      dimensions: { type: 'array', minItems: 1, items: { required: ['id', 'label', 'left', 'right'], types: 'string' } },
    },
    answerShape: 'scaleGroup',
    analysisFamily: 'scaleGroup',
    minimumExample: {
      type: 'imageslidergroup', name: 'scene_sliders', title: 'Rate this scene on each attribute',
      imageCount: 1, scaleMin: 0, scaleMax: 100, dimensions: GENERIC_SLIDER_EXAMPLE, ...MEDIA_SAMPLING,
    },
  },
  imagepointallocation: {
    useWhen: 'Allocate points across researcher-defined labels with an image',
    answerOptions: 'researcher_defined',
    answerShape: 'allocation',
    analysisFamily: 'allocation',
    minimumExample: {
      type: 'imagepointallocation', name: 'scene_budget', title: 'Allocate 100 points',
      imageCount: 1, budget: 100, choices: GENERIC_CHOICES, ...MEDIA_SAMPLING,
    },
  },
  mediapicker: {
    useWhen: 'Choose among media from the pool',
    answerOptions: 'runtime_media_pool',
    answerShape: 'mediaChoice',
    analysisFamily: 'mediaChoice',
    minimumExample: {
      type: 'mediapicker', name: 'pick_media', title: 'Which clip do you prefer?',
      mediaType: 'any', imageCount: 4, mediaSlots: [], mediaPresentation: 'stack', ...MEDIA_SAMPLING,
    },
  },
  mediaranking: {
    useWhen: 'Rank media from the pool',
    answerOptions: 'runtime_media_pool',
    answerShape: 'mediaRankedList',
    analysisFamily: 'mediaRankedList',
    minimumExample: {
      type: 'mediaranking', name: 'rank_media', title: 'Rank these clips',
      mediaType: 'any', imageCount: 4, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediarating: {
    useWhen: 'Rate media from the pool',
    answerOptions: 'runtime_media_pool',
    answerShape: 'rating',
    analysisFamily: 'rating',
    minimumExample: {
      type: 'mediarating', name: 'rate_media', title: 'Rate this clip',
      mediaType: 'image', imageCount: 1, rateMin: 1, rateMax: 7, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediaboolean: {
    useWhen: 'Yes/No about media',
    answerOptions: 'runtime_media_pool',
    answerShape: 'boolean',
    analysisFamily: 'boolean',
    minimumExample: {
      type: 'mediaboolean', name: 'media_yes_no', title: 'Does this apply to the clip?',
      mediaType: 'any', imageCount: 1, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediacheckbox: {
    useWhen: 'Researcher-defined tags about media',
    answerOptions: 'researcher_defined',
    answerShape: 'multiChoice',
    analysisFamily: 'multiChoice',
    minimumExample: {
      type: 'mediacheckbox', name: 'media_tags', title: 'Which apply?',
      mediaType: 'any', imageCount: 1, choices: GENERIC_CHOICES, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediamatrix: {
    useWhen: 'Matrix under media',
    answerOptions: 'researcher_defined',
    answerShape: 'mediaMatrix',
    analysisFamily: 'mediaMatrix',
    minimumExample: {
      type: 'mediamatrix', name: 'media_matrix', title: 'Rate each aspect',
      mediaType: 'image', imageCount: 1, rows: GENERIC_ROWS, columns: GENERIC_COLUMNS, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediadisplay: {
    useWhen: 'Display-only media',
    answerOptions: 'runtime_media_pool',
    answerShape: 'none',
    analysisFamily: 'none',
    minimumExample: {
      type: 'mediadisplay', name: 'show_media', title: 'Watch this clip',
      mediaType: 'any', imageCount: 1, displayMode: 'single', mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediaslidergroup: {
    useWhen: 'Bipolar sliders about media',
    answerOptions: 'researcher_defined',
    requiredFields: ['dimensions'],
    answerShape: 'scaleGroup',
    analysisFamily: 'scaleGroup',
    minimumExample: {
      type: 'mediaslidergroup', name: 'media_sliders', title: 'Rate this clip',
      mediaType: 'image', imageCount: 1, scaleMin: 0, scaleMax: 100,
      dimensions: GENERIC_SLIDER_EXAMPLE, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  mediapointallocation: {
    useWhen: 'Allocate points with media',
    answerOptions: 'researcher_defined',
    answerShape: 'allocation',
    analysisFamily: 'allocation',
    minimumExample: {
      type: 'mediapointallocation', name: 'media_budget', title: 'Allocate 100 points',
      mediaType: 'any', imageCount: 1, budget: 100, choices: GENERIC_CHOICES, mediaSlots: [], ...MEDIA_SAMPLING,
    },
  },
  skillquestion: {
    useWhen: 'Preset interactive task',
    answerOptions: 'runtime_media_pool',
    answerShape: 'native skill family',
    analysisFamily: 'skill',
    minimumExample: {
      type: 'skillquestion',
      name: 'pairwise_pref',
      title: 'Which scene do you prefer?',
      skillId: 'preset_image_preference_slider',
      skillConfig: {
        leftLabel: 'Prefer A',
        rightLabel: 'Prefer B',
        prompt: 'Drag toward the scene you prefer.',
        mediaCount: 2,
        mediaType: 'image',
      },
      imageCount: 2,
      ...MEDIA_SAMPLING,
    },
  },
};

export function getPresetSkillContract(skillId) {
  return PRESET_SKILLS.find((preset) => preset.skillId === skillId) || null;
}

export function listPresetSkillContracts() {
  return PRESET_SKILLS;
}

export function getGenerationContract(typeId, schema = PLATFORM_SCHEMA) {
  const definition = schema.questionTypes?.[typeId] || {};
  const overlay = TYPE_OVERLAYS[typeId] || {
    useWhen: definition.label || typeId,
    answerOptions: 'none',
    answerShape: 'unknown',
    analysisFamily: 'unknown',
    minimumExample: { type: typeId, name: `${typeId}_q`, title: definition.label || typeId },
  };
  return {
    type: typeId,
    label: definition.label,
    group: definition.group,
    traits: definition.traits || [],
    editorBlankDefaults: definition.defaults || {},
    requiredFields: overlay.requiredFields || ['type', 'name'],
    fieldConstraints: overlay.fieldConstraints || {},
    media: {
      stimulus: (definition.traits || []).includes('stimulus'),
      folders: (definition.traits || []).includes('stimulus') ? 'optional mediaFolders / category tags on the dataset' : 'not used',
      category: (definition.traits || []).includes('stimulus') ? 'mediaAssignmentMode=category uses dataset folder tags' : 'not used',
      trial: (definition.traits || []).includes('trial') ? 'trialCount repeats the same sampling rule' : 'single presentation',
    },
    illustrations: {
      streetScene: typeId.includes('slider')
        ? {
          note: 'Illustration only. Do not reuse these poles unless the study is about street-scene perception.',
          dimensions: [
            { id: 'safety', label: '安全感', left: '很不安全', right: '很安全' },
            { id: 'walkability', label: '步行适宜性', left: '很不适宜', right: '很适宜' },
          ],
        }
        : undefined,
    },
    ...overlay,
    generationContractVersion: GENERATION_CONTRACT_VERSION,
  };
}

export function listGenerationContracts(schema = PLATFORM_SCHEMA) {
  return (QUESTION_TYPE_IDS.length ? QUESTION_TYPE_IDS : Object.keys(schema.questionTypes || {}))
    .map((typeId) => getGenerationContract(typeId, schema));
}

export function settingsCapabilityCatalog() {
  return {
    generationContractVersion: GENERATION_CONTRACT_VERSION,
    note: 'These settings live on the draft. survey_publish is required before a participant URL sees them.',
    items: [
      {
        id: 'theme.primaryColor',
        currentFrom: 'surveyConfig.theme.primaryColor',
        allowed: '#RRGGBB',
        scope: 'survey draft appearance',
        tool: 'survey_apply_operations op=setTheme (merge). setTheme.replace=true replaces the whole theme.',
        affectsPublished: false,
      },
      {
        id: 'locale',
        currentFrom: 'surveyConfig.locale',
        allowed: ['en', 'zh'],
        scope: 'participant chrome language',
        tool: 'survey_apply_operations op=updateSurvey patch.locale',
        affectsPublished: false,
      },
      {
        id: 'page.title',
        currentFrom: 'pages[name].title',
        allowed: 'string',
        scope: 'one page',
        tool: 'updatePage',
        affectsPublished: false,
      },
      {
        id: 'question.dimensions',
        currentFrom: 'working copy first, else saved question',
        allowed: '[{id,label,left,right}]',
        scope: 'one slider question',
        tool: 'updateQuestion',
        affectsPublished: false,
      },
      {
        id: 'media.imageSelectionMode',
        currentFrom: 'question.imageSelectionMode',
        allowed: ['huggingface_random', 'huggingface_manual'],
        scope: 'one stimulus question',
        tool: 'updateQuestion',
        affectsPublished: false,
      },
      {
        id: 'media.mediaAssignmentMode',
        currentFrom: 'question.mediaAssignmentMode',
        allowed: ['individual', 'set', 'category'],
        scope: 'one stimulus question; category/set need dataset folder tags',
        tool: 'updateQuestion',
        affectsPublished: false,
      },
      {
        id: 'media.trialCount',
        currentFrom: 'question.trialCount',
        allowed: 'integer >= 1',
        scope: 'repeats the same question with redrawn media',
        tool: 'updateQuestion',
        affectsPublished: false,
      },
    ],
  };
}
