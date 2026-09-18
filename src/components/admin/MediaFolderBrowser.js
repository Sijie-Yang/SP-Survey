import { useMediaLibraryText } from '../../contexts/mediaLibraryI18n';
/**
 * Folder tree + set/category tagging for project media.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Chip, List, ListItemButton, ListItemText,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, Alert, Divider, Paper, Autocomplete, Checkbox,
} from '@mui/material';
import {
  CreateNewFolder, DriveFileMove, Folder, FolderOpen, Delete,
} from '@mui/icons-material';
import {
  normalizeFolderPath, joinFolderPath, listAllKnownFolders, getFolderTag,
  setMediaFolderTag, getDirectChildMedia, getRecursiveMedia,
  MEDIA_FOLDER_TAG_SET, MEDIA_FOLDER_TAG_CATEGORY, compareMediaNames,
  analyzeTaggedSets, analyzeTaggedCategories, normalizeMediaEntry,
  buildProjectMediaKey, removeMediaFolders, isFolderOrDescendant,
  remapMediaFolderTags, remapMediaFolderList, getMediaId,
} from '../../lib/mediaUtils';
import { deleteImagesFromR2, projectR2Prefix } from '../../lib/r2';

function folderChildrenMap(folders) {
  const roots = [];
  const byParent = new Map();
  const all = new Set(folders);
  folders.forEach((folder) => {
    const parts = folder.split('/');
    if (parts.length === 1) {
      roots.push(folder);
      return;
    }
    const parent = parts.slice(0, -1).join('/');
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(folder);
    if (!all.has(parent)) {
      all.add(parent);
      // parent will be attached below if needed
    }
  });
  // Ensure every parent path exists as a navigable node
  [...all].forEach((folder) => {
    const parts = folder.split('/');
    if (parts.length === 1) {
      if (!roots.includes(folder)) roots.push(folder);
      return;
    }
    const parent = parts.slice(0, -1).join('/');
    if (!byParent.has(parent)) byParent.set(parent, []);
    if (!byParent.get(parent).includes(folder)) byParent.get(parent).push(folder);
    if (!all.has(parent) && !roots.includes(parent)) roots.push(parent);
  });
  // Only top-level folders in roots
  const top = [...all].filter((f) => !f.includes('/')).sort(compareMediaNames);
  for (const kids of byParent.values()) kids.sort(compareMediaNames);
  return { roots: top, byParent };
}

function FolderTreeNode({
  folder, depth = 0, currentFolder, byParent, folderTags, onSelect, selectedFolders, onToggleSelect,
}) {
  const tx = useMediaLibraryText();
  const kids = byParent.get(folder) || [];
  const tag = getFolderTag(folderTags, folder);
  const selected = selectedFolders?.has(folder);
  return (
    <Box>
      <ListItemButton
        dense
        selected={currentFolder === folder}
        onClick={() => onSelect(folder)}
        sx={{ pl: 1 + depth * 1.5 }}
      >
        <Checkbox
          size="small"
          checked={!!selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(folder)}
          inputProps={{ 'aria-label': tx("Select folder {v0}", { v0: folder }) }}
          sx={{ mr: 0.5 }}
        />
        {kids.length ? <FolderOpen fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} />
          : <Folder fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} />}
        <ListItemText
          primary={folder.split('/').pop()}
          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
        />
        {tag === MEDIA_FOLDER_TAG_SET && <Chip size="small" label={tx("set")} color="primary" sx={{ height: 20, ml: 0.5 }} />}
        {tag === MEDIA_FOLDER_TAG_CATEGORY && <Chip size="small" label={tx("category")} color="secondary" sx={{ height: 20, ml: 0.5 }} />}
      </ListItemButton>
      {kids.map((child) => (
        <FolderTreeNode
          key={child}
          folder={child}
          depth={depth + 1}
          currentFolder={currentFolder}
          byParent={byParent}
          folderTags={folderTags}
          onSelect={onSelect}
          selectedFolders={selectedFolders}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </Box>
  );
}

export default function MediaFolderBrowser({
  currentProject,
  userId,
  onProjectUpdate,
  currentFolder,
  onCurrentFolderChange,
  selectedMediaEntries = [],
  selectedFolders: controlledFolders,
  onSelectedFoldersChange,
  onMoveComplete,
  openMoveSignal = 0,
  children = null,
  mediaCount = 0,
  disabled = false,
  /** Override R2 prefix (e.g. templates/{id}/). Default: projectR2Prefix(userId, projectId). */
  r2Prefix = null,
  /** Extra options for deleteImagesFromR2 (e.g. { allowTemplateKeys: true }). */
  r2DeleteOptions = null,
  rootLabel = '(project root)',
}) {
  const tx = useMediaLibraryText();
  const visibleRootLabel = ['(project root)', '(template root)', '(root)'].includes(rootLabel) ? tx(rootLabel) : rootLabel;
  const projectId = currentProject?.id;
  const prefix = r2Prefix != null && r2Prefix !== ''
    ? String(r2Prefix).replace(/\/?$/, '/')
    : projectR2Prefix(userId, projectId);
  const folderTags = currentProject?.imageDatasetConfig?.mediaFolderTags || {};
  const pool = currentProject?.preloadedImages || [];
  const deleteOpts = { allowedPrefix: prefix, ...(r2DeleteOptions || {}) };

  const [newFolderName, setNewFolderName] = useState('');
  const [localFolders, setLocalFolders] = useState(() => new Set());
  const selectedFolders = controlledFolders ?? localFolders;
  const setSelectedFolders = onSelectedFoldersChange ?? setLocalFolders;
  const [moveFilesOnly, setMoveFilesOnly] = useState(false);
  const movingFolders = moveFilesOnly ? new Set() : selectedFolders;
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (openMoveSignal > 0) {
      setMoveFilesOnly(true);
      setMoveTarget(currentFolder || '');
      setMoveOpen(true);
    }
  }, [openMoveSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(
    () => listAllKnownFolders(
      pool,
      folderTags,
      prefix,
      currentProject?.imageDatasetConfig?.mediaFolders || [],
    ),
    [pool, folderTags, prefix, currentProject?.imageDatasetConfig?.mediaFolders],
  );
  const { roots, byParent } = useMemo(() => folderChildrenMap(folders), [folders]);

  const taggedSets = useMemo(() => analyzeTaggedSets(pool, folderTags, null, { projectPrefix: prefix }), [pool, folderTags, prefix]);
  const taggedCats = useMemo(() => analyzeTaggedCategories(pool, folderTags, { projectPrefix: prefix }), [pool, folderTags, prefix]);

  const persistTags = (nextTags, extra = {}) => {
    const imageDatasetConfig = {
      ...(currentProject.imageDatasetConfig || {}),
      mediaFolderTags: nextTags,
    };
    onProjectUpdate({
      ...currentProject,
      ...extra,
      imageDatasetConfig,
    });
  };

  const toggleFolderSelect = (folder) => {
    const next = new Set(selectedFolders);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    setSelectedFolders(next);
  };

  /** Checked folders, else the currently open folder (not root). */
  const foldersToTag = useMemo(() => {
    if (selectedFolders.size) {
      return [...selectedFolders].map(normalizeFolderPath).filter(Boolean);
    }
    if (currentFolder) return [normalizeFolderPath(currentFolder)];
    return [];
  }, [selectedFolders, currentFolder]);

  const tagSelected = (tag) => {
    if (!foldersToTag.length) {
      setStatus({
        severity: 'info',
        message: tx("Open a folder (or check folders in the tree), then click Set / Category."),
      });
      return;
    }
    let tags = { ...folderTags };
    foldersToTag.forEach((folder) => {
      tags = setMediaFolderTag(tags, folder, tag);
    });
    persistTags(tags);
    const label = foldersToTag.length === 1 ? foldersToTag[0] : tx("{v0} folder(s)", { v0: foldersToTag.length });
    setStatus({
      severity: 'success',
      message: tx("Tagged {v0} as {v1}.", { v0: label, v1: tx(tag || 'untagged') }),
    });
  };

  const createFolder = () => {
    const name = normalizeFolderPath(newFolderName);
    if (!name) return;
    const folder = currentFolder ? joinFolderPath(currentFolder, name) : name;
    const mediaFolders = [...new Set([
      ...(currentProject.imageDatasetConfig?.mediaFolders || []),
      ...folders,
      folder,
    ])].sort(compareMediaNames);
    onProjectUpdate({
      ...currentProject,
      imageDatasetConfig: {
        ...(currentProject.imageDatasetConfig || {}),
        mediaFolders,
        mediaFolderTags: folderTags,
      },
    });
    onCurrentFolderChange(folder);
    setNewFolderName('');
    setStatus({ severity: 'success', message: tx("Created folder “{v0}”. Upload or move files into it next.", { v0: folder }) });
  };

  /** Folders to delete: checked ones, else current folder (if not root). */
  const foldersPendingDelete = useMemo(() => {
    if (selectedFolders.size) return [...selectedFolders].map(normalizeFolderPath).filter(Boolean).sort(compareMediaNames);
    if (currentFolder) return [normalizeFolderPath(currentFolder)];
    return [];
  }, [selectedFolders, currentFolder]);

  const deletePreview = useMemo(() => {
    const fileIds = new Set();
    const files = [];
    foldersPendingDelete.forEach((folder) => {
      getRecursiveMedia(pool, folder, prefix).forEach((entry) => {
        const id = entry.media_id || entry.key || entry.name;
        if (fileIds.has(id)) return;
        fileIds.add(id);
        files.push(entry);
      });
    });
    const subfolders = folders.filter((f) => foldersPendingDelete.some((d) => isFolderOrDescendant(f, d)));
    return { files, subfolders };
  }, [foldersPendingDelete, pool, prefix, folders]);

  const deleteFolders = async () => {
    if (!foldersPendingDelete.length) return;
    setBusy(true);
    setStatus(null);
    try {
      const { files } = deletePreview;
      if (files.length) {
        const keys = files
          .map((entry) => entry.key || buildProjectMediaKey(prefix, entry.folder, entry.name))
          .filter(Boolean);
        if (keys.length) {
          const del = await deleteImagesFromR2(keys, deleteOpts);
          if (!del.success) throw new Error(del.error || tx("Failed to delete folder files from R2"));
        }
      }
      const removeIds = new Set(files.map((e) => e.media_id || e.key || e.name));
      const remaining = (pool || [])
        .map((raw) => normalizeMediaEntry(raw, prefix))
        .filter((e) => !removeIds.has(e.media_id || e.key || e.name));
      const { mediaFolderTags, mediaFolders } = removeMediaFolders(
        folderTags,
        currentProject.imageDatasetConfig?.mediaFolders || folders,
        foldersPendingDelete,
      );
      onProjectUpdate({
        ...currentProject,
        preloadedImages: remaining,
        preloadedAt: new Date().toISOString(),
        preloadedSource: currentProject.preloadedSource || 'r2',
        imageDatasetConfig: {
          ...(currentProject.imageDatasetConfig || {}),
          mediaFolderTags,
          mediaFolders,
        },
      });
      if (currentFolder && foldersPendingDelete.some((f) => isFolderOrDescendant(currentFolder, f))) {
        onCurrentFolderChange('');
      }
      setSelectedFolders(new Set());
      setDeleteOpen(false);
      const fileNote = files.length ? tx(" and {v0} file(s)", { v0: files.length }) : '';
      setStatus({
        severity: 'success',
        message: tx("Deleted {v0} folder(s){v1}.", { v0: foldersPendingDelete.length, v1: fileNote }),
      });
    } catch (err) {
      setStatus({ severity: 'error', message: err.message || tx("Delete folder failed") });
    } finally {
      setBusy(false);
    }
  };

  const moveSelectedMedia = async () => {
    if (moveTarget === null || (moveTarget && !folders.includes(moveTarget))
      || [...movingFolders].some((folder) => isFolderOrDescendant(moveTarget, folder))) return;
    const target = normalizeFolderPath(moveTarget);
    const selectedFolderList = [...movingFolders]
      .map(normalizeFolderPath)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length); // deepest first for mapping
    // Only move root-most selected folders (skip children of other selected folders)
    const folderMoves = selectedFolderList
      .filter((from) => !selectedFolderList.some((other) => other !== from && isFolderOrDescendant(from, other)))
      .map((from) => {
        const leaf = from.split('/').pop();
        const to = joinFolderPath(target, leaf);
        return { from, to };
      })
      .filter(({ from, to }) => from && from !== to && !isFolderOrDescendant(to, from));

    if (!selectedMediaEntries.length && !folderMoves.length) {
      setStatus({
        severity: 'warning',
        message: tx("Check folders in the tree and/or select files, then move."),
      });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const selectedIds = new Set(selectedMediaEntries.map(getMediaId));
      let movedCount = 0;
      const updated = pool.map((raw) => {
        const entry = { ...raw, ...normalizeMediaEntry(raw, prefix) };
        const oldFolder = entry.folder || '';
        const folderMove = folderMoves.find(({ from }) => isFolderOrDescendant(oldFolder, from));
        const nextFolder = folderMove
          ? joinFolderPath(folderMove.to, oldFolder.slice(folderMove.from.length))
          : selectedIds.has(getMediaId(entry)) ? target : oldFolder;
        if (nextFolder === oldFolder) return entry;
        movedCount += 1;
        // Organization is metadata only. Keys, URLs, feature IDs and old answers stay valid.
        return { ...entry, folder: nextFolder, logicalFolder: nextFolder };
      });

      let nextTags = folderTags;
      let nextFolderList = currentProject.imageDatasetConfig?.mediaFolders || folders;
      folderMoves.forEach(({ from, to }) => {
        nextTags = remapMediaFolderTags(nextTags, from, to);
        nextFolderList = remapMediaFolderList(nextFolderList, from, to);
      });
      if (target) {
        nextFolderList = [...new Set([...nextFolderList, target, ...folderMoves.map((m) => m.to)])]
          .map(normalizeFolderPath)
          .filter(Boolean)
          .sort(compareMediaNames);
      }

      await onProjectUpdate({
        ...currentProject,
        preloadedImages: updated,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
        imageDatasetConfig: {
          ...(currentProject.imageDatasetConfig || {}),
          mediaFolders: nextFolderList,
          mediaFolderTags: nextTags,
        },
      }, { throwOnError: true });
      setMoveOpen(false);
      setSelectedFolders(new Set());
      onMoveComplete?.();
      onCurrentFolderChange(target);
      const parts = [];
      if (folderMoves.length) parts.push(tx("{v0} folder(s)", { v0: folderMoves.length }));
      if (movedCount) parts.push(tx("{v0} file(s)", { v0: movedCount }));
      setStatus({
        severity: 'success',
        message: tx("Moved {v0} to {v1}.", { v0: parts.join(' / ') || tx('items'), v1: target || tx('(root)') }),
      });
    } catch (err) {
      setStatus({ severity: 'error', message: err.message || tx("Move failed") });
    } finally {
      setBusy(false);
    }
  };

  const directCount = getDirectChildMedia(pool, currentFolder || '', prefix).length;
  const recursiveCount = getRecursiveMedia(pool, currentFolder || '', prefix).length;

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 3,
        border: '2px solid',
        borderColor: 'primary.light',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2.5,
          pt: 2,
          pb: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'action.hover'),
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Folder color="primary" fontSize="small" />{' '}{tx("Media library")}{' '}<Chip size="small" color="primary" variant="outlined" label={tx("{v0} file(s)", { v0: mediaCount || pool.length })} />
          <Chip size="small" variant="outlined" label={currentFolder || '/'} sx={{ fontFamily: 'monospace' }} />
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{' '}{tx("Left: folders (create, delete, tag as set / category). Right: files in the current folder.")}{' '}</Typography>
      </Box>

      {status && (
        <Alert severity={status.severity} sx={{ mx: 2.5, mt: 1.5 }} onClose={() => setStatus(null)}>
          {status.message}
        </Alert>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: 'stretch',
          minHeight: { md: 420 },
        }}
      >
        {/* Folder tree — stretches with files panel */}
        <Box
          sx={{
            width: { xs: '100%', md: 268 },
            flexShrink: 0,
            alignSelf: 'stretch',
            borderRight: { md: '1px solid' },
            borderBottom: { xs: '1px solid', md: 'none' },
            borderColor: 'divider',
            bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
            display: 'flex',
            flexDirection: 'column',
            minHeight: { xs: 220, md: 'auto' },
          }}
        >
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                placeholder={tx("New folder")}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
                sx={{ flex: 1, minWidth: 100, bgcolor: 'background.paper' }}
              />
              <Button
                size="small"
                variant="contained"
                onClick={createFolder}
                disabled={!newFolderName.trim()}
                sx={{ minWidth: 0, px: 1 }}
                title={tx("Create folder")}
              >
                <CreateNewFolder fontSize="small" />
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={disabled || !foldersPendingDelete.length || busy}
                onClick={() => setDeleteOpen(true)}
                sx={{ minWidth: 0, px: 1, bgcolor: 'background.paper' }}
                title={tx("Delete folder")}
              >
                <Delete fontSize="small" />
              </Button>
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" disabled={disabled || busy || !foldersToTag.length} onClick={() => tagSelected(MEDIA_FOLDER_TAG_SET)} sx={{ py: 0.25, bgcolor: 'background.paper' }}>{' '}{tx("Set")}{' '}</Button>
              <Button size="small" variant="outlined" color="secondary" disabled={disabled || busy || !foldersToTag.length} onClick={() => tagSelected(MEDIA_FOLDER_TAG_CATEGORY)} sx={{ py: 0.25, bgcolor: 'background.paper' }}>{' '}{tx("Category")}{' '}</Button>
              <Button size="small" variant="text" disabled={disabled || busy || !foldersToTag.length} onClick={() => tagSelected(null)} sx={{ py: 0.25 }}>{' '}{tx("Clear")}{' '}</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>{' '}{tx("Tags apply to checked folders, or the open folder if none checked.")}{' '}{' · '}{directCount}{' '}{tx("direct /")}{' '}{recursiveCount}{' '}{tx("in view")}{' '}</Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <ListItemButton dense selected={!currentFolder} onClick={() => onCurrentFolderChange('')}>
              <FolderOpen fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} />
              <ListItemText primary={visibleRootLabel} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
            </ListItemButton>
            <Divider />
            {folders.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>{' '}{tx("No folders yet — create one above.")}{' '}</Typography>
            ) : (
              <List dense disablePadding>
                {roots.map((folder) => (
                  <FolderTreeNode
                    key={folder}
                    folder={folder}
                    currentFolder={currentFolder}
                    byParent={byParent}
                    folderTags={folderTags}
                    onSelect={onCurrentFolderChange}
                    selectedFolders={selectedFolders}
                    onToggleSelect={toggleFolderSelect}
                  />
                ))}
              </List>
            )}
          </Box>
          <Box sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper' }}>
            <Typography variant="caption" color="text.secondary" display="block">{' '}{tx("Sets:")}{' '}{taggedSets.length}
              {taggedSets.length > 0 && ` (${taggedSets.map((s) => `${s.folder}:${s.size}`).join(', ')})`}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">{' '}{tx("Categories:")}{' '}{taggedCats.length}
              {taggedCats.length > 0 && ` (${taggedCats.map((c) => `${c.folder}:${c.count}`).join(', ')})`}
            </Typography>
          </Box>
        </Box>

        {/* Files panel */}
        <Box sx={{ flex: 1, minWidth: 0, p: 2, display: 'flex', flexDirection: 'column', minHeight: { md: 420 } }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 0.5 }}>{' '}{tx("Files in")}{' '}{currentFolder || tx('root')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DriveFileMove />}
              disabled={disabled || busy || (!selectedMediaEntries.length && !selectedFolders.size)}
              onClick={() => { setMoveFilesOnly(false); setMoveTarget(selectedFolders.size ? '' : currentFolder || ''); setMoveOpen(true); }}
            >{' '}{tx("Move selected")}{' '}{(selectedFolders.size || selectedMediaEntries.length)
                ? ` (${[
                  selectedFolders.size ? tx("{v0} folder", { v0: selectedFolders.size }) : null,
                  selectedMediaEntries.length ? tx("{v0} file", { v0: selectedMediaEntries.length }) : null,
                ].filter(Boolean).join(', ')})`
                : ''}
            </Button>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {children}
          </Box>
        </Box>
      </Box>

      <Dialog open={moveOpen} onClose={() => !busy && setMoveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{' '}{tx("Move")}{' '}{movingFolders.size ? tx(" {v0} folder(s)", { v0: movingFolders.size }) : ''}
          {movingFolders.size && selectedMediaEntries.length ? ' +' : ''}
          {selectedMediaEntries.length ? tx(" {v0} file(s)", { v0: selectedMediaEntries.length }) : ''}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1, mb: 1 }}>{' '}{tx("Moving changes the library folder only. File links and previously collected answers stay unchanged. Check question folder filters when moving tagged sets or categories.")}{' '}</Alert>
          {!selectedMediaEntries.length && !movingFolders.size ? (
            <Alert severity="warning" sx={{ mt: 1 }}>{' '}{tx("Check folders in the tree and/or select files, then try again.")}{' '}</Alert>
          ) : (
            <Autocomplete
              options={['', ...folders]}
              noOptionsText={tx('No matching folders')}
              clearText={tx('Clear')}
              openText={tx('Open folder list')}
              closeText={tx('Close folder list')}
              value={moveTarget}
              onChange={(_, value) => setMoveTarget(value)}
              getOptionLabel={(folder) => folder || visibleRootLabel}
              getOptionDisabled={(folder) => [...movingFolders].some((from) => isFolderOrDescendant(folder, from))}
              disabled={busy}
              fullWidth
              size="small"
              renderOption={(props, folder) => (
                <li {...props} key={folder || '__root__'} style={{ overflowWrap: 'anywhere' }}>
                  <Folder fontSize="small" sx={{ mr: 1, flexShrink: 0 }} />{folder || visibleRootLabel}
                </li>
              )}
              renderInput={(params) => <TextField {...params} label={tx("Target folder")}
                helperText={movingFolders.size
                  ? tx("Choose a folder. Selected folders keep their names inside it.")
                  : tx("Choose an existing folder or the project root. Type to search.")} />}
              sx={{ mt: 1 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveOpen(false)} disabled={busy}>{tx("Cancel")}</Button>
          <Button
            variant="contained"
            onClick={moveSelectedMedia}
            disabled={disabled || busy || moveTarget === null || [...movingFolders].some((from) => isFolderOrDescendant(moveTarget, from)) || (!selectedMediaEntries.length && !movingFolders.size)}
          >{' '}{tx("Move")}{' '}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => !busy && setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tx('Delete {count} folder(s)?', { count: foldersPendingDelete.length })}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mt: 1, mb: 1.5 }}>
            {tx('This removes {count} folder(s) from the project{files}. Tags on these folders are cleared. This cannot be undone.', {
              count: foldersPendingDelete.length,
              files: deletePreview.files.length ? tx(' and permanently deletes {v0} media file(s) in R2', { v0: deletePreview.files.length }) : '',
            })}
          </Alert>
          <Typography variant="body2" sx={{ mb: 1 }}>{' '}{tx("Folders:")}{' '}{foldersPendingDelete.map((f) => <code key={f} style={{ marginRight: 8 }}>{f}</code>)}
          </Typography>
          {deletePreview.subfolders.length > foldersPendingDelete.length && (
            <Typography variant="caption" color="text.secondary" display="block">{' '}{tx("Also removes nested paths:")}{' '}{deletePreview.subfolders.filter((f) => !foldersPendingDelete.includes(f)).join(', ')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={busy}>{tx("Cancel")}</Button>
          <Button variant="contained" color="error" onClick={deleteFolders} disabled={busy}>
            {busy ? tx("Deleting…") : tx("Delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
