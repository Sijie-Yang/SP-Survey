import { mergeMediaLibraryListing } from '../../lib/mediaLibrarySync';
import { useMediaLibraryText } from '../../contexts/mediaLibraryI18n';
import { uploadMediaBatch, pickUploadMedia } from '../../lib/mediaUploadBatch';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  CloudDownload,
  Delete,
  CloudUpload,
  Search,
  SelectAll,
  Deselect,
  DriveFileMove,
  Visibility,
  Audiotrack,
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, resetR2ProxyUnreachable, uploadImageToR2, deleteImagesFromR2, listImagesFromR2, projectR2Prefix, stripTemplateOwnedMedia, r2KeyFromUrl, isTemplateR2Key } from '../../lib/r2';
import {
  inferMediaType, normalizeMediaEntry, getMediaId, MEDIA_ACCEPT,
  analyzeTaggedSets, analyzeTaggedCategories,
  sortMediaByName, compareMediaNames, buildProjectMediaKey, joinFolderPath,
  normalizeFolderPath, IMAGE_COMPRESS_TARGET_BYTES, MAX_AV_MEDIA_BYTES,
  formatMediaMb, getRecursiveMedia, downloadMediaFile,
} from '../../lib/mediaUtils';
import {
  downloadMediaEntriesZip,
  downloadFolderMediaZip,
  downloadFeatureCsvsZip,
} from '../../lib/mediaLibraryDownload';
import { migrateLegacyDefaultLabelColors } from '../../lib/preannotateLabels';
import MediaPairingGuide from './MediaPairingGuide';
import MediaCategoryGuide from './MediaCategoryGuide';
import MediaFolderBrowser from './MediaFolderBrowser';
import MediaKeywordSelection from './MediaKeywordSelection';
import { mediaSelectionCandidates } from '../../lib/mediaLibrarySelection';
import MediaFilePreviewDialog from './MediaFilePreviewDialog';
import SpatialIntelligencePanel from './SpatialIntelligencePanel';
import MediaPreannotatePanel from './MediaPreannotatePanel';
import MediaPreannotateResults from './MediaPreannotateResults';
import ConfirmDialog from '../layout/ConfirmDialog';
import { AdminPageHeader } from './AdminPageLayout';
import { L0_MODEL } from '../../lib/imageFeaturesL0';
import { SEG_MODEL } from '../../lib/falInference';
import {
  loadFeaturesMapFromR2,
  featureStatusFromMap,
  migrateLegacyFeaturesToR2,
  FEATURE_MODELS,
  SAM_PREANNOT_MODEL,
} from '../../lib/imageFeaturesR2';
import { featureStorageKey } from '../../lib/imageFeaturesStore';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import { LOCAL_USER_ID } from '../../lib/appMode';
import SupabaseStorageConfig from './SupabaseStorageConfig';

const MEDIA_PAGE_SIZE = 24;

function mediaEntryKey(entry, userId, projectId) {
  const prefix = projectR2Prefix(userId, projectId);
  if (!prefix) return null;

  // Only delete objects that live under THIS project. Template keys/URLs must
  // never be deleted from the project media UI.
  if (entry?.key) {
    if (entry.key.startsWith(prefix)) return entry.key;
    if (isTemplateR2Key(entry.key)) return null;
  }
  const fromUrl = r2KeyFromUrl(entry?.url);
  if (fromUrl) {
    if (fromUrl.startsWith(prefix)) return fromUrl;
    if (isTemplateR2Key(fromUrl)) return null;
  }
  if (!entry?.name) return null;
  // Nested folders must keep their relative path; basename-only keys collide.
  return buildProjectMediaKey(prefix, entry.folder || '', entry.name);
}

function mediaEntryIdentity(entry, userId, projectId) {
  return getMediaId(entry)
    || mediaEntryKey(entry, userId, projectId)
    || entry?.url
    || entry?.name
    || null;
}

