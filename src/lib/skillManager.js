/**
 * question_skills CRUD — local file storage for self-hosted SP-Survey.
 * Keeps exampleAnswer, contractVersion, revision history; honors revision on get.
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
    analysisHtml: row.analysis_html || row.analysisHtml || '',
    configSchema: row.config_schema || row.configSchema || [],
    defaultConfig: row.default_config || row.defaultConfig || {},
    resultSchema: row.result_schema || row.resultSchema || [],
    exampleAnswer: row.example_answer ?? row.exampleAnswer ?? null,
    contractVersion: Number(row.contract_version ?? row.contractVersion) || 0,
    currentRevision: Number(row.current_revision ?? row.currentRevision) || 1,
    versions: Array.isArray(row.versions) ? row.versions : [],
    is_approved: row.is_approved ?? true,
    submittedAt: row.submitted_at || row.submittedAt || null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function snapshotFromSkill(skill, revision) {
  return {
    revision,
    name: skill.name,
    description: skill.description,
    source_html: skill.sourceHtml,
    analysis_html: skill.analysisHtml,
    config_schema: skill.configSchema,
    default_config: skill.defaultConfig,
    result_schema: skill.resultSchema,
    example_answer: skill.exampleAnswer,
    contract_version: skill.contractVersion,
    created_at: skill.updatedAt || new Date().toISOString(),
  };
}

function applyVersion(skill, version) {
  return {
    ...skill,
    name: version.name ?? skill.name,
    description: version.description ?? skill.description,
    sourceHtml: version.source_html ?? version.sourceHtml ?? skill.sourceHtml,
    analysisHtml: version.analysis_html ?? version.analysisHtml ?? skill.analysisHtml,
    configSchema: version.config_schema ?? version.configSchema ?? skill.configSchema,
    defaultConfig: version.default_config ?? version.defaultConfig ?? skill.defaultConfig,
    resultSchema: version.result_schema ?? version.resultSchema ?? skill.resultSchema,
    exampleAnswer: version.example_answer ?? version.exampleAnswer ?? skill.exampleAnswer,
    contractVersion: Number(version.contract_version ?? version.contractVersion ?? skill.contractVersion) || 0,
    revision: Number(version.revision) || skill.currentRevision,
  };
}

function skillToRow(skill) {
  return {
    id: skill.id,
    name: skill.name || 'Untitled Skill',
    description: skill.description || '',
    source_html: skill.sourceHtml || '',
    analysis_html: skill.analysisHtml || '',
    config_schema: skill.configSchema || [],
    default_config: skill.defaultConfig || {},
    result_schema: skill.resultSchema || [],
    example_answer: skill.exampleAnswer ?? null,
    contract_version: Number(skill.contractVersion) || 0,
    current_revision: Number(skill.currentRevision) || 1,
    versions: Array.isArray(skill.versions) ? skill.versions : [],
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
  const { prepareSkillForSave } = await import('./skillHtmlValidate');
  const prepared = prepareSkillForSave({ ...skill, contractVersion: 1 });
  if (!prepared.ok) {
    throw new Error(prepared.errors.join(' '));
  }

  const existing = skill.id ? await getSkillById(skill.id) : null;
  const id = skill.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const unchanged = existing
    && existing.name === (prepared.skill.name || skill.name || 'Untitled Skill')
    && existing.description === (prepared.skill.description || skill.description || '')
    && existing.sourceHtml === prepared.skill.sourceHtml
    && existing.analysisHtml === prepared.skill.analysisHtml
    && sameJson(existing.configSchema, prepared.skill.configSchema)
    && sameJson(existing.defaultConfig, prepared.skill.defaultConfig)
    && sameJson(existing.resultSchema, prepared.skill.resultSchema)
    && sameJson(existing.exampleAnswer, prepared.skill.exampleAnswer);
  if (unchanged) {
    return { success: true, skill: { ...existing, revision: existing.currentRevision }, warnings: prepared.warnings };
  }

  const revision = existing ? (Number(existing.currentRevision) || 1) + 1 : 1;
  const versions = existing ? [...(existing.versions || [])] : [];
  if (existing) {
    versions.push(snapshotFromSkill(existing, existing.currentRevision || 1));
  }

  const row = skillToRow({
    ...prepared.skill,
    id,
    name: prepared.skill.name || skill.name || 'Untitled Skill',
    description: prepared.skill.description || skill.description || '',
    contractVersion: 1,
    currentRevision: revision,
    versions,
    is_approved: existing?.is_approved ?? true,
    submittedAt: existing?.submittedAt ?? null,
    createdAt: existing?.createdAt,
    submitter_email: existing?.submitter_email || skill.submitter_email || null,
  });
  const saved = await apiSaveSkill(row);
  return {
    success: true,
    skill: { ...saved, revision },
    warnings: prepared.warnings,
  };
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
  if ('analysis_html' in updates) merged.analysisHtml = updates.analysis_html;
  if ('config_schema' in updates) merged.configSchema = updates.config_schema;
  if ('default_config' in updates) merged.defaultConfig = updates.default_config;
  if ('result_schema' in updates) merged.resultSchema = updates.result_schema;
  if ('example_answer' in updates) merged.exampleAnswer = updates.example_answer;
  if ('contract_version' in updates) merged.contractVersion = updates.contract_version;
  await apiSaveSkill(skillToRow(merged));
  return { success: true };
}

export async function deleteSkill(id) {
  await apiDeleteSkill(id);
  return { success: true };
}

export async function getSkillById(id, revision = null) {
  if (!id) return null;
  const skills = await apiListSkills();
  const skill = skills.find((s) => s.id === id) || null;
  if (!skill) return null;
  const current = Number(skill.currentRevision) || 1;
  if (revision == null || Number(revision) === current) {
    return { ...skill, revision: Number(revision) || current };
  }
  const version = (skill.versions || []).find((v) => Number(v.revision) === Number(revision));
  if (!version) return null;
  return applyVersion(skill, version);
}

export async function importPresetSkill(presetId) {
  const preset = getPresetSkill(presetId);
  if (!preset) throw new Error('Preset not found');
  const stableId = `preset_${presetId}`;
  const existing = await getSkillById(stableId);
  const { buildSyntheticAnalysisResponses } = await import('./skillSdk');
  const exampleAnswer = buildSyntheticAnalysisResponses(
    preset.resultSchema || [],
    [{ url: 'https://example.invalid/stimulus.jpg', name: 'stimulus.jpg', type: preset.defaultConfig?.mediaType || 'image' }],
    1,
  )[0]?.answer || { value: true };
  const result = await saveSkill({
    id: stableId,
    name: preset.name,
    description: preset.description,
    sourceHtml: preset.sourceHtml,
    configSchema: preset.configSchema,
    defaultConfig: preset.defaultConfig,
    resultSchema: preset.resultSchema || [],
    exampleAnswer,
  });
  return { ...result, alreadyExists: !!existing, updated: !!existing };
}

export async function listImportedPresetIds() {
  const mine = await listMySkills();
  return mine.filter((s) => s.id.startsWith('preset_')).map((s) => s.id.replace(/^preset_/, ''));
}

export { PRESET_SKILLS };
