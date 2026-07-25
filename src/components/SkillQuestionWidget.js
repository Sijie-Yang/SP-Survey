import React, { useEffect, useRef, useState, useCallback, useMemo, useContext } from 'react';
import { Box, Alert } from '@mui/material';
import { buildSkillSrcdoc } from '../lib/skillSdk';
import { toSkillInitPayload } from '../lib/skillPostMessage';
import { extractAnswerFromIframeMessage } from '../lib/skillAnswerBridge';
import { getPresetSkill } from '../lib/presetSkills';
import { stripSkillAnswerContext } from '../lib/skillMediaUtils';
import SkillAnswerReview from './SkillAnswerReview';
import { RegionContext } from '../contexts/RegionContext';
import { adminI18n } from '../contexts/adminI18n';

function presetSkillHtml(skillId) {
  if (!skillId?.startsWith('preset_')) return '';
  return getPresetSkill(skillId.replace(/^preset_/, ''))?.sourceHtml || '';
}

function stableStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** True when SurveyJS holds a real skill answer (not just stimulus context). */
export function skillAnswerPresent(value) {
  if (value == null || value === '') return false;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length > 0;
  const clean = stripSkillAnswerContext(value);
  if (clean == null) return false;
  if (typeof clean !== 'object') return true;
  if (Array.isArray(clean)) return clean.length > 0;
  return Object.keys(clean).length > 0;
}

export default function SkillQuestionFrame({ skillHtml, config, images, value, onChange, readOnly, skillId, resultSchema }) {
  const region = useContext(RegionContext);
  const t = region?.t || adminI18n.en;
  const resolvedHtml = skillHtml || presetSkillHtml(skillId);
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  const iframeReadyRef = useRef(false);
  /** Ignore host→iframe value echoes for a window (AI skills often re-render on every init). */
  const skipValueSyncUntilRef = useRef(0);
  const lastEmittedJsonRef = useRef('');
  const lastInitKeyRef = useRef('');
  const configRef = useRef(config);
  const imagesRef = useRef(images);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  configRef.current = config;
  imagesRef.current = images;
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Stable iframe document — never embed live answers in srcDoc (that reloads on every interaction).
  const srcDoc = useMemo(
    () => buildSkillSrcdoc(resolvedHtml, null),
    [resolvedHtml],
  );

  const structuralKey = useMemo(
    () => JSON.stringify({ config, images }),
    [config, images],
  );

  const postToIframe = useCallback((msg) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ source: 'sp-survey-host', ...msg }, '*');
    } catch (err) {
      console.error('SkillQuestionFrame postMessage failed:', err);
    }
  }, []);

  const sendInit = useCallback((force = false) => {
    const payload = toSkillInitPayload(configRef.current, imagesRef.current, valueRef.current);
    const key = stableStringify({
      config: payload.config,
      images: payload.images,
      value: payload.value,
    });
    // AI skills often call render() on every init message — avoid duplicate inits.
    if (!force && key === lastInitKeyRef.current) return;
    lastInitKeyRef.current = key;
    postToIframe({ type: 'init', ...payload });
  }, [postToIframe]);

  useEffect(() => {
    iframeReadyRef.current = false;
    lastInitKeyRef.current = '';
  }, [srcDoc]);

  useEffect(() => {
    const handler = (e) => {
      const iframe = iframeRef.current;
      // Only handle messages from this question's iframe (same page may host multiple skills).
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;

      // Official SDK control messages (height / ready)
      if (d.source === 'sp-survey-skill') {
        if (d.type === 'height' && d.px) {
          // Tall composite / streetscape skills often exceed 1200px (Done button below fold).
          setHeight(Math.min(Math.max(d.px, 80), 4000));
        }
        if (d.type === 'ready') {
          iframeReadyRef.current = true;
          sendInit(true);
        }
      }

      // Official answer + AI mistaken postMessage shapes (skill-result, etc.).
      // Persist even if SurveyJS already flipped isReadOnly for preview — the
      // answer was produced while the participant was interacting.
      const extracted = extractAnswerFromIframeMessage(d);
      if (!extracted) return;
      const json = stableStringify(extracted.value);
      // ChatGPT skills often post 3 alias messages at once — debounce + skip re-init window.
      skipValueSyncUntilRef.current = Date.now() + 600;
      if (json === lastEmittedJsonRef.current) return;
      lastEmittedJsonRef.current = json;
      // The answer is survey state, so persist synchronously. UI echo suppression
      // may be timed, but correctness must never depend on a timer surviving Preview.
      if (typeof onChangeRef.current === 'function') onChangeRef.current(extracted.value);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    lastEmittedJsonRef.current = '';
    sendInit(true);
  }, [structuralKey, sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    // Do NOT bounce the participant's own answer back as init — many AI skills
    // listen to all messages and call render() whenever config.mode is set, which
    // destroys in-progress UI and makes Done buttons appear dead.
    if (Date.now() < skipValueSyncUntilRef.current) return;
    const incoming = stableStringify(value);
    if (incoming === lastEmittedJsonRef.current) return;
    sendInit();
  }, [value, sendInit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      iframeReadyRef.current = true;
      sendInit(true);
    };
    iframe.addEventListener('load', onLoad);
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc, sendInit]);

  // Survey end preview / review: always show recorded answer summary (never a blank re-run).
  if (readOnly) {
    const hasAnswer = skillAnswerPresent(value);
    return (
      <Box sx={{ width: '100%' }}>
        {hasAnswer ? (
          <SkillAnswerReview value={value} resultSchema={resultSchema} title={t.skillAnswerYourSubmittedTitle} />
        ) : (
          <Alert severity="info">{t.skillAnswerNotRecorded}</Alert>
        )}
      </Box>
    );
  }

  if (!resolvedHtml) {
    return <Alert severity="warning">Skill HTML not configured.</Alert>;
  }

  return (
    <Box sx={{ width: '100%', position: 'relative', zIndex: 1 }}>
      <iframe
        ref={iframeRef}
        title="skill-question"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        scrolling="yes"
        style={{
          width: '100%',
          height,
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 8,
          display: 'block',
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          background: '#fff',
          overflow: 'auto',
        }}
      />
    </Box>
  );
}
