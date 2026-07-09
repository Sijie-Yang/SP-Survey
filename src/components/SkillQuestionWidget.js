import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Alert } from '@mui/material';
import { buildSkillSrcdoc } from '../lib/skillSdk';
import { toSkillInitPayload } from '../lib/skillPostMessage';
import { getPresetSkill } from '../lib/presetSkills';

function presetSkillHtml(skillId) {
  if (!skillId?.startsWith('preset_')) return '';
  return getPresetSkill(skillId.replace(/^preset_/, ''))?.sourceHtml || '';
}

export default function SkillQuestionFrame({ skillHtml, config, images, value, onChange, readOnly, skillId }) {
  const resolvedHtml = skillHtml || presetSkillHtml(skillId);
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  const iframeReadyRef = useRef(false);
  const skipValueSyncRef = useRef(false);
  const configRef = useRef(config);
  const imagesRef = useRef(images);
  const valueRef = useRef(value);
  configRef.current = config;
  imagesRef.current = images;
  valueRef.current = value;

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

  const sendInit = useCallback(() => {
    const payload = toSkillInitPayload(configRef.current, imagesRef.current, valueRef.current);
    postToIframe({ type: 'init', ...payload });
  }, [postToIframe]);

  useEffect(() => {
    iframeReadyRef.current = false;
  }, [srcDoc]);

  useEffect(() => {
    const handler = (e) => {
      const iframe = iframeRef.current;
      // Only handle messages from this question's iframe (same page may host multiple skills).
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== 'sp-survey-skill') return;
      if (d.type === 'height' && d.px) {
        setHeight(Math.min(Math.max(d.px, 80), 1200));
      }
      if (d.type === 'ready') {
        iframeReadyRef.current = true;
        sendInit();
      }
      if (d.type === 'answer' && !readOnly) {
        skipValueSyncRef.current = true;
        onChange?.(d.value);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onChange, readOnly, sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    sendInit();
  }, [structuralKey, sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    if (skipValueSyncRef.current) {
      skipValueSyncRef.current = false;
      return;
    }
    sendInit();
  }, [value, sendInit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      iframeReadyRef.current = true;
      sendInit();
    };
    iframe.addEventListener('load', onLoad);
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc, sendInit]);

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
        style={{
          width: '100%',
          height,
          border: '1px solid #ddd',
          borderRadius: 8,
          display: 'block',
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          background: '#fff',
        }}
      />
    </Box>
  );
}
