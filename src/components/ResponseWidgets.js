import React, { useEffect, useRef, useState } from 'react';
import { isChineseLanguage, uiPair } from '../lib/uiLanguages';
import { Box, Typography, Slider, TextField, Chip, Button } from '@mui/material';
import { allocationChoiceMax, clampAllocationPoints } from '../lib/allocationStats';
import { dimensionDisplayName, dimensionIncomplete, dimensionPoles, sliderScale } from '../lib/sliderScale';
import { ImageGalleryGrid } from './MediaWidgets';
import { useTrialAdvanceHold } from './trialAdvanceHold';

/**
 * Slider group (semantic differential): multiple bipolar dimensions rated
 * on a shared numeric scale. value = { [dimensionId]: number }
 * UI shows the scale midpoint until touched; values persist only after interaction
 * (unless autoPersistDefaults is explicitly enabled for legacy callers).
 */
export function SliderGroupContent({
  dimensions = [],
  scaleMin = 1,
  scaleMax = 7,
  scaleStep = 1,
  language = 'en',
  value,
  onChange,
  readOnly,
  /** When true, silently persist midpoints (legacy). Default false restores required semantics. */
  autoPersistDefaults = false
}) {
  const zh = isChineseLanguage(language);
  const hold = useTrialAdvanceHold();
  const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const currentRef = useRef(current);
  currentRef.current = current;
  const [active, setActive] = useState(null);
  const activeRef = useRef(null);
  useEffect(() => {
    if (!autoPersistDefaults || readOnly || !onChange || !dimensions.length) return;
    let changed = false;
    const next = {
      ...current
    };
    dimensions.forEach(d => {
      if (!d?.id) return;
      if (next[d.id] === undefined || next[d.id] === null || next[d.id] === '') {
        next[d.id] = sliderScale(d, {
          scaleMin,
          scaleMax,
          scaleStep
        }).midpoint;
        changed = true;
      }
    });
    if (changed) onChange(next);
    // Only re-run when scale / dimension set changes — not on every value tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions, scaleMin, scaleMax, scaleStep, readOnly, autoPersistDefaults]);
  if (!dimensions.length) {
    return <Typography variant="body2" color="text.secondary">
        No dimensions configured. Add rating dimensions in the question editor.
      </Typography>;
  }
  return <Box sx={{
    display: 'flex',
    flexDirection: 'column',
    gap: 1.5
  }}>
      {dimensions.map((d, index) => {
      const scale = sliderScale(d, {
        scaleMin,
        scaleMax,
        scaleStep
      });
      const answered = typeof current[d.id] === 'number' && Number.isFinite(current[d.id]);
      const dragging = active?.id === d.id;
      const v = dragging ? active.value : (answered ? current[d.id] : scale.midpoint);
      const label = (answered || dragging) ? v : uiPair(language, 'Not rated', '尚未评分');
      const title = dimensionDisplayName(d, index, {
        locale: zh ? 'zh' : 'en'
      });
      const incomplete = dimensionIncomplete(d);
      const poles = dimensionPoles(d);
      return <Box key={d.id} sx={{
        px: {
          xs: 0,
          sm: 1
        }
      }}>
            <Typography variant="subtitle2" sx={{
          mb: 0.5,
          lineHeight: 1.35,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word'
        }}>
              {title}
            </Typography>
            {incomplete ? <Typography variant="caption" color="warning.main" sx={{
          display: 'block',
          mb: 0.5
        }}>
                {uiPair(language, 'Dimension setup is incomplete: add a display name and both pole labels.', '维度配置不完整：请补全显示名称和两端说明。')}
              </Typography> : null}
            {/* Phones: labels above slider so long bipolar text does not crush mid-row */}
            <Box sx={{
          display: {
            xs: 'flex',
            sm: 'none'
          },
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 1,
          mb: 0.5
        }}>
              <Typography variant="caption" color="text.secondary" sx={{
            flex: 1,
            lineHeight: 1.3,
            overflowWrap: 'anywhere'
          }}>
                {poles.left}
              </Typography>
              <Chip size="small" label={label} color={answered ? "primary" : "default"} sx={{
            height: 20,
            fontSize: '0.72rem',
            fontWeight: 700,
            flexShrink: 0
          }} />
              <Typography variant="caption" color="text.secondary" sx={{
            flex: 1,
            lineHeight: 1.3,
            textAlign: 'right',
            overflowWrap: 'anywhere'
          }}>
                {poles.right}
              </Typography>
            </Box>
            <Box sx={{
          display: {
            xs: 'none',
            sm: 'grid'
          },
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          columnGap: 1,
          mb: -0.5
        }}>
              <Typography variant="body2" color="text.secondary" sx={{
            textAlign: 'left'
          }}>
                {poles.left}
              </Typography>
              <Chip size="small" label={label} color={answered ? "primary" : "default"} sx={{
            height: 20,
            fontSize: '0.72rem',
            fontWeight: 700,
            justifySelf: 'center'
          }} />
              <Typography variant="body2" color="text.secondary" sx={{
            textAlign: 'right'
          }}>
                {poles.right}
              </Typography>
            </Box>
            <Box
              onPointerDown={() => { if (!readOnly && scale.valid) hold?.hold(); }}
              onPointerUp={() => { if (!readOnly && scale.valid) hold?.release(); }}
              onPointerCancel={() => { if (!readOnly && scale.valid) hold?.release(); }}
              onKeyDown={() => { if (!readOnly && scale.valid) hold?.hold(); }}
              onKeyUp={() => { if (!readOnly && scale.valid) hold?.release(); }}
            >
            <Slider value={Number(v)} min={scale.min} max={scale.max} step={scale.step} marks={scale.valid && (scale.max - scale.min) / scale.step <= 20} disabled={readOnly || !scale.valid} aria-label={`${title}: ${poles.left || d.id} – ${poles.right || d.id}`} onChange={(_, val) => {
          activeRef.current = { id: d.id, value: val };
          setActive({ id: d.id, value: val });
        }} onChangeCommitted={(_, val) => {
          const latest = activeRef.current?.id === d.id ? activeRef.current.value : val;
          activeRef.current = null;
          setActive((prev) => (prev?.id === d.id ? null : prev));
          onChange?.({ ...currentRef.current, [d.id]: latest });
        }} valueLabelDisplay="auto" />
            </Box>
            <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mt: -1
        }}>
              <Typography variant="caption" color="text.disabled">{scale.min}</Typography>
              <Typography variant="caption" color="text.disabled">{scale.max}</Typography>
            </Box>
            {!answered && !dragging && !readOnly && <Button size="small" sx={{
          minHeight: 44
        }} disabled={!scale.valid} onClick={() => {
          activeRef.current = null;
          setActive(null);
          onChange?.({ ...currentRef.current, [d.id]: scale.midpoint });
        }}>
              {zh ? `选择 ${scale.midpoint}` : `Select ${scale.midpoint}`}
            </Button>}
          </Box>;
    })}
    </Box>;
}

