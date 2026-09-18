import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  siliconMediaInfo,
  siliconRunCounts,
  siliconRunDurationMs,
  siliconRunOutcome,
  siliconRunPlan,
} from '../../lib/siliconSupport';
import SiliconRunProcess from './SiliconRunProcess';

const STATUS_LABEL = {
  allComplete: 'siliconStatusAllComplete',
  partialValid: 'siliconStatusPartialValid',
  allFailed: 'siliconStatusAllFailed',
  budgetPartial: 'siliconStatusPartial',
  budgetFailed: 'siliconStatusBudgetFailed',
  failed: 'siliconStatusFailed',
  cancelled: 'siliconStatusCancelled',
  running: 'siliconStatusRunning',
  queued: 'siliconStatusQueued',
  throttled: 'siliconStatusThrottled',
  stopping: 'siliconStopping',
  loading: 'siliconStatusLoading',
};

function formatDuration(ms, t) {
  if (ms == null) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return tf(t.siliconDurationSeconds, { seconds });
  return tf(t.siliconDurationMinutes, { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

function TaskRow({ run, t, onOpen, onReuse, showEndedMeta }) {
  const counts = siliconRunCounts(run);
  const outcome = siliconRunOutcome(run);
  const plan = siliconRunPlan(run);
  const media = siliconMediaInfo(run);
  const duration = formatDuration(siliconRunDurationMs(run), t);
  return (
    <Box sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
        {run.project_name || run.project_id}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {tf(t.siliconConfigSummary, plan)}
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', mt: 0.4 }}>
        <Chip size="small" label={t[STATUS_LABEL[outcome]] || run.status} />
        <Typography variant="caption" color="text.secondary">
          {counts.ready
            ? tf(t.siliconTaskCounts, {
              processed: counts.processed,
              total: counts.total,
              valid: counts.valid,
              failed: counts.failed,
            })
            : t.siliconStatusLoading}
        </Typography>
      </Stack>
      {showEndedMeta && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {run.finished_at ? tf(t.siliconEndedAt, { time: new Date(run.finished_at).toLocaleString() }) : ''}
          {duration ? ` · ${tf(t.siliconDuration, { duration })}` : ''}
        </Typography>
      )}
      {!showEndedMeta && duration && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {tf(t.siliconDuration, { duration })}
        </Typography>
      )}
      {media.source === 'preview_library' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {tf(t.siliconMediaPreviewLibrary, { count: media.availableCount })}
        </Typography>
      )}
      {run.error_summary && outcome === 'allFailed' && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.25 }}>
          {run.error_summary}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Button size="small" sx={{ px: 0 }} onClick={() => onOpen(run.id)}>
          {t.siliconViewProcess}
        </Button>
        {showEndedMeta && onReuse && (
          <Button size="small" sx={{ px: 0 }} onClick={() => onReuse(run)}>
            {t.siliconReuseSettings}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export default function RunningTasksPanel({
  tasks,
  currentProjectId,
  onOpenProject,
}) {
  const { t } = useRegion();
  const [tab, setTab] = useState('active');
  const [actionError, setActionError] = useState('');
  const activeIds = useMemo(() => new Set((tasks.active || []).map((run) => run.id)), [tasks.active]);
  const ended = useMemo(() => (
    (tasks.recent || [])
      .filter((run) => !activeIds.has(run.id))
      .sort((a, b) => Date.parse(b.finished_at || b.updated_at || 0) - Date.parse(a.finished_at || a.updated_at || 0))
  ), [activeIds, tasks.recent]);

  const reuse = async (run) => {
    setActionError('');
    const result = await tasks.reuse?.(run);
    if (result && result.success === false) {
      setActionError(result.error || t.siliconErrorNoMedia);
    }
  };

  if (tasks.detail?.run?.id) {
    return (
      <SiliconRunProcess
        detail={tasks.detail}
        responses={tasks.responses}
        connection={tasks.connection}
        currentProjectId={currentProjectId}
        onBack={tasks.closeDetail}
        onOpenProject={onOpenProject}
        onStop={tasks.stop}
        onResume={tasks.resume}
        onRetryFailed={tasks.retryFailed}
        onReuse={reuse}
        onLoadResponses={tasks.loadResponses}
      />
    );
  }

  const rows = tab === 'active' ? (tasks.active || []) : ended;
  const empty = tab === 'active' ? t.siliconTasksEmptyActive : t.siliconTasksEmptyEnded;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ px: 1.75, pt: 1.25, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.siliconTasksTitle}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button
            size="small"
            variant={tab === 'active' ? 'contained' : 'text'}
            onClick={() => setTab('active')}
          >
            {tf(t.siliconTasksInProgress, { count: (tasks.active || []).length })}
          </Button>
          <Button
            size="small"
            variant={tab === 'ended' ? 'contained' : 'text'}
            onClick={() => setTab('ended')}
          >
            {tf(t.siliconTasksEnded, { count: ended.length })}
          </Button>
        </Stack>
        {tasks.connection === 'offline' && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {t.siliconConnectionLost}
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 1.75, pb: 2, overflow: 'auto' }}>
        {actionError && <Alert severity="warning" sx={{ mb: 1 }}>{actionError}</Alert>}
        {tasks.loading && !rows.length ? (
          <Typography variant="body2" color="text.secondary">{t.siliconStatusLoading}</Typography>
        ) : null}
        {!tasks.loading && !rows.length ? (
          <Typography variant="body2" color="text.secondary">{empty}</Typography>
        ) : (
          rows.map((run) => (
            <TaskRow
              key={run.id}
              run={run}
              t={t}
              onOpen={tasks.openDetail}
              onReuse={reuse}
              showEndedMeta={tab === 'ended'}
            />
          ))
        )}
      </Box>
    </Box>
  );
}
