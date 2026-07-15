/**
 * Supabase Storage adapter with an R2-compatible API for self-hosted SP-Survey.
 * Platform uses Cloudflare R2; local deployments use Supabase Storage instead.
 */
import { supabase, isSupabaseConfigured, reinitializeSupabase } from './supabase';

const BUCKET = 'survey-images';

export const isR2Configured = () => isSupabaseConfigured();

export const isMediaStorageConfigured = isR2Configured;

function ensureClient() {
  reinitializeSupabase();
  if (!supabase) throw new Error('Supabase is not configured. Set credentials in Server Setup.');
  return supabase;
}

function publicUrl(client, key) {
  const { data } = client.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

async function ensureBucket(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw error;
  if (!buckets?.find((b) => b.name === BUCKET)) {
    const { error: createError } = await client.storage.createBucket(BUCKET, { public: true });
    if (createError && !/already exists/i.test(createError.message)) throw createError;
  }
}

function inferContentType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
    webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

async function listAll(prefix = '') {
  const client = ensureClient();
  await ensureBucket(client);
  const { data, error } = await client.storage.from(BUCKET).list(prefix, {
    limit: 10000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  return data || [];
}

export async function uploadImageToR2(fileOrBlob, key) {
  try {
    const client = ensureClient();
    await ensureBucket(client);
    const contentType = fileOrBlob.type || inferContentType(key);
    const body = fileOrBlob instanceof Blob ? fileOrBlob : fileOrBlob;
    const { error } = await client.storage.from(BUCKET).upload(key, body, {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });
    if (error) throw error;
    return { success: true, url: publicUrl(client, key), key };
  } catch (error) {
    console.error('uploadImageToR2 (Supabase):', error);
    return { success: false, error: error.message };
  }
}

export async function deleteImagesFromR2(keys) {
  try {
    const client = ensureClient();
    const list = (keys || []).filter(Boolean);
    if (!list.length) return { success: true };
    const { error } = await client.storage.from(BUCKET).remove(list);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('deleteImagesFromR2 (Supabase):', error);
    return { success: false, error: error.message };
  }
}

async function listImagesRecursive(client, pathPrefix = '', acc = []) {
  const listPath = pathPrefix.replace(/\/$/, '');
  const { data, error } = await client.storage.from(BUCKET).list(listPath || '', {
    limit: 10000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;

  for (const f of data || []) {
    if (!f?.name || f.name.startsWith('.')) continue;
    const key = listPath ? `${listPath}/${f.name}` : f.name;
    // Supabase folders have null id; files have a uuid
    if (f.id == null) {
      await listImagesRecursive(client, key, acc);
      continue;
    }
    acc.push({
      key,
      name: f.name,
      url: publicUrl(client, key),
      size: f.metadata?.size || 0,
      lastModified: f.updated_at || f.created_at,
    });
  }
  return acc;
}

export async function listImagesFromR2(prefix = '') {
  try {
    const client = ensureClient();
    await ensureBucket(client);
    const normalized = (prefix || '').replace(/\/$/, '');
    const images = await listImagesRecursive(client, normalized, []);
    return { success: true, images, objects: images };
  } catch (error) {
    console.error('listImagesFromR2 (Supabase):', error);
    return { success: false, images: [], objects: [], error: error.message };
  }
}

export function projectR2Prefix(userId, projectId) {
  if (!userId || !projectId) return '';
  return `${userId}/${projectId}/`;
}

export async function copyImagesInR2(items, { onProgress } = {}) {
  try {
    const client = ensureClient();
    await ensureBucket(client);
    const copied = [];
    const errors = [];
    for (let i = 0; i < items.length; i += 1) {
      const from = items[i].from || items[i].sourceKey;
      const to = items[i].to || items[i].destKey;
      if (!from || !to) {
        errors.push({ from, to, error: 'Missing storage key' });
        continue;
      }
      try {
        const { data, error } = await client.storage.from(BUCKET).download(from);
        if (error) throw error;
        const contentType = inferContentType(to);
        const { error: uploadError } = await client.storage.from(BUCKET).upload(to, data, {
          cacheControl: '3600',
          upsert: true,
          contentType,
        });
        if (uploadError) throw uploadError;
        copied.push({ from, to, url: publicUrl(client, to) });
      } catch (err) {
        errors.push({ from, to, error: err.message });
      }
      onProgress?.({ current: i + 1, total: items.length });
    }
    return { success: errors.length === 0, copied, errors };
  } catch (error) {
    console.error('copyImagesInR2 (Supabase):', error);
    return { success: false, error: error.message, copied: [], errors: [] };
  }
}

/** Move objects via copy + delete (R2-compatible API for MediaFolderBrowser). */
export async function moveImagesInR2(moves, options = {}) {
  const list = (moves || []).filter((m) => m?.from && m?.to && m.from !== m.to);
  if (!list.length) return { success: true, moved: [], errors: [] };
  const copyResult = await copyImagesInR2(list, options);
  const copiedOk = (copyResult.copied || []).map((c) => c.from);
  if (copiedOk.length) {
    await deleteImagesFromR2(copiedOk);
  }
  return {
    success: copyResult.success && !(copyResult.errors || []).length,
    moved: copyResult.copied || [],
    errors: copyResult.errors || [],
    error: copyResult.error,
  };
}

export async function checkR2Status() {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, connected: false, message: 'Supabase not configured' };
    }
    const client = ensureClient();
    await ensureBucket(client);
    const { data, error } = await client.storage.from(BUCKET).list('', { limit: 1 });
    if (error) throw error;
    return {
      success: true,
      connected: true,
      message: `Connected to Supabase bucket "${BUCKET}" (${(data || []).length >= 0 ? 'ok' : 'ok'})`,
    };
  } catch (error) {
    return { success: false, connected: false, message: error.message };
  }
}

// Accept base64 uploads from server-side callers
export async function uploadBase64ToStorage(key, base64, contentType) {
  const blob = base64ToBlob(base64, contentType || inferContentType(key));
  return uploadImageToR2(blob, key);
}
