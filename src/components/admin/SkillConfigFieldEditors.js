import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
import React from 'react';
import {
  Box, TextField, Button, IconButton, Typography, Stack,
} from '@mui/material';
import { Add, Delete, ArrowUpward, ArrowDownward } from '@mui/icons-material';

const DEFAULT_DIMENSION = { id: 'dim1', label: 'Dimension 1', left: 'Low', right: 'High' };

export function SkillDimensionsEditor({ value = [], onChange, scaleMin = 1, scaleMax = 7 }) {
  const { tr, zh } = useQuestionEditorText();
  const dims = Array.isArray(value) && value.length ? value : [{ ...DEFAULT_DIMENSION }];

  const update = (next) => onChange(next);

  const patch = (index, patchObj) => {
    const next = dims.map((d, i) => (i === index ? { ...d, ...patchObj } : d));
    update(next);
  };

  const add = () => {
    let n = dims.length + 1;
    while (dims.some((d) => d.id === `dim${n}`)) n += 1;
    update([...dims, { id: `dim${n}`, label: `Dimension ${n}`, left: 'Left label', right: 'Right label' }]);
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
        {zh ? `双极量表：参与者对每行按 ${scaleMin}–${scaleMax} 评分` : `Bipolar scale pairs (participants rate ${scaleMin}–${scaleMax} on each row)`}
      </Typography>
      {dims.map((d, i) => (
        <Box
          key={i}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
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
            label={tr("ID")}
            value={d.id || ''}
            onChange={(e) => patch(i, { id: e.target.value.replace(/\s/g, '_') })}
          />
          <TextField
            size="small"
            label={zh ? '显示名称' : 'Display name'}
            value={d.label || d.text || d.name || d.title || ''}
            onChange={(e) => patch(i, { label: e.target.value })}
            placeholder={zh ? `维度 ${i + 1}` : `Dimension ${i + 1}`}
          />
          <TextField
            size="small"
            label={tr("Left pole")}
            value={d.left || d.low || d.leftLabel || ''}
            onChange={(e) => patch(i, { left: e.target.value })}
          />
          <TextField
            size="small"
            label={tr("Right pole")}
            value={d.right || d.high || d.rightLabel || ''}
            onChange={(e) => patch(i, { right: e.target.value })}
          />
          {['min', 'max', 'step'].map((key) => <TextField key={key} size="small" type="number"
            name={`dimensions[${i}].${key}`} label={tr(key === 'min' ? 'Minimum (optional)' : key === 'max' ? 'Maximum (optional)' : 'Step (optional)')}
            value={d[key] ?? ''} onChange={(e) => patch(i, { [key]: e.target.value === '' ? undefined : Number(e.target.value) })} />)}
          <Stack direction="row" sx={{ gridColumn: '1 / -1', '& .MuiIconButton-root': { width: 44, height: 44 } }}>
            <IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={tr("Move up")}>
              <ArrowUpward fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => move(i, 1)} disabled={i === dims.length - 1} aria-label={tr("Move down")}>
              <ArrowDownward fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => remove(i)} disabled={dims.length <= 1} aria-label={tr("Remove")}>
              <Delete fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      ))}
      <Button size="small" startIcon={<Add />} onClick={add} sx={{ alignSelf: 'flex-start' }}>{tr("Add dimension")} </Button>
    </Box>
  );
}

export function SkillStringListEditor({ value = [], onChange, label = 'Items', placeholder = 'New item' }) {
  const { tr, zh } = useQuestionEditorText();
  const items = Array.isArray(value) ? value : [];

  const update = (next) => onChange(next);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            label={tr(`${tr(label)} ${i + 1}`)}
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
            aria-label={tr("Remove")}
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
      >{tr("Add")} {zh ? tr(label) : label.toLowerCase()}
      </Button>
      {items.length === 0 && (
        <Typography variant="caption" color="text.secondary">{tr("No items yet — click Add or paste comma-separated values below.")} </Typography>
      )}
      <TextField
        size="small"
        placeholder={tr(zh ? `粘贴用逗号分隔的${tr(placeholder)}` : `Paste comma-separated ${placeholder}`)}
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
