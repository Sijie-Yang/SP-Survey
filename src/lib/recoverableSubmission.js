import { savePendingSubmission } from './surveyDraft';

export async function submitWithRecovery(projectId, completeData, meta, send, timeoutMs = 30000) {
  const recoverySaved = savePendingSubmission(projectId, completeData.participant_id, completeData, meta);
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => send(completeData)).catch((error) => ({ success: false, error })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ success: false, error: new Error('Submission confirmation timed out') }), timeoutMs); }),
    ]);
    return { ...result, recoverySaved };
  } finally { clearTimeout(timer); }
}
