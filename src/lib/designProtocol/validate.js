/**
 * Structural survey validation for agent / MCP / builder.
 * Pure module — no I/O.
 */

const IMAGE_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'imagematrix', 'image',
  'imageannotation', 'skillquestion', 'imageslidergroup', 'imagepointallocation',
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
]);

export function validateSurveyConfig(surveyConfig) {
  const errors = [];
  const warnings = [];
  let questionCount = 0;

  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      errors: [{ path: 'surveyConfig', message: 'surveyConfig must be an object.' }],
      warnings,
      pageCount: 0,
      questionCount,
    };
  }

  if (!Array.isArray(surveyConfig.pages)) {
    errors.push({ path: 'surveyConfig.pages', message: 'pages must be an array.' });
  } else {
    if (surveyConfig.pages.length === 0) {
      warnings.push({ path: 'surveyConfig.pages', message: 'The survey has no pages.' });
    }
    const names = new Map();
    surveyConfig.pages.forEach((page, pageIndex) => {
      const pagePath = `surveyConfig.pages[${pageIndex}]`;
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        errors.push({ path: pagePath, message: 'Each page must be an object.' });
        return;
      }
      if (!page.name) warnings.push({ path: `${pagePath}.name`, message: 'Page name is recommended.' });
      if (!Array.isArray(page.elements)) {
        errors.push({ path: `${pagePath}.elements`, message: 'elements must be an array.' });
        return;
      }
      if (page.elements.length === 0) {
        warnings.push({ path: `${pagePath}.elements`, message: 'Page has no questions.' });
      }
      page.elements.forEach((element, elementIndex) => {
        questionCount += 1;
        const elementPath = `${pagePath}.elements[${elementIndex}]`;
        if (!element || typeof element !== 'object' || Array.isArray(element)) {
          errors.push({ path: elementPath, message: 'Each element must be an object.' });
          return;
        }
        if (!element.type) errors.push({ path: `${elementPath}.type`, message: 'Question type is required.' });
        if (!element.name) {
          errors.push({ path: `${elementPath}.name`, message: 'Question name is required.' });
        } else if (names.has(element.name)) {
          errors.push({
            path: `${elementPath}.name`,
            message: `Duplicate question name; first used at ${names.get(element.name)}.`,
          });
        } else {
          names.set(element.name, `${elementPath}.name`);
        }

        if (IMAGE_TYPES.has(element.type) && element.type !== 'skillquestion') {
          const hasManual = element.selectedImageUrls?.length
            || element.choices?.length
            || element.imageLinks?.length
            || element.annotationImageUrl;
          const hasRandom = element.randomImageSelection !== false
            || element.imageSelectionMode === 'huggingface_random';
          if (!hasManual && !hasRandom) {
            warnings.push({
              path: elementPath,
              message: `Question "${element.title || element.name}" may have no images configured.`,
            });
          }
        }
        if (
          (element.type === 'slidergroup' || element.type === 'imageslidergroup' || element.type === 'mediaslidergroup')
          && !element.dimensions?.length
        ) {
          warnings.push({
            path: elementPath,
            message: `Slider group "${element.title || element.name}" has no dimensions configured.`,
          });
        }
        if (
          (element.type === 'pointallocation'
            || element.type === 'imagepointallocation'
            || element.type === 'mediapointallocation')
          && !element.choices?.length
        ) {
          warnings.push({
            path: elementPath,
            message: `Point allocation "${element.title || element.name}" has no choices configured.`,
          });
        }
      });
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    pageCount: Array.isArray(surveyConfig.pages) ? surveyConfig.pages.length : 0,
    questionCount,
  };
}

/** Human-readable warning strings for the builder banner. */
export function getSurveyValidationWarningStrings(surveyConfig) {
  const report = validateSurveyConfig(surveyConfig);
  return [
    ...report.errors.map((e) => e.message),
    ...report.warnings.map((w) => w.message),
  ];
}
