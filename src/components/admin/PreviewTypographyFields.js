import React, { useState } from 'react';
import { Box, Button, IconButton, InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import RestartAlt from '@mui/icons-material/RestartAlt';
import { copyTypography, FONT_FAMILIES, QUESTION_TYPOGRAPHY_FIELDS, resetTypography, setTypographyField, TYPOGRAPHY_FIELDS, typographySlot } from '../../lib/viewportTypography';

export default function PreviewTypographyFields({ config, viewport, questionName, labels, onChange, onStart, onEnd, onSelectSurvey }) {
  const { own, inherited, resolved } = typographySlot(config, viewport, questionName);
  const fields = questionName ? QUESTION_TYPOGRAPHY_FIELDS : Object.keys(TYPOGRAPHY_FIELDS);
  const device = viewport === 'mobile' ? labels.mobileOnly : labels.desktopOnly;
  const act = (makeNext) => { onEnd(false); onChange(makeNext(config, viewport, questionName)); };
  return <Box sx={{ my: 2 }}>
    <Typography component="div" className="sp-studio-section-title">{labels.typography}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>{device} · {questionName ? labels.perQuestion : labels.allQuestions}</Typography>
    {questionName && onSelectSurvey && <Button size="small" fullWidth sx={{ mb: 2 }} onClick={onSelectSurvey}>{labels.editSurveyTitleStyle}</Button>}
    <TextField select fullWidth size="small" label={labels.fontFamily} value={own.fontFamily || ''} sx={{ mb: 2 }}
      onChange={(event) => act((c, v, q) => setTypographyField(c, v, q, 'fontFamily', event.target.value || null))}
      helperText={own.fontFamily ? labels.custom : inherited.fontFamily ? `${labels.inheritedSurvey} · ${labels.fontNames[inherited.fontFamily]}` : labels.inheritedTheme}>
      <MenuItem value="">{labels.restoreInheritance}</MenuItem>
      {Object.keys(FONT_FAMILIES).map((font) => <MenuItem key={font} value={font} sx={{ fontFamily: FONT_FAMILIES[font] }}>{labels.fontNames[font]}</MenuItem>)}
    </TextField>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>{labels.selectionHint}</Typography>
    <Stack spacing={1.5}>
      {fields.map((field) => <TypographyField key={`${viewport}-${questionName || 'survey'}-${field}`} field={field}
        value={resolved[field]} custom={own[field] != null} source={inherited[field] != null ? labels.inheritedSurvey : labels.inheritedTheme}
        labels={labels} onStart={onStart} onEnd={onEnd}
        onChange={(value) => onChange(setTypographyField(config, viewport, questionName, field, value))}
        onReset={() => act((c, v, q) => setTypographyField(c, v, q, field, null))} />)}
    </Stack>
    <Button fullWidth size="small" sx={{ mt: 1 }} disabled={!Object.keys(own).length} onClick={() => act(resetTypography)}>{labels.resetTypography}</Button>
    <Button fullWidth size="small" onClick={() => act(copyTypography)}>{viewport === 'mobile' ? labels.copyTypographyDesktop : labels.copyTypographyMobile}</Button>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{labels.copyTypographyHint}</Typography>
  </Box>;
}

function TypographyField({ field, value, custom, source, labels, onStart, onEnd, onChange, onReset }) {
  const [draft, setDraft] = useState(null);
  const limits = TYPOGRAPHY_FIELDS[field];
  return <TextField fullWidth size="small" type="number" label={labels[field]}
    value={draft ?? value ?? ''} placeholder={labels.themeDefault}
    onFocus={() => { setDraft(value == null ? '' : String(value)); onStart(); }}
    onBlur={() => {
      if (draft !== null) onChange(draft === '' ? null : Number(draft));
      setDraft(null);
      onEnd(false);
    }}
    onChange={(event) => {
      const raw = event.target.value;
      setDraft(raw);
      // Keep intermediate typing (e.g. the first "2" of "24") intact.
      if (raw === '') onChange(null);
      else if (Number(raw) >= limits.min && Number(raw) <= limits.max) onChange(Number(raw));
    }}
    helperText={custom ? labels.custom : source}
    inputProps={{ ...limits, 'aria-label': labels[field] }}
    InputProps={{ endAdornment: <InputAdornment position="end">
      <Typography variant="caption">{field === 'lineHeight' ? '×' : 'px'}</Typography>
      <Tooltip title={labels.restoreInheritance}><span><IconButton size="small" disabled={!custom} aria-label={`${labels.restoreInheritance}: ${labels[field]}`}
        onClick={() => { setDraft(null); onReset(); }}><RestartAlt fontSize="small" /></IconButton></span></Tooltip>
    </InputAdornment> }} />;
}
