import React, { useMemo, useRef, useState } from 'react';
import SpSiteFrame from './SpSiteFrame';
import { buildSiteQuestions, siteMatchLevel, siteMediaFolders, sitePreviewMediaFolders } from '../lib/spSite';
import { collectSurveyDataWithTrials, isTrialsAnswer, persistTrialsAnswer } from '../lib/trialNavigation';

/** Response key holding every request the page sent with data, exactly as sent. */
export const SP_SITE_REQUESTS_KEY = '__sp_requests';
export const SP_SITE_REQUESTS_MAX = 3000;
/** Response key holding what the page saved in its own storage (latest value per key). */
export const SP_SITE_STATE_KEY = '__sp_page_state';
const SP_SITE_STATE_MAX_CHARS = 200000;

/** Fold one saved value into the page-state record: JSON is parsed, null removes the key. */
export function applyPageState(prev, area, key, value) {
  const next = { ...(prev && typeof prev === 'object' ? prev : {}) };
  const id = area === 'localStorage' ? key : `${area}:${key}`;
  if (value == null) {
    delete next[id];
    return next;
  }
  let parsed = value;
  try { parsed = JSON.parse(value); } catch { /* plain text */ }
  next[id] = value.length > SP_SITE_STATE_MAX_CHARS ? { truncated: true, text: value.slice(0, SP_SITE_STATE_MAX_CHARS) } : parsed;
  return next;
}
const PAGE_FINISH_FLAGS = ['done', 'finished', 'completed', 'complete', 'isComplete', 'isDone', 'submitted'];

/** A saved value saying the page reached its own end, e.g. {"done": true, ...}. */
export function pageSaysFinished(value) {
  if (value == null) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && PAGE_FINISH_FLAGS.some((k) => parsed[k] === true));
}
const SP_SITE_REQUEST_MAX_CHARS = 20000;
/** A request to one of these paths means the page is done (when nothing else says so). */
export const SP_SITE_DEFAULT_COMPLETE_ON = '(finish|complete|submit|done|final)';

/** The request the page sent, trimmed so the response stays a sane size. */
export function captureRecord(request, at = new Date().toISOString()) {
  let data = request?.data;
  try {
    const text = JSON.stringify(data === undefined ? null : data);
    if (text.length > SP_SITE_REQUEST_MAX_CHARS) data = { truncated: true, text: text.slice(0, SP_SITE_REQUEST_MAX_CHARS) };
  } catch {
    data = String(data);
  }
  const record = { at, kind: String(request?.kind || ''), method: String(request?.method || ''), url: String(request?.url || '').slice(0, 2000), data };
  // The adapter also answered it: this is the backup copy of what the page sent.
  if (request?.answered) record.answered = true;
  return record;
}

export function completesOn(url, pattern) {
  const source = pattern == null || pattern === '' ? SP_SITE_DEFAULT_COMPLETE_ON : String(pattern);
  if (source === 'never') return false;
  try {
    return new RegExp(source, 'i').test(String(url || '').split('?')[0]);
  } catch {
    return false;
  }
}

/**
 * Participant view of an SP-Scheme site. The SurveyJS model stays headless:
 * answers from the site land on it, and SPSite.complete() completes it, so the
 * normal submission path (drafts, enrichment, response contract) is unchanged.
 * Requests the page sends that no adapter maps are kept raw on the response.
 */
