import React, { useState } from 'react';
import {
  Box, Typography, Button, FormControl, InputLabel, Select, MenuItem,
  TextField, IconButton, Collapse, Alert, Chip, Stack,
} from '@mui/material';
import { Add, Delete, ExpandMore, ExpandLess } from '@mui/icons-material';
import { MEDIA_SLOT_PRESETS } from '../../lib/mediaSlots';
import { sortMediaByName } from '../../lib/mediaUtils';

const ROLES = ['stimulus', 'companion', 'choice', 'context'];
const MEDIA_TYPES = ['image', 'video', 'audio', 'any'];
const SELECTIONS = ['fixed', 'random', 'set_member', 'category'];

function emptySlot(index = 0) {
  return {
    id: `slot_${index + 1}`,
    role: 'stimulus',
    mediaType: 'video',
    selection: 'random',
    count: 1,
    order: index,
    matchBy: 'none',
    mediaFolders: [],
    setBinding: 'shared',
    mediaRef: {},
  };
}

/**
 * Collapsible editor for question.mediaSlots + mediaPresentation.
 * When slots are empty, legacy individual/set/category still applies.
 */
export default function MediaSlotsEditor({
  question,
  onChange,
  availableImages = [],
}) {
  const slots = Array.isArray(question.mediaSlots) ? question.mediaSlots : [];
  const [open, setOpen] = useState(slots.length > 0);
  const pool = sortMediaByName(availableImages || []);

  const setSlots = (next) => onChange('mediaSlots', next);
  const updateSlot = (index, patch) => {
    const next = slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSlots(next);
  };

  const applyPreset = (key) => {
    const preset = MEDIA_SLOT_PRESETS[key];
    if (!preset) return;
    setSlots(JSON.parse(JSON.stringify(preset)));
    if (!question.mediaPresentation) onChange('mediaPresentation', 'stack');
    setOpen(true);
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'white' }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 1.5, py: 1, cursor: 'pointer',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>
            Media Slots
            {slots.length > 0 && (
              <Chip size="small" label={`${slots.length} slot${slots.length === 1 ? '' : 's'}`} sx={{ ml: 1 }} />
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Multi-modal stimuli (fixed video + random audio, paired basenames, mixed sets). Leave empty for legacy single-pool assignment.
          </Typography>
        </Box>
        {open ? <ExpandLess /> : <ExpandMore />}
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Button size="small" variant="outlined" onClick={() => applyPreset('fixedVideoRandomAudio')}>
              Fixed video + random audio
            </Button>
            <Button size="small" variant="outlined" onClick={() => applyPreset('randomVideoAudio')}>
              Random video + audio
            </Button>
            <Button size="small" variant="outlined" onClick={() => applyPreset('basenamePair')}>
              Basename pair
            </Button>
            <Button size="small" variant="outlined" onClick={() => applyPreset('mixedSet')}>
              Mixed set
            </Button>
            <Button size="small" onClick={() => { setSlots([]); }}>
              Clear slots
            </Button>
          </Stack>

          <FormControl fullWidth size="small" variant="outlined">
            <InputLabel>Presentation</InputLabel>
            <Select
              label="Presentation"
              value={question.mediaPresentation || 'stack'}
              onChange={(e) => onChange('mediaPresentation', e.target.value)}
            >
              <MenuItem value="stack">Stack — show all slots together</MenuItem>
              <MenuItem value="sequential">Sequential — one slot at a time</MenuItem>
            </Select>
          </FormControl>

          {slots.length === 0 && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              No slots configured — this question uses the Media Assignment controls above (individual / set / category).
            </Alert>
          )}

          {slots.map((slot, index) => (
            <Box
              key={`${slot.id || 'slot'}_${index}`}
              sx={{ p: 1.5, border: '1px solid', borderColor: 'grey.300', borderRadius: 1, bgcolor: 'grey.50' }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" fontWeight={700}>Slot {index + 1}</Typography>
                <IconButton
                  size="small"
                  onClick={() => setSlots(slots.filter((_, i) => i !== index))}
                  aria-label="Remove slot"
                >
                  <Delete fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                <TextField
                  size="small" label="Slot id" value={slot.id || ''}
                  onChange={(e) => updateSlot(index, { id: e.target.value.replace(/\s+/g, '_') })}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>Role</InputLabel>
                  <Select label="Role" value={slot.role || 'stimulus'} onChange={(e) => updateSlot(index, { role: e.target.value })}>
                    {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Media type</InputLabel>
                  <Select label="Media type" value={slot.mediaType || 'any'} onChange={(e) => updateSlot(index, { mediaType: e.target.value })}>
                    {MEDIA_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Selection</InputLabel>
                  <Select label="Selection" value={slot.selection || 'random'} onChange={(e) => updateSlot(index, { selection: e.target.value })}>
                    {SELECTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  size="small" type="number" label="Count" value={slot.count ?? 1}
                  onChange={(e) => updateSlot(index, { count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  inputProps={{ min: 1, max: 10 }}
                />
                <TextField
                  size="small" type="number" label="Order" value={slot.order ?? index}
                  onChange={(e) => updateSlot(index, { order: parseInt(e.target.value, 10) || 0 })}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>Match by</InputLabel>
                  <Select label="Match by" value={slot.matchBy || 'none'} onChange={(e) => updateSlot(index, { matchBy: e.target.value })}>
                    <MenuItem value="none">none</MenuItem>
                    <MenuItem value="basename">basename</MenuItem>
                  </Select>
                </FormControl>
                {(slot.selection === 'set_member') && (
                  <TextField
                    size="small" label="Set binding" value={slot.setBinding || 'shared'}
                    onChange={(e) => updateSlot(index, { setBinding: e.target.value || 'shared' })}
                    helperText="Same binding = one shared set draw"
                  />
                )}
              </Box>
              {slot.selection === 'fixed' && (
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Fixed media</InputLabel>
                  <Select
                    label="Fixed media"
                    value={slot.mediaRef?.key || slot.mediaRef?.url || ''}
                    onChange={(e) => {
                      const found = pool.find((m) => (m.key || m.url) === e.target.value);
                      updateSlot(index, {
                        mediaRef: found
                          ? { key: found.key || found.media_id, url: found.url, name: found.name }
                          : {},
                      });
                    }}
                  >
                    <MenuItem value=""><em>Select file…</em></MenuItem>
                    {pool.map((m) => (
                      <MenuItem key={m.key || m.url} value={m.key || m.url}>
                        {m.name || m.url} ({m.type || 'file'})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {['random', 'set_member', 'category'].includes(slot.selection) && (
                <TextField
                  size="small"
                  fullWidth
                  sx={{ mt: 1 }}
                  label="Folder scope (comma-separated, optional)"
                  value={(slot.mediaFolders || []).join(', ')}
                  onChange={(e) => {
                    const folders = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    updateSlot(index, { mediaFolders: folders });
                  }}
                  helperText="Limit this slot’s pool to these media folders"
                />
              )}
            </Box>
          ))}

          <Button
            size="small"
            startIcon={<Add />}
            onClick={() => setSlots([...slots, emptySlot(slots.length)])}
          >
            Add slot
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
}
