/**
 * Adapt library pre-annotation docs into the same shapes Results uses for
 * imageannotation (AnnotationAnalysis + questionSummaryExport).
 */

export const PREANNOTATE_QUESTION_NAME = 'preannotate';

export function buildPreannotateQuestion() {
  return {
    type: 'imageannotation',
    name: PREANNOTATE_QUESTION_NAME,
    title: 'Library pre-annotate',
  };
}

/**
 * @param {Array<{ mediaEntry: object, annotation: object|null }>} items
 * @returns {{
 *   question: object,
 *   answers: Array<{ answer: object, shown_images: string[] }>,
 *   responses: object[],
 *   imageNameToUrl: Map<string, string>,
 *   annotatedCount: number,
 * }}
 */
export function preannotationsToAnalysisInputs(items) {
  const question = buildPreannotateQuestion();
  const answers = [];
  const responses = [];
  const imageNameToUrl = new Map();
  let annotatedCount = 0;

  (items || []).forEach(({ mediaEntry, annotation }) => {
    const name = mediaEntry?.name || annotation?.name || '';
    const url = annotation?.image || mediaEntry?.url || '';
    if (name && url) imageNameToUrl.set(name, url);
    if (url) {
      const file = url.split('?')[0].split('/').pop();
      if (file) imageNameToUrl.set(file, url);
    }
    if (!annotation?.shapes?.length) return;
    annotatedCount += 1;
    const answer = {
      shapes: annotation.shapes,
      image: url || name,
    };
    const shown = url ? [url] : (name ? [name] : []);
    answers.push({ answer, shown_images: shown });
    responses.push({
      participant_id: annotation.media_id || name || 'library',
      created_at: annotation.updated_at || '',
      survey_metadata: {
        session_id: 'library_preannotate',
        practice_mode: false,
      },
      responses: {
        [PREANNOTATE_QUESTION_NAME]: {
          answer,
          shown_images: shown,
          shown_media_ids: annotation.media_id ? [annotation.media_id] : [],
        },
      },
    });
  });

  return {
    question,
    answers,
    responses,
    imageNameToUrl,
    annotatedCount,
  };
}
