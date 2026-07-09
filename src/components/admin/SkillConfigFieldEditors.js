import React from 'react';
import {
  Box, TextField, Button, IconButton, Typography, Stack,
} from '@mui/material';
import { Add, Delete, ArrowUpward, ArrowDownward } from '@mui/icons-material';

const DEFAULT_DIMENSION = { id: 'dim1', left: 'Low', right: 'High' };

export function SkillDimensionsEditor({ value = [], onChange, scaleMin = 1, scaleMax = 7 }) {
  const dims = Array.isArray(value) && value.length ? value : [{ ...DEFAULT_DIMENSION }];

  const update = (next) => onChange(next);

  const patch = (index, patchObj) => {
    const next = dims.map((d, i) => (i === index ? { ...d, ...patchObj } : d));
    update(next);
  };

  const add = () => {
    const n = dims.length + 1;
    update([...dims, { id: `dim${n}`, left: 'Left label', right: 'Right label' }]);
  };

  const remove = (index) => {
    if (dims.length <= 1) return;
    update(dims.filter((_, i) => i !== index));
  };

  const move = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= dims.length) return;
    const next = [...dims];
    [next[index], next[j]] = [next[j], next[index]];
    update(next);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Bipolar scale pairs (participants rate {scaleMin}–{scaleMax} on each row)
      </Typography>
      {dims.map((d, i) => (
        <Box
          key={`${d.id}-${i}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto',
            gap: 1,
            alignItems: 'center',
            p: 1.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'white',
          }}
        >
          <TextField
            size="small"
            label="ID"
            value={d.id || ''}
            onChange={(e) => patch(i, { id: e.target.value.replace(/\s/g, '_') })}
          />
          <TextField
            size="small"
            label="Left pole"
            value={d.left || ''}
            onChange={(e) => patch(i, { left: e.target.value })}
          />
          <TextField
            size="small"
            label="Right pole"
            value={d.right || ''}
            onChange={(e) => patch(i, { right: e.target.value })}
          />
          <Stack direction="row">
            <IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <ArrowUpward fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => move(i, 1)} disabled={i === dims.length - 1} aria-label="Move down">
              <ArrowDownward fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => remove(i)} disabled={dims.length <= 1} aria-label="Remove">
              <Delete fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      ))}
      <Button size="small" startIcon={<Add />} onClick={add} sx={{ alignSelf: 'flex-start' }}>
        Add dimension
      </Button>
    </Box>
  );
}

export function SkillStringListEditor({ value = [], onChange, label = 'Items', placeholder = 'New item' }) {
  const items = Array.isArray(value) ? value : [];

  const update = (next) => onChange(next.filter(Boolean));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            label={`${label} ${i + 1}`}
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              update(next);
            }}
            sx={{ bgcolor: 'white' }}
          />
          <IconButton
            color="error"
            onClick={() => update(items.filter((_, j) => j !== i))}
            aria-label="Remove"
          >
            <Delete fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button
        size="small"
        startIcon={<Add />}
        onClick={() => update([...items, ''])}
        sx={{ alignSelf: 'flex-start' }}
      >
        Add {label.toLowerCase()}
      </Button>
      {items.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          No items yet — click Add or paste comma-separated values below.
        </Typography>
      )}
      <TextField
        size="small"
        placeholder={`Paste comma-separated ${placeholder}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (!raw) return;
          const parsed = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
          if (parsed.length) update([...items, ...parsed]);
          e.target.value = '';
        }}
        sx={{ bgcolor: 'white' }}
      />
    </Box>
  );
}
