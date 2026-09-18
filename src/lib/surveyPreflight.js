import { validateSurveyConfig } from './designProtocol/validate';
import { getTrialCount } from './trialNavigation';
import { normalizeMediaEntry, getMediaId } from './mediaUtils';
import { defaultMediaCount, expectedCategoryImageCount, filterPoolForQuestion, pickMediaForQuestion, trackMediaAssignment, resolveCuratedImages, isRandomMediaQuestion, isCuratedMediaMode, shouldInjectMedia, hasMediaSlots, resolveMediaFolderTags, applyMediaToElement } from './surveyMediaInjection';
import { buildQuestionLongTable, buildQuestionSummaryRows } from './questionSummaryExport';
import { displayOnly, questionExample } from './questionExample';

/** Uses runtime assignment and export functions; does not execute HTML or write any responses. */
export async function runSurveyPreflight(config, project, { participants = 5, onProgress = () => {}, cancelled = () => false } = {}) {
  const validation = validateSurveyConfig(config);
  const questions = (config?.pages || []).flatMap((p) => p.elements || []);
  const pool = (project?.preloadedImages || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url);
  const tags = resolveMediaFolderTags(project, config);
  const rounds = questions.reduce((n, q) => n + getTrialCount(q), 0);
  const n = Math.min(50, Math.max(1, Math.floor(Number(participants) || 5)));
  if (rounds * n > 10000) throw new Error('Too many trial assignments for a browser check (limit: 10,000). Reduce simulated participants.');
  const details = questions.map((q) => ({ name: q.name, title: q.title || q.name, rounds: getTrialCount(q), missing: 0, reused: 0, exposures: {}, warnings: [], example: undefined, headers: [], exportRows: 0, summaryRows: 0, displayOnly: displayOnly(q) }));
  const responses = [];
  for (let person = 0; person < n; person += 1) {
    if (cancelled()) throw new Error('Check cancelled');
    const used = new Set(); const usedSets = new Set();
    const row = { id: `simulation_${person + 1}`, participant_id: `simulation_${person + 1}`, responses: {}, survey_metadata: { simulation: true } };
    for (let qi = 0; qi < questions.length; qi += 1) {
      const q = questions[qi]; const detail = details[qi];
      const filtered = filterPoolForQuestion(pool, q);
      const trials = [];
      for (let trial = 0; trial < detail.rounds; trial += 1) {
        const prior = new Set(used);
        let assignment = { images: [] };
        const random = shouldInjectMedia(q) || hasMediaSlots(q);
        if (random) assignment = pickMediaForQuestion(filtered, q, used, usedSets, null, tags);
        else if (isCuratedMediaMode(q)) assignment.images = resolveCuratedImages(q, pool);
        else {
          const urls = q.imageLinks || q.mediaUrls || (q.imageLink || q.mediaUrl ? [q.imageLink || q.mediaUrl] : []);
          assignment.images = q.mediaItems?.length ? q.mediaItems : urls.length ? urls.map((url) => ({ url })) : (q.choices || []).filter((c) => c?.imageLink).map((c) => ({ url: c.imageLink, name: c.imageName || c.value }));
        }
        const media = assignment.flatMedia || assignment.images || [];
        if (q.allowTie && (q.multiSelect || media.length !== 2)) {
          detail.warnings.push('No-preference option is enabled but requires exactly two displayed alternatives and single selection. It will not appear for this assignment.');
        }
        const expected = hasMediaSlots(q) ? q.mediaSlots.reduce((sum, s) => sum + Math.max(1, Number(s.count) || 1), 0)
          : expectedCategoryImageCount(filtered, q, tags) ?? (q.imageCount || defaultMediaCount(q));
        if ((random || isCuratedMediaMode(q) || isRandomMediaQuestion(q)) && media.length < expected) detail.missing += 1;
        media.forEach((m) => {
          const id = getMediaId(m);
          detail.exposures[id] = (detail.exposures[id] || 0) + 1;
          if (q.excludePreviouslyUsedImages !== false && prior.has(id)) detail.reused += 1;
        });
        if (!hasMediaSlots(q)) trackMediaAssignment(assignment, q, used, usedSets);
        detail.warnings.push(...(assignment.warnings || []));
        const assigned = JSON.parse(JSON.stringify(q));
        applyMediaToElement(assigned, media);
        const answer = questionExample(assigned, media);
        if (detail.example === undefined && answer !== undefined) detail.example = answer;
        if (answer !== undefined) trials.push({ answer, shown_images: media.map((m) => m.url), shown_media: media, shown_media_set: assignment.setId || null, shown_media_categories: assignment.categories || null });
      }
      if (!detail.displayOnly && trials.length) row.responses[q.name] = detail.rounds > 1 ? { trials } : trials[0];
    }
    responses.push(row);
    onProgress(person + 1, n);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  details.forEach((d, i) => {
    const q = questions[i];
    if (q.visibleIf || q.enableIf || q.requiredIf) d.warnings.push('Conditional logic needs a participant preview; this check visits every configured question.');
    if (q.pairingMode && q.pairingMode !== 'random') d.warnings.push('This check has no live exposure/rating history. Balanced/adaptive allocation must also be checked during a pilot.');
    if (q.type === 'skillquestion') d.warnings.push('This checks the answer contract only. Verify the actual custom interaction in participant preview.');
    if (!d.displayOnly && d.example === undefined) d.warnings.push('No validated example answer is available. Test this task manually in participant preview.');
    if (!d.displayOnly && d.example !== undefined) {
      try {
        const table = buildQuestionLongTable(q, responses, config);
        const summary = buildQuestionSummaryRows(q, responses);
        d.headers = table?.headers || [];
        d.exportRows = table?.rows?.length || 0;
        d.summaryRows = summary?.length || 0;
        if (!d.exportRows) d.warnings.push('The example produced no long-table rows. Check the answer structure before collecting data.');
      } catch (err) { d.warnings.push(`Export check failed: ${err.message}`); }
    }
    d.warnings = [...new Set(d.warnings)];
  });
  return { simulation: true, checkedAt: new Date().toISOString(), participants: n, assignments: rounds * n, validation, questions: details, responses };
}
