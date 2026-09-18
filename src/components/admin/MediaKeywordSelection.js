import React, { useContext, useMemo, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { Search } from '@mui/icons-material';
import { RegionContext } from '../../contexts/RegionContext';
import { mediaKeywordCandidates } from '../../lib/mediaLibrarySelection';
import { normalizeMediaEntry } from '../../lib/mediaUtils';

const NO_FOLDERS = new Set();

/** Shared by researcher, project-admin and template media libraries. Changes selection only. */
export default function MediaKeywordSelection({ pool, folders = NO_FOLDERS, currentFolder = '', prefix = '', selected, getId, onSelect, disabled = false }) {
  const zh = useContext(RegionContext)?.language === 'zh';
  const [open, setOpen] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [match, setMatch] = useState('any');
  const [allFolders, setAllFolders] = useState(false);
  const matches = useMemo(() => open ? mediaKeywordCandidates(pool, { keywords, match, allFolders, folders, currentFolder, prefix }) : [],
    [open, pool, keywords, match, allFolders, folders, currentFolder, prefix]);
  const additions = matches.filter((entry) => !selected.has(getId(entry)));
  const scopedLabel = folders.size
    ? (zh ? `已勾选的 ${folders.size} 个文件夹（含子文件夹）` : `${folders.size} checked folders (including subfolders)`)
    : (zh ? `当前文件夹：${currentFolder || '根目录'}（仅本层）` : `Current folder: ${currentFolder || 'Root'} (direct files only)`);

  return <>
    <Button size="small" variant="outlined" startIcon={<Search />} disabled={disabled || !pool?.length} onClick={() => {
      setKeywords(''); setMatch('any'); setAllFolders(false); setOpen(true);
    }}>{zh ? '按关键词选图' : 'Select images by keyword'}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth aria-labelledby="media-keyword-title">
      <DialogTitle id="media-keyword-title">{zh ? '按关键词选图' : 'Select images by keyword'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField autoFocus fullWidth multiline minRows={2} label={zh ? '文件名关键词' : 'Filename keywords'} value={keywords}
            onChange={(event) => setKeywords(event.target.value)} placeholder={zh ? '例如：街道，公园，night scene' : 'e.g. street, park, night scene'}
            helperText={zh ? '多个关键词用逗号、分号或换行分隔，不区分大小写；空格保留为词组。' : 'Separate keywords with commas, semicolons or newlines. Case-insensitive; spaces stay within phrases.'} />
          <TextField select fullWidth label={zh ? '匹配方式' : 'Match mode'} value={match} onChange={(event) => setMatch(event.target.value)}>
            <MenuItem value="any">{zh ? '包含任意一个关键词' : 'Contains any keyword'}</MenuItem>
            <MenuItem value="all">{zh ? '同时包含所有关键词' : 'Contains all keywords'}</MenuItem>
          </TextField>
          <TextField select fullWidth label={zh ? '查找范围' : 'Search scope'} value={allFolders ? 'all' : 'scoped'}
            onChange={(event) => setAllFolders(event.target.value === 'all')}
            sx={{ '& .MuiSelect-select': { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}>
            <MenuItem value="scoped" sx={{ whiteSpace: 'normal' }}>{scopedLabel}</MenuItem>
            <MenuItem value="all">{zh ? '整个媒体库（含所有子文件夹）' : 'Entire library (including all subfolders)'}</MenuItem>
          </TextField>
          <Typography variant="body2" color="text.secondary">{zh
            ? '仅匹配图片文件名，不识别画面内容；使用这里的查找条件，保留已有勾选。'
            : 'Matches image filenames, not visual content. Uses the criteria in this dialog and keeps your existing selection.'}</Typography>
          <Alert severity={matches.length ? 'success' : 'info'} role="status">{!keywords.trim()
            ? (zh ? '输入关键词后查看匹配图片。' : 'Enter keywords to see matching images.')
            : (zh ? `匹配 ${matches.length} 张图片，可新增选中 ${additions.length} 张。` : `${matches.length} matching ${matches.length === 1 ? 'image' : 'images'}; ${additions.length} new ${additions.length === 1 ? 'selection' : 'selections'}.`)}</Alert>
          {!!matches.length && <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1 }}>
            {matches.slice(0, 12).map((raw) => {
              const entry = normalizeMediaEntry(raw, prefix);
              return <Box key={getId(raw)} sx={{ minWidth: 0 }}>
                <Box component="img" src={entry.url} alt="" loading="lazy" sx={{ width: '100%', height: 80, objectFit: 'contain', bgcolor: 'grey.100', borderRadius: 1 }} />
                <Typography variant="caption" component="div" sx={{ overflowWrap: 'anywhere' }}>{entry.name}</Typography>
                <Typography variant="caption" component="div" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{entry.folder || (zh ? '根目录' : 'Root')}</Typography>
              </Box>;
            })}
          </Box>}
          {matches.length > 12 && <Typography variant="caption">{zh ? '仅预览前 12 张，确认后选中全部匹配图片。' : 'Previewing the first 12; confirmation selects all matches.'}</Typography>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={() => setOpen(false)}>{zh ? '取消' : 'Cancel'}</Button>
        <Button variant="contained" disabled={!additions.length || disabled} onClick={() => { onSelect(matches); setOpen(false); }}>
          {zh ? `新增选中 ${additions.length} 张` : `Add ${additions.length} ${additions.length === 1 ? 'image' : 'images'} to selection`}
        </Button>
      </DialogActions>
    </Dialog>
  </>;
}
