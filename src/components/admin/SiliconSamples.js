import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  cancelSiliconRun,
  createSiliconRun,
  deleteSiliconPersona,
  getCredentialStatus,
  getSiliconCompare,
  listSiliconPersonas,
  listSiliconRuns,
  exportSiliconRun,
  resumeSiliconRun,
  retryFailedSiliconRun,
  saveSiliconPersona,
} from '../../lib/agentApi';
import {
  collectQuestions,
  siliconMediaInfo,
  siliconPlanSummary,
  siliconQuestionReport,
  siliconRunCounts,
  siliconRunOutcome,
  siliconRunPlan,
} from '../../lib/siliconSupport';

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

const MEDIA_ERROR = {
  SILICON_NO_MEDIA_SOURCE: 'siliconErrorNoMedia',
  SILICON_FOLDER_EMPTY: 'siliconErrorFolderEmpty',
  SILICON_IMAGE_UNREADABLE: 'siliconErrorImageUnreadable',
  SILICON_LEASE_UNAVAILABLE: 'siliconErrorLease',
  DRAFT_SAVE_RPC_MISSING: 'draftSaveRpcMissing',
  ASSISTANT_RUN_SCHEMA_MISSING: 'assistantRunSchemaMissing',
};

export default function SiliconSamples({ currentProject, surveyConfig = null }) {
  const { t } = useRegion();
  const projectId = currentProject?.id;
  const [personas, setPersonas] = useState([]);
  const [runs, setRuns] = useState([]);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [repeats, setRepeats] = useState(1);
  const [budgetTokens, setBudgetTokens] = useState(25000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [visionRoutes, setVisionRoutes] = useState([]);
  const [overrideRoute, setOverrideRoute] = useState('');
  const [overrideEffort, setOverrideEffort] = useState('');
  const [compareCounts, setCompareCounts] = useState({});
  const [openPersona, setOpenPersona] = useState(null);
  const [selectedQuestionNames, setSelectedQuestionNames] = useState([]);
  const projectIdRef = useRef(projectId);
  const questionInitRef = useRef(null);
  projectIdRef.current = projectId;
  const questionReport = siliconQuestionReport(surveyConfig || currentProject?._surveyConfig || {});
  const supportedNames = questionReport.supported.map((item) => item.name).join('\0');
  const pretestNames = selectedQuestionNames;
  const hasUnsupported = questionReport.supported.length === 0 && questionReport.unsupported.length > 0;
  const hasNoSelectedQuestions = selectedQuestionNames.length === 0;
  const isPartialPretest = questionReport.unsupported.length > 0 && pretestNames.length > 0;
  const selectedPersonas = personas.filter((persona) => selectedIds.includes(persona.id));
  const selectedRoute = visionRoutes.find((route) => route.value === overrideRoute);
  const startPlan = siliconPlanSummary({
    personaCount: selectedIds.length,
    repeats: Number(repeats) || 1,
    questions: collectQuestions(surveyConfig || currentProject?._surveyConfig || {}, pretestNames),
  });

  const reuseRun = async (run) => {
    if (!overrideRoute && !run.provider) {
      setError(t.modelsSelectVision);
      return;
    }
    setBusy(true);
    setError('');
    const created = await createSiliconRun({
      projectId: run.project_id || projectId,
      personaIds: run.persona_ids || selectedIds,
      repeats: Number(run.repeats || repeats) || 1,
      budgetTokens: Number(run.budget_tokens || budgetTokens) || 25000,
      provider: run.provider || String(overrideRoute || '').split('::')[0] || undefined,
      model: run.model || String(overrideRoute || '').split('::')[1] || undefined,
      reasoningEffort: run.reasoning_effort || overrideEffort || undefined,
      questionNames: run.question_names || pretestNames,
    });
    setBusy(false);
    if (!created.success) {
      setError(t[MEDIA_ERROR[created.code]] || created.error || 'Could not start run');
      return;
    }
    refresh();
  };

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const [p, r] = await Promise.all([
      listSiliconPersonas(projectId),
      listSiliconRuns(projectId),
    ]);
    if (projectIdRef.current !== projectId) return;
    if (p.success) setPersonas(p.personas || []);
    if (r.success) {
      const listed = r.runs || [];
      setRuns(listed);
      setCompareCounts((current) => {
        const next = { ...current };
        for (const run of listed) {
          if (run.counts_ready || Number.isFinite(run.progress_valid)) {
            next[run.id] = {
              answer: run.progress_valid,
              skip: run.progress_skipped || 0,
              error: run.progress_failed || 0,
              processed: run.progress_processed ?? run.progress_done,
              hydrated: true,
            };
          }
        }
        return next;
      });
    }
    if (p.error || r.error) setError(p.error || r.error || '');
    const status = await getCredentialStatus();
    if (status.success !== false) {
      const options = [];
      (status.directory || []).forEach((provider) => {
        if (!provider.configured || provider.authUnsupported) return;
        if (provider.shared && !provider.userConfigured) return;
        (provider.models || []).forEach((model) => {
          const vision = !!(model.vision || (model.input || []).includes('image'));
          if (!vision || !model.id) return;
          options.push({
            value: `${provider.id}::${model.id}`,
            provider: provider.id,
            model: model.id,
            label: `${provider.displayName} / ${model.label || model.name || model.id}`,
            reasoningEfforts: model.reasoningEfforts || false,
            defaultEffort: model.defaultEffort || '',
          });
        });
      });
      setVisionRoutes(options);
      const def = status.siliconRoute;
      if (def?.provider && def?.model) {
        setOverrideRoute((current) => {
          if (current) return current;
          setOverrideEffort(def.reasoningEffort || '');
          return `${def.provider}::${def.model}`;
        });
      }
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const names = supportedNames ? supportedNames.split('\0').filter(Boolean) : [];
    setSelectedQuestionNames((current) => {
      if (questionInitRef.current !== projectId) {
        questionInitRef.current = projectId;
        return names;
      }
      const valid = current.filter((name) => names.includes(name));
      return valid.length ? valid : names;
    });
  }, [projectId, supportedNames]);
  useEffect(() => {
    setSelectedIds([]);
    setCompare(null);
    setCompareCounts({});
    setError('');
    setBusy(false);
  }, [projectId]);

  const addPersona = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const result = await saveSiliconPersona({
      projectId,
      name: name.trim(),
      attributes: { city, notes },
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Could not save persona');
      return;
    }
    setName('');
    setCity('');
    setNotes('');
    refresh();
  };

  const togglePersona = (id) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const startRun = async () => {
    if (!selectedIds.length) {
      setError(t.siliconPickPersona);
      return;
    }
    if (!overrideRoute) {
      setError(t.modelsSelectVision);
      return;
    }
    if (hasUnsupported) {
      setError(t.siliconCannotStart);
      return;
    }
    if (hasNoSelectedQuestions) {
      setError(t.siliconSelectQuestions);
      return;
    }
    setBusy(true);
    setError('');
    const requestProjectId = projectId;
    const [provider, model] = String(overrideRoute || '').split('::');
    const created = await createSiliconRun({
      projectId,
      personaIds: selectedIds,
      repeats: Number(repeats) || 1,
      budgetTokens: Number(budgetTokens) || 25000,
      provider: provider || undefined,
      model: model || undefined,
      reasoningEffort: overrideEffort || undefined,
      questionNames: pretestNames,
    });
    if (!created.success) {
      setBusy(false);
      setError(t[MEDIA_ERROR[created.code]] || created.error || 'Could not start run');
      return;
    }
    if (projectIdRef.current !== requestProjectId) return;
    setBusy(false);
    refresh();
  };

  const resumeRun = async (runId) => {
    setBusy(true);
    setError('');
    const result = await resumeSiliconRun(runId);
    if (!result.success) setError(result.error || 'Could not resume run');
    setBusy(false);
    refresh();
  };

  const retryFailedRun = async (runId) => {
    setBusy(true);
    setError('');
    const result = await retryFailedSiliconRun(runId);
    if (!result.success) setError(result.error || 'Could not retry failed units');
    setBusy(false);
    refresh();
  };

  const downloadExport = async (runId) => {
    const payload = await exportSiliconRun(runId);
    if (!payload?.success) {
      setError(payload?.error || 'Export failed');
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `silicon-run-${runId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    if (payload.csv) {
      const csvBlob = new Blob([payload.csv], { type: 'text/csv;charset=utf-8' });
      const csvUrl = URL.createObjectURL(csvBlob);
      const csvLink = document.createElement('a');
      csvLink.href = csvUrl;
      csvLink.download = `silicon-run-${runId}.csv`;
      csvLink.click();
      URL.revokeObjectURL(csvUrl);
    }
  };

  if (!projectId) {
    return <Typography color="text.secondary">{t.noProjectBody}</Typography>;
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>{t.siliconPageTitle}</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>{t.siliconDisclaimer}</Alert>
      {error && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconRun}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t.siliconDraftVersion}: {currentProject?.draftUpdatedAt || currentProject?.updated_at || '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t.siliconModelLabel}: {selectedRoute?.label || t.modelsSelectVision}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t.siliconSelectedPersonas}: {selectedPersonas.length
              ? selectedPersonas.map((persona) => persona.name).join(', ')
              : t.siliconPickPersona}
          </Typography>
          {questionReport.supported.length === 0 && questionReport.unsupported.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t.siliconNoAnswerable}</Typography>
          ) : (
            <>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.siliconSupportedQs}</Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mb: 1 }}>
                {questionReport.supported.map((item) => (
                  <Chip
                    key={item.name}
                    size="small"
                    color={selectedQuestionNames.includes(item.name) ? 'primary' : 'default'}
                    onClick={() => setSelectedQuestionNames((current) => (
                      current.includes(item.name)
                        ? current.filter((name) => name !== item.name)
                        : [...current, item.name]
                    ))}
                    label={`${item.name} (${item.type})`}
                    sx={{ mb: 0.5 }}
                  />
                ))}
              </Stack>
              {questionReport.unverified?.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.siliconUnverifiedQs}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {questionReport.unverified.map((item) => `${item.name} (${item.type})`).join(', ')}
                  </Typography>
                </>
              )}
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.siliconUnsupportedQs}</Typography>
              {questionReport.unsupported.length === 0 ? (
                <Typography variant="body2" color="text.secondary">—</Typography>
              ) : (
                questionReport.unsupported.map((item) => (
                  <Typography key={item.name} variant="body2" color="warning.main">
                    {item.name} ({item.type}): {item.reason}
                  </Typography>
                ))
              )}
            </>
          )}
          {isPartialPretest && (
            <Alert severity="warning" sx={{ mt: 1 }}>{t.siliconPartialPretest}</Alert>
          )}
          {hasUnsupported && (
            <Alert severity="warning" sx={{ mt: 1 }}>{t.siliconCannotStart}</Alert>
          )}
        </CardContent>
      </Card>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconPersonas}</Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              <TextField size="small" label={t.siliconName} value={name} onChange={(e) => setName(e.target.value)} />
              <TextField size="small" label={t.siliconCity} value={city} onChange={(e) => setCity(e.target.value)} />
              <TextField size="small" label={t.siliconNotes} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
              <Button variant="outlined" onClick={addPersona} disabled={busy}>{t.siliconAddPersona}</Button>
            </Stack>
            {personas.map((p) => (
              <Stack key={p.id} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Chip
                  label={p.name}
                  color={selectedIds.includes(p.id) ? 'primary' : 'default'}
                  onClick={() => togglePersona(p.id)}
                />
                <Button size="small" color="error" onClick={() => deleteSiliconPersona(p.id).then(refresh)}>
                  {t.siliconRemove}
                </Button>
              </Stack>
            ))}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconRun}</Typography>
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <InputLabel>{t.siliconOverrideModel}</InputLabel>
              <Select
                label={t.siliconOverrideModel}
                value={visionRoutes.some((route) => route.value === overrideRoute) ? overrideRoute : ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setOverrideRoute(value);
                  const hit = visionRoutes.find((route) => route.value === value);
                  setOverrideEffort(hit?.defaultEffort || '');
                }}
              >
                <MenuItem value="" disabled>{t.modelsSelectVision}</MenuItem>
                {visionRoutes.map((route) => (
                  <MenuItem key={route.value} value={route.value}>{route.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {visionRoutes.find((route) => route.value === overrideRoute)?.reasoningEfforts && (
              <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t.siliconEffort}</InputLabel>
                <Select
                  label={t.siliconEffort}
                  value={overrideEffort}
                  onChange={(event) => setOverrideEffort(event.target.value)}
                >
                  {Object.keys(visionRoutes.find((route) => route.value === overrideRoute).reasoningEfforts).map((effort) => (
                    <MenuItem key={effort} value={effort}>{effort}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <TextField
              size="small"
              type="number"
              label={t.siliconRepeats}
              value={repeats}
              onChange={(e) => setRepeats(e.target.value)}
              sx={{ mb: 2, width: 140 }}
            />
            <TextField
              size="small"
              type="number"
              label={t.siliconBudget}
              value={budgetTokens}
              inputProps={{ min: 512, max: 100000, step: 1000 }}
              onChange={(e) => setBudgetTokens(e.target.value)}
              sx={{ mb: 2, ml: { xs: 0, sm: 1 }, width: 160 }}
            />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={startRun} disabled={busy || !overrideRoute || hasUnsupported || hasNoSelectedQuestions}>{t.siliconStart}</Button>
              <Typography variant="body2" color="text.secondary">
                {tf(t.siliconConfigSummary, startPlan)}
              </Typography>
            </Stack>
            {busy && <LinearProgress sx={{ mt: 2 }} />}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t.siliconNeedVlm}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t.siliconDraftSnapshot}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconRuns}</Typography>
          {(runs || []).map((run) => {
            const counts = compareCounts[run.id] || {};
            const outcome = siliconRunOutcome(run, counts);
            const progress = siliconRunCounts(run, counts);
            const plan = siliconRunPlan(run);
            const media = siliconMediaInfo(run);
            return (
              <Box key={run.id} sx={{ mb: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Chip size="small" label={t[STATUS_LABEL[outcome]] || run.status} />
                  <Typography variant="body2">
                    {run.model || '—'} · {tf(t.siliconConfigSummary, plan)}
                    {progress.ready
                      ? ` · ${tf(t.siliconProgressCounts, {
                        done: progress.processed,
                        total: progress.total,
                        answered: progress.valid,
                        skipped: progress.skipped,
                        errors: progress.failed,
                        remaining: Math.max(0, (progress.total || 0) - (progress.processed || 0)),
                      })}`
                      : ` · ${t.siliconStatusLoading}`}
                  </Typography>
                  {run.budget_tokens && (
                    <Typography variant="caption" color="text.secondary">
                      {tf(t.siliconBudgetUsage, { used: run.tokens_used || 0, budget: run.budget_tokens })}
                    </Typography>
                  )}
                  {['queued', 'draft', 'running', 'partial', 'failed', 'cancelled'].includes(run.status) && (
                    <>
                      <Button size="small" onClick={() => resumeRun(run.id)} disabled={busy} title={t.siliconResumeHint}>
                        {t.siliconResume}
                      </Button>
                      <Button size="small" onClick={() => retryFailedRun(run.id)} disabled={busy} title={t.siliconRetryHint}>
                        {t.siliconRetryFailed}
                      </Button>
                    </>
                  )}
                  {['queued', 'draft', 'running'].includes(run.status) && (
                    <Button size="small" onClick={() => cancelSiliconRun(run.id).then(refresh)}>{t.siliconCancel}</Button>
                  )}
                  <Button
                    size="small"
                    onClick={() => getSiliconCompare(run.id).then((c) => {
                      if (!c.success) return;
                      setCompare(c);
                      setCompareCounts((current) => ({ ...current, [run.id]: c.eventCounts || {} }));
                    })}
                  >
                    {t.siliconCompare}
                  </Button>
                  <Button size="small" onClick={() => downloadExport(run.id)}>{t.siliconExport}</Button>
                  {!['queued', 'draft', 'running'].includes(run.status) && (
                    <Button size="small" onClick={() => reuseRun(run)} disabled={busy} title={t.siliconReuseHint}>{t.siliconReuseSettings}</Button>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {t.siliconDraftVersion}: {run.draft_updated_at || '—'}
                  {' · '}
                  {media.source === 'preview_library'
                    ? tf(t.siliconMediaPreviewLibrary, { count: media.availableCount })
                    : media.source === 'none'
                      ? t.siliconMediaNone
                      : tf(t.siliconMediaProject, { count: media.availableCount })}
                </Typography>
                {run.error_summary && (
                  <Typography variant="caption" color="text.secondary">{run.error_summary}</Typography>
                )}
              </Box>
            );
          })}
          {compare && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="warning" sx={{ mb: 1 }}>{compare.disclaimer}</Alert>
              <Typography variant="body2" sx={{ mb: 1 }}>{t.siliconScienceNote}</Typography>
              <Typography variant="body2">{t.siliconCount}: {compare.responseCount}</Typography>
              {Object.entries(compare.byQuestion || {}).map(([q, rows]) => {
                const valid = rows.filter((row) => row.valid !== false && row.status !== 'error').length;
                return (
                  <Box key={q} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {q}: {rows.length} {t.siliconAnswers} · {t.siliconValidRate} {rows.length ? Math.round((valid / rows.length) * 100) : 0}%
                    </Typography>
                    {rows.slice(0, 4).map((row, index) => (
                      <Typography key={`${q}-${index}`} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {row.persona_name || row.persona_id || 'persona'}: {JSON.stringify(row.answer ?? row.value ?? row.responses?.[q] ?? row)}
                        {row.error ? ` · ${t.siliconFailureReason}: ${row.error}` : ''}
                        {row.images || row.displayed_images ? ` · ${t.siliconShownMedia}: ${JSON.stringify(row.images || row.displayed_images)}` : ''}
                      </Typography>
                    ))}
                  </Box>
                );
              })}
              {(compare.responses || []).map((row) => (
                <Button
                  key={row.id || row.participant_id}
                  size="small"
                  onClick={() => setOpenPersona(row)}
                  sx={{ mt: 0.5, mr: 0.5 }}
                >
                  {t.siliconOpenPersona}: {row.survey_metadata?.persona_name || row.persona_id}
                </Button>
              ))}
              {openPersona && (
                <Box sx={{ mt: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
                    {JSON.stringify(openPersona, null, 2)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
