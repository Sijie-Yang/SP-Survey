import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Chip,
  TextField,
  Switch,
  FormControlLabel,
  IconButton,
  Checkbox,
  Tooltip,
  Pagination,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  Warning,
  CloudDownload,
  Delete,
  CloudUpload,
  Search,
  SelectAll,
  Deselect,
  DriveFileMove,
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, uploadImageToR2, deleteImagesFromR2, listImagesFromR2, projectR2Prefix } from '../../lib/r2';
import {
  inferMediaType, normalizeMediaEntry, MEDIA_ACCEPT, downloadMediaFiles,
  analyzeTaggedSets, analyzeTaggedCategories, sortMediaByName,
  buildProjectMediaKey,
} from '../../lib/mediaUtils';
import MediaPairingGuide from './MediaPairingGuide';
import MediaCategoryGuide from './MediaCategoryGuide';
import MediaFolderBrowser from './MediaFolderBrowser';
import SupabaseStorageConfig from './SupabaseStorageConfig';
import SpatialIntelligencePanel from './SpatialIntelligencePanel';
import MediaPreannotatePanel from './MediaPreannotatePanel';
import { useRegion } from '../../contexts/RegionContext';
import { LOCAL_USER_ID } from '../../lib/appMode';

const MEDIA_PAGE_SIZE = 24;
function mediaEntryKey(entry, userId, projectId) {
  if (entry?.key) return entry.key;
  if (!entry?.name || !projectId) return null;
  const prefix = projectR2Prefix(userId, projectId);
  return buildProjectMediaKey(prefix, entry.folder || '', entry.name);
}