export default function SpSiteSurvey({ model, surveyJson, language, mediaPool = [], previewLibrary = false, status = 'active', completionCode = '' }) {
  const questions = useMemo(() => buildSiteQuestions(surveyJson, { language }), [surveyJson, language]);
  const media = useMemo(() => (previewLibrary ? sitePreviewMediaFolders(mediaPool, surveyJson) : siteMediaFolders(mediaPool, surveyJson)), [mediaPool, previewLibrary, surveyJson]);
  const match = useMemo(() => siteMatchLevel(surveyJson), [surveyJson]);
  const initialAnswers = useMemo(() => {
    const names = new Set(questions.map((q) => q.name));
    return Object.fromEntries(Object.entries(collectSurveyDataWithTrials(model) || {}).filter(([name]) => names.has(name)));
    // Read once per model; later answers flow from the site.
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  const [captured, setCaptured] = useState(() => (Array.isArray(model.getValue(SP_SITE_REQUESTS_KEY)) ? model.getValue(SP_SITE_REQUESTS_KEY).length : 0));
  const done = useRef(false);

  // SurveyJS drops values that are not among a question's rendered choices when it
  // completes; nothing is rendered here and SpSiteFrame has already validated them.
  model.clearInvisibleValues = 'none';

  const complete = () => {
    if (done.current) return;
    done.current = true;
    model.doComplete();
  };

  const onAnswer = (name, stored, { trial } = {}) => {
    const question = model.getQuestionByName(name);
    if (stored == null) {
      model.clearValue(name);
      return;
    }
    if (question && isTrialsAnswer(stored) && trial != null) {
      // Same convention as TrialShell: the full rounds live in the trials store,
      // the question holds the active round's flat value (folded back on submit).
      const index = Number(trial) || 0;
      persistTrialsAnswer(question, stored, index);
      model.setValue(name, stored.trials[index]?.value ?? null);
      return;
    }
    model.setValue(name, stored);
  };

  const onCapture = (request) => {
    const list = Array.isArray(model.getValue(SP_SITE_REQUESTS_KEY)) ? model.getValue(SP_SITE_REQUESTS_KEY) : [];
    if (list.length < SP_SITE_REQUESTS_MAX) {
      model.setValue(SP_SITE_REQUESTS_KEY, [...list, captureRecord(request)]);
      setCaptured(list.length + 1);
    }
    // With no mapped questions, the page's own "finish" request ends the survey.
    if (match.level === 'none' && completesOn(request?.url, surveyJson.spSite?.completeOn)) complete();
  };

  // A converted page may never tell the platform it is finished, so it always gets the bar.
  const showBar = match.level === 'none' || Boolean(surveyJson.spSite?.convertedFrom);

  const onState = (area, key, value) => {
    if (!key) return;
    model.setValue(SP_SITE_STATE_KEY, applyPageState(model.getValue(SP_SITE_STATE_KEY), area, key, value));
    // The page's own finish (it saves {"done": true}) submits; the page stays on screen.
    if (showBar && area !== 'sp-media' && pageSaysFinished(value)) complete();
  };

  const zh = /^zh/i.test(language || surveyJson.locale || '');
  const barText = status === 'completed'
    ? (zh ? `✓ 已提交，谢谢参与！${completionCode ? `完成码：${completionCode}` : ''}` : `✓ Submitted, thank you!${completionCode ? ` Completion code: ${completionCode}` : ''}`)
    : status === 'submitting'
      ? (zh ? '正在提交…' : 'Submitting…')
      : (zh
        ? 'SP-Survey 正在原样记录你在本页的作答。页面完成时会自动提交；如果没有自动提交，请点“完成并提交”。'
        : 'SP-Survey is recording your answers on this page as they are. It submits when the page finishes; if it does not, click “Finish and submit”.');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: '#fff', display: 'flex', flexDirection: 'column' }} data-testid="sp-site-survey">
      <div style={{ flex: 1, minHeight: 0 }}>
        <SpSiteFrame
          html={surveyJson.spSite.html}
          allowedHosts={surveyJson.spSite.allowedHosts || []}
          questions={questions}
          media={media}
          survey={{
            title: model.title || surveyJson.title || '',
            description: model.description || '',
            language: language || surveyJson.locale || 'en',
          }}
          initialAnswers={initialAnswers}
          onAnswer={onAnswer}
          onCapture={onCapture}
          onState={onState}
          onComplete={complete}
          title={model.title || 'Survey'}
        />
      </div>
      {showBar && (
        <div
          data-testid="sp-site-raw-bar"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fafafa', fontSize: 13, color: '#444' }}
        >
          <span style={{ flex: 1, fontWeight: status === 'completed' ? 600 : 400 }} data-testid="sp-site-bar-text">{barText}</span>
          {status === 'active' && <button
            type="button"
            onClick={complete}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #1976d2', background: '#1976d2', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            {zh ? '完成并提交' : 'Finish and submit'}
          </button>}
        </div>
      )}
    </div>
  );
}
