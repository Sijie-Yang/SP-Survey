import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  groupSiliconProcess,
  siliconMediaInfo,
  siliconRunCounts,
  siliconRunOutcome,
  siliconRunPlan,
} from '../../lib/siliconSupport';

function waitSeconds(stage) {
  if (!stage?.started_at) return 0;
  const started = Date.parse(stage.started_at);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

function eventLabel(t, event) {
  const type = event?.type || '';
  const map = {
    'unit.start': t.siliconEventStart,
    'media.ready': t.siliconEventMedia,
    'model.request': t.siliconEventRequest,
    'model.response': t.siliconEventResponse,
    'validate.ok': t.siliconEventValid,
    'validate.fail': t.siliconEventInvalid,
    'unit.saved': t.siliconEventSaved,
    'unit.skip': t.siliconEventSkip,
    retry: t.siliconEventRetry,
    throttle: t.siliconEventThrottle,
    'run.stopping': t.siliconEventStopping,
    'run.complete': t.siliconEventComplete,
    'run.failed': t.siliconEventFailed,
    answer: t.siliconEventSaved,
    skip: t.siliconEventSkip,
    error: t.siliconEventInvalid,
  };
  return map[type] || type;
}

function imageSrc(image) {
  return typeof image === 'string' ? image : image?.url;
}

function TrialBody({ trial, t }) {
  return (
    <Box sx={{ mt: 0.75 }}>
      {Array.isArray(trial.images) && trial.images.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', mb: 0.75 }}>
          {trial.images.slice(0, 6).map((image, index) => (
            <Box
              key={imageSrc(image) || index}
              component="img"
              src={imageSrc(image)}
              alt=""
              sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1 }}
            />
          ))}
        </Stack>
      )}
      {trial.answer != null && (
        <Typography variant="body2">{typeof trial.answer === 'object' ? JSON.stringify(trial.answer) : String(trial.answer)}</Typography>
      )}
      {trial.rationale && (
        <Typography variant="body2" color="text.secondary">{t.siliconRationale}: {trial.rationale}</Typography>
      )}
      {trial.error && (
        <Typography variant="body2" color="error">{trial.error}</Typography>
      )}
    </Box>
  );
}

