/**
 * Batch SAM Text across a media list — multi prompt→label jobs with
 * replace / skip / append-dedupe modes, checkpoints, and undo support.
 */
import { runSam3, instancesToPolygons } from './falInference';
import {
  loadPreannotation,
  savePreannotation,
  saveBatchRun,
  loadBatchRun,
  DEFAULT_SAM_LABELS,
  SAM_PREANNOT_MODEL,
  SHAPE_SOURCE_SAM_TEXT,
  newBatchRunId,
  newShapeId,
  withShapeProvenance,
} from './imageFeaturesR2';
import { normalizeMediaEntry } from './mediaUtils';
import {
  dedupeShapesByOverlap,
  isSamTextShapeForPrompt,
} from './annotationGeometry';

export const BATCH_MODE_REPLACE_SAME_PROMPT = 'replace_same_prompt';
export const BATCH_MODE_SKIP_COMPLETED = 'skip_completed';
export const BATCH_MODE_APPEND_DEDUPE = 'append_dedupe';

export const BATCH_MODES = [
  BATCH_MODE_REPLACE_SAME_PROMPT,
  BATCH_MODE_SKIP_COMPLETED,
  BATCH_MODE_APPEND_DEDUPE,
];

/** Normalize jobs: [{ prompt, label }] — drops incomplete rows. */
export function normalizeBatchSamJobs(jobs, { prompt, label } = {}) {
  let list = Array.isArray(jobs) ? jobs : [];
  if (!list.length && (prompt || label)) {
    list = [{ prompt, label }];
  }
  return list
    .map((j) => ({
      prompt: String(j?.prompt || '').trim(),
      label: String(j?.label || '').trim(),
    }))
    .filter((j) => j.prompt && j.label);
}

export function estimateBatchSamCalls(imageCount, jobCount) {
  const images = Math.max(0, Number(imageCount) || 0);
  const jobs = Math.max(0, Number(jobCount) || 0);
  return {
    images,
    jobs,
    calls: images * jobs,
    maxMasksPerCall: 32,
  };
}

function shapeMatchesPrompt(shape, prompt) {
  if (isSamTextShapeForPrompt(shape, prompt)) return true;
  // Legacy: no source — do not auto-replace (preserve manual / unknown).
  return false;
}

function imageHasPromptCompleted(shapes, prompt) {
  return (shapes || []).some((s) => shapeMatchesPrompt(s, prompt));
}

/**
 * @param {object} opts
 * @param {'replace_same_prompt'|'skip_completed'|'append_dedupe'} [opts.mode]
 * @param {string} [opts.batchRunId] - resume existing run
 * @param {boolean} [opts.retryFailuresOnly]
 */
