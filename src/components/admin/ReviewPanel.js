import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  REVIEW_ROLES,
  formatTokens,
  formatUsd,
  reviewRoleEmoji,
  reviewRoleLabel,
} from '../../lib/reviewMode';

function fill(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    String(template || ''),
  );
}

const compactSelect = {
  fontSize: '0.75rem',
  '& .MuiSelect-select': { py: 0.25, pl: 0.75, pr: 2.5 },
};

export function ReviewComposerOptions({ t, options, estimate, onChange, disabled = false }) {
  if (!options) return null;
  const toggleRole = (id) => {
    const selected = options.roles.includes(id);
    if (selected && options.roles.length === 1) return;
    if (!selected && options.roles.length >= options.maxRoles) return;
    onChange?.({ roles: selected ? options.roles.filter((role) => role !== id) : [...options.roles, id] });
  };
  const estimateText = estimate?.tokens
    ? fill(t.aiReviewEstimate || 'Estimate: {calls} model calls, {minTokens}–{maxTokens} tokens', {
      calls: `${estimate.modelCalls?.min ?? '?'}–${estimate.modelCalls?.max ?? '?'}`,
      minTokens: formatTokens(estimate.tokens.min),
      maxTokens: formatTokens(estimate.tokens.max),
    })
    : '';
  const costText = estimate?.costUsd
    ? fill(t.aiReviewEstimateCost || '≈ {min}–{max}', {
      min: formatUsd(estimate.costUsd.min),
      max: formatUsd(estimate.costUsd.max),
    })
    : (estimate ? (t.aiReviewEstimateNoPrice || 'price unknown for this model') : '');
  return (
    <Box
      data-testid="review-options"
      sx={{ px: 1.25, pt: 1, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider', display: 'grid', gap: 0.75 }}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, mr: 0.5 }}>
          {t.aiReviewRoles || 'Reviewers'}
        </Typography>
        {REVIEW_ROLES.map((role) => {
          const selected = options.roles.includes(role.id);
          return (
            <Chip
              key={role.id}
              size="small"
              label={`${role.emoji} ${reviewRoleLabel(role.id, t)}`}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              onClick={disabled ? undefined : () => toggleRole(role.id)}
              aria-pressed={selected}
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
          );
        })}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <Select
          variant="standard"
          disableUnderline
          size="small"
          value={options.method}
          disabled={disabled}
          onChange={(event) => onChange?.({ method: event.target.value })}
          inputProps={{ 'aria-label': t.aiReviewMethod || 'Method' }}
          sx={compactSelect}
        >
          <MenuItem value="linear">{t.aiReviewMethodLinear || 'Linear individual review'}</MenuItem>
          <MenuItem value="group">{t.aiReviewMethodGroup || 'Group discussion'}</MenuItem>
        </Select>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Typography variant="caption" color="text.secondary">{t.aiReviewMaxRounds || 'Max rounds'}</Typography>
          <Select
            variant="standard"
            disableUnderline
            size="small"
            value={options.maxRounds}
            disabled={disabled}
            onChange={(event) => onChange?.({ maxRounds: event.target.value })}
            inputProps={{ 'aria-label': t.aiReviewMaxRounds || 'Max rounds' }}
            sx={compactSelect}
          >
            {[1, 2, 3, 4, 5].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Typography variant="caption" color="text.secondary">{t.aiReviewThreshold || 'Accept at'}</Typography>
          <Select
            variant="standard"
            disableUnderline
            size="small"
            value={options.threshold}
            disabled={disabled}
            onChange={(event) => onChange?.({ threshold: event.target.value })}
            inputProps={{ 'aria-label': t.aiReviewThreshold || 'Accept at' }}
            sx={compactSelect}
          >
            {[5, 6, 7, 8, 9, 10].map((n) => <MenuItem key={n} value={n}>{`${n}/10`}</MenuItem>)}
          </Select>
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Typography variant="caption" color="text.secondary">{t.aiReviewMaxRoles || 'Reviewer cap'}</Typography>
          <Select
            variant="standard"
            disableUnderline
            size="small"
            value={options.maxRoles}
            disabled={disabled}
            onChange={(event) => {
              const cap = Number(event.target.value);
              onChange?.({ maxRoles: cap, roles: options.roles.slice(0, cap) });
            }}
            inputProps={{ 'aria-label': t.aiReviewMaxRoles || 'Reviewer cap' }}
            sx={compactSelect}
          >
            {[1, 2, 3, 4, 5].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
        </Stack>
        <Select
          variant="standard"
          disableUnderline
          size="small"
          value={options.applyMode}
          disabled={disabled}
          onChange={(event) => onChange?.({ applyMode: event.target.value })}
          inputProps={{ 'aria-label': t.aiReviewApplyMode || 'Revisions' }}
          sx={compactSelect}
        >
          <MenuItem value="review">{t.aiReviewApplyModeReview || 'Review only, do not apply'}</MenuItem>
          <MenuItem value="apply">{t.aiReviewApplyModeApply || 'Apply each round'}</MenuItem>
        </Select>
      </Stack>
      {estimateText ? (
        <Typography variant="caption" color="text.secondary" data-testid="review-estimate">
          {estimateText}{costText ? ` · ${costText}` : ''}
        </Typography>
      ) : null}
    </Box>
  );
}

function roleStatusText(review, t) {
  if (review.status === 'start') return t.aiReviewRoleRunning || 'reviewing…';
  if (review.status === 'failed') return t.aiReviewRoleFailed || 'failed';
  if (review.status === 'cancelled') return t.aiReviewRoleCancelled || 'cancelled';
  return review.rating != null ? `${review.rating}/10` : '';
}

function severityColor(severity) {
  if (severity === 'high') return 'error';
  if (severity === 'low') return 'default';
  return 'warning';
}

function RoleReview({ review, t }) {
  const [open, setOpen] = React.useState(false);
  const running = review.status === 'start';
  const hasDetail = (review.concerns || []).length || (review.strengths || []).length || (review.suggestions || []).length;
  return (
    <Box sx={{ px: 1, py: 0.6, borderRadius: 1, border: '1px solid', borderColor: review.status === 'failed' ? 'error.light' : 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {reviewRoleEmoji(review.role)} {reviewRoleLabel(review.role, t)}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {running ? <CircularProgress size={10} /> : null}
          <Typography
            variant="caption"
            sx={{ color: review.status === 'failed' ? 'error.main' : (running ? 'primary.main' : 'text.secondary'), fontWeight: 600 }}
          >
            {roleStatusText(review, t)}
          </Typography>
        </Stack>
      </Stack>
      {review.comments ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, whiteSpace: 'pre-wrap' }}>
          {review.comments}
        </Typography>
      ) : null}
      {review.error ? (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.25 }}>{review.error}</Typography>
      ) : null}
      {hasDetail ? (
        <Button size="small" sx={{ minWidth: 0, p: 0, mt: 0.25, fontSize: '0.7rem', textTransform: 'none' }} onClick={() => setOpen((v) => !v)}>
          {open ? '−' : '+'} {t.aiReviewConcerns || 'Concerns'} ({(review.concerns || []).length})
        </Button>
      ) : null}
      {open ? (
        <Box sx={{ display: 'grid', gap: 0.35, mt: 0.35 }}>
          {(review.concerns || []).map((item, index) => (
            <Stack key={`c-${index}`} direction="row" spacing={0.5} alignItems="flex-start">
              <Chip size="small" label={item.severity} color={severityColor(item.severity)} sx={{ height: 16, fontSize: '0.62rem' }} />
              <Typography variant="caption" sx={{ flex: 1 }}>
                {item.issue}
                {item.questions?.length ? ` · ${fill(t.aiReviewQuestions || 'Questions: {names}', { names: item.questions.join(', ') })}` : ''}
              </Typography>
            </Stack>
          ))}
          {(review.strengths || []).length ? (
            <Typography variant="caption" color="text.secondary">
              <b>{t.aiReviewStrengths || 'Strengths'}:</b> {review.strengths.join('; ')}
            </Typography>
          ) : null}
          {(review.suggestions || []).length ? (
            <Typography variant="caption" color="text.secondary">
              <b>{t.aiReviewSuggestions || 'Suggestions'}:</b> {review.suggestions.join('; ')}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function RevisionBlock({ round, revision, t, canApply, applying, onApply }) {
  if (!revision) return null;
  const running = revision.status === 'start';
  const operations = Array.isArray(revision.operations) ? revision.operations : [];
  let status = '';
  if (running) status = t.aiReviewRevising || 'revising…';
  else if (revision.applied) status = t.aiReviewApplied || 'Applied';
  else if (revision.status === 'invalid') status = t.aiReviewRevisionInvalid || 'Revision rejected by validation';
  else if (revision.status === 'conflict') status = t.aiReviewConflict || 'Draft changed during the review; not applied';
  else if (revision.status === 'failed' || revision.status === 'apply_failed') status = revision.error || 'failed';
  else if (operations.length) status = fill(t.aiReviewOperations || '{count} operation(s)', { count: operations.length });
  return (
    <Box sx={{ px: 1, py: 0.75, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', gap: 0.4 }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          🛠️ {t.aiReviewRevision || 'Revision'}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {running ? <CircularProgress size={10} /> : null}
          <Typography variant="caption" color={['conflict', 'invalid', 'failed', 'apply_failed'].includes(revision.status) ? 'error.main' : 'text.secondary'}>
            {status}
          </Typography>
        </Stack>
      </Stack>
      {revision.summary ? (
        <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>
          <b>{t.aiReviewSummary || 'Summary'}:</b> {revision.summary}
        </Typography>
      ) : null}
      {(revision.plan || []).length ? (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.aiReviewPlan || 'Revision plan'}</Typography>
          {(revision.plan || []).map((item, index) => (
            <Typography key={`p-${index}`} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {index + 1}. {item.step}
              {item.roles?.length ? ` · ${item.roles.map((role) => reviewRoleLabel(role, t)).join(', ')}` : ''}
              {item.questions?.length ? ` · ${item.questions.join(', ')}` : ''}
            </Typography>
          ))}
        </Box>
      ) : null}
      {canApply ? (
        <Box>
          <Button
            size="small"
            variant="outlined"
            disabled={Boolean(applying)}
            onClick={() => onApply?.([round])}
            sx={{ textTransform: 'none' }}
          >
            {fill(t.aiReviewApplyRound || 'Apply round {round}', { round })}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

export function ReviewCard({ review, t, runId, isLoading = false, applying = '', onApply }) {
  if (!review) return null;
  const options = review.options || {};
  const reviewOnly = options.applyMode === 'review';
  const status = review.status || 'running';
  const pending = reviewOnly
    ? review.rounds
      .filter((entry) => entry.revision?.status === 'proposed' && !entry.revision.applied)
      .map((entry) => entry.round)
      .sort((a, b) => a - b)
    : [];
  const finished = status !== 'running';
  const statusLabel = t[`aiReviewStatus_${status}`] || status;
  return (
    <Box
      data-testid="review-card"
      sx={{ mb: 1, p: 1, border: '1px solid', borderColor: status === 'accepted' ? 'success.light' : 'divider', borderRadius: 1.5, display: 'grid', gap: 0.75 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ fontWeight: 800 }}>
          {t.aiReviewPanelTitle || 'Multi-agent review'} · {options.method === 'group'
            ? (t.aiReviewMethodGroup || 'Group discussion')
            : (t.aiReviewMethodLinear || 'Linear individual review')}
        </Typography>
        <Chip
          size="small"
          label={statusLabel}
          color={status === 'accepted' ? 'success' : (finished ? 'default' : 'primary')}
          sx={{ height: 20, fontSize: '0.68rem' }}
        />
      </Stack>
      {(review.rounds || []).map((entry) => (
        <Box key={`round-${entry.round}`} sx={{ display: 'grid', gap: 0.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {fill(t.aiReviewRound || 'Round {round}', { round: entry.round })}
            </Typography>
            {entry.averageRating != null ? (
              <Typography variant="caption" color={entry.decision === 'accept' ? 'success.main' : 'text.secondary'}>
                {fill(t.aiReviewAverage || 'Average {rating}/10 (accept at {threshold})', {
                  rating: entry.averageRating,
                  threshold: options.threshold,
                })}
                {' · '}
                {entry.decision === 'accept'
                  ? (t.aiReviewDecisionAccept || 'Accepted')
                  : (entry.decision === 'failed' ? (t.aiReviewDecisionFailed || 'All reviewers failed') : (t.aiReviewDecisionRevise || 'Revise'))}
              </Typography>
            ) : null}
          </Stack>
          {(entry.reviews || []).map((item) => <RoleReview key={`${entry.round}-${item.role}`} review={item} t={t} />)}
          <RevisionBlock
            round={entry.round}
            revision={entry.revision}
            t={t}
            applying={applying}
            canApply={finished && !isLoading && reviewOnly && pending[0] === entry.round}
            onApply={(rounds) => onApply?.(runId, rounds)}
          />
        </Box>
      ))}
      {finished && reviewOnly && pending.length > 1 ? (
        <Box>
          <Button
            size="small"
            variant="contained"
            disabled={Boolean(applying) || isLoading}
            onClick={() => onApply?.(runId, pending)}
            sx={{ textTransform: 'none' }}
          >
            {t.aiReviewApplyAll || 'Apply all proposed revisions'}
          </Button>
        </Box>
      ) : null}
      {applying && applying.startsWith(`${runId}:`) ? <CircularProgress size={14} /> : null}
    </Box>
  );
}
