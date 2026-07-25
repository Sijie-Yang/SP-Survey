/**
 * Add / rename / recolor / delete labels for SAM pre-annotate (project-wide).
 */
import React, { useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import { Add, Delete, Edit } from '@mui/icons-material';
import {
  LABEL_COLOR_PALETTE,
  hashLabelColor,
  normalizeLabelDefs,
} from '../../lib/preannotateLabels';

export default function PreannotateLabelManager({
  labels = [],
  onChange,
  disabled = false,
}) {
  const defs = normalizeLabelDefs(labels);
  const [editOpen, setEditOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(LABEL_COLOR_PALETTE[0]);
  const [addName, setAddName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState(-1);
  const [deleteMode, setDeleteMode] = useState('clear'); // clear | delete_shapes

  const openEdit = (index) => {
    const d = defs[index];
    if (!d) return;
    setEditIndex(index);
    setDraftName(d.name);
    setDraftColor(d.color || hashLabelColor(d.name));
    setEditOpen(true);
  };

  const commitEdit = () => {
    const name = draftName.trim();
    if (!name || editIndex < 0) return;
    const next = defs.map((d, i) => {
      if (i !== editIndex) return d;
      return { name, color: draftColor };
    });
    const clash = next.some((d, i) => i !== editIndex && d.name === name);
    if (clash) return;
    const oldName = defs[editIndex].name;
    const colorOnly = oldName === name && defs[editIndex].color !== draftColor;
    onChange?.(next, {
      type: colorOnly ? 'recolor' : 'rename',
      oldName,
      newName: name,
      color: draftColor,
    });
    setEditOpen(false);
  };

  const openDelete = (index) => {
    setDeleteIndex(index);
    setDeleteMode('clear');
    setDeleteOpen(true);
  };

  const commitDelete = () => {
    const d = defs[deleteIndex];
    if (!d) return;
    const next = defs.filter((_, i) => i !== deleteIndex);
    onChange?.(next.length ? next : normalizeLabelDefs([]), {
      type: 'delete',
      name: d.name,
      deleteMode, // clear | delete_shapes
    });
    setDeleteOpen(false);
  };

  const addLabel = () => {
    const name = addName.trim();
    if (!name) return;
    if (defs.some((x) => x.name === name)) {
      setAddName('');
      return;
    }
    const color = LABEL_COLOR_PALETTE[defs.length % LABEL_COLOR_PALETTE.length] || hashLabelColor(name);
    const next = [...defs, { name, color }];
    onChange?.(next, { type: 'add', name, color });
    setAddName('');
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
        Project labels — add / edit name & color / delete. Rename & delete apply across this project&apos;s annotations.
      </Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mb: 1 }}>
        {defs.map((d, i) => (
          <Chip
            key={`${d.name}-${i}`}
            size="small"
            disabled={disabled}
            onDelete={() => openDelete(i)}
            deleteIcon={<Delete fontSize="small" />}
            onClick={() => openEdit(i)}
            label={(
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{
                  width: 10, height: 10, borderRadius: '50%', bgcolor: d.color,
                  border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0,
                }}
                />
                {d.name}
              </Box>
            )}
            sx={{ borderColor: d.color }}
            variant="outlined"
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          placeholder="New label"
          value={addName}
          disabled={disabled}
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLabel();
            }
          }}
          sx={{ maxWidth: 220 }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<Add />}
          disabled={disabled || !addName.trim()}
          onClick={addLabel}
        >
          Add
        </Button>
      </Stack>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Edit fontSize="small" /> Edit label
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
            />
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" color="text.secondary">Color</Typography>
              <Box
                component="input"
                type="color"
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                sx={{ width: 42, height: 32, border: 'none', p: 0, bgcolor: 'transparent', cursor: 'pointer' }}
              />
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {LABEL_COLOR_PALETTE.map((c) => (
                  <IconButton
                    key={c}
                    size="small"
                    onClick={() => setDraftColor(c)}
                    sx={{
                      width: 22,
                      height: 22,
                      bgcolor: c,
                      border: draftColor === c ? '2px solid #111' : '1px solid rgba(0,0,0,0.2)',
                      borderRadius: 0.5,
                      '&:hover': { bgcolor: c },
                    }}
                  />
                ))}
              </Stack>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Renaming remaps this label on every annotated image in the project.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={commitEdit} disabled={!draftName.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete label from project?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Remove “{defs[deleteIndex]?.name}” from the project palette.
          </Typography>
          <RadioGroup value={deleteMode} onChange={(e) => setDeleteMode(e.target.value)}>
            <FormControlLabel
              value="clear"
              control={<Radio size="small" />}
              label="Keep shapes — set their label to None"
            />
            <FormControlLabel
              value="delete_shapes"
              control={<Radio size="small" />}
              label="Delete all shapes that use this label"
            />
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={commitDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
