/**
 * Studio's one-click data download. Same rows and files as the Results page
 * with its default filters: silicon runs are never included and researcher
 * practice runs only when the survey says so (includeResearcherPractice).
 *
 *   page imported as it is  → the Results page's site ZIP (README, wide CSV, raw JSON, citation)
 *   any other survey        → the wide CSV and the raw JSON
 */

import { supabase } from './supabase';
import { API_ROOT } from './apiConfig';
import { readAllResponsePages } from './responsePagination';
import { createResponseLoadSession, fetchOwnerResponsePage } from './adminResults';
import { recordedSurveyConfig } from './recordedSurvey';
import { buildResponsesWideCsv } from './responsesWideExport';
import { buildSiteResultsExportFiles } from './questionSummaryExport';
import { exportDateStamp } from './csvUtil';
import { downloadZip } from './zipDownload';

/** Every stored response of the project. */
export async function loadStudioResponses(projectId, { signal } = {}) {
  if (!projectId) return [];
  if (supabase) {
    const session = createResponseLoadSession();
    const rows = await readAllResponsePages((offset, after) => fetchOwnerResponsePage(projectId, after, session, { signal }), {
      cancelled: () => Boolean(signal?.aborted),
    });
    return rows.filter((row) => !row?._unreadable);
  }
  const res = await fetch(`${API_ROOT}/responses`, { signal });
  if (!res.ok) throw new Error(`Local server: ${res.status}`);
  const json = await res.json();
  return (json.responses || []).filter((row) => row?.project_id === projectId);
}

function isSilicon(row) {
  return row?.source === 'silicon' || Boolean(row?.survey_metadata?.silicon_run_id);
}

/** The Results page's default rows: no silicon runs; practice runs only when the survey includes them. */
export function studioExportRows(responses = [], config = {}) {
  const includePractice = config?.includeResearcherPractice === true;
  return (Array.isArray(responses) ? responses : [])
    .filter((row) => !isSilicon(row))
    .filter((row) => includePractice || !row?.survey_metadata?.practice_mode);
}

/**
 * Files of the download, relative to its folder.
 * @returns {{ path: string, content: string }[]}
 */
export function studioExportFiles({ project, config, responses }) {
  const rows = studioExportRows(responses, config);
  const recorded = recordedSurveyConfig(rows, config || {});
  const questions = (recorded?.pages || []).flatMap((page) => page.elements || []);
  const wideCsv = buildResponsesWideCsv(rows, questions, recorded);
  if (recorded?.spSite?.convertedFrom) return buildSiteResultsExportFiles({ project, filteredResponses: rows, wideCsv });
  return [
    { path: 'responses_wide.csv', content: wideCsv },
    { path: 'responses_raw.json', content: `${JSON.stringify(rows, null, 2)}\n` },
  ];
}

/** Load, build and download the ZIP. Returns the number of responses in it. */
export async function downloadStudioResults({ project, config }) {
  const responses = await loadStudioResponses(project?.id);
  const files = studioExportFiles({ project, config, responses });
  const folder = `results_${project?.id || 'survey'}_${exportDateStamp()}`;
  downloadZip(`${folder}.zip`, files.map((file) => ({ path: `${folder}/${file.path}`, content: file.content })));
  return studioExportRows(responses, config).length;
}