export default function ImageDataset({ currentProject, onProjectUpdate, onConfigChange, onNextStep }) {
  useRegion();
  const user = { id: LOCAL_USER_ID };

  // Direct upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [directUploadStatus, setDirectUploadStatus] = useState({
    loading: false, progress: 0, total: 0, error: null, success: null,
  });
  const fileInputRef = useRef(null);

  // HuggingFace optional import
  const [hfConfig, setHfConfig] = useState({ enabled: false, token: '', datasetName: '' });
  const [hfStatus, setHfStatus] = useState({ loading: false, connected: false, error: null, datasetInfo: null });
  const [preloadStatus, setPreloadStatus] = useState({ loading: false, progress: 0, total: 0, error: null, success: null });

  // R2 sync state
  const [r2Syncing, setR2Syncing] = useState(false);

  // Uploaded media library management
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [mediaPage, setMediaPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState(() => new Set());
  const [mediaActionStatus, setMediaActionStatus] = useState({ loading: false, error: null, success: null });
  const [mediaDownloadProgress, setMediaDownloadProgress] = useState(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [groupSizeFilter, setGroupSizeFilter] = useState('all');
  const [currentFolder, setCurrentFolder] = useState('');
  const [openMoveSignal, setOpenMoveSignal] = useState(0);
  const [preannotateFocusName, setPreannotateFocusName] = useState(null);
  const scrollRef = useRef(0);
  const restoreScrollRef = useRef(false);

  useEffect(() => {
    if (restoreScrollRef.current) {
      window.scrollTo(0, scrollRef.current);
      restoreScrollRef.current = false;
    }
  });

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const projectPrefix = projectId ? projectR2Prefix(userId, projectId) : '';

  const normalizeR2Listing = (images = []) => images.map((img) => normalizeMediaEntry({
    url: img.url,
    name: img.name,
    key: img.key,
    type: img.type || inferMediaType(img.name),
  }, projectPrefix));

  const persistPreloadedImages = (images, extra = {}) => {
    if (!currentProject) return;
    const updatedProject = {
      ...currentProject,
      preloadedImages: images,
      preloadedAt: images.length ? (extra.preloadedAt || new Date().toISOString()) : null,
      preloadedSource: images.length ? 'supabase' : null,
      ...extra,
    };
    onProjectUpdate(updatedProject);
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
    return updatedProject;
  };

  const refreshMediaFromR2 = async () => {
    if (!isR2Configured() || !projectId) return;
    setRefreshingMedia(true);
    setMediaActionStatus({ loading: false, error: null, success: null });
    try {
      const result = await listImagesFromR2(projectPrefix);
      if (!result.success) throw new Error(result.error || 'Failed to list media from Supabase');
      const images = normalizeR2Listing(result.images);
      persistPreloadedImages(images);
      setSelectedMedia(new Set());
      setMediaPage(1);
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Synced ${images.length} file(s) from Supabase Storage.`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setRefreshingMedia(false);
    }
  };

  const deleteMediaEntries = async (entries) => {
    if (!entries.length || !currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const label = entries.length === 1 ? `"${entries[0].name}"` : `${entries.length} files`;
    if (!window.confirm(`Delete ${label} from Supabase Storage? This cannot be undone.`)) return;

    setMediaActionStatus({ loading: true, error: null, success: null });
    try {
      if (isR2Configured()) {
        const keys = entries
          .map((entry) => mediaEntryKey(entry, userId, projectId))
          .filter(Boolean);
        if (keys.length) {
          const del = await deleteImagesFromR2(keys);
          if (!del.success) throw new Error(del.error || 'Failed to delete from Supabase');
        }
      }

      const removeNames = new Set(entries.map((e) => e.name));
      const remaining = (currentProject.preloadedImages || []).filter((m) => !removeNames.has(m.name));
      persistPreloadedImages(remaining);
      setSelectedMedia((prev) => {
        const next = new Set(prev);
        removeNames.forEach((n) => next.delete(n));
        return next;
      });
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Deleted ${entries.length} file(s).`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    }
  };

  const handleDeleteSingleMedia = (entry) => deleteMediaEntries([entry]);
  const handleDeleteSelectedMedia = () => {
    const selected = filteredMedia.filter((m) => selectedMedia.has(m.name));
    if (!selected.length) return;
    deleteMediaEntries(selected);
  };

  const downloadMediaEntries = async (entries) => {
    if (!entries.length) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    setMediaDownloadProgress({ done: 0, total: entries.length });
    try {
      const { succeeded, failed, failures } = await downloadMediaFiles(entries, {
        onProgress: (done, total) => setMediaDownloadProgress({ done, total }),
      });
      if (failed > 0 && succeeded === 0) {
        throw new Error(failures[0]?.error || 'Download failed');
      }
      const failHint = failed > 0
        ? ` ${failed} failed (${failures.slice(0, 2).map((f) => f.name).join(', ')}${failures.length > 2 ? '…' : ''}).`
        : '';
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Downloaded ${succeeded} of ${entries.length} file(s).${failHint}`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setMediaDownloadProgress(null);
    }
  };

  const handleDownloadSingleMedia = (entry, e) => {
    e?.stopPropagation();
    downloadMediaEntries([entry]);
  };

  const handleDownloadSelectedMedia = () => {
    const selected = filteredMedia.filter((m) => selectedMedia.has(m.name));
    if (!selected.length) return;
    downloadMediaEntries(selected);
  };

  const handleDownloadFilteredMedia = () => {
    if (!filteredMedia.length) return;
    downloadMediaEntries(filteredMedia);
  };

  const filteredMedia = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    const folder = currentFolder || '';
    const filtered = (currentProject?.preloadedImages || []).filter((m) => {
      const entry = normalizeMediaEntry(m, projectPrefix);
      if ((entry.folder || '') !== folder) return false;
      const t = entry.type || inferMediaType(entry.name || entry.url);
      if (mediaFilter !== 'all' && t !== mediaFilter) return false;
      if (q && !(entry.name || '').toLowerCase().includes(q)
        && !(entry.folder || '').toLowerCase().includes(q)) return false;
      return true;
    });
    return sortMediaByName(filtered);
  }, [currentProject?.preloadedImages, mediaSearch, mediaFilter, currentFolder, projectPrefix]);

  const totalMediaPages = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE));
  const pagedMedia = useMemo(() => {
    const start = (mediaPage - 1) * MEDIA_PAGE_SIZE;
    return filteredMedia.slice(start, start + MEDIA_PAGE_SIZE);
  }, [filteredMedia, mediaPage]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaSearch, mediaFilter, currentFolder]);

  useEffect(() => {
    if (mediaPage > totalMediaPages) setMediaPage(totalMediaPages);
  }, [mediaPage, totalMediaPages]);

  const toggleMediaSelection = (name) => {
    setSelectedMedia((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedMedia(new Set(filteredMedia.map((m) => m.name)));
  };

  const clearMediaSelection = () => setSelectedMedia(new Set());

  // On mount / project change: sync actual image count from Supabase
  useEffect(() => {
    if (!isR2Configured() || !currentProject?.id) return;
    let cancelled = false;
    const userId = user.id;
    const prefix = `${userId}/${currentProject.id}/`;

    setR2Syncing(true);
    listImagesFromR2(prefix).then((result) => {
      if (cancelled) return;
      setR2Syncing(false);
      if (!result.success || result.images.length === 0) return;
      // If R2 has more images than stored locally, update the project record
      const storedCount = currentProject.preloadedImages?.length || 0;
      if (result.images.length !== storedCount) {
        const images = normalizeR2Listing(result.images);
        onProjectUpdate({
          ...currentProject,
          preloadedImages: images,
          preloadedSource: 'supabase',
          preloadedAt: currentProject.preloadedAt || new Date().toISOString(),
        });
      }
    });
    return () => { cancelled = true; };
  }, [currentProject?.id, user?.id]); // eslint-disable-line

  // Sync hfConfig from project
  useEffect(() => {
    if (currentProject?.imageDatasetConfig) {
      const c = currentProject.imageDatasetConfig;
      setHfConfig({
        enabled: c.enabled || false,
        token: c.huggingFaceToken || '',
        datasetName: c.datasetName || '',
      });
      if (c.datasetInfo && onConfigChange) {
        setHfStatus(prev => ({ ...prev, connected: true, datasetInfo: c.datasetInfo }));
      }
    }
  }, [currentProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveHfConfig = () => {
    if (!currentProject) return;
    const updated = {
      ...currentProject,
      imageDatasetConfig: {
        ...currentProject.imageDatasetConfig,
        enabled: hfConfig.enabled,
        huggingFaceToken: hfConfig.token,
        datasetName: hfConfig.datasetName,
      },
    };
    onProjectUpdate(updated);
    if (onConfigChange) onConfigChange(true, updated.imageDatasetConfig);
  };

  const testHfConnection = async () => {
    setHfStatus({ loading: true, connected: false, error: null, datasetInfo: null });
    try {
      const result = await testHuggingFaceConnection(hfConfig.token, hfConfig.datasetName);
      if (result.success) {
        setHfStatus({ loading: false, connected: true, error: null, datasetInfo: result.datasetInfo });
      } else {
        setHfStatus({ loading: false, connected: false, error: result.error || 'Connection failed', datasetInfo: null });
      }
    } catch (e) {
      setHfStatus({ loading: false, connected: false, error: e.message, datasetInfo: null });
    }
  };

  // ── Direct upload to Supabase Storage ────────────────────────────────────────

  // Compress image to stay under maxBytes using Canvas
  const compressImage = (file, maxBytes = 300 * 1024, quality = 0.85) => {
    return new Promise((resolve) => {
      if (file.size <= maxBytes) { resolve(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        // Scale down if very large
        const maxDim = 1920;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Try progressively lower quality until under maxBytes
        const tryQuality = (q) => {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= maxBytes || q <= 0.3) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              tryQuality(Math.max(q - 0.1, 0.3));
            }
          }, 'image/jpeg', q);
        };
        tryQuality(quality);
      };
      img.onerror = () => resolve(file);
      img.src = url;
    });
  };

  const handleDirectUpload = async () => {
    if (!selectedFiles.length) return;
    if (!isR2Configured()) {
      setDirectUploadStatus(prev => ({ ...prev, error: 'Supabase is not configured. Save credentials in Supabase Storage Configuration above.' }));
      return;
    }

    setDirectUploadStatus({ loading: true, progress: 0, total: selectedFiles.length, error: null, success: null });

    try {
      const uploadedImages = [...(currentProject?.preloadedImages || [])];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        const raw = selectedFiles[i];
        const mediaType = inferMediaType(raw.name);
        const file = mediaType === 'image' ? await compressImage(raw) : raw;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const userId = user?.id || 'anonymous';
        const key = buildProjectMediaKey(
          `${userId}/${currentProject?.id || 'default'}/`,
          currentFolder,
          safeName,
        );

        const result = await uploadImageToR2(file, key);

        if (result.success) {
          uploadedImages.push({
            url: result.url,
            name: raw.name,
            type: mediaType,
            key,
            media_id: key,
            folder: currentFolder || '',
          });
          successCount++;
        } else {
          console.error('Upload error:', result.error);
          failCount++;
          if (i === 0) {
            setDirectUploadStatus(prev => ({ ...prev, error: `Upload failed: ${result.error}` }));
          }
        }

        setDirectUploadStatus(prev => ({ ...prev, progress: i + 1 }));

        // Save progress every 10 files so interruption doesn't lose all work
        if ((i + 1) % 10 === 0) {
          onProjectUpdate({
            ...currentProject,
            preloadedImages: [...uploadedImages],
            preloadedAt: new Date().toISOString(),
            preloadedSource: 'supabase',
          });
        }
      }

      const updatedProject = {
        ...currentProject,
        preloadedImages: uploadedImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'supabase',
      };
      onProjectUpdate(updatedProject);
      if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);

      setDirectUploadStatus({
        loading: false, progress: selectedFiles.length, total: selectedFiles.length,
        error: failCount > 0 ? `${failCount} file(s) failed to upload.` : null,
        success: `Successfully uploaded ${successCount} file(s) to Supabase Storage!`,
      });
      setSelectedFiles([]);
    } catch (error) {
      setDirectUploadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  // ── HuggingFace batch preload ─────────────────────────────────────────────

  const handlePreloadAllImages = async () => {
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    if (!hfConfig.datasetName) {
      setPreloadStatus(prev => ({ ...prev, error: 'Please configure and test dataset connection first.' }));
      return;
    }
    if (!isR2Configured()) {
      setPreloadStatus(prev => ({ ...prev, error: 'Supabase is not configured. Save credentials in Supabase Storage Configuration above.' }));
      return;
    }
    if (!currentProject?.id) {
      setPreloadStatus(prev => ({ ...prev, error: 'No active project. Please select or create a project before preloading images.' }));
      return;
    }

    setPreloadStatus({ loading: true, progress: 0, total: 0, error: null, success: null });

    try {
      // Store HF images under the same per-project R2 prefix used by direct
      // uploads (${userId}/${projectId}/) so they live with the project and
      // get carried over correctly when exporting the project as a template.
      const userId = user?.id || 'anonymous';
      const projectPrefix = `${userId}/${currentProject.id}`;

      // Check which images already exist in R2 for this project
      const existingResult = await listImagesFromR2(`${projectPrefix}/`);
      const existingFileNames = new Set((existingResult.images || []).map(img => img.name));

      // Folder mode (input is "owner/repo/subfolder") returns real file
      // names from the Hub tree, so the rows-mode `image_NNNNNN.jpg` naming
      // and its batch-level "all files already exist → skip the network
      // call entirely" pre-check don't apply. Detect mode up front so the
      // inner loop branches once instead of per-image.
      const datasetSegments = hfConfig.datasetName
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
      const isFolderMode = datasetSegments.length > 2;

      const countResult = await getImageCountFromDataset(hfConfig.token, hfConfig.datasetName);
      const totalImages = countResult.imageCount || 1000;
      setPreloadStatus(prev => ({ ...prev, total: totalImages }));

      // Collect public URLs for already-existing images
      const allImages = [];
      for (const img of (existingResult.images || [])) {
        allImages.push({ url: img.url, name: img.name, key: img.key, type: img.type || inferMediaType(img.name) });
      }

      const batchSize = 100;
      const batches = Math.ceil(totalImages / batchSize);
      let newCount = 0;
      let skipCount = 0;

      // Sanitize an HF filename so it's safe to use as an R2 key segment.
      // Matches the rule used by the direct-upload path.
      const safeKey = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

      for (let b = 0; b < batches; b++) {
        const offset = b * batchSize;
        const limit = Math.min(batchSize, totalImages - offset);

        if (!isFolderMode) {
          // Rows mode: filenames are deterministic, so we can skip whole
          // batches when every synthesized name already exists in R2.
          const toDownload = [];
          for (let j = 0; j < limit; j++) {
            const padded = String(offset + j).padStart(6, '0');
            if (!existingFileNames.has(`image_${padded}.jpg`)) toDownload.push(offset + j);
          }
          if (!toDownload.length) {
            skipCount += limit;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));
            continue;
          }
        }

        const result = await getImagesFromHuggingFace(hfConfig.token, hfConfig.datasetName, limit, offset);
        if (!result.success || !result.images) throw new Error(result.error || 'Failed to fetch images');

        for (let k = 0; k < result.images.length; k++) {
          const gi = offset + k;
          // Folder mode preserves the original filename from the HF tree
          // (sanitized for R2). Rows mode keeps the existing zero-padded
          // synthetic naming so old projects continue to dedupe correctly.
          const fname = isFolderMode
            ? safeKey(result.images[k].name || `image_${String(gi).padStart(6, '0')}.jpg`)
            : `image_${String(gi).padStart(6, '0')}.jpg`;
          if (existingFileNames.has(fname)) { skipCount++; continue; }

          try {
            // Gated datasets serve their "permanent" image URLs from
            // huggingface.co/datasets/.../resolve/main/... which 401s
            // without an Authorization header. Signed CDN URLs already
            // carry auth in the query string, so we only attach the
            // bearer token when the request actually targets huggingface.co.
            const imgUrl = result.images[k].url;
            const fetchOpts = (hfConfig.token && hfConfig.token.trim() && /^https:\/\/(?:[a-z0-9-]+\.)*huggingface\.co\//i.test(imgUrl))
              ? { headers: { Authorization: `Bearer ${hfConfig.token.trim()}` } }
              : undefined;
            const resp = await fetch(imgUrl, fetchOpts);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            // Run HF-fetched images through the same ≤300KB compressor used
            // for direct uploads, so every R2 object served to participants
            // is on the same size/quality budget regardless of source.
            const wrapped = new File([blob], fname, { type: blob.type || 'image/jpeg' });
            const compressed = await compressImage(wrapped);
            const r2Key = `${projectPrefix}/${fname}`;
            const uploadResult = await uploadImageToR2(compressed, r2Key);
            if (!uploadResult.success) continue;
            // Track the filename we used so a re-run skips it from
            // existingFileNames without an extra R2 list round-trip.
            existingFileNames.add(fname);
            allImages.push({ url: uploadResult.url, name: fname, key: r2Key, type: 'image' });
            newCount++;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));

            // Save progress every 10 new uploads
            if (newCount % 10 === 0) {
              onProjectUpdate({
                ...currentProject,
                preloadedImages: [...allImages],
                preloadedAt: new Date().toISOString(),
                preloadedSource: 'supabase',
              });
            }
          } catch {}
        }
      }

      allImages.sort((a, b) => a.name.localeCompare(b.name));
      const updatedProject = {
        ...currentProject,
        preloadedImages: allImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'supabase',
      };
      onProjectUpdate(updatedProject);

      setPreloadStatus({
        loading: false, progress: allImages.length, total: totalImages, error: null,
        success: `Completed! ${allImages.length} images available (${newCount} new, ${skipCount} skipped).`,
      });
    } catch (error) {
      setPreloadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  const handleClearImages = async () => {
    if (!currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const count = currentProject.preloadedImages?.length || 0;
    if (!window.confirm(`Clear all ${count} uploaded images from Supabase Storage? This cannot be undone.`)) return;

    // Delete files from Supabase
    if (isR2Configured() && currentProject.preloadedImages?.length > 0) {
      try {
        const userId = user?.id || 'anonymous';
        const projectId = currentProject.id;
        const listResult = await listImagesFromR2(`${userId}/${projectId}`);
        if (listResult.success && listResult.images.length > 0) {
          const keys = listResult.images.map(img => img.key);
          await deleteImagesFromR2(keys);
        }
      } catch (e) {
        console.error('Error clearing images from Supabase:', e);
      }
    }

    const updatedProject = {
      ...currentProject,
      preloadedImages: [],
      preloadedAt: null,
      preloadedSource: null,
      imageDatasetConfig: {
        ...(currentProject.imageDatasetConfig || {}),
        mediaFolderTags: {},
        mediaFolders: [],
      },
    };
    onProjectUpdate(updatedProject);
    setSelectedMedia(new Set());
    setMediaPage(1);
    setCurrentFolder('');
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;
  const mediaGroups = useMemo(
    () => analyzeTaggedSets(
      currentProject?.preloadedImages || [],
      currentProject?.imageDatasetConfig?.mediaFolderTags || {},
      null,
      { projectPrefix },
    ),
    [currentProject?.preloadedImages, currentProject?.imageDatasetConfig?.mediaFolderTags, projectPrefix],
  );
  const pairedGroups = mediaGroups;
  const groupSummary = useMemo(() => {
    const bySize = {};
    pairedGroups.forEach((g) => {
      bySize[g.size] = (bySize[g.size] || 0) + 1;
    });
    return { total: pairedGroups.length, bySize };
  }, [pairedGroups]);
  const filteredPairedGroups = useMemo(() => {
    if (groupSizeFilter === 'all') return pairedGroups;
    const n = parseInt(groupSizeFilter, 10);
    return pairedGroups.filter((g) => g.size === n);
  }, [pairedGroups, groupSizeFilter]);
  const mediaCategories = useMemo(
    () => analyzeTaggedCategories(
      currentProject?.preloadedImages || [],
      currentProject?.imageDatasetConfig?.mediaFolderTags || {},
      { projectPrefix },
    ),
    [currentProject?.preloadedImages, currentProject?.imageDatasetConfig?.mediaFolderTags, projectPrefix],
  );
  const mediaCounts = (currentProject?.preloadedImages || []).reduce((acc, m) => {
    const t = m.type || inferMediaType(m.name || m.url);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const preannotateImages = useMemo(
    () => sortMediaByName((currentProject?.preloadedImages || []).filter(
      (m) => (m.type || inferMediaType(m.name || m.url)) === 'image',
    )),
    [currentProject?.preloadedImages],
  );
  const preannotateIndex = Math.max(
    0,
    preannotateImages.findIndex((m) => m.name === preannotateFocusName),
  );
  const preannotateEntry = preannotateImages[preannotateIndex] || null;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
        Media Dataset
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload images, videos, and audio to Supabase Storage. They will be served to survey participants.
        Images over 300 KB are automatically compressed. Video/audio are uploaded as-is (max ~100 MB).
        HuggingFace batch import is available as an optional tool for images.
      </Typography>

      <Box sx={{ mb: 2.5, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <MediaPairingGuide compact totalFileCount={preloadedCount} pairedSetCount={groupSummary.total} />
        <MediaCategoryGuide
          compact
          categoryCount={mediaCategories.length}
          totalFileCount={preloadedCount}
          categoryLabels={mediaCategories.map((c) => c.category)}
        />
      </Box>

      {/* ── Current Status ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {r2Syncing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Checking Supabase for existing images…</Typography>
          </Box>
        ) : preloadedCount > 0 ? (
          <>
            <Chip icon={<CheckCircle />} label={`${preloadedCount} media file(s) in Supabase`} color="success" variant="outlined" />
            {Object.entries(mediaCounts).map(([t, n]) => (
              <Chip key={t} size="small" label={`${n} ${t}`} variant="outlined" />
            ))}
            <Chip label="Supabase Storage" color="primary" size="small" variant="outlined" />
            {currentProject?.preloadedAt && (
              <Typography variant="body2" color="text.secondary">
                Last upload: {new Date(currentProject.preloadedAt).toLocaleString()}
              </Typography>
            )}
          </>
        ) : (
          <Chip icon={<Warning />} label="No images uploaded yet" color="default" variant="outlined" />
        )}
      </Box>

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        1 · Add media
      </Typography>

      <Box
        sx={{
          mb: 3,
          display: 'grid',
          gap: 2,
          alignItems: 'stretch',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        <Box sx={{ p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'secondary.light', bgcolor: 'background.paper' }}>
          <SupabaseStorageConfig
            compact
            currentProject={currentProject}
            onProjectUpdate={onProjectUpdate}
            onConfigChange={onConfigChange}
          />
        </Box>

        <Box sx={{
          p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'primary.light',
          bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudUpload fontSize="small" color="primary" />
            Upload Media
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Upload into the <strong>current folder</strong> ({currentFolder ? <code>{currentFolder}</code> : 'root'}).
            Images over 300 KB are compressed automatically.
          </Typography>
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading}>
              Choose files
            </Button>
            {selectedFiles.length > 0 && <Typography variant="caption" color="text.secondary">{selectedFiles.length} selected</Typography>}
          </Box>
          {directUploadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                Uploading… {directUploadStatus.progress} / {directUploadStatus.total}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={directUploadStatus.total > 0 ? (directUploadStatus.progress / directUploadStatus.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
          {directUploadStatus.success && <Alert severity="success" sx={{ mb: 1.5 }}>{directUploadStatus.success}</Alert>}
          {directUploadStatus.error && <Alert severity="error" sx={{ mb: 1.5 }}>{directUploadStatus.error}</Alert>}
          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth variant="contained" onClick={handleDirectUpload}
              disabled={!selectedFiles.length || directUploadStatus.loading || !isR2Configured()}
              startIcon={directUploadStatus.loading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
            >
              Upload{selectedFiles.length > 0 ? ` ${selectedFiles.length}` : ''}{currentFolder ? ` → ${currentFolder}` : ' → root'}
            </Button>
          </Box>
        </Box>

        <Box sx={{
          p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'warning.light',
          bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700 }}>🤗 HF Dataset Import</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Batch-import from HuggingFace using <code>owner/dataset</code> or <code>owner/dataset/folder</code>.
          </Typography>
          <FormControlLabel
            sx={{ mb: 1, ml: 0 }}
            control={<Switch size="small" checked={hfConfig.enabled} onChange={(e) => setHfConfig((p) => ({ ...p, enabled: e.target.checked }))} />}
            label={<Typography variant="body2">Enable HF import</Typography>}
          />
          <TextField
            fullWidth size="small" label="Token (optional)" type="password" value={hfConfig.token}
            onChange={(e) => setHfConfig((p) => ({ ...p, token: e.target.value }))} disabled={!hfConfig.enabled} sx={{ mb: 1 }}
          />
          <TextField
            fullWidth size="small" label="Dataset" value={hfConfig.datasetName}
            onChange={(e) => setHfConfig((p) => ({ ...p, datasetName: e.target.value }))}
            placeholder="owner/dataset" disabled={!hfConfig.enabled} sx={{ mb: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={saveHfConfig} disabled={!hfConfig.enabled || !hfConfig.datasetName}>Save</Button>
            <Button
              size="small" variant="outlined" onClick={testHfConnection}
              disabled={!hfConfig.enabled || !hfConfig.datasetName || hfStatus.loading}
              startIcon={hfStatus.loading ? <CircularProgress size={14} /> : <Refresh />}
            >Test</Button>
          </Box>
          {(hfStatus.connected || hfStatus.error) && (
            <Alert severity={hfStatus.connected ? 'success' : 'error'} sx={{ mb: 1.5 }} icon={false}>
              <Typography variant="caption">
                {hfStatus.connected
                  ? `Connected${hfStatus.datasetInfo?.imageCount != null ? ` · ${hfStatus.datasetInfo.imageCount} images` : ''}`
                  : hfStatus.error}
              </Typography>
            </Alert>
          )}
          {preloadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>HF → Supabase… {preloadStatus.progress} / {preloadStatus.total}</Typography>
              <LinearProgress
                variant="determinate"
                value={preloadStatus.total > 0 ? (preloadStatus.progress / preloadStatus.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
          {preloadStatus.success && <Alert severity="success" sx={{ mb: 1.5 }}>{preloadStatus.success}</Alert>}
          {preloadStatus.error && <Alert severity="error" sx={{ mb: 1.5 }}>{preloadStatus.error}</Alert>}
          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth variant="contained" onClick={handlePreloadAllImages}
              disabled={!hfStatus.connected || !isR2Configured() || preloadStatus.loading}
              startIcon={preloadStatus.loading ? <CircularProgress size={16} /> : <CloudDownload />}
            >
              {preloadedCount > 0 ? 'Re-preload to Supabase' : 'Preload to Supabase'}
            </Button>
          </Box>
        </Box>
      </Box>

      <SpatialIntelligencePanel
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        onConfigChange={onConfigChange}
      />

      {pairedGroups.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Tagged sets ({pairedGroups.length})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Folders tagged <code>set</code>. Each folder&apos;s direct files stay together when a question uses
            &quot;Random fixed sets&quot; with a matching media count.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {Object.entries(groupSummary.bySize)
              .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
              .map(([size, count]) => (
                <Chip
                  key={size}
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`${count} set(s) × ${size} file(s)`}
                />
              ))}
          </Box>
          <FormControl size="small" sx={{ minWidth: 160, mb: 2 }}>
            <InputLabel id="group-size-filter">Filter by set size</InputLabel>
            <Select
              labelId="group-size-filter"
              label="Filter by set size"
              value={groupSizeFilter}
              onChange={(e) => setGroupSizeFilter(e.target.value)}
            >
              <MenuItem value="all">All sizes</MenuItem>
              {Object.keys(groupSummary.bySize)
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map((size) => (
                  <MenuItem key={size} value={size}>{size} file(s) per set</MenuItem>
                ))}
            </Select>
          </FormControl>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Group ID</TableCell>
                  <TableCell align="center">Size</TableCell>
                  <TableCell>Types</TableCell>
                  <TableCell>Files (in slot order)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPairedGroups.slice(0, 50).map((g) => (
                  <TableRow key={g.setKey || g.groupKey} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{g.setId || g.groupId}</Typography>
                    </TableCell>
                    <TableCell align="center">{g.size}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{g.types.join(' + ')}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace' }}>
                        {g.members.map((m) => m.name).join('  ·  ')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {filteredPairedGroups.length > 50 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing first 50 of {filteredPairedGroups.length} groups.
            </Typography>
          )}
          {filteredPairedGroups.length === 0 && (
            <Alert severity="warning" sx={{ mt: 1 }}>No groups match this size filter.</Alert>
          )}
        </Box>
      )}

      {mediaCategories.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'secondary.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Tagged categories ({mediaCategories.length})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Use Survey Builder → Media Assignment → <strong>One per category</strong> to show one random file from each class in every question.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Category</TableCell>
                  <TableCell align="center">Files</TableCell>
                  <TableCell>Types</TableCell>
                  <TableCell>Sample filenames</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mediaCategories.map((c) => (
                  <TableRow key={c.category} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{c.category}</Typography>
                    </TableCell>
                    <TableCell align="center">{c.count}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{c.types.join(', ')}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.members.slice(0, 4).map((m) => m.name).join(' · ')}
                        {c.count > 4 ? ` · +${c.count - 4} more` : ''}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ── Uploaded Media Library (folder browser) ── */}
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        Organize in folders
      </Typography>
      <MediaFolderBrowser
        currentProject={currentProject}
        userId={userId}
        onProjectUpdate={onProjectUpdate}
        currentFolder={currentFolder}
        onCurrentFolderChange={setCurrentFolder}
        selectedMediaEntries={(currentProject?.preloadedImages || []).filter((m) => selectedMedia.has(m.name))}
        openMoveSignal={openMoveSignal}
        mediaCount={preloadedCount}
      >
        {preloadedCount === 0 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            No media uploaded yet. Use the import / upload cards above, then organize files with folders on the left.
          </Alert>
        ) : (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Uploaded Media ({preloadedCount})
              {currentFolder ? ` · ${currentFolder}` : ' · root'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={refreshingMedia ? <CircularProgress size={14} /> : <Refresh />}
                onClick={refreshMediaFromR2}
                disabled={refreshingMedia || !isR2Configured()}
              >
                Refresh from Supabase
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SelectAll />}
                onClick={selectAllFiltered}
                disabled={!filteredMedia.length}
              >
                Select filtered
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Deselect />}
                onClick={clearMediaSelection}
                disabled={!selectedMedia.size}
              >
                Clear selection
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={mediaActionStatus.loading && mediaDownloadProgress ? <CircularProgress size={14} /> : <CloudDownload />}
                onClick={handleDownloadSelectedMedia}
                disabled={!selectedMedia.size || mediaActionStatus.loading}
              >
                Download selected ({selectedMedia.size})
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CloudDownload />}
                onClick={handleDownloadFilteredMedia}
                disabled={!filteredMedia.length || mediaActionStatus.loading}
              >
                Download filtered ({filteredMedia.length})
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DriveFileMove />}
                onClick={() => setOpenMoveSignal((n) => n + 1)}
                disabled={!selectedMedia.size || mediaActionStatus.loading}
              >
                Move to folder… ({selectedMedia.size})
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<Delete />}
                onClick={handleDeleteSelectedMedia}
                disabled={!selectedMedia.size || mediaActionStatus.loading}
              >
                Delete selected ({selectedMedia.size})
              </Button>
              <Button variant="outlined" color="error" onClick={handleClearImages} startIcon={<Delete />} size="small">
                Clear all
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Search by filename…"
              value={mediaSearch}
              onChange={(e) => setMediaSearch(e.target.value)}
              sx={{ minWidth: 220, flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="media-filter-label">Type</InputLabel>
              <Select
                labelId="media-filter-label"
                label="Type"
                value={mediaFilter}
                onChange={(e) => setMediaFilter(e.target.value)}
              >
                <MenuItem value="all">All types</MenuItem>
                <MenuItem value="image">Image</MenuItem>
                <MenuItem value="video">Video</MenuItem>
                <MenuItem value="audio">Audio</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {mediaActionStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{mediaActionStatus.success}</Alert>}
          {mediaActionStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{mediaActionStatus.error}</Alert>}
          {mediaDownloadProgress && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">Downloading…</Typography>
                <Typography variant="body2" color="text.secondary">
                  {mediaDownloadProgress.done} / {mediaDownloadProgress.total}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={(mediaDownloadProgress.done / mediaDownloadProgress.total) * 100}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}

          {filteredMedia.length === 0 ? (
            <Alert severity="info">No media matches your search or filter.</Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Showing {pagedMedia.length} of {filteredMedia.length} file(s)
                {mediaSearch || mediaFilter !== 'all' ? ' (filtered)' : ''}.
                Click a card to select; use download or trash icons on each file.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                {pagedMedia.map((img) => {
                  const t = img.type || inferMediaType(img.name || img.url);
                  const selected = selectedMedia.has(img.name);
                  return (
                    <Box
                      key={img.key || img.name}
                      sx={{
                        position: 'relative',
                        borderRadius: 1,
                        overflow: 'hidden',
                        border: '2px solid',
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: 'grey.100',
                        cursor: 'pointer',
                        transition: 'border-color .15s',
                        '&:hover .media-action-btn': { opacity: 1 },
                      }}
                      onClick={() => toggleMediaSelection(img.name)}
                    >
                      <Checkbox
                        size="small"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleMediaSelection(img.name)}
                        sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2, bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, p: 0.25 }}
                      />
                      <Box sx={{ position: 'absolute', top: 2, right: 2, zIndex: 2, display: 'flex', gap: 0.25 }}>
                        <Tooltip title="Download">
                          <IconButton
                            className="media-action-btn"
                            size="small"
                            color="primary"
                            disabled={mediaActionStatus.loading}
                            onClick={(e) => handleDownloadSingleMedia(img, e)}
                            sx={{
                              bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                            }}
                          >
                            <CloudDownload fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            className="media-action-btn"
                            size="small"
                            color="error"
                            disabled={mediaActionStatus.loading}
                            onClick={(e) => { e.stopPropagation(); handleDeleteSingleMedia(img); }}
                            sx={{
                              bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                            }}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <Box sx={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {t === 'video' ? (
                          <video src={img.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                        ) : t === 'audio' ? (
                          <Typography variant="caption" sx={{ p: 1, textAlign: 'center' }}>🎵 Audio</Typography>
                        ) : (
                          <img
                            src={img.url}
                            alt={img.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        )}
                      </Box>
                      <Box sx={{ p: 1, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" noWrap title={img.name} sx={{ display: 'block' }}>
                          {img.name}
                        </Typography>
                        <Chip size="small" label={t} variant="outlined" sx={{ height: 18, fontSize: '0.65rem', mt: 0.5 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              {totalMediaPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                  <Pagination
                    count={totalMediaPages}
                    page={mediaPage}
                    onChange={(_, p) => setMediaPage(p)}
                    color="primary"
                    size="small"
                  />
                </Box>
              )}
            </>
          )}
        </Box>
        )}
      </MediaFolderBrowser>

      {preloadedCount > 0 && (
        <MediaPreannotatePanel
          mediaEntry={preannotateEntry}
          imageIndex={preannotateIndex}
          imageTotal={preannotateImages.length}
          onPrev={() => {
            const prev = preannotateImages[preannotateIndex - 1];
            if (prev) setPreannotateFocusName(prev.name);
          }}
          onNext={() => {
            const next = preannotateImages[preannotateIndex + 1];
            if (next) setPreannotateFocusName(next.name);
          }}
          r2Prefix={projectPrefix}
          falKey={currentProject?.imageDatasetConfig?.falApiKey || ''}
          projectId={projectId || ''}
        />
      )}

      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" color="primary" size="large" onClick={onNextStep} sx={{ px: 4, py: 1.5, fontWeight: 600 }}>
            Next: Survey Builder →
          </Button>
        </Box>
      )}
    </Box>
  );
}
