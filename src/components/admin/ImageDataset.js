import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
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
  Error as ErrorIcon,
  Warning,
  CloudDownload,
  Delete,
  ExpandMore,
  CloudUpload,
  ContentCopy,
  Search,
  SelectAll,
  Deselect,
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, uploadImageToR2, deleteImagesFromR2, listImagesFromR2, copyImagesInR2 } from '../../lib/r2';
import { asyncPool } from '../../lib/asyncPool';
import { inferMediaType, normalizeMediaEntry, MEDIA_ACCEPT, analyzeMediaGroups, summarizeMediaGroupsBySize, analyzeMediaCategories, downloadMediaFiles } from '../../lib/mediaUtils';
import { MediaPairingGuide } from './MediaPairingGuide';
import { MediaCategoryGuide } from './MediaCategoryGuide';
import SupabaseStorageConfig from './SupabaseStorageConfig';
import { getTemplateById, listTemplates } from '../../lib/templateManager';
import {
  computeTemplateImportProgress,
  buildTemplateCopyTodo,
  mergeCopiedIntoProjectImages,
  getTemplateImportHistory,
  mergeTemplateImportHistory,
  formatTemplateImportStatus,
} from '../../lib/templateImageImport';
import { useRegion } from '../../contexts/RegionContext';
import { LOCAL_USER_ID } from '../../lib/appMode';

const MEDIA_PAGE_SIZE = 24;
/** Images per R2 copy API request. */
const R2_COPY_REQUEST_BATCH = 100;
/** How many copy requests run in parallel (up to BATCH × CONCURRENCY objects in flight). */
const R2_COPY_CONCURRENCY = 3;

function templateImportProgressLabel(status) {
  if (status.phase === 'listing') return 'Scanning template & project folders…';
  if (status.phase === 'saving') return 'Saving project image list…';
  if (status.total === 0) {
    return status.activeTemplateName
      ? `All images from "${status.activeTemplateName}" are already in this project.`
      : 'All template images are already in this project.';
  }
  const shown = Math.min(status.progress, status.total);
  const pct = status.total > 0 ? Math.round((shown / status.total) * 100) : 0;
  let label = status.activeTemplateName
    ? `Importing "${status.activeTemplateName}": ${shown} / ${status.total} (${pct}%)`
    : `Copying ${shown} / ${status.total} (${pct}%)`;
  if (status.skipped > 0) label += ` · ${status.skipped} skipped (already present)`;
  return label;
}

/** Copy template images — progress ticks +1 each time the server finishes one file. */
async function copyTemplateImagesWithRealProgress(todo, setStatus) {
  const batches = [];
  for (let i = 0; i < todo.length; i += R2_COPY_REQUEST_BATCH) {
    batches.push(todo.slice(i, i + R2_COPY_REQUEST_BATCH));
  }

  const copiedImages = [];
  const errors = [];
  const progressRef = { current: 0 };

  await asyncPool(R2_COPY_CONCURRENCY, batches, async (batch) => {
    const res = await copyImagesInR2(batch, {
      onProgress: () => {
        progressRef.current += 1;
        const done = progressRef.current;
        setStatus((prev) => ({
          ...prev,
          progress: done,
          phase: 'copying',
        }));
      },
    });
    if (res.copied?.length) copiedImages.push(...res.copied);
    if (res.errors?.length) errors.push(...res.errors);
    return res;
  });

  return { copiedImages, errors, completed: progressRef.current };
}

