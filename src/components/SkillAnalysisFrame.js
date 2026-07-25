import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import {
  buildAnalysisSrcdoc,
  shapeAnalysisResponses,
} from '../lib/skillSdk';

/**
 * Sandboxed host for skill-authored analysisHtml.
 * Read-only: does not accept answer messages back.
 */
export default function SkillAnalysisFrame({
  analysisHtml,
  responses = [],
  config = {},
  mediaUrlMap = {},
  minHeight = 160,
}) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(minHeight);
  const readyRef = useRef(false);
  const responsesRef = useRef(responses);
  const configRef = useRef(config);
  const mediaRef = useRef(mediaUrlMap);
  responsesRef.current = responses;
  configRef.current = config;
  mediaRef.current = mediaUrlMap;

  const srcDoc = useMemo(
    () => buildAnalysisSrcdoc(analysisHtml || '', null),
    [analysisHtml],
  );

  const postToIframe = useCallback((msg) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ source: 'sp-survey-host', ...msg }, '*');
    } catch (err) {
      console.error('SkillAnalysisFrame postMessage failed:', err);
    }
  }, []);

  const sendInit = useCallback(() => {
    postToIframe({
      type: 'analysis-init',
      responses: shapeAnalysisResponses(responsesRef.current),
      config: configRef.current || {},
      mediaUrlMap: mediaRef.current || {},
    });
  }, [postToIframe]);

  useEffect(() => {
    readyRef.current = false;
  }, [srcDoc]);

  useEffect(() => {
    const handler = (e) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.source !== 'sp-survey-skill') return;
      if (d.type === 'height' && d.px) {
        setHeight(Math.min(Math.max(d.px, minHeight), 4000));
      }
      if (d.type === 'ready') {
        readyRef.current = true;
        sendInit();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendInit, minHeight]);

  useEffect(() => {
    if (!readyRef.current) return;
    sendInit();
  }, [responses, config, mediaUrlMap, sendInit]);

  if (!analysisHtml || !String(analysisHtml).trim()) {
    return null;
  }

  return (
    <Box sx={{ width: '100%', mb: 2 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        Skill-authored analysis view
      </Typography>
      <Box
        component="iframe"
        ref={iframeRef}
        title="Skill analysis"
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        sx={{
          width: '100%',
          height,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: '#fff',
        }}
      />
    </Box>
  );
}