export default function ImageDataset({ currentProject, onProjectUpdate, onConfigChange, onNextStep, focusRequest }) {
  const tx = useMediaLibraryText();
  const { t, language } = useRegion();
  const zh = language === 'zh';
  const user = { id: LOCAL_USER_ID };
  const currentProjectRef = useRef(currentProject);
  currentProjectRef.current = currentProject;

  // Direct upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [directUploadStatus, setDirectUploadStatus] = useState({
    loading: false, progress: 0, total: 0, error: null, success: null,
  });
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const uploadBaseFolder = useRef(null);
  const [skippedUploadFiles, setSkippedUploadFiles] = useState(0);
  const chooseUploadFiles = (list) => {
    if (!list?.length) return;
    const { files, skipped } = pickUploadMedia(list);
    setSelectedFiles(files); setSkippedUploadFiles(skipped); setUploadFailures([]);
    uploadBaseFolder.current = null;
    setDirectUploadStatus({ loading: false, progress: 0, total: 0, error: null, success: null });
  };
  const uploadLock = useRef(false);
  const stopUpload = useRef(false);
  const [uploadFailures, setUploadFailures] = useState([]);
  const [pendingMediaSave, setPendingMediaSave] = useState(null);
  const [compressUploads, setCompressUploads] = useState(true);
  useUnsavedChanges(directUploadStatus.loading || !!pendingMediaSave);
  useEffect(() => { stopUpload.current = false; return () => { stopUpload.current = true; }; }, []);

  // HuggingFace optional section
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
  const [previewEntry, setPreviewEntry] = useState(null);
  const [mediaActionStatus, setMediaActionStatus] = useState({ loading: false, error: null, success: null });
  const [mediaDownloadProgress, setMediaDownloadProgress] = useState(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [groupSizeFilter, setGroupSizeFilter] = useState('all');
  const [featureInspect, setFeatureInspect] = useState(null); // { name, mediaId, records }
  const [r2FeatureMap, setR2FeatureMap] = useState({});
  const [preannotateFocusName, setPreannotateFocusName] = useState(null);
  /** Latest autosave → patch Pre-annotate results without re-fetching the library. */
  const [preannotateSavedPatch, setPreannotateSavedPatch] = useState(null);
  /** Accumulated batch saves for results panel (multi-image). */
  const [preannotateBatchPatches, setPreannotateBatchPatches] = useState([]);
  const [preannotateLastBatch, setPreannotateLastBatch] = useState(null);
  const [preannotateReviewFilter, setPreannotateReviewFilter] = useState(null);
  /** name → 'accepted' | 'needs_review' from saves / Accept·Needs fix clicks */
  const [preannotateReviewByName, setPreannotateReviewByName] = useState(() => ({}));
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }
  const [currentFolder, setCurrentFolder] = useState('');
  const [selectedFolders, setSelectedFolders] = useState(() => new Set());
  useEffect(() => { setSelectedFolders(new Set()); setSelectedMedia(new Set()); }, [currentProject?.id]);
  const [openMoveSignal, setOpenMoveSignal] = useState(0);

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const projectPrefix = projectId ? `${userId}/${projectId}/` : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectPrefix || !isR2Configured()) {
        setR2FeatureMap({});
        return;
      }
      try {
        const legacy = currentProject?.imageDatasetConfig?.imageFeatures;
        if (legacy && Object.keys(legacy).length) {
          await migrateLegacyFeaturesToR2(projectPrefix, legacy);
        }
        const map = await loadFeaturesMapFromR2(projectPrefix, FEATURE_MODELS);
        if (!cancelled) setR2FeatureMap(map);
      } catch (err) {
        console.warn('loadFeaturesMapFromR2', err);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPrefix, currentProject?.preloadedImages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strip accidental template-owned URLs/keys from project media list.
  // (Legacy bug: create-from-template copied template refs into preloadedImages.)
  useEffect(() => {
    const imgs = currentProject?.preloadedImages;
    if (!imgs?.length || !onProjectUpdate) return;
    const cleaned = stripTemplateOwnedMedia(imgs);
    if (cleaned.length === imgs.length) return;
    console.warn(
      `Removed ${imgs.length - cleaned.length} template-owned media ref(s) from project ${currentProject.id}`,
    );
    onProjectUpdate({
      ...currentProject,
      preloadedImages: cleaned,
      preloadedAt: cleaned.length ? currentProject.preloadedAt : null,
      preloadedSource: cleaned.length ? currentProject.preloadedSource : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id, currentProject?.preloadedImages?.length]);

  // Backfill media_id on legacy preloadedImages entries
  useEffect(() => {
    const imgs = currentProject?.preloadedImages;
    if (!imgs?.length || !onProjectUpdate) return;
    let changed = false;
    const next = imgs.map((raw) => {
      const n = normalizeMediaEntry(raw);
      if (!n) return raw;
      if (raw.media_id === n.media_id && raw.type === n.type) return raw;
      changed = true;
      return { ...raw, media_id: n.media_id, type: n.type || raw.type };
    });
    if (changed) {
      onProjectUpdate({ ...currentProject, preloadedImages: next });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when project id / image count changes
  }, [currentProject?.id, currentProject?.preloadedImages?.length]);

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
    const startingProject = currentProjectRef.current;
    setRefreshingMedia(true);
    setMediaActionStatus({ loading: false, error: null, success: null });
    try {
      const result = await listImagesFromR2(projectPrefix);
      if (!result.success) {
        if (result.unreachable || /load failed|failed to fetch|unreachable/i.test(result.error || '')) {
          setMediaActionStatus({
            loading: false,
            error: tx("Could not refresh the storage file list. Saved media is unchanged."),
            success: null,
          });
          return;
        }
        throw new Error(result.error || tx("Failed to list media from Supabase"));
      }
      if (currentProjectRef.current !== startingProject) return;
      const images = mergeMediaLibraryListing(result.images, startingProject.preloadedImages, projectPrefix);
      persistPreloadedImages(images);
      setSelectedMedia(new Set());
      setMediaPage(1);
      setMediaActionStatus({
        loading: false,
        error: null,
        success: tx("Synced {v0} file(s) from Supabase Storage.", { v0: images.length }),
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

    const label = entries.length === 1 ? `"${entries[0].name}"` : tx("{v0} files", { v0: entries.length });
    setConfirmDialog({
      title: tx("Delete media"),
      message: tx("Delete {v0} from Supabase Storage? This cannot be undone.", { v0: label }),
      confirmLabel: tx("Delete"),
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        setMediaActionStatus({ loading: true, error: null, success: null });
        try {
          if (isR2Configured()) {
            const keys = entries
              .map((entry) => mediaEntryKey(entry, userId, projectId))
              .filter(Boolean);
            if (keys.length) {
              const del = await deleteImagesFromR2(keys, {
                allowedPrefix: projectR2Prefix(userId, projectId),
              });
              if (!del.success) throw new Error(del.error || tx("Failed to delete from Supabase"));
            }
          }

          const removeIds = new Set(
            entries.map((entry) => mediaEntryIdentity(entry, userId, projectId)).filter(Boolean),
          );
          const remaining = (currentProject.preloadedImages || []).filter((m) => {
            const id = mediaEntryIdentity(m, userId, projectId);
            return !id || !removeIds.has(id);
          });
          persistPreloadedImages(remaining);
          setSelectedMedia((prev) => {
            const next = new Set(prev);
            entries.forEach((entry) => {
              next.delete(getMediaId(entry));
            });
            return next;
          });
          setMediaActionStatus({
            loading: false,
            error: null,
            success: tx("Deleted {v0} file(s).", { v0: entries.length }),
          });
        } catch (err) {
          setMediaActionStatus({ loading: false, error: err.message, success: null });
        }
      },
    });
  };

  const handleDeleteSingleMedia = (entry) => deleteMediaEntries([entry]);
  const handleDeleteSelectedMedia = () => {
    const selected = (currentProject?.preloadedImages || []).filter((m) => selectedMedia.has(getMediaId(m)));
    if (!selected.length) return;
    deleteMediaEntries(selected);
  };

  const downloadMediaEntriesAsZip = async (entries, filenameHint) => {
    if (!entries.length) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    setMediaDownloadProgress({ done: 0, total: entries.length });
    try {
      const { succeeded, failed, failures, filename } = await downloadMediaEntriesZip(entries, {
        projectPrefix,
        filename: filenameHint,
        onProgress: (done, total) => setMediaDownloadProgress({ done, total }),
      });
      const failHint = failed > 0
        ? tx(" {v0} failed ({v1}{v2}).", { v0: failed, v1: failures.slice(0, 2).map((f) => f.name).join(', '), v2: failures.length > 2 ? '…' : '' })
        : '';
      setMediaActionStatus({
        loading: false,
        error: null,
        success: tx("ZIP {v0}: {v1} file(s), folders preserved.{v2}", { v0: filename, v1: succeeded, v2: failHint }),
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setMediaDownloadProgress(null);
    }
  };

  const handleDownloadSingleMedia = async (entry, e) => {
    e?.stopPropagation();
    if (!entry) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    try {
      await downloadMediaFile(entry);
      setMediaActionStatus({ loading: false, error: null, success: tx("Downloaded {v0}.", { v0: entry.name || 'file' }) });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    }
  };

  const handleDownloadSelectedMedia = () => {
    const selected = (currentProject?.preloadedImages || []).filter((m) => selectedMedia.has(getMediaId(m)));
    if (!selected.length) return;
    downloadMediaEntriesAsZip(selected, `media_selected_${new Date().toISOString().slice(0, 10)}.zip`);
  };

  const handleDownloadFilteredMedia = () => {
    if (!filteredMedia.length) return;
    const label = currentFolder ? currentFolder.split('/').pop() : 'root';
    downloadMediaEntriesAsZip(
      filteredMedia,
      `media_${String(label).replace(/[^a-zA-Z0-9._-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.zip`,
    );
  };

  const handleDownloadFolderRecursive = async () => {
    const pool = currentProject?.preloadedImages || [];
    const entries = getRecursiveMedia(pool, currentFolder || '', projectPrefix);
    if (!entries.length) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    setMediaDownloadProgress({ done: 0, total: entries.length });
    try {
      const { succeeded, failed, failures, filename } = await downloadFolderMediaZip(pool, currentFolder || '', {
        projectPrefix,
        onProgress: (done, total) => setMediaDownloadProgress({ done, total }),
      });
      const failHint = failed > 0
        ? tx(" {v0} failed ({v1}{v2}).", { v0: failed, v1: failures.slice(0, 2).map((f) => f.name).join(', '), v2: failures.length > 2 ? '…' : '' })
        : '';
      setMediaActionStatus({
        loading: false,
        error: null,
        success: tx("ZIP {v0}: {v1} file(s) under {v2} (recursive).{v3}", { v0: filename, v1: succeeded, v2: currentFolder || tx('root'), v3: failHint }),
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setMediaDownloadProgress(null);
    }
  };

  const handleDownloadFeatureCsvs = async () => {
    if (!projectPrefix) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    try {
      const { filename, included, missing } = await downloadFeatureCsvsZip(projectPrefix, {
        models: [L0_MODEL, SEG_MODEL],
      });
      const missHint = missing.length ? tx(" Missing: {v0}.", { v0: missing.join(', ') }) : '';
      setMediaActionStatus({
        loading: false,
        error: null,
        success: tx("Downloaded {v0} ({v1}).{v2}", { v0: filename, v1: included.join(', '), v2: missHint }),
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    }
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

  const selectionCandidates = useMemo(() => mediaSelectionCandidates(currentProject?.preloadedImages, {
    folders: selectedFolders, currentFolder, search: mediaSearch, type: mediaFilter, prefix: projectPrefix,
  }), [currentProject?.preloadedImages, selectedFolders, currentFolder, mediaSearch, mediaFilter, projectPrefix]);

  /** Images available for SAM pre-annotate (respects gallery filter/search). */
  const preannotateImages = useMemo(
    () => filteredMedia.filter((m) => (m.type || inferMediaType(m.name || m.url)) === 'image'),
    [filteredMedia],
  );

  const preannotateIndex = useMemo(() => {
    if (!preannotateFocusName) return 0;
    const idx = preannotateImages.findIndex((m) => getMediaId(m) === preannotateFocusName || m.name === preannotateFocusName);
    return idx >= 0 ? idx : 0;
  }, [preannotateImages, preannotateFocusName, focusRequest]);

  const preannotateEntry = preannotateImages[preannotateIndex] || null;
  const handledFocusRef = useRef(null);
  useEffect(() => {
    if (focusRequest?.scrollTo !== 'supabase-storage' || handledFocusRef.current === focusRequest.token) return;
    handledFocusRef.current = focusRequest.token;
    const timer = setTimeout(() => {
      document.getElementById('media-supabase-storage')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 200);
    return () => clearTimeout(timer);
  }, [focusRequest]);

  useEffect(() => {
    if (!focusRequest?.mediaId || handledFocusRef.current === focusRequest.token) return;
    const entry = (currentProject?.preloadedImages || []).map((m) => normalizeMediaEntry(m, projectPrefix)).find((m) => getMediaId(m) === focusRequest.mediaId);
    if (!entry) return;
    handledFocusRef.current = focusRequest.token;
    setCurrentFolder(entry.folder || ''); setMediaSearch(''); setMediaFilter('all');
    const folderItems = sortMediaByName((currentProject.preloadedImages || []).map((m) => normalizeMediaEntry(m, projectPrefix)).filter((m) => (m.folder || '') === (entry.folder || '')));
    setMediaPage(Math.floor(folderItems.findIndex((m) => getMediaId(m) === getMediaId(entry)) / MEDIA_PAGE_SIZE) + 1);
    setPreannotateReviewFilter(null); setPreannotateFocusName(getMediaId(entry));
    setSelectedMedia(new Set([getMediaId(entry)]));
    const timer = setTimeout(() => document.getElementById('media-preannotate-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 200);
    return () => clearTimeout(timer);
  }, [focusRequest, currentProject?.preloadedImages, projectPrefix]);


  const preannotScrollLockRef = useRef(null); // { top: number } panel viewport top before nav

  const focusMediaInGallery = useCallback((name) => {
    if (!name) return;
    const panel = document.getElementById('media-preannotate-panel');
    if (panel) {
      preannotScrollLockRef.current = { top: panel.getBoundingClientRect().top };
    } else {
      preannotScrollLockRef.current = { top: null, y: window.scrollY };
    }
    setPreannotateFocusName(name);
    const focusedEntry = filteredMedia.find((m) => getMediaId(m) === name || m.name === name);
    setSelectedMedia(new Set(focusedEntry ? [getMediaId(focusedEntry)] : []));
    const idxInFiltered = filteredMedia.findIndex((m) => getMediaId(m) === name || m.name === name);
    if (idxInFiltered >= 0) {
      setMediaPage(Math.floor(idxInFiltered / MEDIA_PAGE_SIZE) + 1);
    }
  }, [filteredMedia]);

  const reviewQueueNames = useMemo(() => {
    const batch = preannotateLastBatch;
    const identify = (item) => item.media_id || item.url || (preannotateImages.filter((m) => m.name === item.name).length === 1 ? getMediaId(preannotateImages.find((m) => m.name === item.name)) : null);
    const imgs = (Array.isArray(batch?.images) ? batch.images : []).map((item) => ({ ...item, media_id: identify(item) }));
    const failNames = new Set((batch?.failures || []).map(identify).filter(Boolean));
    const inGallery = (n) => preannotateImages.some((m) => getMediaId(m) === n);
    if (preannotateReviewFilter === 'last_batch') {
      return imgs
        .filter((i) => (i.status === 'done' || i.status === 'partial') && (i.polygonsAdded > 0 || (i.addedShapeIds || []).length))
        .map((i) => i.media_id)
        .filter(inGallery);
    }
    if (preannotateReviewFilter === 'zero') {
      return imgs.filter((i) => i.status === 'zero').map((i) => i.media_id).filter(inGallery);
    }
    if (preannotateReviewFilter === 'failed') {
      return [...failNames].filter(inGallery);
    }
    if (preannotateReviewFilter === 'needs_review') {
      // Real Accept / Needs fix marks — not "everything from last batch".
      return preannotateImages
        .filter((m) => preannotateReviewByName[getMediaId(m)] === 'needs_review')
        .map(getMediaId);
    }
    return [];
  }, [preannotateLastBatch, preannotateReviewFilter, preannotateImages, preannotateReviewByName]);

  const focusReviewRelative = useCallback((delta) => {
    if (!reviewQueueNames.length) return;
    const cur = preannotateFocusName;
    let idx = reviewQueueNames.indexOf(cur);
    if (idx < 0) idx = 0;
    else idx = (idx + delta + reviewQueueNames.length) % reviewQueueNames.length;
    focusMediaInGallery(reviewQueueNames[idx]);
  }, [reviewQueueNames, preannotateFocusName, focusMediaInGallery]);

  useEffect(() => {
    if (!preannotateReviewFilter || !reviewQueueNames.length) return;
    if (!preannotateFocusName || !reviewQueueNames.includes(preannotateFocusName)) {
      focusMediaInGallery(reviewQueueNames[0]);
    }
  }, [preannotateReviewFilter, reviewQueueNames, preannotateFocusName, focusMediaInGallery]);

  useLayoutEffect(() => {
    const lock = preannotScrollLockRef.current;
    if (!lock) return;
    preannotScrollLockRef.current = null;
    const panel = document.getElementById('media-preannotate-panel');
    if (panel && typeof lock.top === 'number') {
      const delta = panel.getBoundingClientRect().top - lock.top;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      return;
    }
    if (typeof lock.y === 'number') window.scrollTo(0, lock.y);
  }, [preannotateFocusName, mediaPage, selectedMedia]);

  // Keep focus valid when filter/list changes
  useEffect(() => {
    if (!preannotateImages.length) {
      setPreannotateFocusName(null);
      return;
    }
    if (!preannotateFocusName || !preannotateImages.some((m) => getMediaId(m) === preannotateFocusName || m.name === preannotateFocusName)) {
      const requested = preannotateImages.find((m) => getMediaId(m) === focusRequest?.mediaId);
      setPreannotateFocusName(getMediaId(requested || preannotateImages[0]));
    }
  }, [preannotateImages, preannotateFocusName, focusRequest]);

  // One-time: stock labels still on old index colors → semantic defaults
  useEffect(() => {
    if (!currentProject || !onProjectUpdate) return;
    const migrated = migrateLegacyDefaultLabelColors(
      currentProject?.imageDatasetConfig?.preannotateLabels,
    );
    if (!migrated) return;
    onProjectUpdate({
      ...currentProject,
      imageDatasetConfig: {
        ...(currentProject.imageDatasetConfig || {}),
        preannotateLabels: migrated,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id, currentProject?.imageDatasetConfig?.preannotateLabels]);

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

  /** Card click: preview media; images also focus Pre-annotate. Multi-select via checkbox. */
  const handleMediaCardClick = (img) => {
    const t = img.type || inferMediaType(img.name || img.url);
    setPreviewEntry(img);
    if (t === 'image') {
      focusMediaInGallery(getMediaId(img));
    }
  };

  const selectAllFiltered = () => {
    setSelectedMedia(new Set(selectionCandidates.map(getMediaId)));
  };

  const clearMediaSelection = () => setSelectedMedia(new Set());

  // On mount / project change: sync actual image count from R2
  useEffect(() => {
    if (!isR2Configured() || !currentProject?.id || !user?.id) return;
    let cancelled = false;
    const startingProject = currentProjectRef.current;
    const userId = user.id;
    const prefix = `${userId}/${currentProject.id}/`;

    setR2Syncing(true);
    listImagesFromR2(prefix).then((result) => {
      if (cancelled) return;
      setR2Syncing(false);
      if (!result.success || result.images.length === 0 || currentProjectRef.current !== startingProject) return;
      // If R2 has more images than stored locally, update the project record
      const storedCount = currentProject.preloadedImages?.length || 0;
      if (result.images.length !== storedCount) {
        const images = mergeMediaLibraryListing(result.images, startingProject.preloadedImages, prefix);
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
        setHfStatus({ loading: false, connected: false, error: result.error || tx("Connection failed"), datasetInfo: null });
      }
    } catch (e) {
      setHfStatus({ loading: false, connected: false, error: e.message, datasetInfo: null });
    }
  };

  // ── Direct upload ────────────────────────────────────────

  // Compress image to stay under maxBytes using Canvas
  const compressImage = (file, maxBytes = IMAGE_COMPRESS_TARGET_BYTES, quality = 0.85) => {
    return new Promise((resolve, reject) => {
      if (file.size <= maxBytes) { resolve(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
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
        const context = canvas.getContext('2d');
        if (!context) throw new Error(tx("Image conversion unavailable; disable compression and retry."));
        context.drawImage(img, 0, 0, width, height);
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
        } catch (err) { reject(err); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tx("Image could not be decoded; check the source file."))); };
      img.src = url;
    });
  };

  const handleDirectUpload = async () => {
    if (!selectedFiles.length || uploadLock.current || pendingMediaSave || !currentProject?.id || !user?.id) return;
    if (!isR2Configured()) return;
    uploadLock.current = true;
    resetR2ProxyUnreachable();
    stopUpload.current = false;
    const files = [...selectedFiles];
    const project = currentProject;
    const folder = uploadBaseFolder.current ?? currentFolder;
    uploadBaseFolder.current = folder;
    let latestProject = project;
    setUploadFailures([]);
    setDirectUploadStatus({ loading: true, progress: 0, total: files.length, error: null, success: null });
    try {
      const result = await uploadMediaBatch({
        files, prefix: `${user.id}/${project.id}/`, folder,
        // Animated GIFs must retain their frames; compression remains explicit.
        prepare: (raw, type) => type === 'image' && compressUploads && !/\.gif$/i.test(raw.name) ? compressImage(raw) : raw,
        upload: uploadImageToR2,
        makeId: () => typeof window.crypto?.randomUUID === 'function' ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        shouldStop: () => stopUpload.current,
        persist: async (uploaded) => {
          latestProject = { ...project, preloadedImages: [...(project.preloadedImages || []), ...uploaded],
            preloadedAt: new Date().toISOString(), preloadedSource: 'supabase' };
          await onProjectUpdate(latestProject, { throwOnError: true });
        },
        onProgress: ({ processed }) => setDirectUploadStatus((prev) => ({ ...prev, progress: processed })),
      });
      setSelectedFiles([...result.failures.map((f) => f.file), ...result.pending]);
      setUploadFailures(result.failures);
      if (result.saveError) setPendingMediaSave(latestProject);
      setDirectUploadStatus({ loading: false, progress: result.processed, total: files.length,
        error: result.saveError ? (zh ? '媒体已上传，但媒体清单保存失败，请重试保存。' : 'Media uploaded, but saving the media list failed. Retry saving.')
          : result.failures.length ? (zh ? `${result.failures.length} 个文件失败，已保留供重试。` : `${result.failures.length} files failed and remain selected for retry.`) : null,
        success: result.uploaded.length && !result.saveError ? (zh ? `已上传并保存 ${result.uploaded.length} 个文件。` : `${result.uploaded.length} files uploaded and saved.`) : null,
      });
    } catch (err) {
      setDirectUploadStatus((prev) => ({ ...prev, loading: false, error: err.message }));
    } finally { uploadLock.current = false; }
  };

  const retryMediaSave = async () => {
    if (!pendingMediaSave || uploadLock.current) return;
    uploadLock.current = true;
    setDirectUploadStatus((prev) => ({ ...prev, loading: true }));
    try {
      await onProjectUpdate(pendingMediaSave, { throwOnError: true });
      setPendingMediaSave(null);
      setDirectUploadStatus((prev) => ({ ...prev, loading: false, error: null,
        success: zh ? '媒体清单已保存。' : 'Media list saved.' }));
    } catch (err) {
      setDirectUploadStatus((prev) => ({ ...prev, loading: false, error: err.message }));
    } finally { uploadLock.current = false; }
  };

  // ── HuggingFace batch preload ─────────────────────────────────────────────

  const handlePreloadAllImages = async () => {
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    if (!hfConfig.datasetName) {
      setPreloadStatus(prev => ({ ...prev, error: tx("Please configure and test dataset connection first.") }));
      return;
    }
    if (!isR2Configured()) {
      setPreloadStatus(prev => ({ ...prev, error: tx("Supabase Storage is not configured. Save credentials in Supabase Storage Configuration above.") }));
      return;
    }
    if (!currentProject?.id) {
      setPreloadStatus(prev => ({ ...prev, error: tx("No active project. Please select or create a project before preloading images.") }));
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
      // Track full relative keys (folder/name) so nested HF folders don't collide.
      const existingKeys = new Set(
        (existingResult.images || []).map((img) => {
          const entry = normalizeMediaEntry(img, `${projectPrefix}/`);
          const folder = entry.folder || '';
          return folder ? `${folder}/${entry.name}` : entry.name;
        }),
      );

      const datasetNameTrimmed = hfConfig.datasetName.trim();
      const datasetSegments = datasetNameTrimmed
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
      const isFolderMode = datasetSegments.length > 2;

      // Keep HF import destination stable across resume so nested HF folders
      // are not re-prefixed with the current Media library folder (which would
      // create street/street after you open street and click Preload again).
      const prevCfg = currentProject.imageDatasetConfig || {};
      const sameHfTarget = prevCfg.hfImportDataset === datasetNameTrimmed
        && Object.prototype.hasOwnProperty.call(prevCfg, 'hfImportBase');
      const importBase = sameHfTarget
        ? normalizeFolderPath(prevCfg.hfImportBase || '')
        : normalizeFolderPath(currentFolder || '');

      const countResult = await getImageCountFromDataset(hfConfig.token, datasetNameTrimmed);
      const totalImages = countResult.imageCount || 1000;
      setPreloadStatus(prev => ({ ...prev, total: totalImages }));

      // Collect public URLs for already-existing images
      const allImages = mergeMediaLibraryListing(
        existingResult.images || [], currentProject.preloadedImages, `${projectPrefix}/`,
      );

      const batchSize = 100;
      const batches = Math.ceil(totalImages / batchSize);
      let newCount = 0;
      let skipCount = 0;
      let failCount = 0;
      let lastFailReason = null;
      const importedFolders = new Set(
        (prevCfg.mediaFolders || []).map(normalizeFolderPath).filter(Boolean),
      );

      // Sanitize an HF filename so it's safe to use as an R2 key segment.
      // Matches the rule used by the direct-upload path.
      const safeKey = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeFolderSeg = (seg) => String(seg || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeFolderPath = (folder) => normalizeFolderPath(
        String(folder || '')
          .split('/')
          .map(safeFolderSeg)
          .filter(Boolean)
          .join('/'),
      );

      // Only attach the HF bearer token to Hub resolve URLs that actually
      // need it (gated datasets). Signed CDN / datasets-server cached-asset
      // URLs already carry auth in the query string — adding Authorization
      // forces a CORS preflight that CloudFront rejects with 403, so every
      // download fails with "Failed to fetch" in the browser.
      const fetchOptsForHfImage = (imgUrl) => {
        const token = hfConfig.token && hfConfig.token.trim();
        if (!token || !imgUrl) return undefined;
        if (/[?&](?:Expires|Signature|Key-Pair-Id)=/i.test(imgUrl)) return undefined;
        if (/datasets-server\.huggingface\.co/i.test(imgUrl)) return undefined;
        if (!/^https:\/\/(?:[a-z0-9-]+\.)*huggingface\.co\//i.test(imgUrl)) return undefined;
        return { headers: { Authorization: `Bearer ${token}` } };
      };

      for (let b = 0; b < batches; b++) {
        const offset = b * batchSize;
        const limit = Math.min(batchSize, totalImages - offset);

        if (!isFolderMode) {
          // Rows mode: filenames are deterministic, so we can skip whole
          // batches when every synthesized name already exists in R2.
          const toDownload = [];
          for (let j = 0; j < limit; j++) {
            const padded = String(offset + j).padStart(6, '0');
            if (!existingKeys.has(`image_${padded}.jpg`)) toDownload.push(offset + j);
          }
          if (!toDownload.length) {
            skipCount += limit;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));
            continue;
          }
        }

        const result = await getImagesFromHuggingFace(hfConfig.token, datasetNameTrimmed, limit, offset);
        if (!result.success || !result.images) throw new Error(result.error || tx("Failed to fetch images"));
        if (!result.images.length) {
          failCount += limit;
          lastFailReason = tx("HuggingFace returned 0 images for offset {v0}", { v0: offset });
          continue;
        }

        for (let k = 0; k < result.images.length; k++) {
          const gi = offset + k;
          const hfImg = result.images[k];
          // Folder mode: HF nested paths relative to dataset path, under a
          // stable importBase (not live currentFolder — avoids resume nesting).
          const relFolder = isFolderMode
            ? safeFolderPath(joinFolderPath(importBase, hfImg.relativeFolder || ''))
            : normalizeFolderPath(importBase);
          const fname = isFolderMode
            ? safeKey(hfImg.name || `image_${String(gi).padStart(6, '0')}.jpg`)
            : `image_${String(gi).padStart(6, '0')}.jpg`;
          const relKey = relFolder ? `${relFolder}/${fname}` : fname;
          if (existingKeys.has(relKey)) { skipCount++; continue; }

          try {
            const imgUrl = hfImg.url;
            if (!imgUrl) {
              failCount++;
              lastFailReason = tx("Missing image URL for {v0}", { v0: relKey });
              continue;
            }
            const resp = await fetch(imgUrl, fetchOptsForHfImage(imgUrl));
            if (!resp.ok) {
              failCount++;
              lastFailReason = tx("Download HTTP {v0} for {v1}", { v0: resp.status, v1: relKey });
              continue;
            }
            const blob = await resp.blob();
            // datasets-server often serves images as binary/octet-stream;
            // normalize so R2/content-type and the compressor stay consistent.
            const mime = (blob.type && blob.type !== 'binary/octet-stream')
              ? blob.type
              : 'image/jpeg';
            // Run HF-fetched images through the same ≤300KB compressor used
            // for direct uploads, so every R2 object served to participants
            // is on the same size/quality budget regardless of source.
            const wrapped = new File([blob], fname, { type: mime });
            const compressed = await compressImage(wrapped);
            const r2Key = buildProjectMediaKey(`${projectPrefix}/`, relFolder, fname);
            const uploadResult = await uploadImageToR2(compressed, r2Key);
            if (!uploadResult.success) {
              failCount++;
              lastFailReason = uploadResult.error || tx("Storage upload failed for {v0}", { v0: relKey });
              continue;
            }
            // Track the key we used so a re-run skips it without an extra R2 list.
            existingKeys.add(relKey);
            if (relFolder) importedFolders.add(relFolder);
            allImages.push({
              url: uploadResult.url,
              name: fname,
              key: r2Key,
              media_id: r2Key,
              folder: relFolder,
              type: 'image',
            });
            newCount++;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));

            // Save progress every 10 new uploads
            if (newCount % 10 === 0) {
              onProjectUpdate({
                ...currentProject,
                preloadedImages: [...allImages],
                preloadedAt: new Date().toISOString(),
                preloadedSource: 'supabase',
                imageDatasetConfig: {
                  ...(currentProject.imageDatasetConfig || {}),
                  mediaFolders: [...importedFolders].sort(compareMediaNames),
                  hfImportDataset: datasetNameTrimmed,
                  hfImportBase: importBase,
                },
              });
            }
          } catch (err) {
            failCount++;
            lastFailReason = err?.message || String(err);
            console.error('HF preload image failed:', relKey, err);
          }
        }
      }

      allImages.sort((a, b) => compareMediaNames(a.name, b.name));
      const updatedProject = {
        ...currentProject,
        preloadedImages: allImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'supabase',
        imageDatasetConfig: {
          ...(currentProject.imageDatasetConfig || {}),
          mediaFolders: [...importedFolders].sort(compareMediaNames),
          hfImportDataset: datasetNameTrimmed,
          hfImportBase: importBase,
        },
      };
      onProjectUpdate(updatedProject);

      const failNote = failCount > 0
        ? tx(" {v0} failed{v1}.", { v0: failCount, v1: lastFailReason ? tx(" (last: {v0})", { v0: lastFailReason }) : '' })
        : '';
      if (newCount === 0 && failCount > 0 && allImages.length === 0) {
        setPreloadStatus({
          loading: false, progress: 0, total: totalImages, success: null,
          error: tx("Preload finished with 0 images uploaded ({v0} failed).{v1}", { v0: failCount, v1: lastFailReason ? tx(" Last error: {v0}", { v0: lastFailReason }) : '' }),
        });
      } else {
        setPreloadStatus({
          loading: false, progress: allImages.length, total: totalImages, error: null,
          success: tx("Completed! {v0} images available ({v1} new, {v2} skipped).{v3}{v4}", { v0: allImages.length, v1: newCount, v2: skipCount, v3: isFolderMode && importedFolders.size ? tx(" {v0} folder(s) preserved.", { v0: importedFolders.size }) : '', v4: failNote }),
        });
      }
    } catch (error) {
      setPreloadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  const handleClearImages = async () => {
    if (!currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const count = currentProject.preloadedImages?.length || 0;
    setConfirmDialog({
      title: tx("Clear all media"),
      message: tx("Clear all {v0} uploaded images from Supabase Storage? This cannot be undone.", { v0: count }),
      confirmLabel: tx("Clear all"),
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        if (isR2Configured() && currentProject.preloadedImages?.length > 0) {
          try {
            const uid = user?.id || 'anonymous';
            const pid = currentProject.id;
            const prefix = projectR2Prefix(uid, pid);
            const listResult = await listImagesFromR2(prefix);
            if (listResult.success && listResult.images.length > 0) {
              const keys = listResult.images
                .map((img) => img.key)
                .filter((key) => key && key.startsWith(prefix));
              await deleteImagesFromR2(keys, { allowedPrefix: prefix });
            }
          } catch (e) {
            console.error('Error clearing images from R2:', e);
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
        if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;
  const featureStatusByName = useMemo(() => {
    const map = new Map();
    (currentProject?.preloadedImages || []).forEach((raw) => {
      const entry = normalizeMediaEntry(raw);
      if (!entry?.name) return;
      map.set(entry.name, featureStatusFromMap(r2FeatureMap, entry, FEATURE_MODELS));
    });
    return map;
  }, [currentProject?.preloadedImages, r2FeatureMap]);
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

  return (
    <Box>
      <AdminPageHeader
        icon={<CloudUpload />}
        title={t.mediaTitle}
        description={t.mediaDescription}
      />

      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          {tx("Supabase Storage is not configured. Save credentials in Supabase Storage Configuration below.")}
        </Alert>
      )}

      {/* ── Current Status ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2, flexWrap: 'wrap' }}>
        {r2Syncing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">{t.mediaCheckingR2}</Typography>
          </Box>
        ) : preloadedCount > 0 ? (
          <>
            <Chip icon={<CheckCircle />} label={`${preloadedCount} ${t.mediaInR2}`} color="success" variant="outlined" />
            {Object.entries(mediaCounts).map(([mediaType, n]) => (
              <Chip key={mediaType} size="small" label={`${n} ${tx(mediaType)}`} variant="outlined" />
            ))}
            <Chip label="Supabase Storage" color="primary" size="small" variant="outlined" />
            {currentProject?.preloadedAt && (
              <Typography variant="caption" color="text.secondary">
                {t.mediaLastUpload} {new Date(currentProject.preloadedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}
              </Typography>
            )}
          </>
        ) : (
          <Chip icon={<Warning />} label={t.noMediaYet} color="default" variant="outlined" />
        )}
      </Box>

      <Box
        sx={{
          mb: 2.5,
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          alignItems: 'stretch',
        }}
      >
        <MediaPairingGuide
          compact
          context="dataset"
          totalFileCount={preloadedCount}
          pairedSetCount={mediaGroups.length}
        />
        <MediaCategoryGuide
          compact
          context="dataset"
          categoryCount={mediaCategories.length}
          totalFileCount={preloadedCount}
          categoryLabels={mediaCategories.map((c) => c.category)}
        />
      </Box>

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        {t.mediaAddSection}
      </Typography>

      <Box id="media-supabase-storage" sx={{ mb: 2, p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'secondary.light', bgcolor: 'background.paper' }}>
        <SupabaseStorageConfig
          compact
          currentProject={currentProject}
          onProjectUpdate={onProjectUpdate}
          onConfigChange={onConfigChange}
        />
      </Box>

      {/* ── Upload / HF — two columns ── */}
      <Box
        sx={{
          mb: 3,
          display: 'grid',
          gap: 2,
          alignItems: 'stretch',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        {/* Upload Media */}
        <Box sx={{
          p: 2.5,
          borderRadius: 1.5,
          border: '2px solid',
          borderColor: 'primary.light',
          bgcolor: (t) => t.palette.mode === 'dark' ? 'background.paper' : 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudUpload fontSize="small" color="primary" />
            {t.mediaUploadTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.mediaUploadHelpPrefix}
            {' '}({currentFolder ? <code>{currentFolder}</code> : 'root'}).
            {' '}
            {tf(t.mediaUploadLimitsHelp, { mb: formatMediaMb(MAX_AV_MEDIA_BYTES) })}
          </Typography>

          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { chooseUploadFiles(e.target.files); e.target.value = ''; }}
          />

          <input ref={folderInputRef} type="file" webkitdirectory="" multiple style={{ display: 'none' }}
            aria-label={zh ? '选择媒体文件夹' : 'Choose media folder'}
            onChange={(e) => { chooseUploadFiles(e.target.files); e.target.value = ''; }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading || !!pendingMediaSave}>
              {t.mediaChooseFiles}
            </Button>
            <Button size="small" variant="outlined" onClick={() => folderInputRef.current?.click()} disabled={directUploadStatus.loading || !!pendingMediaSave}>
              {zh ? '选择文件夹' : 'Choose folder'}
            </Button>
            {selectedFiles.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {selectedFiles.length} {t.mediaSelected}
              </Typography>
            )}
          </Box>

          <Typography variant="caption" sx={{ display: 'block', mb: 1 }} color="text.secondary">
            {zh ? '文件夹上传会保留所选文件夹名称和子文件夹层级，放入当前目录。仅导入媒体文件；空文件夹不会导入。' : 'Folder uploads keep the selected folder name and subfolders inside the current directory. Only media files are imported; empty folders are omitted.'}
          </Typography>
          {skippedUploadFiles > 0 && <Alert severity="info" sx={{ mb: 1 }}>
            {zh ? `已跳过 ${skippedUploadFiles} 个非媒体或系统文件。` : `Skipped ${skippedUploadFiles} non-media or system files.`}
          </Alert>}
          {selectedFiles.some((f) => f.webkitRelativePath) && <Box sx={{ mb: 1, maxHeight: 110, overflowY: 'auto' }}>
            {selectedFiles.slice(0, 5).map((f, i) => <Typography key={i} variant="caption" component="div" sx={{ overflowWrap: 'anywhere' }}>
              {[uploadBaseFolder.current ?? currentFolder, f.webkitRelativePath || f.name].filter(Boolean).join('/')}
            </Typography>)}
            {selectedFiles.length > 5 && <Typography variant="caption">{zh ? `另有 ${selectedFiles.length - 5} 个文件` : `${selectedFiles.length - 5} more files`}</Typography>}
          </Box>}
          <FormControlLabel control={<Checkbox checked={compressUploads} disabled={directUploadStatus.loading}
            onChange={(e) => setCompressUploads(e.target.checked)} />} label={zh ? '压缩大图以加快加载（GIF 保留原文件）' : 'Compress large images for faster loading (keep original GIFs)'} />
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }} color="text.secondary">
            {zh ? '研究需要原始像素时取消勾选；原文件最大 40 MB。同名文件会分别保存。' : 'Uncheck when original pixels matter. Original files: up to 40 MB. Same-name files are stored separately.'}
          </Typography>
          {directUploadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>{' '}{tx("Uploading…")}{' '}{directUploadStatus.progress} / {directUploadStatus.total}
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
          {uploadFailures.length > 0 && <Box sx={{ maxHeight: 160, overflowY: 'auto', mb: 1 }}>
            {uploadFailures.map((failure, i) => <Typography key={i} variant="caption" component="div" sx={{ overflowWrap: 'anywhere' }}>{failure.name}: {failure.error}</Typography>)}
          </Box>}
          {pendingMediaSave && <Button onClick={retryMediaSave} disabled={directUploadStatus.loading} sx={{ minHeight: 44 }}>{zh ? '重试保存媒体清单' : 'Retry saving media list'}</Button>}

          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              onClick={handleDirectUpload}
              disabled={preloadStatus.loading || !selectedFiles.length || directUploadStatus.loading || !!pendingMediaSave || !isR2Configured()}
              startIcon={directUploadStatus.loading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
            >
              {t.mediaUploadBtn}{selectedFiles.length > 0 ? ` ${selectedFiles.length}` : ''}
              {(uploadBaseFolder.current ?? currentFolder) ? ` → ${uploadBaseFolder.current ?? currentFolder}` : ` ${t.mediaUploadRoot}`}
            </Button>
          </Box>
        </Box>

        {/* HuggingFace Dataset Import */}
        <Box sx={{
          p: 2.5,
          borderRadius: 1.5,
          border: '2px solid',
          borderColor: 'warning.light',
          bgcolor: (t) => t.palette.mode === 'dark' ? 'background.paper' : 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            {t.hfImportTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.hfImportHelp}
          </Typography>

          <FormControlLabel
            sx={{ mb: 1, ml: 0 }}
            control={<Switch size="small" checked={hfConfig.enabled} onChange={(e) => setHfConfig(p => ({ ...p, enabled: e.target.checked }))} />}
            label={<Typography variant="body2">{t.hfEnable}</Typography>}
          />
          <TextField
            fullWidth size="small" label={t.hfToken} type="password"
            value={hfConfig.token}
            onChange={(e) => setHfConfig(p => ({ ...p, token: e.target.value }))}
            disabled={!hfConfig.enabled}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth size="small" label={t.hfDataset}
            value={hfConfig.datasetName}
            onChange={(e) => setHfConfig(p => ({ ...p, datasetName: e.target.value }))}
            placeholder={t.hfPlaceholder}
            disabled={!hfConfig.enabled}
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={saveHfConfig} disabled={!hfConfig.enabled || !hfConfig.datasetName}>
              {t.saveConfig}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={testHfConnection}
              disabled={!hfConfig.enabled || !hfConfig.datasetName || hfStatus.loading}
              startIcon={hfStatus.loading ? <CircularProgress size={14} /> : <Refresh />}
            >
              {t.testConnection}
            </Button>
          </Box>

          {(hfStatus.connected || hfStatus.error) && (
            <Alert severity={hfStatus.connected ? 'success' : 'error'} sx={{ mb: 1.5 }} icon={false}>
              <Typography variant="caption">
                {hfStatus.connected
                  ? tx("Connected{v0}", { v0: hfStatus.datasetInfo?.imageCount != null ? tx(" · {v0} images", { v0: hfStatus.datasetInfo.imageCount }) : '' })
                  : hfStatus.error}
              </Typography>
            </Alert>
          )}
          {preloadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>{' '}{tx("HF → storage…")}{' '}{preloadStatus.progress} / {preloadStatus.total}
              </Typography>
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
              fullWidth
              variant="contained"
              onClick={handlePreloadAllImages}
              disabled={!hfStatus.connected || !isR2Configured() || preloadStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
              startIcon={preloadStatus.loading ? <CircularProgress size={16} /> : <CloudDownload />}
            >
              {preloadedCount > 0 ? t.hfRePreload : t.hfPreload}
            </Button>
          </Box>
        </Box>
      </Box>

      <SpatialIntelligencePanel
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        onConfigChange={onConfigChange}
        onFeaturesUpdated={setR2FeatureMap}
      />

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        {t.mediaOrganizeSection}
      </Typography>

      <MediaFolderBrowser
        currentProject={currentProject}
        userId={userId}
        onProjectUpdate={onProjectUpdate}
        currentFolder={currentFolder}
        onCurrentFolderChange={setCurrentFolder}
        selectedFolders={selectedFolders}
        onSelectedFoldersChange={setSelectedFolders}
        onMoveComplete={clearMediaSelection}
        selectedMediaEntries={(currentProject?.preloadedImages || []).filter((m) => selectedMedia.has(getMediaId(m)))}
        openMoveSignal={openMoveSignal}
        mediaCount={preloadedCount}
        disabled={directUploadStatus.loading || !!pendingMediaSave}
      >
        {preloadedCount === 0 ? (
          <Alert severity="info">{' '}{tx("No media uploaded yet. Upload files or import from Hugging Face above, then organize files with folders on the left.")}{' '}</Alert>
        ) : (
          <>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={refreshingMedia ? <CircularProgress size={14} /> : <Refresh />}
                  onClick={refreshMediaFromR2}
                  disabled={refreshingMedia || !isR2Configured() || directUploadStatus.loading || !!pendingMediaSave}
                >{' '}{tx("Refresh from storage")}{' '}</Button>
                <MediaKeywordSelection
                  pool={currentProject?.preloadedImages}
                  folders={selectedFolders} currentFolder={currentFolder} prefix={projectPrefix}
                  selected={selectedMedia} getId={getMediaId}
                  disabled={mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
                  onSelect={(matches) => setSelectedMedia((prev) => new Set([...prev, ...matches.map(getMediaId)]))}
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SelectAll />}
                  onClick={selectAllFiltered}
                  disabled={!selectionCandidates.length}
                >{' '}{tx("Select filtered (")}{selectionCandidates.length})
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Deselect />}
                  onClick={clearMediaSelection}
                  disabled={!selectedMedia.size}
                >{' '}{tx("Clear selection")}{' '}</Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={mediaActionStatus.loading && mediaDownloadProgress ? <CircularProgress size={14} /> : <CloudDownload />}
                  onClick={handleDownloadSelectedMedia}
                  disabled={!selectedMedia.size || mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
                >{' '}{tx("ZIP selected (")}{selectedMedia.size})
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CloudDownload />}
                  onClick={handleDownloadFilteredMedia}
                  disabled={!filteredMedia.length || mediaActionStatus.loading}
                >{' '}{tx("ZIP this folder view (")}{filteredMedia.length})
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CloudDownload />}
                  onClick={handleDownloadFolderRecursive}
                  disabled={mediaActionStatus.loading || !(currentProject?.preloadedImages || []).length}
                >{' '}{tx("ZIP folder+subfolders")}{' '}</Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CloudDownload />}
                  onClick={handleDownloadFeatureCsvs}
                  disabled={!projectPrefix || !isR2Configured() || mediaActionStatus.loading}
                >{' '}{tx("Download L0 + Seg CSV")}{' '}</Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DriveFileMove />}
                  onClick={() => setOpenMoveSignal((n) => n + 1)}
                  disabled={!selectedMedia.size || mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
                >{' '}{tx("Move to folder… (")}{selectedMedia.size})
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  onClick={handleDeleteSelectedMedia}
                  disabled={!selectedMedia.size || mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
                >{' '}{tx("Delete selected (")}{selectedMedia.size})
                </Button>
                <Button variant="outlined" color="error" onClick={handleClearImages} disabled={directUploadStatus.loading || !!pendingMediaSave} startIcon={<Delete />} size="small">{' '}{tx("Clear all")}{' '}</Button>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder={tx("Search by filename…")}
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
                <InputLabel id="media-filter-label">{tx("Type")}</InputLabel>
                <Select
                  labelId="media-filter-label"
                  label={tx("Type")}
                  value={mediaFilter}
                  onChange={(e) => setMediaFilter(e.target.value)}
                >
                  <MenuItem value="all">{tx("All types")}</MenuItem>
                  <MenuItem value="image">{tx("Image")}</MenuItem>
                  <MenuItem value="video">{tx("Video")}</MenuItem>
                  <MenuItem value="audio">{tx("Audio")}</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {mediaActionStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{mediaActionStatus.success}</Alert>}
            {mediaActionStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{mediaActionStatus.error}</Alert>}
            {mediaDownloadProgress && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">{tx("Downloading…")}</Typography>
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

            {selectedFolders.size > 0 && <Alert severity="info" sx={{ mb: 1.5 }}>{' '}{tx("Select filtered uses")}{' '}{selectedFolders.size}{' '}{tx("checked folder(s), including subfolders, and the current search/type filters.")}{' '}{' '}{selectionCandidates.length}{' '}{tx("matching file(s). The gallery shows the open folder.")}{' '}</Alert>}
            {filteredMedia.length === 0 ? (
              <Alert severity="info">{tx("No media matches your search or filter.")}</Alert>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{' '}{tx("Showing")}{' '}{pagedMedia.length}{' '}{tx("of")}{' '}{filteredMedia.length}{' '}{tx("file(s)")}{' '}{mediaSearch || mediaFilter !== 'all' ? ` ${tx('(filtered)')}` : ''}{tx(". Click a card to preview (image / video / audio); images also focus Pre-annotate below. Use checkboxes for multi-select download / move / delete.")}{' '}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                  {pagedMedia.map((img) => {
                    const t = img.type || inferMediaType(img.name || img.url);
                    const selected = selectedMedia.has(getMediaId(img));
                    const focused = preannotateFocusName === getMediaId(img);
                    const feat = featureStatusByName.get(img.name);
                    const l0Status = feat?.status?.[L0_MODEL];
                    const segStatus = feat?.status?.[SEG_MODEL];
                    const samStatus = feat?.status?.[SAM_PREANNOT_MODEL];
                    const l0Ok = l0Status === 'ready';
                    const segOk = segStatus === 'ready';
                    const samOk = samStatus === 'ready';
                    const l0Err = l0Status === 'error';
                    const segErr = segStatus === 'error';
                    return (
                      <Box
                        key={img.key || img.media_id || img.name}
                        sx={{
                          position: 'relative',
                          borderRadius: 1,
                          overflow: 'hidden',
                          border: '2px solid',
                          borderColor: focused ? 'secondary.main' : selected ? 'primary.main' : 'divider',
                          boxShadow: focused ? 2 : 0,
                          bgcolor: 'grey.100',
                          cursor: 'pointer',
                          transition: 'border-color .15s, box-shadow .15s',
                          '&:hover .media-action-btn': { opacity: 1 },
                        }}
                        onClick={() => handleMediaCardClick(img)}
                      >
                        <Checkbox
                          size="small"
                          checked={selected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleMediaSelection(getMediaId(img))}
                          sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2, bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, p: 0.25 }}
                        />
                        <Box sx={{ position: 'absolute', top: 2, right: 2, zIndex: 2, display: 'flex', gap: 0.25 }}>
                          <Tooltip title={tx("Preview")}>
                            <IconButton
                              className="media-action-btn"
                              size="small"
                              onClick={(e) => { e.stopPropagation(); setPreviewEntry(img); }}
                              sx={{
                                bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                              }}
                            >
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={tx("Download")}>
                            <IconButton
                              className="media-action-btn"
                              size="small"
                              color="primary"
                              disabled={mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
                              onClick={(e) => handleDownloadSingleMedia(img, e)}
                              sx={{
                                bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                              }}
                            >
                              <CloudDownload fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={tx("Delete")}>
                            <IconButton
                              className="media-action-btn"
                              size="small"
                              color="error"
                              disabled={mediaActionStatus.loading || directUploadStatus.loading || !!pendingMediaSave}
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
                            <video src={img.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted preload="metadata" />
                          ) : t === 'audio' ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1 }}>
                              <Audiotrack fontSize="small" color="action" />
                              <Typography variant="caption" sx={{ textAlign: 'center' }}>{tx("Audio")}</Typography>
                            </Box>
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
                          {(img.folder || '') !== '' && (
                            <Typography variant="caption" color="text.secondary" noWrap title={img.folder} sx={{ display: 'block' }}>
                              📁 {img.folder}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            <Chip size="small" label={t} variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                            {t === 'image' && l0Ok && (
                              <Chip
                                size="small"
                                label={tx("L0")}
                                color="success"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                            {t === 'image' && l0Err && (
                              <Chip size="small" label={tx("L0!")} color="warning" sx={{ height: 18, fontSize: '0.65rem' }} title={tx("L0 failed")} />
                            )}
                            {t === 'image' && segOk && (
                              <Chip
                                size="small"
                                label={tx("Seg")}
                                color="info"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                            {t === 'image' && segErr && (
                              <Chip size="small" label={tx("Seg!")} color="warning" sx={{ height: 18, fontSize: '0.65rem' }} title={tx("Seg failed")} />
                            )}
                            {t === 'image' && samOk && (
                              <Chip
                                size="small"
                                label={tx("SAM")}
                                color="secondary"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
                {totalMediaPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                    <Pagination
                      count={totalMediaPages}
                      getItemAriaLabel={(type, page, selected) => type === 'page'
                        ? tx(selected ? 'Current page {page}' : 'Go to page {page}', { page })
                        : tx(`Go to ${type} page`)}
                      page={mediaPage}
                      onChange={(_, p) => setMediaPage(p)}
                      color="primary"
                      size="small"
                    />
                  </Box>
                )}
              </>
            )}
          </>
        )}
      </MediaFolderBrowser>

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, mt: 0.5, letterSpacing: 1 }}>
        {t.mediaTaggedSection}
      </Typography>

      {pairedGroups.length === 0 && mediaCategories.length === 0 && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          {t.mediaNoFoldersTagged}
        </Alert>
      )}

      {pairedGroups.length > 0 && (
        <Box sx={{ mb: 2.5, p: 2.5, bgcolor: 'background.paper', border: '2px solid', borderColor: 'info.light', borderRadius: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {tf(t.mediaTaggedSets, { n: pairedGroups.length })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.mediaTaggedSetsHelp}
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
                  label={tx("{v0} set(s) × {v1} file(s)", { v0: count, v1: size })}
                />
              ))}
          </Box>
          <FormControl size="small" sx={{ minWidth: 160, mb: 2 }}>
            <InputLabel id="group-size-filter">{tx("Filter by set size")}</InputLabel>
            <Select
              labelId="group-size-filter"
              label={tx("Filter by set size")}
              value={groupSizeFilter}
              onChange={(e) => setGroupSizeFilter(e.target.value)}
            >
              <MenuItem value="all">{tx("All sizes")}</MenuItem>
              {Object.keys(groupSummary.bySize)
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map((size) => (
                  <MenuItem key={size} value={size}>{size}{' '}{tx("file(s) per set")}</MenuItem>
                ))}
            </Select>
          </FormControl>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>{tx("Set folder")}</TableCell>
                  <TableCell align="center">{tx("Size")}</TableCell>
                  <TableCell>{tx("Types")}</TableCell>
                  <TableCell>{tx("Files")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPairedGroups.slice(0, 50).map((g) => (
                  <TableRow key={g.setKey || g.folder} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{g.folder || g.setId || g.groupId}</Typography>
                    </TableCell>
                    <TableCell align="center">{g.size}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{g.types.map((type) => tx(type)).join(' + ')}</Typography>
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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{' '}{tx("Showing first 50 of")}{' '}{filteredPairedGroups.length}{' '}{tx("groups.")}{' '}</Typography>
          )}
          {filteredPairedGroups.length === 0 && (
            <Alert severity="warning" sx={{ mt: 1 }}>{tx("No groups match this size filter.")}</Alert>
          )}
        </Box>
      )}

      {mediaCategories.length > 0 && (
        <Box sx={{ mb: 2.5, p: 2.5, bgcolor: 'background.paper', border: '2px solid', borderColor: 'secondary.light', borderRadius: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {tf(t.mediaTaggedCategories, { n: mediaCategories.length })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t.mediaTaggedCategoriesHelp}
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>{tx("Category")}</TableCell>
                  <TableCell align="center">{tx("Files")}</TableCell>
                  <TableCell>{tx("Types")}</TableCell>
                  <TableCell>{tx("Sample filenames")}</TableCell>
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
                      <Typography variant="caption">{c.types.map((type) => tx(type)).join(', ')}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.members.slice(0, 4).map((m) => m.name).join(' · ')}
                        {c.count > 4 ? tx(" · +{v0} more", { v0: c.count - 4 }) : ''}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ── SAM3 Pre-annotate (synced with gallery selection) ── */}
      {preloadedCount > 0 && (
        <MediaPreannotatePanel
          mediaEntry={preannotateEntry}
          imageIndex={preannotateIndex}
          imageTotal={preannotateImages.length}
          mediaList={preannotateImages}
          selectedMediaIds={selectedMedia}
          labelDefs={currentProject?.imageDatasetConfig?.preannotateLabels || null}
          onLabelDefsChange={(next) => {
            onProjectUpdate({
              ...currentProject,
              imageDatasetConfig: {
                ...(currentProject?.imageDatasetConfig || {}),
                preannotateLabels: next,
              },
            });
          }}
          reviewFilter={preannotateReviewFilter}
          reviewQueueCount={reviewQueueNames.length}
          reviewQueueIndex={
            preannotateFocusName && reviewQueueNames.includes(preannotateFocusName)
              ? reviewQueueNames.indexOf(preannotateFocusName) + 1
              : 0
          }
          hasLastBatch={!!preannotateLastBatch}
          onReviewFilterChange={(f) => setPreannotateReviewFilter(f)}
          onFocusReviewNext={() => focusReviewRelative(1)}
          onFocusReviewPrev={() => focusReviewRelative(-1)}
          onReviewStatusKnown={(name, status) => {
            if (!name) return;
            setPreannotateReviewByName((prev) => {
              if (status === 'accepted' || status === 'needs_review') {
                if (prev[name] === status) return prev;
                return { ...prev, [name]: status };
              }
              if (prev[name] == null) return prev;
              const next = { ...prev };
              delete next[name];
              return next;
            });
          }}
          onBatchComplete={(batch) => {
            setPreannotateLastBatch(batch || null);
            if (!batch) return;
            // Batch save stamps needs_review on new work — mirror into local filter map.
            const imgs = Array.isArray(batch?.images) ? batch.images : [];
            setPreannotateReviewByName((prev) => {
              const next = { ...prev };
              imgs.forEach((i) => {
                if (!i?.name) return;
                if ((i.status === 'done' || i.status === 'partial')
                  && (i.polygonsAdded > 0 || (i.addedShapeIds || []).length)) {
                  next[i.name] = 'needs_review';
                }
              });
              return next;
            });
          }}
          onBatchClosed={(batch) => {
            setPreannotateLastBatch(null);
            setPreannotateReviewFilter(null);
            const imgs = Array.isArray(batch?.images) ? batch.images : [];
            const status = batch?.status;
            setPreannotateReviewByName((prev) => {
              const next = { ...prev };
              imgs.forEach((i) => {
                if (!i?.name) return;
                const touched = (i.polygonsAdded > 0 || (i.addedShapeIds || []).length)
                  && (i.status === 'done' || i.status === 'partial');
                if (status === 'accepted' && touched) next[i.name] = 'accepted';
                else if (status === 'cancelled' || status === 'undone') delete next[i.name];
              });
              return next;
            });
          }}
          onPrev={() => {
            if (preannotateReviewFilter && reviewQueueNames.length) {
              focusReviewRelative(-1);
              return;
            }
            if (preannotateIndex <= 0) return;
            const prev = preannotateImages[preannotateIndex - 1];
            if (prev) focusMediaInGallery(getMediaId(prev));
          }}
          onNext={() => {
            if (preannotateReviewFilter && reviewQueueNames.length) {
              focusReviewRelative(1);
              return;
            }
            if (preannotateIndex >= preannotateImages.length - 1) return;
            const next = preannotateImages[preannotateIndex + 1];
            if (next) focusMediaInGallery(getMediaId(next));
          }}
          r2Prefix={projectPrefix}
          falKey={currentProject?.imageDatasetConfig?.falApiKey || ''}
          projectId={projectId || ''}
          onSaved={(result) => {
            const annotation = result?.annotation || null;
            const mediaEntry = annotation
              ? (currentProject?.preloadedImages || []).find((m) => getMediaId(m) === annotation.media_id)
                || { name: annotation.name, url: annotation.image, media_id: annotation.media_id, folder: annotation.folder }
              : preannotateEntry;
            const patch = {
              mediaEntry,
              annotation,
              at: Date.now(),
            };
            setPreannotateSavedPatch(patch);
            setPreannotateBatchPatches((prev) => {
              const key = getMediaId(mediaEntry) || annotation?.media_id;
              if (!key) return prev;
              const next = prev.filter((p) => (getMediaId(p.mediaEntry) || p.annotation?.media_id) !== key);
              next.push(patch);
              return next.slice(-200);
            });
            const reviewName = getMediaId(mediaEntry) || annotation?.media_id;
            const rs = annotation?.review_status;
            if (reviewName && (rs === 'accepted' || rs === 'needs_review')) {
              setPreannotateReviewByName((prev) => ({ ...prev, [reviewName]: rs }));
            }
            // Patch feature map locally — avoid re-downloading all feature CSVs on every autosave.
            const rec = result?.featureRecord;
            if (rec) {
              setR2FeatureMap((prev) => {
                const next = { ...prev };
                if (rec.media_id) next[featureStorageKey(rec.media_id, SAM_PREANNOT_MODEL)] = rec;
                if (rec.name && (currentProject?.preloadedImages || []).filter((m) => m.name === rec.name).length === 1) next[featureStorageKey(rec.name, SAM_PREANNOT_MODEL)] = rec;
                return next;
              });
            }
          }}
        />
      )}

      {preloadedCount > 0 && (
        <MediaPreannotateResults
          r2Prefix={projectPrefix}
          mediaList={preannotateImages}
          featureMap={r2FeatureMap}
          savedPatch={preannotateSavedPatch}
          batchPatches={preannotateBatchPatches}
        />
      )}

      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" color="primary" size="large" onClick={onNextStep} disabled={directUploadStatus.loading || !!pendingMediaSave} sx={{ px: 4, py: 1.5, fontWeight: 600 }}>{' '}{tx("Next: Survey Builder →")}{' '}</Button>
        </Box>
      )}

      <Dialog open={!!featureInspect} onClose={() => setFeatureInspect(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{featureInspect?.name || tx("Image features")}</DialogTitle>
        <DialogContent dividers>
          {featureInspect?.url && (
            <Box sx={{ mb: 2, textAlign: 'center' }}>
              <img
                src={featureInspect.url}
                alt={featureInspect.name}
                style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
              />
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{' '}{tx("media_id:")}{' '}{featureInspect?.mediaId}
          </Typography>
          {featureInspect?.records?.[L0_MODEL]?.features && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{tx("L0 (")}{L0_MODEL})</Typography>
              {Object.entries(featureInspect.records[L0_MODEL].features).map(([k, v]) => (
                <Typography key={k} variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                  {k}: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                </Typography>
              ))}
            </Box>
          )}
          {featureInspect?.records?.[SEG_MODEL]?.features && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{tx("Streetscape seg (")}{SEG_MODEL})</Typography>
              {Object.entries(featureInspect.records[SEG_MODEL].features)
                .filter(([k]) => k.startsWith('seg_ratio_'))
                .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                .map(([k, v]) => (
                  <Box key={k} sx={{ mb: 0.75 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption">{k.replace('seg_ratio_', '')}</Typography>
                      <Typography variant="caption">{typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—'}</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={typeof v === 'number' ? Math.min(100, v * 100) : 0}
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                  </Box>
                ))}
            </Box>
          )}
          {featureInspect?.records?.[SAM_PREANNOT_MODEL]?.features && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{tx("SAM pre-annot (")}{SAM_PREANNOT_MODEL})</Typography>
              {Object.entries(featureInspect.records[SAM_PREANNOT_MODEL].features).map(([k, v]) => (
                <Typography key={k} variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                  {k}: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFeatureInspect(null)}>{tx("Close")}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={tx("Cancel")}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />

      <MediaFilePreviewDialog
        open={!!previewEntry}
        entry={previewEntry}
        items={filteredMedia}
        onNavigate={setPreviewEntry}
        onClose={() => setPreviewEntry(null)}
      />
    </Box>
  );
}
