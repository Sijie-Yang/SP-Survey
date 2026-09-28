import { supabase } from './supabase';
import { API_BASE_URL } from './apiConfig';

const FILE_SERVER = process.env.REACT_APP_SERVER_URL || API_BASE_URL;

/**
 * Delete one survey response (Supabase row or local JSON file).
 * @param {{ id?: number|string, filename?: string, projectId?: string }} params
 */
export async function deleteSurveyResponse({ id, filename, projectId }) {
  if (supabase && id != null) {
    let query = supabase.from('survey_responses').delete().eq('id', id);
    if (projectId) query = query.eq('project_id', projectId);
    const { error } = await query;
    if (error) throw new Error(error.message || 'Failed to delete response');
    return { success: true, storage: 'supabase' };
  }

  if (filename) {
    const res = await fetch(
      `${FILE_SERVER}/api/responses/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error ? `: ${body.error}` : '';
      } catch {
        /* ignore */
      }
      throw new Error(`Delete failed (HTTP ${res.status})${detail}`);
    }
    return { success: true, storage: 'file' };
  }

  throw new Error('Cannot delete response: missing record id');
}

export { responseRecordKey } from './responseIdentity';
