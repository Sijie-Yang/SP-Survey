export const QUESTION_PREVIEW_PATH = '/question-preview';
export const PREVIEW_UPDATE = 'sp-question-preview:update';
export const PREVIEW_READY = 'sp-question-preview:ready';
export const PREVIEW_RENDERED = 'sp-question-preview:rendered';
export const PREVIEW_FAILED = 'sp-question-preview:failed';
export const PREVIEW_DEVICES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

export function isPreviewMessage(event, source, type) {
  return !!source && event.origin === window.location.origin && event.source === source && event.data?.type === type;
}

/** Only presentation settings cross into the frame, never project/account metadata. */
export function previewAppearance(config = {}, fallbackTheme) {
  const fields = ['widthMode', 'width', 'showQuestionNumbers', 'questionStartIndex',
    'questionTitleLocation', 'questionDescriptionLocation', 'questionErrorLocation', 'requiredText'];
  return {
    locale: config.locale,
    theme: config.theme || fallbackTheme,
    displaySettings: Object.fromEntries(fields.filter((key) => config[key] !== undefined).map((key) => [key, config[key]])),
  };
}
