import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  TextField,
  Typography,
} from '@mui/material';
import { CloudUploadOutlined, FolderOutlined } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { IMAGE_COMPRESS_TARGET_BYTES, MEDIA_ACCEPT } from '../../lib/mediaUtils';
import { pickUploadMedia, uploadMediaBatch } from '../../lib/mediaUploadBatch';
import { setActiveProject } from '../../lib/projectManager';
import { uploadImageToR2 } from '../../lib/r2';
import { compressImage } from '../../lib/imageCompress';
import { adminProjectPath } from '../../lib/adminDeepLink';
import { isStudioLocalMode } from '../../lib/studioData';
import {
  appendUploadedMedia,
  cleanFolderName,
  defaultUploadFolder,
  libraryFolders,
  libraryThumbnails,
  linkUploadFolder,
  looseFileCount,
  missingPageFolders,
  pageFolders,
  pageUsesFolders,
  surveyImageNeed,
} from '../../lib/studioProject';
import { StudioCard, useL } from './studioUi';

const MAX_FOLDERS_SHOWN = 6;

function newId() {
  return typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Photos are made smaller before upload, like the classic media library does by default.
function prepareUpload(raw, type) {
  return type === 'image' && !/\.(gif|svg)$/i.test(raw.name) ? compressImage(raw, IMAGE_COMPRESS_TARGET_BYTES) : raw;
}

/**
 * Pick a folder (or type a new one), choose files, upload. The media list is
 * saved as it goes, each time on a fresh read of the study; a folder the page
 * reads is linked to it in the same save. The folder field only shows when the
 * page reads folders.
 * @param {(task) => Promise} queue runs the upload after the study's other writes
 * @param {(change) => Promise} applyWrite one write on a fresh read (used inside the queue)
 */
export function StudioUploadDialog({ open, project, config, initialFolder = '', queue, applyWrite, onClose }) {
  const L = useL();
  const auth = useOptionalAuth();
  const inputRef = useRef(null);
  const showFolder = Boolean(initialFolder) || pageUsesFolders(config);
  const folders = useMemo(
    () => [...new Set([...pageFolders(config), ...libraryFolders(project).map((f) => f.folder)])],
    [config, project],
  );
  const [folder, setFolder] = useState(initialFolder || defaultUploadFolder(config));
  const [files, setFiles] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const uploading = progress !== null;
  const userId = auth?.user?.id || (isStudioLocalMode() ? 'local' : null);
  const target = showFolder ? cleanFolderName(folder) : defaultUploadFolder(config);

  const choose = (list) => {
    const picked = pickUploadMedia(list);
    setFiles(picked.files);
    setSkipped(picked.skipped);
    setError('');
  };

  const close = () => {
    if (uploading) return;
    setFiles([]);
    setSkipped(0);
    setError('');
    onClose();
  };

  const upload = async () => {
    if (!files.length || !userId || !target) return;
    setError('');
    setProgress(0);
    try {
      const result = await queue(() => uploadMediaBatch({
        files,
        prefix: `${userId}/${project.id}/`,
        folder: target,
        prepare: prepareUpload,
        upload: uploadImageToR2,
        makeId: newId,
        onProgress: ({ processed }) => setProgress(processed),
        persist: async (uploaded) => {
          const saved = await applyWrite((fresh, current) => ({
            fields: {
              preloadedImages: appendUploadedMedia(fresh.preloadedImages, uploaded),
              preloadedAt: new Date().toISOString(),
              preloadedSource: 'r2',
            },
            config: linkUploadFolder(current, target),
          }));
          if (!saved.success) throw new Error(saved.error || 'Save failed');
        },
      }));
      if (result.saveError) {
        setError(L(`The images were uploaded, but saving the list failed: ${result.saveError}`, `图片已上传，但保存图片清单失败：${result.saveError}`));
      } else if (result.failures.length) {
        const first = result.failures[0];
        setFiles(result.failures.map((f) => f.file));
        setError(L(
          `${result.failures.length} file(s) failed (for example ${first.name}: ${first.error}). They are still selected; try again.`,
          `${result.failures.length} 个文件上传失败（例如 ${first.name}：${first.error}）。它们还在待上传列表里，请再试一次。`,
        ));
      } else {
        setFiles([]);
        setSkipped(0);
        onClose();
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{L('Upload images', '上传图片')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {showFolder && (
          <Autocomplete
            freeSolo
            options={folders}
            value={folder}
            inputValue={folder}
            onInputChange={(_, value) => setFolder(value)}
            onChange={(_, value) => setFolder(value || '')}
            disabled={uploading}
            renderInput={(params) => (
              <TextField
                {...params}
                label={L('Folder', '文件夹')}
                helperText={L('Choose a folder, or type a new name.', '选一个文件夹，或者输入新的名字。')}
              />
            )}
          />
        )}
        <Box>
          <input
            ref={inputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            data-testid="studio-upload-files"
            onChange={(e) => {
              choose(e.target.files);
              e.target.value = '';
            }}
          />
          <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {L('Choose files', '选择文件')}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {files.length
              ? L(`${files.length} file(s) selected.`, `已选 ${files.length} 个文件。`)
              : L('Images, video or audio. You can choose many at once.', '图片、视频或音频，可以一次选很多个。')}
            {skipped ? L(` ${skipped} file(s) are not images, video or audio and were left out.`, ` 有 ${skipped} 个文件不是图片、视频或音频，已跳过。`) : ''}
          </Typography>
        </Box>
        {!userId && <Alert severity="warning">{L('Sign in to upload images.', '请先登录再上传图片。')}</Alert>}
        {uploading && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {L(`Uploading ${progress}/${files.length}…`, `正在上传 ${progress}/${files.length}…`)}
            </Typography>
            <LinearProgress variant="determinate" value={files.length ? (100 * progress) / files.length : 0} />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} color="inherit" disabled={uploading}>{L('Cancel', '取消')}</Button>
        <Button variant="contained" onClick={upload} disabled={!files.length || !target || uploading || !userId}>
          {L('Upload', '上传')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function missingText({ folder, reason }, L) {
  if (reason === 'unlinked') {
    return L(`The page uses the folder ${folder}, but it is not linked to the page yet.`, `页面要用 ${folder} 文件夹，但它还没有连接到页面。`);
  }
  if (reason === 'slots') return L("The page's image list is still empty.", '页面的图片列表还是空的。');
  return L(`The page uses the folder ${folder}, but it has no images yet.`, `页面要用 ${folder} 文件夹，但里面还没有图片。`);
}

/**
 * Image library: thumbnails, folders with counts, and what the survey still
 * needs. `busy` while another write of the study runs.
 */
export default function StudioMediaCard({ project, config, busy = false, queue, applyWrite }) {
  const L = useL();
  const [upload, setUpload] = useState(null);
  const folders = useMemo(() => libraryFolders(project), [project]);
  const thumbs = useMemo(() => libraryThumbnails(project, 4), [project]);
  const loose = useMemo(() => looseFileCount(project), [project]);
  const missing = useMemo(() => missingPageFolders(project, config), [project, config]);
  const need = useMemo(() => surveyImageNeed(config), [config]);
  const total = (project?.preloadedImages || []).length;

  const link = (folder) => queue(() => applyWrite((_, current) => ({ config: linkUploadFolder(current, folder) })));

  return (
    <StudioCard
      title={L('Image library', '图片库')}
      data-testid="studio-media"
      action={(
        <Button size="small" startIcon={<CloudUploadOutlined />} onClick={() => setUpload({ folder: '' })} disabled={busy}>
          {L('Upload images', '上传图片')}
        </Button>
      )}
    >
      {thumbs.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 0.75, mb: 1 }}>
          {thumbs.map((entry) => (
            <Box
              key={entry.url}
              component="img"
              src={entry.url}
              alt={entry.name}
              loading="lazy"
              sx={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: '8px', bgcolor: 'action.hover', display: 'block' }}
            />
          ))}
        </Box>
      )}

      {total === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {L('No images yet.', '还没有图片。')}
        </Typography>
      )}

      {folders.slice(0, MAX_FOLDERS_SHOWN).map(({ folder, count }) => (
        <Box key={folder} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <FolderOutlined fontSize="small" color="action" />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{folder}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{L(`${count} files`, `${count} 个文件`)}</Typography>
        </Box>
      ))}
      {folders.length > MAX_FOLDERS_SHOWN && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.75 }}>
          {L(`${folders.length - MAX_FOLDERS_SHOWN} more folders`, `还有 ${folders.length - MAX_FOLDERS_SHOWN} 个文件夹`)}
        </Typography>
      )}
      {loose > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{L('Not in a folder', '不在文件夹里')}</Typography>
          <Typography variant="body2" color="text.secondary">{L(`${loose} files`, `${loose} 个文件`)}</Typography>
        </Box>
      )}

      {need > total && (
        <Alert
          severity="warning"
          sx={{ mt: 1, alignItems: 'center' }}
          data-testid="studio-image-need"
          action={<Button color="inherit" size="small" onClick={() => setUpload({ folder: '' })} disabled={busy}>{L('Upload', '上传')}</Button>}
        >
          {L(`This survey needs at least ${need} images.`, `这个问卷至少需要 ${need} 张图片。`)}
        </Alert>
      )}

      {missing.map((item) => (
        <Alert
          key={`${item.reason}-${item.folder}`}
          severity="warning"
          sx={{ mt: 1, alignItems: 'center' }}
          data-testid="studio-missing-folder"
          action={item.reason === 'unlinked' ? (
            <Button color="inherit" size="small" onClick={() => link(item.folder)} disabled={busy}>{L('Link', '连接')}</Button>
          ) : (
            <Button color="inherit" size="small" onClick={() => setUpload({ folder: item.folder })} disabled={busy}>{L('Upload', '上传')}</Button>
          )}
        >
          {missingText(item, L)}
        </Alert>
      ))}

      <Link
        component={RouterLink}
        to={adminProjectPath(project.id, 'media')}
        onClick={() => setActiveProject(project.id)}
        variant="caption"
        underline="hover"
        color="text.secondary"
        sx={{ display: 'inline-block', mt: 1.25 }}
      >
        {L('Advanced image management', '高级图片管理')}
      </Link>

      {upload && (
        <StudioUploadDialog
          open
          project={project}
          config={config}
          initialFolder={upload.folder}
          queue={queue}
          applyWrite={applyWrite}
          onClose={() => setUpload(null)}
        />
      )}
    </StudioCard>
  );
}