/**
 * Point allocation: distribute a fixed budget across options.
 * value = { [choiceValue]: number }
 */
export function PointAllocationContent({
  choices = [],
  budget = 100,
  value,
  onChange,
  readOnly
}) {
  const hold = useTrialAdvanceHold();
  const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const currentRef = useRef(current);
  currentRef.current = current;
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const [typing, setTyping] = useState(null);
  const typingDirty = useRef(false);
  const normalized = choices.map(c => typeof c === 'object' ? c : {
    value: c,
    text: c
  });
  const storedPoints = (key) => {
    const n = Number(current[key]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const draftPoints = (key) => {
    if (drag?.key === key) return Math.max(0, Number(drag.value) || 0);
    if (typing?.key === key) {
      if (String(typing.text).trim() === '') return 0;
      return clampAllocationPoints(typing.text, Number.POSITIVE_INFINITY);
    }
    return storedPoints(key);
  };
  const maxFor = (key) => {
    const others = normalized.reduce((sum, c) => (
      c.value === key ? sum : sum + draftPoints(c.value)
    ), 0);
    const mine = storedPoints(key);
    return allocationChoiceMax(mine, budget - others - mine);
  };
  const allocated = normalized.reduce((sum, c) => sum + draftPoints(c.value), 0);
  const remaining = budget - allocated;
  if (!normalized.length) {
    return <Typography variant="body2" color="text.secondary">
        No options configured. Add choices in the question editor.
      </Typography>;
  }
  const commitPoints = (choiceValue, raw, allowNewZero = false) => {
    const n = clampAllocationPoints(raw, maxFor(choiceValue));
    const prev = currentRef.current;
    const had = Object.prototype.hasOwnProperty.call(prev, choiceValue);
    if (had && Number(prev[choiceValue]) === n) return;
    if (!had && n === 0 && !allowNewZero) return;
    onChange?.({
      ...prev,
      [choiceValue]: n
    });
  };
  return <Box sx={{
    display: 'flex',
    flexDirection: 'column',
    gap: 1.5
  }}>
      {normalized.map(c => {
      const cap = maxFor(c.value);
      const shown = drag?.key === c.value ? drag.value : storedPoints(c.value);
      const stuck = cap <= 0;
      const fieldText = typing?.key === c.value ? typing.text : String(storedPoints(c.value));
      return <Box key={c.value} sx={{
      display: 'flex',
      flexDirection: {
        xs: 'column',
        sm: 'row'
      },
      alignItems: {
        xs: 'stretch',
        sm: 'center'
      },
      gap: {
        xs: 0.5,
        sm: 2
      }
    }}>
          <Typography variant="body2" sx={{
        flex: {
          sm: 1
        },
        minWidth: 0
      }}>
            {c.text}
          </Typography>
          <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: {
          xs: '100%',
          sm: 'auto'
        },
        flex: {
          sm: 2
        },
        minWidth: 0
      }}>
            <Box
              onPointerDown={() => { if (!readOnly && !stuck) hold?.hold(); }}
              onPointerUp={() => { if (!readOnly && !stuck) hold?.release(); }}
              onPointerCancel={() => { if (!readOnly && !stuck) hold?.release(); }}
              onKeyDown={() => { if (!readOnly && !stuck) hold?.hold(); }}
              onKeyUp={() => { if (!readOnly && !stuck) hold?.release(); }}
              sx={{ flex: 1, maxWidth: { xs: 'none', sm: 260 } }}
            >
            <Slider value={stuck ? 0 : shown} min={0} max={stuck ? 1 : cap} step={1} disabled={readOnly || stuck} aria-label={c.text} onChange={(_, val) => {
          dragRef.current = { key: c.value, value: val };
          setDrag({ key: c.value, value: val });
        }} onChangeCommitted={(_, val) => {
          const latest = dragRef.current?.key === c.value ? dragRef.current.value : val;
          dragRef.current = null;
          setDrag(null);
          commitPoints(c.value, latest, false);
        }} sx={{
          flex: 1
        }} />
            </Box>
            <TextField type="number" size="small" value={fieldText} disabled={readOnly || stuck} onFocus={() => {
          if (readOnly) return;
          typingDirty.current = false;
          hold?.hold();
          setTyping({ key: c.value, text: String(storedPoints(c.value)) });
        }} onChange={e => {
          typingDirty.current = true;
          const digits = String(e.target.value).replace(/[^\d]/g, '');
          const nextText = digits === '' ? '' : String(clampAllocationPoints(digits, maxFor(c.value)));
          setTyping({ key: c.value, text: nextText });
        }} onBlur={() => {
          const text = typing?.key === c.value ? typing.text : '';
          const dirty = typingDirty.current;
          typingDirty.current = false;
          setTyping(null);
          if (dirty && String(text).trim() !== '') commitPoints(c.value, text, true);
          hold?.release();
        }} onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }} inputProps={{
          'aria-label': `${c.text} points`,
          min: 0,
          max: cap,
          step: 1,
          style: {
            width: 56,
            textAlign: 'center'
          }
        }} />
          </Box>
        </Box>;
    })}
      <Box sx={{
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 1
    }}>
        <Typography variant="body2" color="text.secondary">Remaining:</Typography>
        <Chip size="small" label={`${remaining} / ${budget}`} color={remaining === 0 ? 'success' : remaining < 0 ? 'error' : 'warning'} sx={{
        fontWeight: 700
      }} />
      </Box>
      {remaining < 0 && <Typography variant="caption" color="error">
          You have allocated more than {budget} points — please reduce some values.
        </Typography>}
    </Box>;
}

