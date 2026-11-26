import { supabase } from './supabase';

/** Anonymous RPC: count completed responses for a project (quota check). */
export async function countProjectResponses(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('count_responses', { p_project_id: projectId });
    if (error) throw error;
    return typeof data === 'number' ? data : Number(data) || 0;
  } catch (err) {
    console.warn('countProjectResponses failed:', err.message);
    return null;
  }
}

/** Anonymous RPC: completed responses per condition; null when unavailable (falls back to weighted random). */
export async function fetchConditionCounts(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('count_condition_responses', { p_project_id: projectId });
    if (error) throw error;
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('fetchConditionCounts failed:', err.message);
    return null;
  }
}

/**
 * Anonymous RPC: this participant's number for balanced sampling (the smallest number nobody
 * has finished or is working on). null when supabase/balanced_draws.sql is not installed or
 * the call fails; the caller then picks a number itself, which is plain random sampling.
 */
export async function claimBalanceNumber(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('claim_balance_number', { p_project_id: projectId });
    if (error) throw error;
    const n = Number(data?.n);
    if (!Number.isInteger(n) || n < 0) return null;
    return { n, claimId: data?.claim_id ? String(data.claim_id) : null };
  } catch (err) {
    console.warn('claimBalanceNumber failed:', err.message);
    return null;
  }
}

/**
 * Anonymous RPC: has this recruitment-platform participant already completed the project?
 * null when the check is unavailable (supabase/recruitment.sql not run, offline); the
 * submission RPC still keeps only one response per platform id.
 */
export async function recruitmentParticipantDone(projectId, platform, participant) {
  if (!supabase || !projectId || !platform || !participant) return null;
  try {
    const { data, error } = await supabase.rpc('recruitment_participant_done', {
      p_project_id: projectId, p_platform: platform, p_participant: participant,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.warn('recruitmentParticipantDone failed:', err.message);
    return null;
  }
}

/**
 * Anonymous RPC: this participant finished, so their number is never handed out again.
 * The database also does this by itself when the response is stored on the platform;
 * this call covers projects that store responses elsewhere.
 */
export async function completeBalanceClaim(claimId) {
  if (!supabase || !claimId) return false;
  try {
    const { error } = await supabase.rpc('complete_balance_claim', { p_claim_id: claimId });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('completeBalanceClaim failed:', err.message);
    return false;
  }
}
