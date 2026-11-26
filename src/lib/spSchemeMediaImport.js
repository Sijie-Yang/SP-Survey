/**
 * Upload the stimulus files that came in an imported project zip to the
 * project's media library, in the folders the import planned, so the
 * survey's questions can draw them like any other project media.
 */

import { uploadMediaBatch } from './mediaUploadBatch.js';
import { inferMediaType } from './mediaUtils.js';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };

function newId() {
  return typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toFile({ path, bytes }) {
  const name = path.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  return new File([bytes], name, { type: MIME[ext] || (inferMediaType(name) === 'image' ? 'image/*' : 'application/octet-stream') });
}

/**
 * @param {{ plan: { files: { path, bytes, folder }[] }, project: object, userId: string,
 *   upload: (file: File, key: string) => Promise<{ success, url, error }>,
 *   onProjectUpdate: (project: object, opts: object) => Promise<void>, onProgress?: Function }} args
 */
export async function uploadPlannedMedia({ plan, project, userId, upload, onProjectUpdate, onProgress = () => {} }) {
  if (!project?.id || !userId) throw new Error('Open a project before importing its media.');
  const byFolder = new Map();
  plan.files.forEach((file) => {
    if (!byFolder.has(file.folder)) byFolder.set(file.folder, []);
    byFolder.get(file.folder).push(file);
  });
  const total = plan.files.length;
  const uploadFolder = async (folder, files, base, offset) => {
    let saved = base;
    const result = await uploadMediaBatch({
      files: files.map(toFile),
      prefix: `${userId}/${project.id}/`,
      folder,
      prepare: (raw) => raw,
      upload,
      makeId: newId,
      onProgress: ({ processed }) => onProgress({ done: offset + processed, total }),
      persist: async (batch) => {
        saved = {
          ...base,
          preloadedImages: [...(base.preloadedImages || []), ...batch],
          preloadedAt: new Date().toISOString(),
          preloadedSource: 'r2',
        };
        await onProjectUpdate(saved, { throwOnError: true });
      },
    });
    return { result, saved };
  };
  let done = 0;
  let latest = project;
  const uploaded = [];
  const failures = [];
  for (const [folder, files] of byFolder) {
    // Folders go one after another so each save includes the folders before it.
    // eslint-disable-next-line no-await-in-loop
    const { result, saved } = await uploadFolder(folder, files, latest, done);
    latest = saved;
    done += files.length;
    uploaded.push(...result.uploaded);
    failures.push(...result.failures.map((f) => ({ name: `${folder}/${f.name}`, error: f.error })));
    if (result.saveError) return { uploaded, failures, saveError: result.saveError, project: latest };
  }
  return { uploaded, failures, saveError: null, project: latest };
}
