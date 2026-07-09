import React from 'react';
import { Box, Typography, Slider, TextField, Chip } from '@mui/material';
import { ImageGalleryGrid } from './MediaWidgets';

/**
 * Slider group (semantic differential): multiple bipolar dimensions rated
 * on a shared numeric scale. value = { [dimensionId]: number }
 */
export function SliderGroupContent({ dimensions = [], scaleMin = 1, scaleMax = 7, value, onChange, readOnly }) {
  const mid = Math.round((scaleMin + scaleMax) / 2);
  const current = value || {};

  if (!dimensions.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No dimensions configured. Add rating dimensions in the question editor.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {dimensions.map((d) => {
        const v = current[d.id] ?? mid;
        const answered = current[d.id] !== undefined;
        return (
          <Box key={d.id} sx={{ px: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: -0.5 }}>
              <Typography variant="body2" color="text.secondary">{d.left}</Typography>
              <Chip
                size="small"
                label={answered ? v : '–'}
                color={answered ? 'primary' : 'default'}
                sx={{ height: 20, fontSize: '0.72rem', fontWeight: 700 }}
              />
              <Typography variant="body2" color="text.secondary">{d.right}</Typography>
            </Box>
            <Slider
              value={v}
              min={scaleMin}
              max={scaleMax}
              step={1}
              marks
              disabled={readOnly}
              onChange={(_, val) => onChange?.({ ...current, [d.id]: val })}
              valueLabelDisplay="auto"
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: -1 }}>
              <Typography variant="caption" color="text.disabled">{scaleMin}</Typography>
              <Typography variant="caption" color="text.disabled">{scaleMax}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Point allocation: distribute a fixed budget across options.
 * value = { [choiceValue]: number }
 */
export function PointAllocationContent({ choices = [], budget = 100, value, onChange, readOnly }) {
  const current = value || {};
  const normalized = choices.map((c) => (typeof c === 'object' ? c : { value: c, text: c }));
  const allocated = normalized.reduce((sum, c) => sum + (Number(current[c.value]) || 0), 0);
  const remaining = budget - allocated;

  if (!normalized.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No options configured. Add choices in the question editor.
      </Typography>
    );
  }

  const setPoints = (choiceValue, raw) => {
    const n = Math.max(0, Math.min(budget, parseInt(raw, 10) || 0));
    onChange?.({ ...current, [choiceValue]: n });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {normalized.map((c) => (
        <Box key={c.value} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="body2" sx={{ flex: 1 }}>{c.text}</Typography>
          <Slider
            value={Number(current[c.value]) || 0}
            min={0}
            max={budget}
            step={1}
            disabled={readOnly}
            onChange={(_, val) => setPoints(c.value, val)}
            sx={{ flex: 2, maxWidth: 260 }}
          />
          <TextField
            type="number"
            size="small"
            value={current[c.value] ?? 0}
            onChange={(e) => setPoints(c.value, e.target.value)}
            disabled={readOnly}
            inputProps={{ min: 0, max: budget, step: 1, style: { width: 56, textAlign: 'center' } }}
          />
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">Remaining:</Typography>
        <Chip
          size="small"
          label={`${remaining} / ${budget}`}
          color={remaining === 0 ? 'success' : remaining < 0 ? 'error' : 'warning'}
          sx={{ fontWeight: 700 }}
        />
      </Box>
      {remaining < 0 && (
        <Typography variant="caption" color="error">
          You have allocated more than {budget} points — please reduce some values.
        </Typography>
      )}
    </Box>
  );
}

/** Image + semantic differential sliders (imageslidergroup). */
export function ImageSliderGroupContent({
  imageUrls = [],
  dimensions = [],
  scaleMin = 1,
  scaleMax = 7,
  value,
  onChange,
  readOnly,
}) {
  const items = (imageUrls || []).filter(Boolean).map((url, i) => ({
    url,
    name: url.split('/').pop() || `Image ${i + 1}`,
    type: 'image',
  }));

  return (
    <Box>
      {items.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <ImageGalleryGrid items={items} />
        </Box>
      )}
      <SliderGroupContent
        dimensions={dimensions}
        scaleMin={scaleMin}
        scaleMax={scaleMax}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    </Box>
  );
}

/** Image + point budget allocation (imagepointallocation). */
export function ImagePointAllocationContent({
  imageUrls = [],
  choices = [],
  budget = 100,
  value,
  onChange,
  readOnly,
}) {
  const items = (imageUrls || []).filter(Boolean).map((url, i) => ({
    url,
    name: url.split('/').pop() || `Image ${i + 1}`,
    type: 'image',
  }));

  return (
    <Box>
      {items.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <ImageGalleryGrid items={items} />
        </Box>
      )}
      <PointAllocationContent
        choices={choices}
        budget={budget}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    </Box>
  );
}
