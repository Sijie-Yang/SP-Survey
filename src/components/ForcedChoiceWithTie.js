import React, { useEffect, useReducer } from 'react';
import { Box, Typography } from '@mui/material';
import { MediaPickerContent } from './MediaWidgets';
import { isNoPreference, NO_PREFERENCE } from '../lib/choiceTie';

/** Native rendering of the built-in A/B task when its optional tie response is enabled. */
export default function ForcedChoiceWithTie({ question, images, config, readOnly, language }) {
  const [, repaint] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const changed = (_, e) => { if (e.name === question.name) repaint(); };
    question.survey?.onValueChanged?.add(changed);
    return () => question.survey?.onValueChanged?.remove(changed);
  }, [question]);
  const value = question.value;
  const items = images.map((m, i) => ({ ...m, name: (i === 0 ? config.leftLabel : config.rightLabel) || (i === 0 ? 'A' : 'B') }));
  return <Box>
    {config.prompt && <Typography sx={{ mb: 1 }}>{config.prompt}</Typography>}
    <MediaPickerContent mediaItems={items} allowTie tieLabel={question.tieLabel} language={language} disabled={readOnly}
      value={isNoPreference(value) ? NO_PREFERENCE : value?.choice === 'A' ? 'media_0' : value?.choice === 'B' ? 'media_1' : null}
      onChange={(selected) => {
        const tie = selected === NO_PREFERENCE;
        const index = tie ? -1 : selected === 'media_0' ? 0 : 1;
        const answer = { choice: tie ? 'tie' : index === 0 ? 'A' : 'B', chosenIndex: index,
          imageA: images[0].url, imageB: images[1].url, ...(tie ? {} : { chosenUrl: images[index].url }) };
        question.value = answer;
        question.skillAnswerSnapshot = answer;
        repaint();
      }} />
  </Box>;
}
