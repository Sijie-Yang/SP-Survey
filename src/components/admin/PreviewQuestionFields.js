import React from 'react';
import { Box, Button, FormControlLabel, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Close from '@mui/icons-material/Close';

/** Common answer settings; advanced task settings stay in the main question editor. */
export default function PreviewQuestionFields({ question, labels, onChange, onStart, onEnd }) {
  if (['expression', 'html', 'image', 'mediadisplay'].includes(question.type)) return null;
  const choices = question.choices || [];
  const editChoice = (index, text) => onChange('choices', choices.map((choice, i) => i !== index ? choice : { ...(typeof choice === 'object' ? choice : { value: choice }), text }));
  return <Stack spacing={1}>
    <FormControlLabel control={<Switch size="small" checked={!!question.isRequired} onChange={(_e, value) => onChange('isRequired', value)} />} label={<Typography variant="body2">{labels.required}</Typography>} />
    {['radiogroup', 'checkbox', 'dropdown', 'ranking'].includes(question.type) && <Box>
      <Typography variant="caption" fontWeight={600}>{labels.options}</Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        {choices.map((choice, index) => <Stack direction="row" key={typeof choice === 'object' ? choice.value : String(choice)} alignItems="center" spacing={0.5}>
          <TextField size="small" fullWidth label={`${labels.option} ${index + 1}`} value={typeof choice === 'object' ? (typeof choice.text === 'string' ? choice.text : choice.value ?? '') : choice} onFocus={onStart} onBlur={onEnd} onChange={(e) => editChoice(index, e.target.value)} />
          <IconButton size="small" disabled={choices.length <= 1} aria-label={`${labels.removeOption} ${index + 1}`} onClick={() => onChange('choices', choices.filter((_, i) => i !== index))}><Close fontSize="small" /></IconButton>
        </Stack>)}
      </Stack>
      <Button size="small" startIcon={<Add />} onClick={() => {
        const values = new Set(choices.map((choice) => String(typeof choice === 'object' ? choice.value : choice)));
        let i = 1;
        while (values.has(`option_${i}`)) i += 1;
        onChange('choices', [...choices, { value: `option_${i}`, text: `${labels.option} ${i}` }]);
      }}>{labels.addOption}</Button>
    </Box>}
  </Stack>;
}
