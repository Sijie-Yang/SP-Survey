import { surveyResponseContract } from './surveyRevision.js';
export const EXPORT_FIELD_DESCRIPTIONS = {
  participant_id: 'Participant identifier. One participant can contribute multiple submissions and trials.',
  created_at: 'Submission timestamp; see raw response for the original timestamp.',
  session_id: 'Research session identifier, when available.',
  attempt_index: 'Submission attempt/round recorded by the survey.',
  practice_mode: 'Whether the submission was collected in researcher practice mode.',
  quality_flags: 'Recorded quality checks; flags do not by themselves delete or invalidate an answer.',
  question_name: 'Stable internal question identifier.', question_type: 'Recorded question/analysis family.',
  trial_index: 'Index of the response trial within this question.',
  shown_images: 'Media shown with this answer; may include image, video or audio.',
  shown_media_ids: 'Media identities for joining answers to stimuli.',
  shown_media_json: 'Structured metadata about the presented media.',
  shown_media_set: 'Assigned stimulus set.', shown_media_categories: 'Assigned stimulus categories.',
  media_metadata_scope: 'Whether media metadata belongs to the trial or a broader question context.',
  survey_revision: 'Recorded question-contract revision; missing historical revisions are unknown.',
  n_responses: 'Response units contributing to a summary, not necessarily independent participants.',
  value: 'Answer or metric value; interpret using question settings, metric and attribute columns.',
  outcome: 'Binary choice outcome: A/B refer to first/second entries in shown_images; tie is an explicit no-preference answer. Blank means not a recognized binary outcome. Ties are excluded from decisive-only TrueSkill.',
  metric: 'Name of the computed descriptive metric.', n: 'Number of contributing observations for this metric.',
};

export function buildExportDictionary(questions, getHeaders) {
  const contract = surveyResponseContract({ pages: [{ elements: questions }] });
  return {
    version: 1,
    missing_values: 'Empty CSV cells may mean missing or not applicable. Consult responses_raw.json to distinguish original values.',
    analysis_units: 'Keep participant, submission, trial and stimulus separate. Repeated trials are not independent participants.',
    spreadsheet_text: 'Formula-like text is prefixed with an apostrophe in CSV. Original text is preserved in responses_raw.json.',
    common_fields: EXPORT_FIELD_DESCRIPTIONS,
    questions: contract.questions.map((q) => ({ ...q, long_table_columns: getHeaders(q) })),
  };
}
