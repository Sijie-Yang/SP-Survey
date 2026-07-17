import React, { useEffect } from 'react';
import { Box, Typography, Slider, TextField, Chip } from '@mui/material';
import { ImageGalleryGrid } from './MediaWidgets';

/**
 * Slider group (semantic differential): multiple bipolar dimensions rated
 * on a shared numeric scale. value = { [dimensionId]: number }
 * Defaults every dimension to the scale midpoint until the participant moves it.
 */
export function SliderGroupContent({
  dimensions = [],
  scaleMin = 1,
  scaleMax = 7,
  value,
  onChange,
  readOnly,
  /** Persist midpoint as the answer when the participant never moves a slider. */
  autoPersistDefaults = true,
}) {
  const mid = Math.round((Number(scaleMin) + Number(scaleMax)) / 2);
  const current = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};

  // Persist midpoint defaults so submit / required / multi-trial checks see real scores
  // without requiring the participant to touch every slider.
  useEffect(() => {
    if (!autoPersistDefaults || readOnly || !onChange || !dimensions.length) return;
    let changed = false;
    const next = { ...current };
    dimensions.forEach((d) => {
      if (!d?.id) return;
      if (next[d.id] === undefined || next[d.id] === null || next[d.id] === '') {
        next[d.id] = mid;
        changed = true;
      }
    });
    if (changed) onChange(next);
    // Only re-run when scale / dimension set changes — not on every value tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions, scaleMin, scaleMax, mid, readOnly, autoPersistDefaults]);

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
        return (
          <Box key={d.id} sx={{ px: { xs: 0, sm: 1 } }}>
            {/* Phones: labels above slider so long bipolar text does not crush mid-row */}
            <Box
              sx={{
                display: { xs: 'flex', sm: 'none' },
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 1,
                mb: 0.5,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.3 }}>
                {d.left}
              </Typography>
              <Chip
                size="small"
                label={v}
                color="primary"
                sx={{ height: 20, fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flex: 1, lineHeight: 1.3, textAlign: 'right' }}
              >
                {d.right}
              </Typography>
            </Box>
            <Box
              sx={{
                display: { xs: 'none', sm: 'grid' },
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                columnGap: 1,
                mb: -0.5,
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>
                {d.left}
              </Typography>
              <Chip
                size="small"
                label={v}
                color="primary"
                sx={{ height: 20, fontSize: '0.72rem', fontWeight: 700, justifySelf: 'center' }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
                {d.right}
              </Typography>
            </Box>
            <Slider
              value={Number(v)}
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
  const current = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
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
        <Box
          key={c.value}
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: { xs: 0.5, sm: 2 },
          }}
        >
          <Typography variant="body2" sx={{ flex: { sm: 1 }, minWidth: 0 }}>
            {c.text}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              width: { xs: '100%', sm: 'auto' },
              flex: { sm: 2 },
              minWidth: 0,
            }}
          >
            <Slider
              value={Number(current[c.value]) || 0}
              min={0}
              max={budget}
              step={1}
              disabled={readOnly}
              onChange={(_, val) => setPoints(c.value, val)}
              sx={{ flex: 1, maxWidth: { xs: 'none', sm: 260 } }}
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
  autoPersistDefaults = true,
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
        autoPersistDefaults={autoPersistDefaults}
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
