export function recordedRevisionSelection(responses, requested = '') {
  const ids = [...new Set((responses || []).map((r) => r.survey_metadata?.survey_revision || 'historical_unknown'))];
  if (requested && ids.includes(requested)) return requested;
  // Avoid interpreting several incompatible designs using today's settings.
  return ids.length > 1 ? ids.find((id) => id !== 'historical_unknown') || ids[0] : '';
}

export function recordedSurveyConfig(responses = [], currentConfig, revision = '') {
  const selected = revision || recordedRevisionSelection(responses) || responses[0]?.survey_metadata?.survey_revision || 'historical_unknown';
  const contract = responses.find((r) => (r.survey_metadata?.survey_revision || 'historical_unknown') === selected && r.survey_metadata?.survey_response_contract?.questions)?.survey_metadata.survey_response_contract;
  if (!contract) return currentConfig;
  return { ...currentConfig, title: contract.title || currentConfig?.title, locale: contract.locale,
    pages: [{ name: 'recorded_revision', elements: contract.questions }] };
}
