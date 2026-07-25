import React, { useEffect, useState } from 'react';
import { Box, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

function choiceValue(c) {
  if (c == null) return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  // SurveyJS ItemValue exposes .value / .text; plain JSON uses text/label.
  if (typeof c.getType === 'function' || typeof c.locText !== 'undefined') {
    return String(c.value ?? c.text ?? '');
  }
  return String(c.value ?? c.text ?? c.label ?? '');
}

function choiceLabel(c) {
  if (c == null) return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (typeof c.getType === 'function' || typeof c.locText !== 'undefined') {
    return String(c.text ?? c.value ?? '');
  }
  return String(c.text ?? c.label ?? c.value ?? '');
}

function normalizeSelected(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

/** Multi-select text tags under a stimulus (always multi-select). */
export function SurveyJsCheckboxControl({
  choices = [],
  value,
  onChange,
  disabled = false,
  name = 'checkbox',
}) {
  // Local state so checks update even when SurveyJS skips React re-renders for array values.
  const [selected, setSelected] = useState(() => normalizeSelected(value));
  const valueKey = normalizeSelected(value).join('\0');

  useEffect(() => {
    setSelected(normalizeSelected(value));
  }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (val) => {
    if (disabled) return;
    const next = selected.includes(val)
      ? selected.filter((v) => v !== val)
      : [...selected, val];
    setSelected(next);
    onChange?.(next);
  };

  const list = Array.isArray(choices) ? [...choices] : [];
  if (!list.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No text tags configured. Add choices in the question editor.
      </Typography>
    );
  }

  return (
    <FormGroup aria-label={name}>
      {list.map((c, idx) => {
        const val = choiceValue(c);
        if (!val) return null;
        const label = choiceLabel(c);
        const checked = selected.includes(val);
        return (
          <FormControlLabel
            key={`${name}_${idx}_${val}`}
            control={(
              <Checkbox
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(val)}
                size="small"
              />
            )}
            label={label}
            sx={{ alignItems: 'center', ml: 0 }}
          />
        );
      })}
    </FormGroup>
  );
}

function ImageStimulus({ question, trialStimulusMedia = null }) {
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  if (!trialStimulusMedia?.length && question?.imageHtml) {
    return (
      <Box
        className="sp-imagecheckbox-html"
        sx={{ mb: 2 }}
        dangerouslySetInnerHTML={{ __html: question.imageHtml }}
      />
    );
  }

  if (!images.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', mb: 1 }}>
        <Typography>No images available for this multi-select trial yet.</Typography>
      </Box>
    );
  }

  return (
    <Box className="sp-image-gallery" sx={{ mb: 2 }}>
      {images.map((item, index) => (
        <Box
          key={`${item.imageLink}_${item.value || index}`}
          className="sp-image-gallery__item"
        >
          <Box className="sp-image-gallery__image-container">
            <Box component="img" src={item.imageLink} alt={`Image ${index + 1}`} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function readChoices(question, choicesProp) {
  if (Array.isArray(choicesProp) && choicesProp.length) return choicesProp;
  const raw = question?.choices;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw.length === 'number') return Array.from(raw);
  return [];
}

export default function ImageCheckboxWidget({
  question,
  value,
  onValueChanged,
  trialStimulusMedia = null,
  choices: choicesProp,
}) {
  const choices = readChoices(question, choicesProp);

  return (
    <Box sx={{ width: '100%' }}>
      <ImageStimulus question={question} trialStimulusMedia={trialStimulusMedia} />
      <SurveyJsCheckboxControl
        name={question?.name || 'imagecheckbox'}
        choices={choices}
        value={value}
        onChange={onValueChanged}
        disabled={!!question?.isReadOnly}
      />
    </Box>
  );
}
