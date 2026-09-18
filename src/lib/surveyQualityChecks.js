/**
 * On-demand, read-only research checks extracted from the old multi-expert flow.
 * These never auto-rewrite the survey.
 */

function questions(config) {
  return (config?.pages || []).flatMap((page) => (
    (page.elements || []).map((question) => ({ pageName: page.name, question }))
  ));
}

export function runResearchDesignCheck(config) {
  const findings = [];
  questions(config).forEach(({ pageName, question }) => {
    if (!question.title) {
      findings.push({
        issue: 'Missing question stem',
        pageName,
        questionName: question.name,
        suggestion: 'Add a complete title/stem before publishing.',
      });
    }
    if (['rating', 'imagerating', 'mediarating'].includes(question.type)
      && (question.rateMin == null || question.rateMax == null)) {
      findings.push({
        issue: 'Rating scale anchors are incomplete',
        pageName,
        questionName: question.name,
        suggestion: 'Set rateMin and rateMax so respondents and exports share the same scale.',
      });
    }
  });
  return { id: 'research-design', findings };
}

export function runParticipantFlowCheck(config) {
  const findings = [];
  questions(config).forEach(({ pageName, question }) => {
    if (/image|media/.test(question.type || '') && !question.imageCount && !question.selectedImageUrls?.length) {
      findings.push({
        issue: 'Media question has no count or fixed images',
        pageName,
        questionName: question.name,
        suggestion: 'Set imageCount or selectedImageUrls so PC/mobile trials can resolve stimuli.',
      });
    }
  });
  return { id: 'participant-flow', findings };
}

export function runAnalysisExportCheck(config) {
  const findings = [];
  questions(config).forEach(({ pageName, question }) => {
    if (question.type === 'skillquestion' && !question.skillId) {
      findings.push({
        issue: 'Skill question is missing skillId',
        pageName,
        questionName: question.name,
        suggestion: 'Bind a typed skillId so results/export stay on a native family.',
      });
    }
  });
  return { id: 'analysis-export', findings };
}

export function runSurveyQualityChecks(config) {
  return [
    runResearchDesignCheck(config),
    runParticipantFlowCheck(config),
    runAnalysisExportCheck(config),
  ];
}
