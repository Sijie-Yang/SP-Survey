/**
 * Published SP-Bench tasks live in the project's metadata (spBenchTasks,
 * keyed by task id), frozen at the moment the owner publishes them.
 */
import { supabase } from './supabase';

export function readBenchTasks(project) {
  const stored = project?.metadata?.spBenchTasks;
  return stored && typeof stored === 'object' ? stored : {};
}

/** `changes` = { [taskId]: task | null }; null removes the task. */
export async function saveBenchTasks(projectId, changes) {
  if (!supabase || !projectId) throw new Error('Sign in to publish a task.');
  const { data, error } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
  if (error) throw error;
  const metadata = data?.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {};
  const tasks = { ...readBenchTasks({ metadata }) };
  for (const [id, task] of Object.entries(changes || {})) {
    if (task) tasks[id] = task;
    else delete tasks[id];
  }
  if (Object.keys(tasks).length) metadata.spBenchTasks = tasks;
  else delete metadata.spBenchTasks;
  const { error: updateError } = await supabase.from('projects').update({ metadata }).eq('id', projectId);
  if (updateError) throw updateError;
  return metadata;
}
