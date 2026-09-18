import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSiliconRun,
  createSiliconRun,
  getSiliconProgress,
  listSiliconResponses,
  listSiliconTasks,
  resumeSiliconRun,
  retryFailedSiliconRun,
} from '../lib/agentApi';

const ACTIVE = new Set(['queued', 'draft', 'running']);

export function useSiliconTasks({
  enabled = true,
  watch = false,
  pollMs = 1500,
  onTerminal = null,
} = {}) {
  const [active, setActive] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState('ok');
  const [detail, setDetail] = useState(null);
  const [responses, setResponses] = useState(null);
  const afterRef = useRef(0);
  const knownActiveRef = useRef(new Set());
  const notifiedRef = useRef(new Set());
  const [viewingRunId, setViewingRunId] = useState(null);
  const viewingRunIdRef = useRef(null);
  viewingRunIdRef.current = viewingRunId;
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  const refreshList = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await listSiliconTasks();
      if (!result?.success) {
        setConnection('offline');
        setLoading(false);
        return;
      }
      setConnection('ok');
      const nextActive = result.active || [];
      const prev = knownActiveRef.current;
      const nextIds = new Set(nextActive.map((run) => run.id));
      for (const id of prev) {
        if (nextIds.has(id)) continue;
        const finished = (result.recent || []).find((run) => run.id === id);
        if (finished && !notifiedRef.current.has(id)) {
          notifiedRef.current.add(id);
          onTerminalRef.current?.(finished);
        }
      }
      knownActiveRef.current = nextIds;
      setActive(nextActive);
      setRecent(result.recent || []);
      setLoading(false);
    } catch {
      setConnection('offline');
      setLoading(false);
    }
  }, [enabled]);

  const refreshDetail = useCallback(async (runId) => {
    if (!runId) return;
    try {
      const result = await getSiliconProgress(runId, afterRef.current);
      if (viewingRunIdRef.current !== runId) return;
      if (!result?.success) {
        setConnection('offline');
        return;
      }
      setConnection('ok');
      setDetail((current) => {
        const events = afterRef.current
          ? [...(current?.events || []), ...(result.events || [])]
          : (result.events || []);
        return {
          run: result.run,
          counts: result.counts,
          current_stage: result.current_stage,
          events,
          units: result.units || [],
          nextCursor: result.nextCursor,
        };
      });
      afterRef.current = Number(result.nextCursor || afterRef.current || 0);
    } catch {
      setConnection('offline');
    }
  }, []);

  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!enabled || !pageVisible) return undefined;
    refreshList();
    return undefined;
  }, [enabled, pageVisible, watch, refreshList]);

  useEffect(() => {
    if (!enabled || !pageVisible) return undefined;
    if (!watch && knownActiveRef.current.size === 0) return undefined;
    const timer = setInterval(refreshList, Math.max(1500, pollMs));
    return () => clearInterval(timer);
  }, [enabled, pageVisible, watch, pollMs, refreshList, active.length]);

  useEffect(() => {
    if (!enabled || !viewingRunId) return undefined;
    refreshDetail(viewingRunId);
    const timer = setInterval(() => refreshDetail(viewingRunId), Math.max(1000, pollMs));
    return () => clearInterval(timer);
  }, [enabled, pollMs, refreshDetail, viewingRunId]);

  const openDetail = useCallback(async (runId) => {
    afterRef.current = 0;
    setResponses(null);
    setViewingRunId(runId);
    const listed = [...active, ...recent].find((run) => run.id === runId) || { id: runId };
    setDetail({ run: listed, counts: null, current_stage: listed.current_stage || null, events: [], units: [] });
    await refreshDetail(runId);
  }, [active, recent, refreshDetail]);

  const closeDetail = useCallback(() => {
    afterRef.current = 0;
    setViewingRunId(null);
    setDetail(null);
    setResponses(null);
  }, []);

  const loadResponses = useCallback(async (runId) => {
    const result = await listSiliconResponses(runId);
    if (result?.success) setResponses(result.responses || []);
    return result;
  }, []);

  const stop = useCallback(async (runId) => {
    const result = await cancelSiliconRun(runId);
    await refreshList();
    if (viewingRunId === runId) await refreshDetail(runId);
    return result;
  }, [refreshDetail, refreshList, viewingRunId]);

  const resume = useCallback(async (runId) => {
    const result = await resumeSiliconRun(runId);
    await refreshList();
    if (viewingRunId === runId) await refreshDetail(runId);
    return result;
  }, [refreshDetail, refreshList, viewingRunId]);

  const retryFailed = useCallback(async (runId) => {
    const result = await retryFailedSiliconRun(runId);
    await refreshList();
    if (viewingRunId === runId) await refreshDetail(runId);
    return result;
  }, [refreshDetail, refreshList, viewingRunId]);

  const reuse = useCallback(async (run) => {
    if (!run?.project_id) return { success: false, error: 'projectId is required' };
    const created = await createSiliconRun({
      projectId: run.project_id,
      personaIds: run.persona_ids || [],
      repeats: Number(run.repeats || 1),
      budgetTokens: run.budget_tokens,
      provider: run.provider,
      model: run.model,
      reasoningEffort: run.reasoning_effort,
      questionNames: run.question_names,
    });
    await refreshList();
    if (created?.success && created.run?.id) {
      afterRef.current = 0;
      setResponses(null);
      setViewingRunId(created.run.id);
      setDetail({ run: created.run, counts: null, current_stage: null, events: [], units: [] });
      await refreshDetail(created.run.id);
    }
    return created;
  }, [refreshDetail, refreshList]);

  return {
    active,
    recent,
    activeCount: active.length,
    loading,
    connection,
    detail,
    responses,
    viewingRunId,
    openDetail,
    closeDetail,
    loadResponses,
    stop,
    resume,
    retryFailed,
    reuse,
    refresh: refreshList,
    isActive: (run) => ACTIVE.has(run?.status) || Boolean(run?.cancel_requested && run?.status === 'running'),
  };
}
