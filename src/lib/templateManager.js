/**
 * File-based template manager for local self-hosted SP-Survey.
 */
import {
  loadTemplatesFromFiles,
  saveTemplateToFile,
  deleteTemplateFile,
} from './fileSystemManager';
import { isLocalSelfHosted, LOCAL_USER_ID } from './appMode';

export function templateImagePrefix(templateId) {
  return `templates/${templateId}/`;
}

export function normalizeTemplateId(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function isValidTemplateId(id) {
  if (!id || id.length > 96) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function buildTemplateIdBase({ name, author, year }) {
  const safeYear = (year || String(new Date().getFullYear())).toString().trim();
  const firstWord = (s, fallback) => {
    const word = (s || fallback).trim().split(/\s+/)[0]
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    return word || fallback;
  };
  const authorWord = firstWord(author, 'user');
  const nameWord = firstWord(name, 'template');
  return `${safeYear}-${authorWord}-${nameWord}`;
}

export async function findAvailableTemplateId(baseId) {
  const templates = await loadTemplatesFromFiles();
  const taken = new Set(templates.map((t) => t.id));
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}-${n}`)) n += 1;
  return `${baseId}-${n}`;
}

export async function listTemplates(_userId) {
  if (!isLocalSelfHosted()) return [];
  return loadTemplatesFromFiles();
}

export async function getTemplateById(id) {
  if (!id) return null;
  const templates = await loadTemplatesFromFiles();
  return templates.find((t) => t.id === id) || null;
}

export async function saveTemplateToSupabase(template) {
  const year = template.year || String(new Date().getFullYear());
  const author = template.author || 'User';
  const baseId = template.id || buildTemplateIdBase({ name: template.name, author, year });
  const id = await findAvailableTemplateId(baseId);

  const payload = {
    id,
    name: template.name || 'Untitled Template',
    description: template.description || '',
    author,
    year,
    category: template.category || 'Custom',
    tags: Array.isArray(template.tags) ? template.tags : [],
    website: template.website || null,
    huggingfaceDataset: template.huggingfaceDataset || null,
    config: template.config || {},
    preloadedImages: Array.isArray(template.preloadedImages) ? template.preloadedImages : [],
    preloadedAt: template.preloadedAt || null,
    preloadedSource: template.preloadedSource || null,
    user_id: LOCAL_USER_ID,
    is_approved: true,
    show_on_landing: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await saveTemplateToFile(payload);
  if (!result.success) throw new Error(result.error || 'Failed to save template');
  return { success: true, template: payload };
}

export async function deleteTemplate(id) {
  return deleteTemplateFile(id);
}

export async function checkIsAdmin() {
  return false;
}

export async function listAllTemplates() {
  return loadTemplatesFromFiles();
}

export async function listAllProjects() {
  return [];
}

export async function updateTemplate() {
  throw new Error('Template admin updates are not available in local mode');
}

export async function updateProjectAdmin() {
  throw new Error('Project admin updates are not available in local mode');
}

export async function deleteProjectAdmin() {
  throw new Error('Project admin delete is not available in local mode');
}

export async function renameTemplateId() {
  throw new Error('Template rename is not available in local mode');
}

export async function previewBuiltinTemplateImport() {
  return { toImport: [], skipped: [], conflicts: [] };
}

export async function seedBuiltinTemplates() {
  return { imported: 0, skipped: 0 };
}

export function resolveBuiltinTemplateId(tpl) {
  return tpl?.id || null;
}
