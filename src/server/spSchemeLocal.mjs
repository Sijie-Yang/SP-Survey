/**
 * The Assistant's SP-Scheme mode on the self-hosted server: write or change
 * the study page with the researcher's own model, check it with the same
 * deterministic check Studio runs on a dropped file, and save it into the
 * local project draft only when it passes (as the platform does).
 */

import { strToU8 } from 'fflate';
import { readSpSchemeUpload } from '../lib/spScheme.js';
import { finalizeSpSchemeImport, prepareSpSchemeUpload, summarizeSpSchemeImport } from '../lib/spSchemeImport.js';
import { writeSpSchemePage } from './platformShared/spSchemeGenerate.mjs';
import { chatCompletions } from './platformShared/runtime/providers.mjs';

export const SP_SCHEME_WRITE_TOOL = 'sp_scheme_write_page';

export const SP_SCHEME_WRITE_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: SP_SCHEME_WRITE_TOOL,
    description: 'Write or change the study\'s SP-Scheme page (the whole participant page). Pass request: what the page should be (for a new study) or exactly what to change, with every detail the researcher gave (topic, tasks, number of trials, questions, wording, language). SP-Survey writes the page, checks it and saves it only when it passes. Returns saved, a short note on what changed, and any problems.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['request'],
      properties: {
        request: { type: 'string', description: 'What to build or change, in full.' },
      },
    },
  },
};

export const SP_SCHEME_SYSTEM = `You are the SP-Survey Assistant in SP-Scheme mode, running locally with the researcher's own API key.
The study is one web page built with SP-Scheme: the page holds the welcome, consent, every task and question, and the end. You never write the page yourself; the sp_scheme_write_page tool does it from your request, checks it and saves it only when it passes.

- To make a new study or change anything participants see, call sp_scheme_write_page once. Put everything the researcher asked for into request: topic, tasks, number of trials, questions and options, wording, language, look. For a change, say exactly what to change and that the rest stays the same.
- If the researcher only asks something, answer briefly; read the draft with survey_get_draft when you need it. Do not call the write tool for questions.
- Never invent image URLs or upload images. The page reads images from the study's image library; the researcher uploads them.
- After the tool returns, say in one or two plain sentences what changed. If it was not saved, list the problems it returned and suggest what to ask for instead.
- Never ask for, print, or store credentials. Reply in the researcher's language.`;

/** A note for the model when the researcher switched mode since their last message; '' otherwise. */
export function modeSwitchNote(previousMode, assistantMode) {
  if (!previousMode || previousMode === assistantMode) return '';
  if (assistantMode === 'spscheme') {
    return '\n\nMode switch: the researcher has just switched this conversation to SP-Scheme mode. Earlier messages in this conversation were in another mode. From now on build and change the study as one SP-Scheme page with sp_scheme_write_page; do not edit question pages one by one.';
  }
  if (assistantMode === 'agent') {
    return '\n\nMode switch: the researcher has just switched this conversation to Classic mode. Earlier messages may be about the SP-Scheme page. From now on build and change the survey in the classic editor, question by question, with the survey tools; do not write or change the SP-Scheme page.';
  }
  return '';
}

/**
 * The draft with `html` as its page, or the check's problems.
 * A new page that names no folders keeps the folders the old page was linked to.
 */
export function draftWithPage(baseConfig, html) {
  const prepared = prepareSpSchemeUpload(readSpSchemeUpload(strToU8(html)), { name: 'index.html' });
  const summary = summarizeSpSchemeImport(prepared);
  if (!prepared.report.ok) return { ok: false, summary };
  const nextConfig = finalizeSpSchemeImport(prepared.report, prepared.upload, baseConfig || {});
  if (nextConfig.spSite && !nextConfig.spSite.mediaFolders?.length && baseConfig?.spSite?.mediaFolders?.length) {
    nextConfig.spSite.mediaFolders = [...baseConfig.spSite.mediaFolders];
  }
  return { ok: true, summary, nextConfig };
}

/**
 * Run the tool for one project.
 * @param {object} input
 * @param {string} input.request what to build or change
 * @param {object} input.route { apiKey, provider, baseUrl, model, protocol }
 * @param {Function} input.readProject (projectId) => stored project file
 * @param {Function} input.saveDraft (projectId, stored, nextConfig) => saved project file
 * @param {Function} [input.chat] chatCompletions (tests pass a fake)
 */
export async function runSpSchemeWriteTool({ projectId, request, route, readProject, saveDraft, chat = chatCompletions }) {
  const text = String(request || '').trim();
  if (!text) return { ok: false, saved: false, error: 'request is required: say what the page should be or what to change.' };
  const stored = await readProject(projectId);
  const baseConfig = stored.surveyConfig || {};
  const currentHtml = baseConfig?.spSite?.html || '';
  const written = await writeSpSchemePage({ chat, route, request: text, currentHtml });
  if (!written.passed) {
    return {
      ok: false,
      saved: false,
      error: 'The page did not pass the SP-Scheme check, so nothing was saved.',
      code: 'SP_SCHEME_PAGE_PROBLEMS',
      problems: written.check.problems.slice(0, 10),
      note: written.reply,
    };
  }
  const next = draftWithPage(baseConfig, written.html);
  if (!next.ok) {
    return { ok: false, saved: false, error: 'The page could not be saved.', code: 'SP_SCHEME_PAGE_PROBLEMS', problems: next.summary.problems || [] };
  }
  const saved = await saveDraft(projectId, stored, next.nextConfig);
  return {
    ok: true,
    summary: written.reply || (currentHtml ? 'Changed the page and saved it' : 'Wrote the page and saved it'),
    saved: true,
    note: written.reply,
    changed: currentHtml ? 'page_changed' : 'page_created',
    questionCount: written.check.questionCount,
    matchLevel: written.check.matchLevel,
    draftUpdatedAt: saved.draftUpdatedAt,
    surveyConfig: saved.surveyConfig,
    spSchemePageChanged: true,
  };
}
