import { buildProjectMediaKey, inferMediaType, MEDIA_FILE_RE, MAX_AV_MEDIA_BYTES, joinFolderPath, normalizeFolderPath } from './mediaUtils';

/** Resolve the original File's directory before compression creates a new File. */
export function uploadFolderForFile(file, baseFolder = '') {
  const relative = String(file.webkitRelativePath || '').replace(/\\/g, '/');
  if (!relative) return normalizeFolderPath(baseFolder);
  const parts = relative.split('/');
  if (relative.startsWith('/') || parts.some((part) => !part.trim() || part.trim() === '.' || part.trim() === '..')) {
    throw new Error('Invalid relative file path');
  }
  return joinFolderPath(baseFolder, ...parts.slice(0, -1));
}

/** Directory pickers include non-media files too (documents, OS metadata, etc.). */
export function pickUploadMedia(fileList) {
  const all = Array.from(fileList || []);
  const files = all.filter((file) => MEDIA_FILE_RE.test(file.name) && !file.name.startsWith('._'));
  return { files, skipped: all.length - files.length };
}

/** Each upload gets an immutable object name, even when original names collide. */
export function uploadObjectKey(prefix, folder, filename, id) {
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dot = safe.lastIndexOf('.');
  const unique = dot > 0 ? `${safe.slice(0, dot)}__${id}${safe.slice(dot)}` : `${safe}__${id}`;
  return buildProjectMediaKey(prefix, folder, unique);
}

/** Files are independent: a failed file never discards the rest of the batch. */
export async function uploadMediaBatch({ files, prefix, folder, prepare, upload, makeId, persist, onProgress = () => {}, shouldStop = () => false }) {
  const uploaded = [];
  const failures = [];
  let processed = 0;
  let saveError = null;
  for (const raw of files) {
    if (shouldStop()) break;
    try {
      if (!MEDIA_FILE_RE.test(raw.name)) throw new Error('Unsupported media format');
      if (raw.size <= 0) throw new Error('File is empty');
      if (raw.size > MAX_AV_MEDIA_BYTES) throw new Error(`File exceeds ${MAX_AV_MEDIA_BYTES / 1024 / 1024} MB`);
      const fileFolder = uploadFolderForFile(raw, folder);
      const type = inferMediaType(raw.name);
      const file = await prepare(raw, type);
      const key = uploadObjectKey(prefix, fileFolder, file.name, makeId());
      const result = await upload(file, key);
      if (!result.success) throw new Error(result.error || 'Upload failed');
      uploaded.push({ url: result.url, name: raw.name, type, key, media_id: key, folder: fileFolder, logicalFolder: fileFolder,
        original_bytes: raw.size, uploaded_bytes: file.size, image_compressed: file !== raw });
    } catch (err) {
      failures.push({ file: raw, name: raw.webkitRelativePath || raw.name, error: err.message || 'Upload failed' });
    }
    processed += 1;
    onProgress({ processed, uploaded: uploaded.length, failed: failures.length });
    if (processed % 10 === 0 && uploaded.length) {
      try { await persist([...uploaded]); } catch (err) { saveError = err.message; break; }
    }
  }
  if (uploaded.length && !saveError) {
    try { await persist([...uploaded]); } catch (err) { saveError = err.message; }
  }
  return { uploaded, failures, pending: files.slice(processed), processed, saveError };
}
