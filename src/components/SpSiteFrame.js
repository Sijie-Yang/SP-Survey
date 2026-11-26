import React, { useEffect, useMemo, useRef } from 'react';
import { applySiteAnswer, missingRequired, prepareSiteDocument } from '../lib/spSite';

/**
 * Hosts an LLM-designed survey site (SP-Scheme) in a sandboxed iframe.
 * The site gets the questions and drawn media; every answer it sends is
 * validated here before `onAnswer` records it.
 */
export default function SpSiteFrame({
  html,
  questions,
  survey = {},
  initialAnswers = {},
  onAnswer,
  onComplete,
  onProblem,
  onCapture,
  onState,
  media = null,
  title = 'Survey',
  allowedHosts = [],
  style,
  sandbox = 'allow-scripts allow-forms allow-modals allow-popups',
  onLoad,
  randomSeed = null,
}) {
  const frameRef = useRef(null);
  const answersRef = useRef({ ...initialAnswers });
  const latest = useRef({});
  latest.current = { questions, survey, onAnswer, onComplete, onProblem, onCapture, onState, media };
  // Questions and answers are embedded as boot data so the page can read them
  // synchronously; the key keeps the iframe from reloading on equal props.
  const bootKey = JSON.stringify({ questions, survey, answers: initialAnswers, allowedHosts, media });
  const srcDoc = useMemo(() => {
    const boot = JSON.parse(bootKey);
    return prepareSiteDocument(html, {
      boot: { questions: boot.questions || [], survey: boot.survey || {}, answers: boot.answers || {}, media: boot.media || {} },
      allowedHosts: boot.allowedHosts,
      randomSeed,
    });
  }, [html, bootKey, randomSeed]);

  useEffect(() => {
    const byName = () => new Map((latest.current.questions || []).map((q) => [q.name, q]));
    const reply = (target, message) => target.postMessage({ source: 'sp-site-host', ...message }, '*');
    const handle = async (event) => {
      const frame = frameRef.current?.contentWindow;
      const data = event.data;
      if (!frame || event.source !== frame || !data || data.source !== 'sp-site') return;
      if (data.type === 'hello') {
        reply(frame, {
          type: 'init',
          questions: latest.current.questions || [],
          survey: latest.current.survey || {},
          answers: answersRef.current,
          media: latest.current.media || {},
        });
        return;
      }
      if (data.type === 'capture') {
        latest.current.onCapture?.(data.request || {});
        return;
      }
      if (data.type === 'state') {
        latest.current.onState?.(String(data.area || 'localStorage'), String(data.key || ''), data.value == null ? null : String(data.value));
        return;
      }
      if (data.type === 'problem') {
        latest.current.onProblem?.({ kind: String(data.kind || ''), message: String(data.message || '') });
        return;
      }
      if (data.type === 'answer') {
        const question = byName().get(data.name);
        const result = question
          ? applySiteAnswer(question, answersRef.current[data.name], data.value, { trial: data.trial, shown: data.shown, key: data.key }, latest.current.media)
          : { ok: false, reason: `Unknown question "${data.name}"` };
        if (result.ok) {
          if (result.stored == null) delete answersRef.current[data.name];
          else answersRef.current[data.name] = result.stored;
          latest.current.onAnswer?.(data.name, result.stored, { trial: data.trial });
        }
        reply(frame, {
          type: 'result',
          requestId: data.requestId,
          name: data.name,
          stored: result.ok ? result.stored : undefined,
          result: result.ok ? { ok: true } : { ok: false, error: result.reason },
        });
        return;
      }
      if (data.type === 'complete') {
        const missing = missingRequired(latest.current.questions, answersRef.current);
        if (missing.length) {
          reply(frame, {
            type: 'result',
            requestId: data.requestId,
            result: { ok: false, missing, error: `Required questions are unanswered: ${missing.join(', ')}` },
          });
          return;
        }
        reply(frame, { type: 'result', requestId: data.requestId, result: { ok: true } });
        await latest.current.onComplete?.(answersRef.current);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  return (
    <iframe
      ref={frameRef}
      title={title}
      data-testid="sp-site-frame"
      srcDoc={srcDoc}
      sandbox={sandbox}
      allow="fullscreen"
      onLoad={onLoad}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#fff', ...style }}
    />
  );
}
