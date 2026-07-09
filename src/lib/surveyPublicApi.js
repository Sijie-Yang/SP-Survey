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

/** Anonymous RPC: per-image exposure / win stats for adaptive pairing. */
export async function fetchPairStats(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('get_pair_stats', { p_project_id: projectId });
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      const key = row.image_key || row.imageKey;
      if (!key) return;
      map[key] = {
        exposures: Number(row.exposures) || 0,
        wins: Number(row.wins) || 0,
        losses: Number(row.losses) || 0,
        mu: row.mu != null ? Number(row.mu) : 25,
      };
    });
    return map;
  } catch (err) {
    console.warn('fetchPairStats failed:', err.message);
    return null;
  }
}
