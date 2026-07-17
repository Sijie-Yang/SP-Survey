import React from 'react';
import { Box, Typography } from '@mui/material';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

/**
 * SurveyJS defaultV2 boolean switch (Yes/No), same look as single-trial panel conversion.
 * Class names must match native boolean — older sd-boolean__switch-item* classes do not exist in defaultV2.
 */
export function SurveyJsBooleanControl({
  labelTrue = 'Yes',
  labelFalse = 'No',
  value,
  onChange,
  disabled = false,
  name = 'boolean',
}) {
  const isTrue = value === true;
  const isFalse = value === false;
  const indeterminate = !isTrue && !isFalse;
  // Native SurveyJS hides the selected side label (transparent) and shows it inside the thumb.
  const thumbLabel = isTrue ? labelTrue : (isFalse ? labelFalse : null);

  const itemClass = [
    'sd-boolean',
    !disabled ? 'sd-boolean--allowhover' : '',
    indeterminate ? 'sd-boolean--indeterminate' : '',
    isTrue ? 'sd-boolean--checked' : '',
    disabled ? 'sd-boolean--disabled' : '',
  ].filter(Boolean).join(' ');

  const labelFalseClass = [
    'sd-boolean__label',
    isFalse ? 'sd-boolean__label--false' : '',
    isTrue ? 'sd-checkbox__label--disabled sd-boolean__label--false' : '',
  ].filter(Boolean).join(' ');

  const labelTrueClass = [
    'sd-boolean__label',
    isTrue ? 'sd-boolean__label--true' : '',
    isFalse ? 'sd-checkbox__label--disabled sd-boolean__label--true' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="sv_qcbc sv_qbln sd-scrollable-container sd-boolean-root sp-surveyjs-boolean">
      <label className={itemClass}>
        <input
          type="checkbox"
          name={name}
          className="sd-boolean__control sd-visuallyhidden"
          disabled={disabled}
          checked={isTrue}
          onChange={() => {
            if (disabled) return;
            if (indeterminate || isFalse) onChange?.(true);
            else onChange?.(false);
          }}
        />
        <div
          className="sd-boolean__thumb-ghost"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) onChange?.(false);
          }}
          role="presentation"
        >
          <span className={labelFalseClass}>{labelFalse}</span>
        </div>
        <div
          className="sd-boolean__switch"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (disabled) return;
            if (indeterminate || isFalse) onChange?.(true);
            else onChange?.(false);
          }}
          role="presentation"
        >
          <span className="sd-boolean__thumb">
            {thumbLabel ? (
              <span className="sd-boolean__thumb-text">{thumbLabel}</span>
            ) : null}
          </span>
        </div>
        <div
          className="sd-boolean__thumb-ghost"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) onChange?.(true);
          }}
          role="presentation"
        >
          <span className={labelTrueClass}>{labelTrue}</span>
        </div>
      </label>
    </div>
  );
}

/** Same `.sp-image-gallery` path as imageHtml / mediaboolean (imagePickerLayout). */
function ImageStimulus({ question, trialStimulusMedia = null }) {
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  if (!trialStimulusMedia?.length && question?.imageHtml) {
    return (
      <Box
        className="sp-imageboolean-html"
        sx={{ mb: 2 }}
        dangerouslySetInnerHTML={{ __html: question.imageHtml }}
      />
    );
  }

  if (!images.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>No images available for this yes/no trial yet.</Typography>
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

export default function ImageBooleanWidget({ question, value, onValueChanged, trialStimulusMedia = null }) {
  const hasHtml = !trialStimulusMedia?.length && Boolean(question?.imageHtml);
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);

  return (
    <Box sx={{ width: '100%' }}>
      {(hasHtml || images.length > 0) && (
        <ImageStimulus question={question} trialStimulusMedia={trialStimulusMedia} />
      )}
      {!hasHtml && !images.length && (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', mb: 1 }}>
          <Typography>No images available for this yes/no trial yet.</Typography>
        </Box>
      )}
      <SurveyJsBooleanControl
        name={question?.name || 'imageboolean'}
        labelTrue={question?.labelTrue || 'Yes'}
        labelFalse={question?.labelFalse || 'No'}
        value={value}
        onChange={onValueChanged}
      />
    </Box>
  );
}
