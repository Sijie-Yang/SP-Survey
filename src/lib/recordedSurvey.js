function hasRecordedStudyArea(question) {
  const raw = question?.studyAreas;
  const areas = Array.isArray(raw) ? raw : [];
  return areas.some((area) => area?.id && area?.boundary?.coordinates?.[0]?.length);
}

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
  const current = new Map();
  const walk = (els) => (els || []).forEach((e) => { if (e?.name) current.set(e.name, e); walk(e?.elements); });
  (currentConfig?.pages || []).forEach((p) => walk(p.elements));
  // Contracts recorded before conditionVariants was a contract key: borrow the wording from the same question today.
  const questions = contract.questions.map((q) => {
    const now = current.get(q?.name);
    if (!now || now.type !== q?.type) return q;
    const patch = {};
    if (!q?.conditionVariants && Array.isArray(now.conditionVariants)) patch.conditionVariants = now.conditionVariants;
    // Study areas were omitted from contracts recorded before that key existed.
    // Keep a recorded boundary when one is present; otherwise use the area still configured on the question.
    if (q.type === 'mapannotation' && !hasRecordedStudyArea(q) && hasRecordedStudyArea(now)) {
      ['studyAreas', 'studyAreaId', 'cityQuestion', 'mapTools', 'mapLabel', 'mapPolarity', 'mapPair'].forEach((key) => {
        if (q[key] == null && now[key] != null) patch[key] = now[key];
      });
    }
    return Object.keys(patch).length ? { ...q, ...patch } : q;
  });
  return { ...currentConfig, title: contract.title || currentConfig?.title, locale: contract.locale,
    pages: [{ name: 'recorded_revision', elements: questions }] };
}
