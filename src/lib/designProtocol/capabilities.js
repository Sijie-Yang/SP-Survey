/**
 * Survey design capabilities / rules exposed to Codex via MCP.
 */

export const AGENT_SCOPES = {
  READ: 'surveys:read',
  WRITE_DRAFT: 'surveys:write',
  PUBLISH: 'surveys:publish',
  MEDIA: 'media:write',
  RESULTS_READ: 'results:read',
};

/** Shared media sampling fields for image* / media* / skillquestion. */
const MEDIA_SAMPLING = {
  imageSelectionMode: 'huggingface_random',
  randomImageSelection: true,
  excludePreviouslyUsedImages: true,
  choices: [],
};

export const DESIGN_CAPABILITIES = {
  name: 'SP-Survey Design Protocol',
  version: '1.1.0',
  questionTypes: [
    'text', 'comment', 'number', 'radiogroup', 'checkbox', 'dropdown', 'boolean', 'rating',
    'matrix', 'ranking', 'slidergroup', 'pointallocation', 'consent',
    'expression',
    'image', 'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox',
    'imagematrix', 'imageslidergroup', 'imagepointallocation', 'imageannotation',
    'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
    'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
    'skillquestion',
  ],
  rules: [
    'Question names must be unique across the survey.',
    'Prefer deterministic operations over full surveyConfig replace.',
    'Never send API keys, HuggingFace tokens, fal keys, or Supabase credentials.',
    'Saves update the live participant URL immediately (preview / share / view-live).',
    'Product "Publish to Main Page" is the homepage listing flow, not gating the share URL.',
    'Use expectedDraftUpdatedAt for optimistic concurrency on every write.',
    'Prefer image*/media*/skillquestion for visual preference studies — not only text/rating.',
    'Media pipeline has several layers (see mediaAssignment). Default simple case: imageSelectionMode=huggingface_random (UI: Random from project media pool), mediaAssignmentMode=individual, choices:[]. Runtime injects files from the project Media Dataset.',
    'Do not put skillHtml on survey questions. Use skillquestion with skillId from skillPresets (preset_*) or skill_list / skill_save (your private library).',
    'media* may use mediaSlots for multi-modal (video+audio+image). Empty mediaSlots = legacy single-pool path.',
    'Match imageCount / skillConfig.mediaCount to stimuli needed. For set mode, imageCount must equal files-per-set folder size.',
    'Never invent media URLs; never send HuggingFace/fal/API keys. Folder tags (set/category) live on the project Media Dataset, not as fake URLs.',
    'MEDIA SOURCE RULES: Do NOT AI-generate / synthesize / invent images or videos and media_upload them. Prefer media_import_from_template, the project Media Dataset, or the platform Admin preview media library (预览媒体库). media_upload only for real files the researcher explicitly provides.',
  ],
  mediaSamplingDefaults: MEDIA_SAMPLING,
  /**
   * Full media pipeline (matches QuestionEditor + surveyMediaInjection).
   * huggingface_random + empty choices is only the default leaf of this tree.
   */
  mediaAssignment: {
    layers: [
      '1. Stimulus source: imageSelectionMode huggingface_random (random pool) OR huggingface_manual (curated selectedImageUrls)',
      '2. Assignment unit: mediaAssignmentMode individual | set | category (legacy group → set)',
      '3. Optional folder scope: mediaFolders[] limits which tagged folders are eligible',
      '4. Optional mediaSlots[]: multi-modal slots (fixed / random / set_member / category) with setBinding shared',
      '5. Optional trialCount: multi-trial loop redraws with same rules',
      '6. Runtime: pickRandomMediaForQuestion / resolveMediaSlots fills choices, imageLinks, mediaSlotsResolved — do not pre-fill choices for random modes',
    ],
    imageSelectionMode: {
      huggingface_random: 'UI: Random from project media pool. Runtime draws from project preloadedImages.',
      huggingface_manual: 'UI: Curated list. Uses selectedImageUrls; skips random injection when choices already saved for picker/ranking.',
    },
    mediaAssignmentMode: {
      individual: {
        meaning: 'Random individual files from pool (optionally scoped by mediaFolders).',
        fields: { mediaAssignmentMode: 'individual', imageCount: 'N files to draw' },
      },
      set: {
        meaning: 'Draw one whole folder tagged set whose direct file count equals imageCount. Legacy alias: group.',
        requires: 'Media Dataset folders tagged set with exactly imageCount files each',
        fields: {
          mediaAssignmentMode: 'set',
          imageCount: 'must match set folder size',
          mediaFolders: 'optional subset of set-tagged folders',
        },
      },
      category: {
        meaning: 'Draw mediaPerCategory files from each category-tagged folder (or scoped mediaFolders).',
        fields: {
          mediaAssignmentMode: 'category',
          mediaPerCategory: 1,
          mediaFolders: 'optional subset of category-tagged folders',
        },
      },
    },
    mediaSlots: {
      when: 'media* questions needing roles (e.g. fixed video + random audio, or shared set across slots)',
      selectionValues: ['random', 'fixed', 'set_member', 'category'],
      notes: [
        'Empty mediaSlots [] = legacy single-pool path via pickRandomMediaForQuestion.',
        'set_member + setBinding:"shared" draws one set and fills multiple typed slots.',
        'Presets exist in builder (Fixed video + random audio, Mixed set, etc.).',
      ],
    },
    relatedFields: [
      'excludePreviouslyUsedImages', 'pairingMode (random|balanced|adaptive)',
      'mediaType (any|image|video|audio)', 'mediaPresentation (stack|sequential)',
      'assignedMediaSetId / assignedMediaGroupId (runtime fill)', 'trialCount',
    ],
  },
  questionTypeGuide: {
    standard: {
      text: { fields: ['name', 'title', 'placeholder', 'inputType?'] },
      comment: { fields: ['name', 'title', 'rows?'] },
      radiogroup: { fields: ['name', 'title', 'choices[]'] },
      checkbox: { fields: ['name', 'title', 'choices[]'] },
      dropdown: { fields: ['name', 'title', 'choices[]'] },
      boolean: { fields: ['name', 'title', 'labelTrue', 'labelFalse'] },
      consent: { note: 'Stored as boolean with isRequired:true; labels for agree/disagree.' },
      rating: { fields: ['name', 'title', 'rateMin', 'rateMax', 'minRateDescription?', 'maxRateDescription?'] },
      matrix: { fields: ['name', 'title', 'rows[]', 'columns[]'] },
      ranking: { fields: ['name', 'title', 'choices[]'] },
      slidergroup: { fields: ['name', 'title', 'dimensions[{id,left,right}]', 'scaleMin', 'scaleMax'] },
      pointallocation: { fields: ['name', 'title', 'choices[]', 'budget'] },
    },
    image: {
      note: 'Image-only stimuli. Always include mediaSamplingDefaults. Prefer these for street-view / scene studies.',
      sharedFields: ['imageSelectionMode', 'randomImageSelection', 'excludePreviouslyUsedImages', 'imageCount', 'choices'],
      types: {
        image: { role: 'Display only', defaults: { imageCount: 1 } },
        imagepicker: { role: 'Choose among images', defaults: { imageCount: 4, multiSelect: false } },
        imageranking: { role: 'Rank images', defaults: { imageCount: 4 } },
        imagerating: {
          role: 'Rate image(s)',
          defaults: { imageCount: 1, rateMin: 1, rateMax: 5, minRateDescription: 'Poor', maxRateDescription: 'Excellent' },
        },
        imageboolean: { role: 'Yes/No about image', defaults: { imageCount: 1, labelTrue: 'Yes', labelFalse: 'No' } },
        imagecheckbox: {
          role: 'Multi-select text tags about an image (which apply to this scene)',
          defaults: {
            imageCount: 1,
            choices: [
              { value: 'tag_a', text: 'Tag A' },
              { value: 'tag_b', text: 'Tag B' },
              { value: 'tag_c', text: 'Tag C' },
            ],
          },
        },
        imagematrix: { role: 'Matrix under image(s)', defaults: { imageCount: 1, rows: [], columns: [], imageLinks: [] } },
        imageslidergroup: {
          role: 'Sliders with image',
          defaults: {
            imageCount: 1,
            dimensions: [{ id: 'pleasant', left: 'Unpleasant', right: 'Pleasant' }],
            scaleMin: 0,
            scaleMax: 100,
          },
        },
        imagepointallocation: { role: 'Allocate points with image', defaults: { imageCount: 1, choices: [], budget: 100 } },
        imageannotation: {
          role: 'Draw/annotate on image',
          defaults: {
            imageCount: 1,
            allowedTools: ['point', 'line', 'polygon', 'bbox'],
            annotationLabels: [],
            minAnnotations: 0,
          },
          avoid: ['falApiKey', 'enableSamAssist secrets'],
          note: 'Tools: point|line|polygon|bbox (aliases: path→line, points→point, rect/box→bbox).',
        },
      },
    },
    media: {
      note: 'Image/video/audio. Same sampling fields as image*. Add mediaType + empty mediaSlots.',
      sharedFields: ['mediaType', 'mediaSlots', 'mediaPresentation', 'imageCount', '...mediaSamplingDefaults'],
      types: {
        mediadisplay: { role: 'Show media', defaults: { mediaType: 'any', imageCount: 1, displayMode: 'single' } },
        mediapicker: { role: 'Pick among media', defaults: { mediaType: 'any', imageCount: 4, multiSelect: false, mediaSlots: [], mediaPresentation: 'stack' } },
        mediaranking: { role: 'Rank media', defaults: { mediaType: 'any', imageCount: 4, mediaSlots: [], mediaPresentation: 'stack' } },
        mediarating: {
          role: 'Rate media',
          defaults: {
            mediaType: 'image', imageCount: 1, rateMin: 1, rateMax: 5,
            mediaSlots: [], mediaPresentation: 'stack',
          },
        },
        mediaboolean: { role: 'Yes/No about media', defaults: { mediaType: 'any', imageCount: 1, mediaSlots: [], mediaPresentation: 'stack' } },
        mediacheckbox: {
          role: 'Multi-select text tags about media (which apply to this scene)',
          defaults: {
            mediaType: 'any',
            imageCount: 1,
            mediaSlots: [],
            mediaPresentation: 'stack',
            choices: [
              { value: 'tag_a', text: 'Tag A' },
              { value: 'tag_b', text: 'Tag B' },
              { value: 'tag_c', text: 'Tag C' },
            ],
          },
        },
        mediamatrix: { role: 'Matrix + media', defaults: { mediaType: 'image', imageCount: 1, rows: [], columns: [], mediaSlots: [] } },
        mediaslidergroup: {
          role: 'Sliders + media',
          defaults: {
            mediaType: 'image', imageCount: 1, mediaSlots: [], mediaPresentation: 'stack',
            dimensions: [{ id: 'pleasant', left: 'Unpleasant', right: 'Pleasant' }],
            scaleMin: 0, scaleMax: 100,
          },
        },
        mediapointallocation: { role: 'Budget + media', defaults: { mediaType: 'any', imageCount: 1, choices: [], budget: 100, mediaSlots: [] } },
      },
    },
    skillquestion: {
      note:
        'Interactive skills. Prefer preset_* first. Custom HTML only via skill_save (never skillHtml on the draft). '
        + 'skill_save HTML MUST use SPSkill.setAnswer + spskill-init; one task per skill; '
        + 'configSchema as [{key,label,type},...]; resultSchema must contain exactly one native field. Required on question: skillId, skillConfig, imageCount. '
        + 'YOU choose resultSchema[].type: ANNOTATION→points|path|polygon|bbox; '
        + 'MEDIA→rating/number/boolean/scaleGroup/mediaChoice/mediaRankedList/mediaMatrix+imageUrl; '
        + 'STRUCTURED→multiChoice(text tags; +imageUrl⇒imagecheckbox)|matrix|rankedList|allocation|compositeBlocks; '
        + 'Prefer native imagecheckbox/mediacheckbox for stimulus+text multi-select. '
        + 'COLOR→color; COMPARISON→pairwiseChoice|pairwisePreference|bestWorst; '
        + 'VIDEO→timeRanges|timeSeries; TEXT→choice/text. '
        + 'Every field must match an existing native family; json, legacy pairwise, and analysisHtml are forbidden for new revisions. Include imageUrl when media is shown.',
      resultSchemaTypes: [
        'number', 'rating', 'boolean', 'choice', 'text', 'count', 'color', 'scaleGroup',
        'points', 'path', 'polygon', 'bbox', 'allocation', 'rankedList',
        'multiChoice', 'matrix', 'mediaMatrix', 'mediaChoice', 'mediaRankedList',
        'timeRanges', 'timeSeries', 'pairwiseChoice', 'pairwisePreference', 'bestWorst', 'compositeBlocks',
      ],
      analysisGuide:
        'Annotation: points/path/polygon/bbox → imageannotation overlays. '
        + 'Media: rating/number/boolean/scaleGroup/mediaChoice/mediaRankedList/mediaMatrix+imageUrl → native media charts. '
        + 'Structured: multiChoice/matrix/rankedList/allocation; comparison: pairwiseChoice/pairwisePreference/bestWorst. '
        + 'Video: timeRanges/timeSeries → moment timeline / continuous rating. '
        + 'No custom result layer: redesign unmatched shapes to one of these native families.',
      skillPresets: [
        {
          skillId: 'preset_image_preference_slider',
          useWhen: 'Pairwise A/B preference strength (slider)',
          imageCount: 2,
          skillConfig: { leftLabel: 'Prefer A', rightLabel: 'Prefer B', prompt: 'Which scene do you prefer?', mediaCount: 2, mediaType: 'image' },
        },
        {
          skillId: 'preset_image_preference_forced',
          useWhen: 'Forced-choice A/B (click one)',
          imageCount: 2,
          skillConfig: { leftLabel: 'Image A', rightLabel: 'Image B', prompt: 'Which scene do you prefer?', mediaCount: 2, mediaType: 'image' },
        },
        {
          skillId: 'preset_best_worst_choice',
          useWhen: 'Best–worst / MaxDiff among several scenes',
          imageCount: 4,
          skillConfig: { prompt: 'Select BEST and WORST', mediaCount: 4, mediaType: 'image', bestLabel: 'Best', worstLabel: 'Worst' },
        },
        {
          skillId: 'preset_emotion_color_picker',
          useWhen: 'Map feeling to a color for one scene',
          imageCount: 1,
          skillConfig: { prompt: 'Pick a color that matches your feeling', mediaCount: 1, mediaType: 'image' },
        },
        {
          skillId: 'preset_video_moment_tag',
          useWhen: 'Tag key moments on a video timeline',
          imageCount: 1,
          skillConfig: { prompt: 'Mark start/end of key moments', mediaCount: 1, mediaType: 'video' },
        },
        {
          skillId: 'preset_video_continuous_rating',
          useWhen: 'Continuous rating while watching video',
          imageCount: 1,
          skillConfig: { prompt: 'Keep adjusting the slider while watching', mediaCount: 1, mediaType: 'video', lowLabel: 'Very unpleasant', highLabel: 'Very pleasant' },
        },
        {
          skillId: 'preset_composite_blocks',
          useWhen: 'Several mini-questions about one scene',
          imageCount: 1,
          skillConfig: { prompt: 'Look at the scene and answer', mediaCount: 1, mediaType: 'image' },
        },
      ],
    },
  },
  examples: {
    imagerating: {
      type: 'imagerating',
      name: 'scene_rating',
      title: 'How pleasant is this scene?',
      imageCount: 1,
      rateMin: 1,
      rateMax: 7,
      minRateDescription: 'Very unpleasant',
      maxRateDescription: 'Very pleasant',
      ...MEDIA_SAMPLING,
    },
    mediapicker: {
      type: 'mediapicker',
      name: 'media_choice',
      title: 'Which option do you prefer?',
      mediaType: 'any',
      imageCount: 4,
      multiSelect: false,
      mediaSlots: [],
      mediaPresentation: 'stack',
      ...MEDIA_SAMPLING,
    },
    skill_pairwise: {
      type: 'skillquestion',
      name: 'pairwise_pref',
      title: 'Which scene do you prefer?',
      skillId: 'preset_image_preference_slider',
      skillConfig: {
        leftLabel: 'Prefer A',
        rightLabel: 'Prefer B',
        prompt: 'Drag the slider toward the scene you prefer.',
        mediaCount: 2,
        mediaType: 'image',
      },
      imageCount: 2,
      ...MEDIA_SAMPLING,
    },
  },
  operations: [
    'addPage', 'removePage', 'addQuestion', 'updateQuestion', 'removeQuestion',
    'setAllRatingScales', 'replaceConfig',
  ],
  scopes: Object.values(AGENT_SCOPES),
};

export function buildProjectUrls(projectId, clientOrigin) {
  const origin = String(clientOrigin || 'http://localhost:3000').replace(/\/$/, '');
  const encodedId = encodeURIComponent(projectId);
  return {
    admin: `${origin}/admin`,
    draftPreview: `${origin}/admin?preview=${encodedId}`,
    liveSurvey: `${origin}/survey?project=${encodedId}`,
  };
}

export function isSafeProjectId(projectId) {
  return /^[A-Za-z0-9_-]+$/.test(String(projectId || ''));
}