/** Image + semantic differential sliders (imageslidergroup). */
export function ImageSliderGroupContent({
  imageUrls = [],
  dimensions = [],
  scaleMin = 1,
  scaleMax = 7,
  scaleStep = 1,
  language = 'en',
  value,
  onChange,
  readOnly,
  autoPersistDefaults = false
}) {
  const items = (imageUrls || []).filter(Boolean).map((url, i) => ({
    url,
    name: url.split('/').pop() || `Image ${i + 1}`,
    type: 'image'
  }));
  return <Box>
      {items.length > 0 && <Box sx={{
      mb: 2
    }}>
          <ImageGalleryGrid items={items} />
        </Box>}
      <SliderGroupContent dimensions={dimensions} scaleMin={scaleMin} scaleMax={scaleMax} scaleStep={scaleStep} language={language} value={value} onChange={onChange} readOnly={readOnly} autoPersistDefaults={autoPersistDefaults} />
    </Box>;
}

/** Image + point budget allocation (imagepointallocation). */
export function ImagePointAllocationContent({
  imageUrls = [],
  choices = [],
  budget = 100,
  value,
  onChange,
  readOnly
}) {
  const items = (imageUrls || []).filter(Boolean).map((url, i) => ({
    url,
    name: url.split('/').pop() || `Image ${i + 1}`,
    type: 'image'
  }));
  return <Box>
      {items.length > 0 && <Box sx={{
      mb: 2
    }}>
          <ImageGalleryGrid items={items} />
        </Box>}
      <PointAllocationContent choices={choices} budget={budget} value={value} onChange={onChange} readOnly={readOnly} />
    </Box>;
}