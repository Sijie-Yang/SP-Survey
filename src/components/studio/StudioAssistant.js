import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, LinearProgress, Typography } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import ChatAssistant from '../admin/ChatAssistant';
import useSurveyAssistant, { chatPropsFromAssistant } from '../../hooks/useSurveyAssistant';
import { StudioCard, useL } from './studioUi';

const PENDING_KEY = 'sp-studio-assistant-prompt:';

/** The new-study box hands its first message to the study's assistant through this. */
export function queueStudioAssistantPrompt(projectId, text) {
  try {
    window.sessionStorage.setItem(`${PENDING_KEY}${projectId}`, String(text || ''));
  } catch {
    // Without storage the researcher types the message again.
  }
}

function takePendingPrompt(projectId) {
  try {
    const key = `${PENDING_KEY}${projectId}`;
    const text = window.sessionStorage.getItem(key) || '';
    window.sessionStorage.removeItem(key);
    return text;
  } catch {
    return '';
  }
}

const MODEL_WAIT_MS = 15000;

/**
 * The new-study box after "Make it with AI": the built-in Assistant (same
 * session the study page shows later) writes the first version while the
 * researcher stays here. `onDone` opens the study: after the first answer,
 * at once when no model is available (the message waits in the chat box),
 * or when the researcher chooses to open it early (the run keeps going).
 */
export function StudioFirstRun({ project, request, onDone }) {
  const L = useL();
  const assistant = useSurveyAssistant({
    currentProject: project,
    surveyConfig: project?.survey_config_draft || project?.survey_config || {},
    defaultMode: 'spscheme',
    onSurveyConfigChange: () => {},
  });
  const { apiKeyValid, credentialsChecked, handleSendMessage, loadingStatus } = assistant;
  const started = useRef(false);
  const finished = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  const finish = (handOver = false) => {
    if (finished.current) return;
    finished.current = true;
    if (handOver) queueStudioAssistantPrompt(project.id, request);
    onDone?.();
  };

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), MODEL_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (started.current || finished.current) return;
    if (apiKeyValid) {
      started.current = true;
      Promise.resolve(handleSendMessage?.({ message: request, assistantMode: 'spscheme' }))
        .catch(() => null)
        .then(() => finish(false));
    } else if (credentialsChecked || timedOut) {
      // No model: open the study with the message in its chat box.
      finish(true);
    }
  });

  return (
    <Box data-testid="studio-first-run" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, py: 1 }}>
      <Typography sx={{ fontWeight: 700 }}>
        {L('The AI is writing the first version of your study…', 'AI 正在写研究的第一版…')}
      </Typography>
      <LinearProgress />
      <Typography variant="body2" color="text.secondary">
        {loadingStatus || L('This usually takes one to three minutes. The study opens when it is ready.', '一般需要一到三分钟，写好后会自动打开研究。')}
      </Typography>
      <Box>
        <Button size="small" onClick={() => finish(false)}>
          {L('Open the study now (the AI keeps working)', '先打开研究（AI 会继续写）')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * The platform's built-in Assistant inside a Studio study: the same chat,
 * sessions, model choice and history as the classic editor's sidebar,
 * opening in SP-Scheme mode (Classic for classic studies). `onSaved` reloads the study after a saved change;
 * `onSaveConfig` stores a change the assistant made only locally (an undo).
 */
export default function StudioAssistant({ project, config, defaultMode = 'spscheme', onSaved, onSaveConfig }) {
  const L = useL();
  const assistant = useSurveyAssistant({
    currentProject: project,
    surveyConfig: config,
    defaultMode,
    onSurveyConfigChange: (next, meta = {}) => {
      if (meta?.persisted) onSaved?.();
      else if (next) onSaveConfig?.(next);
    },
  });
  const pending = useRef(null);
  if (pending.current === null) pending.current = project?.id ? takePendingPrompt(project.id) : '';

  // A message typed on the new-study screen: send it once the model is ready,
  // or leave it in the box when no model is available.
  const { apiKeyValid, isLoading, handleSendMessage, setUserMessage } = assistant;
  useEffect(() => {
    const text = pending.current;
    if (!text) return;
    if (!apiKeyValid) {
      setUserMessage?.(text);
      return;
    }
    if (isLoading) return;
    pending.current = '';
    handleSendMessage?.({ message: text, assistantMode: 'spscheme' });
  }, [apiKeyValid, isLoading, handleSendMessage, setUserMessage]);

  return (
    <StudioCard
      data-testid="studio-assistant"
      title={(
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <AutoAwesome color="primary" sx={{ fontSize: 20 }} />
          {L('AI assistant', 'AI 助手')}
        </Box>
      )}
    >
      <Box sx={{ height: { xs: 520, lg: 600 }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChatAssistant variant="content" fillHeight {...chatPropsFromAssistant(assistant)} />
      </Box>
    </StudioCard>
  );
}
