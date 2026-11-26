import React from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { uiPair } from '../../lib/uiLanguages';
import { annotationScopeFolder } from '../../lib/annotationScope';

const TEXT = {
  label: ['Annotate', '标注'],
  help: ['Only these images are annotated. Folder organization stays in the library.', '本页只标注这里选中的图片或文件夹，文件夹整理仍保留。'],
  all: ['All images', '全部图片'],
  selected: ['Selected images', '已选图片'],
  checked: ['Checked folders', '已勾选文件夹'],
  root: ['No folder', '未分类'],
  folder: ['Folder', '文件夹'],
};

function phrase(language, pair) {
  return uiPair(language, pair[0], pair[1]);
}

export default function AnnotationImageScope({
  language = 'en',
  value = 'all',
  onChange,
  choices,
}) {
  const label = phrase(language, TEXT.label);
  const folders = [...(choices?.folders || [])];
  if (String(value).startsWith('folder:')) {
    const folder = value.slice('folder:'.length);
    if (!folders.some((item) => item.folder === folder)) folders.push({ folder, count: 0 });
  }
  const optionLabel = (optionValue) => {
    if (optionValue === 'all') return `${phrase(language, TEXT.all)} (${choices?.allCount || 0})`;
    if (optionValue === 'selected') return `${phrase(language, TEXT.selected)} (${choices?.selectedCount || 0})`;
    if (optionValue === 'checked') return `${phrase(language, TEXT.checked)} (${choices?.checkedCount || 0})`;
    const folder = String(optionValue).startsWith('folder:') ? optionValue.slice('folder:'.length) : '';
    const count = folders.find((item) => item.folder === folder)?.count || 0;
    const name = folder || phrase(language, TEXT.root);
    return `${phrase(language, TEXT.folder)} · ${name} (${count})`;
  };
  return <Box sx={{ mb: 2 }}>
    <FormControl size="small" fullWidth sx={{ maxWidth: 480 }}>
      <InputLabel id="annotation-image-scope-label" shrink>{label}</InputLabel>
      <Select
        labelId="annotation-image-scope-label"
        id="annotation-image-scope"
        label={label}
        value={value}
        notched
        onChange={(event) => onChange?.(event.target.value)}
        renderValue={optionLabel}
      >
        <MenuItem value="all">{optionLabel('all')}</MenuItem>
        <MenuItem value="selected" disabled={!choices?.selectedCount}>{optionLabel('selected')}</MenuItem>
        <MenuItem value="checked" disabled={!choices?.checkedCount}>{optionLabel('checked')}</MenuItem>
        {folders.map((item) => <MenuItem key={item.folder || '__root'} value={annotationScopeFolder(item.folder)}>
          {optionLabel(annotationScopeFolder(item.folder))}
        </MenuItem>)}
      </Select>
    </FormControl>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{phrase(language, TEXT.help)}</Typography>
  </Box>;
}