function safeR2Name(name = '') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function mediaEntryKey(entry, userId, projectId) {
  if (entry?.key) return entry.key;
  if (!entry?.name || !projectId) return null;
  return `${userId}/${projectId}/${safeR2Name(entry.name)}`;
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

  // HuggingFace optional section
  const [hfExpanded, setHfExpanded] = useState(false);
  const [hfConfig, setHfConfig] = useState({ enabled: false, token: '', datasetName: '' });
  const [hfStatus, setHfStatus] = useState({ loading: false, connected: false, error: null, datasetInfo: null });
  const [preloadStatus, setPreloadStatus] = useState({ loading: false, progress: 0, total: 0, error: null, success: null });

  // R2 sync state
  const [r2Syncing, setR2Syncing] = useState(false);

  // Import template images — any project can pull from any template with an R2 folder.
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateProgressMap, setTemplateProgressMap] = useState({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateImportStatus, setTemplateImportStatus] = useState({
    loading: false,
    progress: 0,
    total: 0,
    templateTotal: 0,
    skipped: 0,
    phase: 'idle', // idle | listing | copying | saving
    activeTemplateId: null,
    activeTemplateName: null,
    error: null,
    success: null,
  });

  // Uploaded media library management
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [mediaPage, setMediaPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState(() => new Set());
  const [mediaActionStatus, setMediaActionStatus] = useState({ loading: false, error: null, success: null });
  const [mediaDownloadProgress, setMediaDownloadProgress] = useState(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [groupSizeFilter, setGroupSizeFilter] = useState('all');

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const projectPrefix = projectId ? `${userId}/${projectId}/` : '';

  const normalizeR2Listing = (images = []) => images.map((img) => normalizeMediaEntry({
    url: img.url,
    name: img.name,
    key: img.key,
    type: img.type || inferMediaType(img.name),
  }));

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
    return (currentProject?.preloadedImages || []).filter((m) => {
      const t = m.type || inferMediaType(m.name || m.url);
      if (mediaFilter !== 'all' && t !== mediaFilter) return false;
      if (q && !(m.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [currentProject?.preloadedImages, mediaSearch, mediaFilter]);

  const totalMediaPages = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE));
  const pagedMedia = useMemo(() => {
    const start = (mediaPage - 1) * MEDIA_PAGE_SIZE;
    return filteredMedia.slice(start, start + MEDIA_PAGE_SIZE);
  }, [filteredMedia, mediaPage]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaSearch, mediaFilter]);

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

  // Scroll position restore
  const scrollRef = useRef(0);
  const restoreScrollRef = useRef(false);
  useEffect(() => {
    if (restoreScrollRef.current) {
      window.scrollTo(0, scrollRef.current);
      restoreScrollRef.current = false;
    }
  });

  const templateImportHistory = useMemo(
    () => getTemplateImportHistory(currentProject),
    [currentProject?.imageDatasetConfig?.templateImportHistory],
  );

  const refreshTemplateProgress = async (templateIds) => {
    if (!projectId || !isR2Configured() || !templateIds?.length) return;
    const uid = user?.id || 'anonymous';
    const entries = await Promise.all(
      templateIds.map(async (id) => {
        const progress = await computeTemplateImportProgress(id, uid, projectId);
        return [id, progress];
      }),
    );
    setTemplateProgressMap((prev) => {
      const next = { ...prev };
      entries.forEach(([id, progress]) => { next[id] = progress; });
      return next;
    });
  };

  // Load templates that ship with images (any project can import from them).
  useEffect(() => {
    let cancelled = false;
    setLoadingTemplates(true);
    listTemplates(user?.id).then((templates) => {
      if (cancelled) return;
      const withImages = templates.filter(
        (t) => Array.isArray(t.preloadedImages) && t.preloadedImages.length > 0,
      );
      setAvailableTemplates(withImages);
      setSelectedTemplateId((prev) => {
        if (prev && withImages.some((t) => t.id === prev)) return prev;
        if (currentProject?.templateId && withImages.some((t) => t.id === currentProject.templateId)) {
          return currentProject.templateId;
        }
        return withImages[0]?.id || '';
      });
    }).finally(() => {
      if (!cancelled) setLoadingTemplates(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, currentProject?.templateId]);

  // Refresh per-template import counts (supports resume after interrupt).
  useEffect(() => {
    const ids = new Set([
      ...availableTemplates.map((t) => t.id),
      ...Object.keys(templateImportHistory),
    ]);
    if (ids.size && projectId) refreshTemplateProgress([...ids]);
  }, [availableTemplates, projectId, currentProject?.preloadedImages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) || null;
  const selectedProgress = templateProgressMap[selectedTemplateId];

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

  // ── Import images from source template ───────────────────────────────────

  const handleImportFromTemplate = async (templateIdOverride) => {
    const templateId = templateIdOverride || selectedTemplateId;
    if (!templateId || !currentProject?.id) return;
    if (!isR2Configured()) {
      setTemplateImportStatus((prev) => ({
        ...prev,
        error: 'Supabase is not configured. Save Supabase credentials in the section above first.',
      }));
      return;
    }
    if (templateImportStatus.loading) return;

    const template = availableTemplates.find((t) => t.id === templateId)
      || (await getTemplateById(templateId));
    if (!template) {
      setTemplateImportStatus((prev) => ({ ...prev, error: 'Template not found.' }));
      return;
    }

    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const uid = user?.id || 'anonymous';
    const projectPrefix = `${uid}/${currentProject.id}/`;

    setTemplateImportStatus({
      loading: true,
      progress: 0,
      total: 0,
      templateTotal: 0,
      skipped: 0,
      phase: 'listing',
      activeTemplateId: template.id,
      activeTemplateName: template.name,
      error: null,
      success: null,
    });

    try {
      const progress = await computeTemplateImportProgress(template.id, uid, currentProject.id);
      if (progress.error) throw new Error(progress.error);

      const listed = { success: true, images: progress.templateImages };
      const existing = await listImagesFromR2(projectPrefix);
      if (!existing.success) {
        throw new Error(existing.error || 'Failed to list project images');
      }

      if (listed.images.length === 0) {
        setTemplateImportStatus({
          loading: false,
          progress: 0,
          total: 0,
          templateTotal: 0,
          skipped: 0,
          phase: 'idle',
          activeTemplateId: template.id,
          activeTemplateName: template.name,
          error: null,
          success: `"${template.name}" has no images in its template folder.`,
        });
        return;
      }

      const todo = buildTemplateCopyTodo(listed.images, progress.existingNames, projectPrefix);
      const total = todo.length;
      const skipCount = listed.images.length - total;

      setTemplateImportStatus((prev) => ({
        ...prev,
        templateTotal: listed.images.length,
        skipped: skipCount,
        total,
        progress: 0,
        phase: total > 0 ? 'copying' : 'saving',
      }));

      const copiedImages = [];
      const errors = [];
      if (total > 0) {
        const copyResult = await copyTemplateImagesWithRealProgress(todo, setTemplateImportStatus);
        copiedImages.push(...copyResult.copiedImages);
        errors.push(...copyResult.errors);
      }

      setTemplateImportStatus((prev) => ({
        ...prev,
        phase: 'saving',
        progress: copiedImages.length,
      }));

      const finalImages = mergeCopiedIntoProjectImages(existing.images, copiedImages);

      const afterProgress = await computeTemplateImportProgress(template.id, uid, currentProject.id);
      const historyEntry = {
        templateName: template.name,
        totalInTemplate: afterProgress.totalInTemplate,
        importedCount: afterProgress.importedCount,
        remaining: afterProgress.remaining,
        isComplete: afterProgress.isComplete,
        lastImportAt: new Date().toISOString(),
        lastBatchCopied: copiedImages.length,
      };

      const updatedImageDatasetConfig = mergeTemplateImportHistory(currentProject, template.id, historyEntry);

      onProjectUpdate({
        ...currentProject,
        preloadedImages: finalImages,
        preloadedSource: 'supabase',
        preloadedAt: new Date().toISOString(),
        imageDatasetConfig: updatedImageDatasetConfig,
      });
      if (onConfigChange) onConfigChange(true, updatedImageDatasetConfig);

      await refreshTemplateProgress([template.id]);

      const newCount = copiedImages.length;
      setTemplateImportStatus({
        loading: false,
        progress: total,
        total,
        templateTotal: listed.images.length,
        skipped: skipCount,
        phase: 'idle',
        activeTemplateId: template.id,
        activeTemplateName: template.name,
        error: errors.length ? `${errors.length} file(s) failed to copy.` : null,
        success: total === 0
          ? `All ${listed.images.length} image(s) from "${template.name}" are already in this project.`
          : `Imported ${newCount} image${newCount === 1 ? '' : 's'} from "${template.name}"${skipCount > 0 ? ` (${skipCount} already present — resume supported)` : ''}.`,
      });
    } catch (err) {
      setTemplateImportStatus({
        loading: false,
        progress: 0,
        total: 0,
        templateTotal: 0,
        skipped: 0,
        phase: 'idle',
        activeTemplateId: template?.id || null,
        activeTemplateName: template?.name || null,
        error: err.message,
        success: null,
      });
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
        const key = `${userId}/${currentProject?.id || 'default'}/${safeName}`;

        const result = await uploadImageToR2(file, key);

        if (result.success) {
          uploadedImages.push({ url: result.url, name: raw.name, type: mediaType, key });
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
    };
    onProjectUpdate(updatedProject);
    setSelectedMedia(new Set());
    setMediaPage(1);
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;
  const mediaGroups = useMemo(
    () => analyzeMediaGroups(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const groupSummary = useMemo(
    () => summarizeMediaGroupsBySize(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const pairedGroups = mediaGroups.filter((g) => g.isGrouped);
  const filteredPairedGroups = useMemo(() => {
    if (groupSizeFilter === 'all') return pairedGroups;
    const n = parseInt(groupSizeFilter, 10);
    return pairedGroups.filter((g) => g.size === n);
  }, [pairedGroups, groupSizeFilter]);
  const mediaCategories = useMemo(
    () => analyzeMediaCategories(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const mediaCounts = (currentProject?.preloadedImages || []).reduce((acc, m) => {
    const t = m.type || inferMediaType(m.name || m.url);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

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

      <SupabaseStorageConfig
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        onConfigChange={onConfigChange}
      />

      <MediaPairingGuide
        totalFileCount={preloadedCount}
        pairedSetCount={groupSummary.total}
        pairedSetsBySize={groupSummary.bySize}
      />

      <MediaCategoryGuide
        categoryCount={mediaCategories.length}
        totalFileCount={preloadedCount}
        categoryLabels={mediaCategories.map((c) => c.category)}
      />

      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Supabase is not configured. In <strong>Supabase Storage Configuration</strong> above, enter your
          Project URL and Service Role key, then click Save Configuration.
        </Alert>
      )}

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

      {preloadedCount > 0 && pairedGroups.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Detected Media Groups ({pairedGroups.length})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Upload-time pairing preview. Each row is one fixed set that stays together when a question uses
            &quot;Random fixed sets&quot; with a matching <strong>files per set</strong> count.
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
                  <TableRow key={g.groupKey} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{g.groupId}</Typography>
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

      {preloadedCount > 0 && mediaCategories.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'secondary.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Detected Media Categories ({mediaCategories.length})
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

      {/* ── Import from templates (any project) ── */}
      {isR2Configured() && (loadingTemplates || availableTemplates.length > 0 || Object.keys(templateImportHistory).length > 0) && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'secondary.light' }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ContentCopy fontSize="small" color="secondary" />
            Import Template Images
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copy images from any published template into this project. You can import from multiple templates;
            files already in your project folder are skipped automatically so interrupted imports can be resumed.
          </Typography>

          {/* Import history — templates with progress or past imports */}
          {(() => {
            const historyIds = [...new Set([
              ...Object.keys(templateImportHistory),
              ...availableTemplates.map((t) => t.id),
            ])].filter((tid) => {
              const hist = templateImportHistory[tid];
              const live = templateProgressMap[tid];
              const imported = live?.importedCount ?? hist?.importedCount ?? 0;
              return imported > 0 || hist?.lastImportAt;
            });
            if (historyIds.length === 0) return null;
            const totalImportedFiles = historyIds.reduce((sum, tid) => {
              const live = templateProgressMap[tid];
              const hist = templateImportHistory[tid];
              return sum + (live?.importedCount ?? hist?.importedCount ?? 0);
            }, 0);
            return (
              <>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>{historyIds.length}</strong> template{historyIds.length === 1 ? '' : 's'} with imports ·{' '}
                  <strong>{totalImportedFiles}</strong> template file{totalImportedFiles === 1 ? '' : 's'} in this project
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, maxHeight: 280 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Template</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Imported</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Last import</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {historyIds.map((tid) => {
                        const hist = templateImportHistory[tid];
                        const tpl = availableTemplates.find((t) => t.id === tid);
                        const live = templateProgressMap[tid];
                        const total = live?.totalInTemplate ?? hist?.totalInTemplate ?? tpl?.preloadedImages?.length ?? 0;
                        const imported = live?.importedCount ?? hist?.importedCount ?? 0;
                        const remaining = live?.remaining ?? hist?.remaining ?? Math.max(0, total - imported);
                        const isComplete = live?.isComplete ?? hist?.isComplete ?? (total > 0 && remaining === 0);
                        const name = hist?.templateName || tpl?.name || tid;
                        const lastAt = hist?.lastImportAt
                          ? new Date(hist.lastImportAt).toLocaleString()
                          : '—';
                        const isActive = templateImportStatus.loading && templateImportStatus.activeTemplateId === tid;
                        return (
                          <TableRow key={tid} hover selected={selectedTemplateId === tid}>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600}>{name}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{tid}</Typography>
                            </TableCell>
                            <TableCell align="right">{imported}</TableCell>
                            <TableCell align="right">{total}</TableCell>
                            <TableCell>
                              {isComplete ? (
                                <Chip size="small" color="success" label="Complete" />
                              ) : remaining > 0 ? (
                                <Chip size="small" color="warning" label={`${remaining} remaining`} />
                              ) : (
                                <Chip size="small" variant="outlined" label="In progress" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">{lastAt}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              {!isComplete && total > 0 && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={templateImportStatus.loading}
                                  onClick={() => {
                                    setSelectedTemplateId(tid);
                                    handleImportFromTemplate(tid);
                                  }}
                                >
                                  {isActive ? 'Importing…' : `Resume (${remaining})`}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            );
          })()}

          {loadingTemplates ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Loading templates…</Typography>
            </Box>
          ) : availableTemplates.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              No templates with images are available yet. Upload images to a template in Admin → Templates first.
            </Alert>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-end', mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 280 }}>
                <InputLabel id="template-import-select">Template to import</InputLabel>
                <Select
                  labelId="template-import-select"
                  label="Template to import"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={templateImportStatus.loading}
                >
                  {availableTemplates.map((t) => {
                    const live = templateProgressMap[t.id];
                    const status = formatTemplateImportStatus(live) || `${t.preloadedImages?.length || 0} in catalog`;
                    return (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name} ({status})
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
              {selectedTemplate && selectedProgress && !selectedProgress.isComplete && selectedProgress.remaining > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {selectedProgress.importedCount}/{selectedProgress.totalInTemplate} already in project ·{' '}
                  {selectedProgress.remaining} left to copy
                </Typography>
              )}
            </Box>
          )}

          {templateImportStatus.loading && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, gap: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {templateImportProgressLabel(templateImportStatus)}
                </Typography>
                {templateImportStatus.phase === 'copying' && templateImportStatus.total > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {Math.min(
                      100,
                      Math.round((templateImportStatus.progress / templateImportStatus.total) * 100),
                    )}%
                  </Typography>
                )}
              </Box>
              <LinearProgress
                variant={templateImportStatus.phase === 'copying' && templateImportStatus.total > 0
                  ? 'determinate'
                  : 'indeterminate'}
                value={templateImportStatus.total > 0
                  ? Math.min(
                    (templateImportStatus.progress / templateImportStatus.total) * 100,
                    100,
                  )
                  : undefined}
                sx={{ height: 8, borderRadius: 4 }}
              />
              {templateImportStatus.templateTotal > 0 && templateImportStatus.phase === 'copying' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  Template has {templateImportStatus.templateTotal} file(s) total
                  {templateImportStatus.skipped > 0
                    ? ` · ${templateImportStatus.skipped} already in your project folder (resume)`
                    : ''}
                </Typography>
              )}
            </Box>
          )}

          {templateImportStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{templateImportStatus.success}</Alert>}
          {templateImportStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{templateImportStatus.error}</Alert>}

          {availableTemplates.length > 0 && (
            <Button
              variant="contained"
              color="secondary"
              onClick={() => handleImportFromTemplate()}
              disabled={templateImportStatus.loading || !selectedTemplateId}
              startIcon={templateImportStatus.loading ? <CircularProgress size={18} color="inherit" /> : <ContentCopy />}
            >
              {templateImportStatus.loading
                ? 'Importing…'
                : selectedProgress?.remaining > 0
                  ? `Resume import (${selectedProgress.remaining} remaining)`
                  : selectedProgress?.isComplete
                    ? 'Re-check template (all copied)'
                    : 'Import from selected template'}
            </Button>
          )}
        </Box>
      )}

      {/* ── Direct Upload ── */}
      <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'primary.light' }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CloudUpload fontSize="small" color="primary" />
          Upload Media to Supabase Storage
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select image, video, or audio files to upload to Supabase Storage.
          Images over 300 KB are automatically compressed in your browser before upload.
        </Typography>

        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading}>
            Choose Media Files
          </Button>
          {selectedFiles.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {selectedFiles.length} file(s) selected
            </Typography>
          )}
        </Box>

        {directUploadStatus.loading && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Uploading...</Typography>
              <Typography variant="body2" color="text.secondary">
                {directUploadStatus.progress} / {directUploadStatus.total}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={directUploadStatus.total > 0 ? (directUploadStatus.progress / directUploadStatus.total) * 100 : 0}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {directUploadStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{directUploadStatus.success}</Alert>}
        {directUploadStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{directUploadStatus.error}</Alert>}

        <Button
          variant="contained"
          color="primary"
          onClick={handleDirectUpload}
          disabled={!selectedFiles.length || directUploadStatus.loading || !isR2Configured()}
          startIcon={directUploadStatus.loading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
        >
          Upload {selectedFiles.length > 0 ? `${selectedFiles.length} File(s)` : ''} to Supabase
        </Button>
      </Box>

      {/* ── Uploaded Media Library ── */}
      {preloadedCount > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Uploaded Media ({preloadedCount})
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

      <Divider sx={{ my: 4 }} />

      {/* ── HuggingFace (Optional) ── */}
      <Accordion
        expanded={hfExpanded}
        onChange={(_, v) => setHfExpanded(v)}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              🤗 HuggingFace Dataset Import (Optional)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Batch-import images from a HuggingFace dataset into Supabase Storage
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" component="div">
              1. <strong>Public datasets:</strong> Leave token empty<br />
              2. <strong>Private datasets:</strong> Get token from{' '}
              <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">
                HuggingFace Settings → Access Tokens
              </a><br />
              3. Format: <code>owner/dataset</code> for parquet-style datasets
              (e.g. <code>sijiey/Thermal-Affordance-Dataset</code>),
              or <code>owner/dataset/subfolder</code> to import an image folder
              (e.g. <code>Jusba/Greenery_Survey_Helsinki_Mapillary/images</code>)<br />
              4. Enable, save, test connection, then click Preload
            </Typography>
          </Alert>

          {(hfStatus.connected || hfStatus.error) && (
            <Alert severity={hfStatus.connected ? 'success' : 'error'} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {hfStatus.loading ? <CircularProgress size={18} /> : hfStatus.connected ? <CheckCircle /> : <ErrorIcon />}
                <Typography variant="body2">
                  {hfStatus.connected ? 'Connection successful!' : hfStatus.error}
                </Typography>
              </Box>
            </Alert>
          )}

          <Box sx={{ p: 2.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', mb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={<Switch checked={hfConfig.enabled} onChange={(e) => setHfConfig(p => ({ ...p, enabled: e.target.checked }))} />}
                label="Enable HuggingFace Dataset Integration"
              />
              <TextField
                fullWidth label="Access Token (optional)" type="password"
                value={hfConfig.token}
                onChange={(e) => setHfConfig(p => ({ ...p, token: e.target.value }))}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxx"
                helperText="Leave empty for public datasets"
                disabled={!hfConfig.enabled} size="small"
              />
              <TextField
                fullWidth label="Dataset Name" value={hfConfig.datasetName}
                onChange={(e) => setHfConfig(p => ({ ...p, datasetName: e.target.value }))}
                placeholder="owner/dataset  or  owner/dataset/subfolder"
                helperText="Use 'owner/dataset' for rows-style data, or 'owner/dataset/subfolder' to import an image folder"
                disabled={!hfConfig.enabled} size="small"
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant="contained" size="small" onClick={saveHfConfig} disabled={!hfConfig.enabled || !hfConfig.datasetName}>
                  Save
                </Button>
                <Button variant="outlined" size="small" onClick={testHfConnection}
                  disabled={!hfConfig.enabled || !hfConfig.datasetName || hfStatus.loading}
                  startIcon={hfStatus.loading ? <CircularProgress size={16} /> : <Refresh />}>
                  Test Connection
                </Button>
              </Box>
            </Box>
          </Box>

          {hfStatus.datasetInfo && hfStatus.connected && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{hfStatus.datasetInfo.id}</strong> — {hfStatus.datasetInfo.imageCount || 0} images found
              </Typography>
            </Alert>
          )}

          {preloadStatus.loading && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">Downloading from HuggingFace → Uploading to Supabase Storage...</Typography>
                <Typography variant="body2" color="text.secondary">{preloadStatus.progress} / {preloadStatus.total}</Typography>
              </Box>
              <LinearProgress variant="determinate"
                value={preloadStatus.total > 0 ? (preloadStatus.progress / preloadStatus.total) * 100 : 0}
                sx={{ height: 8, borderRadius: 4 }} />
            </Box>
          )}
          {preloadStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{preloadStatus.success}</Alert>}
          {preloadStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{preloadStatus.error}</Alert>}

          <Button
            variant="contained" color="primary"
            onClick={handlePreloadAllImages}
            disabled={!hfStatus.connected || !isR2Configured() || preloadStatus.loading}
            startIcon={preloadStatus.loading ? <CircularProgress size={20} /> : <CloudDownload />}
          >
            {preloadedCount > 0 ? 'Re-preload All Images to Supabase' : 'Preload All Images to Supabase'}
          </Button>

          {!hfStatus.connected && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Configure HuggingFace dataset and test connection first.
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>

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
