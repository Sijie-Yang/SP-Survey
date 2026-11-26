/**
 * Deterministic check before Studio publishes a project. Problems come back
 * as codes; the page words them.
 *
 *   empty            the project has no page and no questions
 *   folder-empty     the page reads an image folder that holds no files ({ folder })
 *   folder-unlinked  the page reads a folder that has files but is not linked to it ({ folder })
 *   slots-empty      the page's own image list would stay empty
 *   config           the survey config is invalid ({ message })
 *   media            a question cannot draw enough images ({ question })
 */

import { runSurveyPreflight } from './surveyPreflight';
import { configHasQuestions, missingPageFolders, projectConfig } from './studioProject';

const FOLDER_CODES = { empty: 'folder-empty', unlinked: 'folder-unlinked', slots: 'slots-empty' };

export async function studioPublishProblems(project, config = projectConfig(project)) {
  const problems = [];
  const hasPage = Boolean(config?.spSite?.html);
  const hasQuestions = configHasQuestions(config);
  if (!hasPage && !hasQuestions) return [{ code: 'empty' }];
  missingPageFolders(project, config).forEach(({ folder, reason }) => problems.push({ code: FOLDER_CODES[reason], folder }));
  // Questions whose images the platform draws (classic surveys, and pages that
  // declare such questions) are checked the way participants get them. After a
  // release the preview images are never used, so an empty library fails here.
  if (hasQuestions) {
    const report = await runSurveyPreflight(config, {
      preloadedImages: project?.preloadedImages || [],
      imageDatasetConfig: project?.imageDatasetConfig || {},
    }, { participants: 1 });
    report.validation.errors.forEach((error) => problems.push({ code: 'config', message: `${error.path ? `${error.path}: ` : ''}${error.message}` }));
    report.questions.filter((q) => q.missing).forEach((q) => problems.push({ code: 'media', question: typeof q.title === 'string' && q.title ? q.title : q.name }));
  }
  return problems;
}
