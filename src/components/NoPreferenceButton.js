import React, { useEffect, useReducer } from 'react';
import { Box, Button } from '@mui/material';
import { canChooseTie, isNoPreference, NO_PREFERENCE } from '../lib/choiceTie';
import { resolveSurveyUiLanguage } from '../lib/surveyLocale';
import { uiPair } from '../lib/uiLanguages';

/** Subscribe to the model so single-round selections and restored answers repaint too. */
export default function NoPreferenceButton({ question, count }) {
  const [, repaint] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const changed = (_, event) => { if (event.name === question.name) repaint(); };
    question.survey?.onValueChanged?.add(changed);
    return () => question.survey?.onValueChanged?.remove(changed);
  }, [question]);
  const lang = resolveSurveyUiLanguage(question.survey);
  const custom = String(question?.tieLabel || '').trim();
  const label = custom || uiPair(lang, 'About the same', '两者差不多');
  useEffect(() => { if (question.allowTie && question.noneItem) question.noneText = label; }, [question, label]);
  if (!canChooseTie(question, count)) return null;
  return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
    <Button variant={isNoPreference(question.value) ? 'contained' : 'outlined'}
      aria-pressed={isNoPreference(question.value)} disabled={!!question.isReadOnly}
      sx={{ minHeight: 44, maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' }}
      onClick={() => { question.value = NO_PREFERENCE; repaint(); }}>
      {label}
    </Button>
  </Box>;
}