export default function SiliconRunProcess({
  detail,
  responses,
  connection = 'ok',
  onBack,
  onOpenProject,
  onStop,
  onResume,
  onRetryFailed,
  onReuse,
  onLoadResponses,
  currentProjectId,
}) {
  const { t } = useRegion();
  const [techOpen, setTechOpen] = useState(false);
  const run = detail?.run || {};
  const counts = siliconRunCounts(run, detail?.counts || {});
  const outcome = siliconRunOutcome(run, detail?.counts || {});
  const plan = siliconRunPlan(run);
  const media = siliconMediaInfo(run);
  const stage = detail?.current_stage || {};
  const stopping = Boolean(run.cancel_requested && ['queued', 'draft', 'running'].includes(run.status));
  const known = Boolean(run.status);
  const active = !known || ['queued', 'draft', 'running'].includes(run.status);
  const mediaReady = Boolean(run.media_snapshot || run.execution_plan?.media);
  const grouped = useMemo(
    () => groupSiliconProcess({ run, units: detail?.units || [], events: detail?.events || [] }),
    [detail?.events, detail?.units, run],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
        <Button size="small" onClick={onBack}>{t.siliconTasksBack}</Button>
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, flex: 1 }}>
          {t.siliconProcessTitle}
        </Typography>
      </Stack>
      <Box sx={{ px: 1.75, pb: 2, overflow: 'auto' }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {run.project_name || run.project_id || t.siliconProcessTitle}
          {` · ${
            active
              ? (stopping ? t.siliconStopping : t.siliconStatusRunning)
              : (outcome === 'allFailed' ? t.siliconEndedNoAnswers : (t.siliconStatusAllComplete && outcome === 'allComplete' ? t.siliconStatusAllComplete : ''))
          }`}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {tf(t.siliconConfigSummary, plan)}
        </Typography>
        {mediaReady && media.source === 'preview_library' && (
          <Typography variant="body2" color="text.secondary">
            {tf(t.siliconMediaPreviewLibrary, { count: media.availableCount })}
          </Typography>
        )}
        {mediaReady && media.source === 'none' && (
          <Typography variant="body2" color="text.secondary">{t.siliconMediaNone}</Typography>
        )}
        {mediaReady && media.source !== 'preview_library' && media.source !== 'none' && (
          <Typography variant="body2" color="text.secondary">
            {tf(t.siliconMediaProject, { count: media.availableCount })}
          </Typography>
        )}
        {!counts.ready ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {t.siliconStatusLoading}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {outcome === 'allFailed'
              ? tf(t.siliconTrialBreakdown, {
                done: Math.min(counts.processed, counts.total),
                total: counts.total,
                valid: counts.valid,
                skipped: counts.skipped,
              })
              : tf(t.siliconProcessedTrials, {
                done: Math.min(counts.processed, counts.total),
                total: counts.total,
              })}
          </Typography>
        )}
        {outcome === 'allFailed' && (
          <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
            {run.error_summary || t.siliconNoImagesReason}
          </Typography>
        )}
        {active && stage.phase === 'model.request' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {tf(t.siliconProcessWaiting, { seconds: waitSeconds(stage) })}
          </Typography>
        )}
        {connection === 'offline' && (
          <Alert severity="warning" sx={{ mt: 1 }}>{t.siliconConnectionLost}</Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {active && (
            <Button size="small" color="error" onClick={() => onStop?.(run.id)} disabled={stopping}>
              {stopping ? t.siliconStopping : t.siliconCancel}
            </Button>
          )}
          {!active && onResume && (
            <Button size="small" onClick={() => onResume(run.id)} title={t.siliconResumeHint}>{t.siliconResume}</Button>
          )}
          {!active && onRetryFailed && (
            <Button size="small" onClick={() => onRetryFailed(run.id)} title={t.siliconRetryHint}>{t.siliconRetryFailed}</Button>
          )}
          {!active && onReuse && (
            <Button size="small" onClick={() => onReuse(run)} title={t.siliconReuseHint}>{t.siliconReuseSettings}</Button>
          )}
          <Button size="small" onClick={() => onLoadResponses?.(run.id)}>{t.siliconViewAnswers}</Button>
          {run.project_id && run.project_id !== currentProjectId && (
            <Button size="small" onClick={() => onOpenProject?.(run.project_id)}>{t.siliconOpenProject}</Button>
          )}
        </Stack>

        {grouped.map((envelope) => (
          <Box key={envelope.key} sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {tf(t.siliconEnvelopeLabel, { persona: envelope.personaName, repeat: envelope.repeat })}
            </Typography>
            {envelope.questions.map((question) => {
              const expanded = question.state === 'active' || question.state === 'failed';
              return (
                <Accordion
                  key={`${envelope.key}:${question.name}`}
                  defaultExpanded={expanded}
                  disableGutters
                  sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 40, px: 0 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {tf(t.siliconQuestionCard, {
                          n: question.ordinal || '—',
                          title: question.title,
                        })}
                      </Typography>
                      <Typography variant="caption" color={question.state === 'failed' ? 'error' : 'text.secondary'}>
                        {question.state === 'waiting' && t.siliconWaitingStart}
                        {question.state === 'active' && tf(t.siliconTrialProgress, {
                          done: question.processed,
                          total: question.trialCount,
                          current: question.currentTrial || (question.processed + 1),
                        })}
                        {question.state !== 'waiting' && question.state !== 'active' && tf(t.siliconProcessedTrials, {
                          done: question.processed,
                          total: question.trialCount,
                        })}
                        {question.state === 'failed' && question.trials.find((trial) => trial.error)?.error
                          ? ` · ${question.trials.find((trial) => trial.error).error}`
                          : ''}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    {question.trialCount > 1 ? (
                      question.trials.map((trial) => (
                        <Box key={trial.key} sx={{ mb: 1.25 }}>
                          <Chip size="small" label={`${trial.trialIndex}/${question.trialCount}`} />
                          <TrialBody trial={trial} t={t} />
                        </Box>
                      ))
                    ) : (
                      <TrialBody trial={question.trials[0] || {}} t={t} />
                    )}
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        ))}

        <Accordion
          expanded={techOpen}
          onChange={(_, open) => setTechOpen(open)}
          disableGutters
          sx={{ boxShadow: 'none', mt: 2, '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 36, px: 0 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.siliconTechDetails}</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            {(detail?.events || []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t.siliconStatusLoading}</Typography>
            ) : (
              (detail.events || []).map((event) => (
                <Box key={event.id} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={eventLabel(t, event)} />
                    <Typography variant="caption" noWrap>
                      {event.payload?.persona_name || event.payload?.persona_id || ''}
                      {event.question_name ? ` · ${event.question_name}` : ''}
                      {event.payload?.trial_index ? ` · ${event.payload.trial_index}/${event.payload.trial_count || event.payload.trial_index}` : ''}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {event.created_at ? new Date(event.created_at).toLocaleTimeString() : ''}
                    {event.payload?.error ? ` · ${event.payload.error}` : ''}
                  </Typography>
                </Box>
              ))
            )}
          </AccordionDetails>
        </Accordion>

        {responses && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.siliconViewAnswers}</Typography>
            {responses.map((row) => (
              <Typography key={row.id || row.participant_id} variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                {row.survey_metadata?.persona_name || row.persona_id}: {Object.keys(row.responses || {}).length} · {row.status}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
