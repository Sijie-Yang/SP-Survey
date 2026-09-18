import React, { useMemo } from 'react';
import { Autocomplete, Checkbox, TextField } from '@mui/material';
import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
import { compareMediaNames } from '../../lib/mediaUtils';

/** An empty stored list explicitly means all; the UI-only all option is never saved. */
export default function MediaFolderScopeSelect({ folders = [], value = [], onChange, allLabel, helperText }) {
  const { tr } = useQuestionEditorText();
  const selected = Array.isArray(value) ? value : [];
  const options = useMemo(() => [
    { all: true },
    ...[...new Set([...folders, ...(Array.isArray(value) ? value : [])])].filter(Boolean).sort(compareMediaNames).map((folder) => ({ folder })),
  ], [folders, value]);
  return <Autocomplete
    multiple fullWidth disableCloseOnSelect limitTags={2}
    options={options}
    value={selected.length ? options.filter((option) => selected.includes(option.folder)) : [options[0]]}
    isOptionEqualToValue={(option, other) => option.all ? !!other.all : option.folder === other.folder}
    getOptionLabel={(option) => option.all ? allLabel : option.folder}
    onChange={(_, next, reason, details) => onChange(details?.option?.all ? [] : next.filter((option) => !option.all).map((option) => option.folder))}
    noOptionsText={tr('No matching folders')}
    clearText={tr('Use all folders')} openText={tr('Choose folders')} closeText={tr('Close folder list')}
    renderOption={(props, option, { selected: checked }) => (
      <li {...props} key={option.all ? 'all-folders' : `folder:${option.folder}`}>
        <Checkbox checked={checked} tabIndex={-1} disableRipple sx={{ mr: 1 }} />
        {option.all ? allLabel : option.folder}
      </li>
    )}
    renderInput={(params) => <TextField {...params} label={tr('Random draw scope')} placeholder={tr('Search and select folders…')} helperText={helperText} />}
    sx={{ mt: 1, '& .MuiAutocomplete-tag': { maxWidth: '100%' }, '& .MuiAutocomplete-option': { overflowWrap: 'anywhere' } }}
  />;
}
