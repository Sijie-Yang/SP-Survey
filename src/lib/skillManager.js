/**
 * question_skills CRUD — local file storage for self-hosted SP-Survey.
 */
import { PRESET_SKILLS, getPresetSkill } from './presetSkills';
import { LOCAL_USER_ID } from './appMode';
import { API_BASE_URL } from './apiConfig';

function rowToSkill(row) {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    user_id: row.user_id || LOCAL_USER_ID,
    submitter_email: row.submitter_email || null,
    sourceHtml: row.source_html || row.sourceHtml || '',
    configSchema: row.config_schema || row.configSchema || [],
    defaultConfig: row.default_config || row.defaultConfig || {},
    resultSchema: row.result_schema || row.resultSchema || [],
    is_approved: row.is_approved ?? true,
    submittedAt: row.submitted_at || row.submittedAt || null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function skillToRow(skill) {
  return {
    id: skill.id,
    name: skill.name || 'Untitled Skill',
    description: skill.description || '',
    source_html: skill.sourceHtml || '',
    config_schema: skill.configSchema || [],
    default_config: skill.defaultConfig || {},
    result_schema: skill.resultSchema || [],
    user_id: LOCAL_USER_ID,
    submitter_email: skill.submitter_email || null,
    is_approved: skill.is_approved ?? true,
    submitted_at: skill.submittedAt || null,
    created_at: skill.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function apiListSkills() {
  const res = await fetch(`${API_BASE_URL}/api/skills`);
  const data = await res.json();
  return (data.skills || []).map(rowToSkill);
}

async function apiSaveSkill(row) {
  const res = await fetch(`${API_BASE_URL}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: row }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Save failed');
  return rowToSkill(data.skill || row);
}

async function apiDeleteSkill(id) {
  const res = await fetch(`${API_BASE_URL}/api/skills/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Delete failed');
}

export function getSkillStatus(skill) {
  if (skill.is_approved) return 'approved';
  if (skill.submittedAt) return 'pending';
  return 'draft';
}

export async function listApprovedSkills() {
  const skills = await apiListSkills();
  return skills.filter((s) => s.is_approved);
}

export async function listMySkills() {
  return apiListSkills();
}

export async function listSkillsForBuilder() {
  const skills = await apiListSkills();
  return skills.map((s) => ({ ...s, scope: 'mine' }));
}

export async function listSubmittedSkills() {
  return [];
}

export async function listAllSkills() {
  return listSubmittedSkills();
}

export async function saveSkill(skill) {
  const id = skill.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const row = skillToRow({ ...skill, id });
  const saved = await apiSaveSkill(row);
  return { success: true, skill: saved };
}

export async function submitSkillForReview(id) {
  const existing = await getSkillById(id);
  if (!existing) throw new Error('Skill not found');
  const row = skillToRow({ ...existing, submittedAt: new Date().toISOString(), is_approved: true });
  await apiSaveSkill(row);
  return { success: true };
}

export async function updateSkill(id, updates) {
  const existing = await getSkillById(id);
  if (!existing) throw new Error('Skill not found');
  const merged = { ...existing, ...updates };
  if ('source_html' in updates) merged.sourceHtml = updates.source_html;
  if ('config_schema' in updates) merged.configSchema = updates.config_schema;
  if ('default_config' in updates) merged.defaultConfig = updates.default_config;
  if ('result_schema' in updates) merged.resultSchema = updates.result_schema;
  await apiSaveSkill(skillToRow(merged));
  return { success: true };
}

export async function deleteSkill(id) {
  await apiDeleteSkill(id);
  return { success: true };
}

export async function getSkillById(id) {
  if (!id) return null;
  const skills = await apiListSkills();
  return skills.find((s) => s.id === id) || null;
}

export async function importPresetSkill(presetId) {
  const preset = getPresetSkill(presetId);
  if (!preset) throw new Error('Preset not found');
  const stableId = `preset_${presetId}`;
  const existing = await getSkillById(stableId);
  const result = await saveSkill({
    id: stableId,
    name: preset.name,
    description: preset.description,
    sourceHtml: preset.sourceHtml,
    configSchema: preset.configSchema,
    defaultConfig: preset.defaultConfig,
    resultSchema: preset.resultSchema || [],
    is_approved: true,
  });
  return { ...result, alreadyExists: !!existing, updated: !!existing };
}

export async function listImportedPresetIds() {
  const mine = await listMySkills();
  return mine.filter((s) => s.id.startsWith('preset_')).map((s) => s.id.replace(/^preset_/, ''));
}

export { PRESET_SKILLS };
