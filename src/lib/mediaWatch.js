// Watch-before-answering (S7): per-question playback log for response metadata.

let store = {};

export function watchGateSettings(question) {
  const requireEnded = !!(question?.requireMediaEnded ?? question?.jsonObj?.requireMediaEnded);
  const raw = Number(question?.minWatchSeconds ?? question?.jsonObj?.minWatchSeconds);
  const minSeconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 600) : 0;
  return { requireEnded, minSeconds, active: requireEnded || minSeconds > 0 };
}

export function recordMediaWatch(questionName, trialIndex, entries) {
  if (!questionName) return;
  const q = store[questionName] || (store[questionName] = {});
  q[String(trialIndex ?? 0)] = entries;
}

/** { [question]: [{ trial_index, media: [{ url, watched_seconds, ended, duration }] , unlocked_after_seconds }] } */
export function getMediaWatchLog() {
  const out = {};
  Object.entries(store).forEach(([name, trials]) => {
    out[name] = Object.entries(trials)
      .map(([trial, entry]) => ({ trial_index: Number(trial), ...entry }))
      .sort((a, b) => a.trial_index - b.trial_index);
  });
  return out;
}

export function clearMediaWatchLog() {
  store = {};
}

export function mediaWatchMetadata() {
  const log = getMediaWatchLog();
  return Object.keys(log).length ? { media_watch: log } : {};
}