export async function runBatchSamText({
  r2Prefix,
  mediaList = [],
  jobs,
  prompt,
  label,
  mode = BATCH_MODE_REPLACE_SAME_PROMPT,
  labelNames = DEFAULT_SAM_LABELS,
  falKey = '',
  projectId = '',
  maxAnnotations = 500,
  batchRunId: resumeId = null,
  retryFailuresOnly = false,
  scope = 'all',
  onProgress,
  shouldAbort,
  onItemSaved,
  onBatchCheckpoint,
} = {}) {
  const jobList = normalizeBatchSamJobs(jobs, { prompt, label });
  if (!jobList.length) {
    throw new Error('Add at least one Text noun + label pair before running.');
  }
  if (!r2Prefix) throw new Error('Missing R2 prefix.');
  const runMode = BATCH_MODES.includes(mode) ? mode : BATCH_MODE_REPLACE_SAME_PROMPT;

  const list = (mediaList || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url);
  const batchRunId = resumeId || newBatchRunId();
  let existingBatch = resumeId ? await loadBatchRun(r2Prefix, resumeId) : null;

  const completedNames = new Set(
    (existingBatch?.images || [])
      .filter((img) => img.status === 'done' || img.status === 'skipped')
      .map((img) => img.name),
  );
  const failureNames = new Set(
    (existingBatch?.failures || []).map((f) => f.name).filter(Boolean),
  );

  let targets = list;
  if (retryFailuresOnly && existingBatch) {
    targets = list.filter((m) => failureNames.has(m.name));
  } else if (resumeId && existingBatch) {
    targets = list.filter((m) => !completedNames.has(m.name));
  }

  const stepTotal = Math.max(1, targets.length * jobList.length);
  const summary = {
    batchRunId,
    mode: runMode,
    total: targets.length,
    jobs: jobList.length,
    steps: stepTotal,
    done: 0,
    imagesWithAdds: 0,
    polygonsAdded: 0,
    polygonsRemoved: 0,
    skipped: 0,
    zeroResult: 0,
    failed: 0,
    failures: [],
    byJob: jobList.map((j) => ({ ...j, polygonsAdded: 0, imagesWithAdds: 0 })),
    images: [...(existingBatch?.images || [])],
  };

  const batchDoc = {
    batchRunId,
    status: 'running',
    mode: runMode,
    scope,
    jobs: jobList,
    started_at: existingBatch?.started_at || new Date().toISOString(),
    media_names: list.map((m) => m.name),
    images: summary.images,
    failures: existingBatch?.failures || [],
    calls_estimate: estimateBatchSamCalls(targets.length, jobList.length),
  };

  await saveBatchRun(r2Prefix, batchDoc);
  onBatchCheckpoint?.(batchDoc);

  let step = 0;
  const tick = (extra = {}) => {
    step += 1;
    summary.done = step;
    onProgress?.({
      done: step,
      total: stepTotal,
      batchRunId,
      imageDone: Math.min(targets.length, Math.floor((step - 1) / Math.max(1, jobList.length)) + 1),
      imageTotal: targets.length,
      ...extra,
    });
  };

  const upsertImageRecord = (rec) => {
    const idx = summary.images.findIndex((x) => x.name === rec.name);
    if (idx >= 0) summary.images[idx] = { ...summary.images[idx], ...rec };
    else summary.images.push(rec);
  };

  for (let i = 0; i < targets.length; i += 1) {
    if (shouldAbort?.()) {
      summary.aborted = true;
      break;
    }
    const entry = targets[i];
    let shapes;
    let loadError = null;
    try {
      const existing = await loadPreannotation(r2Prefix, entry);
      shapes = Array.isArray(existing?.shapes) ? [...existing.shapes] : [];
    } catch (err) {
      loadError = err.message || String(err);
      summary.failed += 1;
      summary.failures.push({ name: entry.name, error: loadError, kind: 'load' });
      for (let j = 0; j < jobList.length; j += 1) {
        tick({
          name: entry.name,
          prompt: jobList[j].prompt,
          label: jobList[j].label,
          added: 0,
          error: loadError,
        });
      }
      upsertImageRecord({
        name: entry.name,
        url: entry.url,
        media_id: entry.media_id,
        folder: entry.folder || '',
        status: 'failed',
        error: loadError,
        addedShapeIds: [],
        removedShapes: [],
      });
      continue;
    }

    const removedForUndo = [];
    const addedIds = [];
    let imageAdded = 0;
    let imageError = null;
    let jobsSkipped = 0;

    for (let j = 0; j < jobList.length; j += 1) {
      if (shouldAbort?.()) {
        summary.aborted = true;
        break;
      }
      const job = jobList[j];

      if (runMode === BATCH_MODE_SKIP_COMPLETED && imageHasPromptCompleted(shapes, job.prompt)) {
        jobsSkipped += 1;
        tick({
          name: entry.name,
          prompt: job.prompt,
          label: job.label,
          added: 0,
          skipped: true,
        });
        continue;
      }

      if (runMode === BATCH_MODE_REPLACE_SAME_PROMPT) {
        const keep = [];
        shapes.forEach((s) => {
          if (shapeMatchesPrompt(s, job.prompt)) {
            removedForUndo.push(s);
            summary.polygonsRemoved += 1;
          } else {
            keep.push(s);
          }
        });
        shapes = keep;
      }

      const room = maxAnnotations > 0 ? Math.max(0, maxAnnotations - shapes.length) : Infinity;
      if (!room) {
        summary.skipped += 1;
        tick({
          name: entry.name,
          prompt: job.prompt,
          label: job.label,
          added: 0,
          error: 'annotation limit',
        });
        continue;
      }

      try {
        const result = await runSam3({
          falKey: falKey || undefined,
          projectId: projectId || undefined,
          imageUrl: entry.url,
          prompt: job.prompt,
        });
        const polys = await instancesToPolygons(result, { allowBoxFallback: true });
        const take = polys.slice(0, room === Infinity ? polys.length : room);
        if (!take.length) {
          summary.zeroResult += 1;
          tick({
            name: entry.name,
            prompt: job.prompt,
            label: job.label,
            added: 0,
            zero: true,
          });
          continue;
        }
        const added = take.map((points) => withShapeProvenance({
          id: newShapeId(),
          tool: 'polygon',
          points,
          label: job.label,
        }, {
          source: SHAPE_SOURCE_SAM_TEXT,
          prompt: job.prompt,
          batchRunId,
          model: SAM_PREANNOT_MODEL,
        }));
        shapes = [...shapes, ...added];
        added.forEach((s) => addedIds.push(s.id));
        imageAdded += added.length;
        summary.polygonsAdded += added.length;
        summary.byJob[j].polygonsAdded += added.length;
        summary.byJob[j].imagesWithAdds += 1;
        tick({
          name: entry.name,
          prompt: job.prompt,
          label: job.label,
          added: added.length,
        });
      } catch (err) {
        imageError = err.message || String(err);
        summary.failed += 1;
        summary.failures.push({
          name: entry.name,
          prompt: job.prompt,
          label: job.label,
          error: imageError,
          kind: 'sam',
        });
        tick({
          name: entry.name,
          prompt: job.prompt,
          label: job.label,
          added: 0,
          error: imageError,
        });
      }
    }

    if (runMode === BATCH_MODE_APPEND_DEDUPE || runMode === BATCH_MODE_REPLACE_SAME_PROMPT) {
      const beforeIds = new Set(shapes.map((s) => s.id));
      const { shapes: deduped, removedIds } = dedupeShapesByOverlap(shapes, { iouThreshold: 0.7 });
      if (removedIds.length) {
        // Prefer dropping newly added duplicates.
        const dropNew = removedIds.filter((id) => addedIds.includes(id));
        const dropSet = new Set(dropNew.length ? dropNew : removedIds);
        shapes = shapes.filter((s) => !dropSet.has(s.id));
        dropSet.forEach((id) => {
          const idx = addedIds.indexOf(id);
          if (idx >= 0) addedIds.splice(idx, 1);
        });
        summary.polygonsAdded = Math.max(0, summary.polygonsAdded - dropSet.size);
      } else if (deduped.length < beforeIds.size) {
        shapes = deduped;
      }
    }

    // Always save when we mutated shapes OR abort mid-image with partial adds.
    const shouldSave = imageAdded > 0 || removedForUndo.length > 0 || (summary.aborted && addedIds.length);
    if (shouldSave) {
      try {
        const saved = await savePreannotation(r2Prefix, entry, {
          image: entry.url,
          shapes,
          labels: labelNames.length ? labelNames : DEFAULT_SAM_LABELS,
          review_status: 'needs_review',
        });
        onItemSaved?.(saved, entry);
        if (imageAdded > 0) summary.imagesWithAdds += 1;
        upsertImageRecord({
          name: entry.name,
          url: entry.url,
          media_id: entry.media_id,
          folder: entry.folder || '',
          status: imageError ? 'partial' : 'done',
          error: imageError || null,
          addedShapeIds: addedIds,
          removedShapes: removedForUndo,
          polygonsAdded: imageAdded,
        });
      } catch (err) {
        summary.failed += 1;
        summary.failures.push({ name: entry.name, error: err.message || String(err), kind: 'save' });
        upsertImageRecord({
          name: entry.name,
          url: entry.url,
          media_id: entry.media_id,
          folder: entry.folder || '',
          status: 'failed',
          error: err.message || String(err),
          addedShapeIds: addedIds,
          removedShapes: removedForUndo,
        });
      }
    } else if (!imageError) {
      summary.skipped += 1;
      upsertImageRecord({
        name: entry.name,
        url: entry.url,
        media_id: entry.media_id,
        folder: entry.folder || '',
        status: jobsSkipped === jobList.length ? 'skipped' : 'zero',
        addedShapeIds: [],
        removedShapes: [],
        polygonsAdded: 0,
      });
    }

    // Checkpoint after each image
    batchDoc.images = summary.images;
    batchDoc.failures = summary.failures;
    batchDoc.progress = {
      done: summary.done,
      total: stepTotal,
      imagesDone: i + 1,
      imagesTotal: targets.length,
    };
    batchDoc.status = summary.aborted ? 'aborted' : 'running';
    // eslint-disable-next-line no-await-in-loop
    await saveBatchRun(r2Prefix, batchDoc);
    onBatchCheckpoint?.(batchDoc);

    if (summary.aborted) break;
  }

  batchDoc.status = summary.aborted ? 'aborted' : (summary.failed && !summary.imagesWithAdds ? 'failed' : 'completed');
  batchDoc.finished_at = new Date().toISOString();
  batchDoc.summary = {
    polygonsAdded: summary.polygonsAdded,
    polygonsRemoved: summary.polygonsRemoved,
    imagesWithAdds: summary.imagesWithAdds,
    skipped: summary.skipped,
    zeroResult: summary.zeroResult,
    failed: summary.failed,
  };
  batchDoc.images = summary.images;
  batchDoc.failures = summary.failures;
  const savedBatch = await saveBatchRun(r2Prefix, batchDoc);
  onBatchCheckpoint?.(savedBatch);

  return { ...summary, batch: savedBatch };
}

export { loadBatchRun, undoBatchRun, acceptBatchRun } from './imageFeaturesR2';
