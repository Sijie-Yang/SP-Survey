/**
 * The dataset form (title, authors, license…) is kept in the project's
 * metadata (datasetRelease), so the next package starts from the same values.
 */
import { supabase } from './supabase';

export async function saveDatasetRelease(projectId, meta) {
  if (!supabase || !projectId) throw new Error('Sign in to save the dataset details.');
  const { data, error } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
  if (error) throw error;
  const metadata = data?.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {};
  metadata.datasetRelease = { ...meta, updatedAt: new Date().toISOString() };
  const { error: updateError } = await supabase.from('projects').update({ metadata }).eq('id', projectId);
  if (updateError) throw updateError;
  return metadata;
}
