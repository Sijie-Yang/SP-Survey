import React from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Box, Chip, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { conditionVariants, normalizeConditions } from '../../lib/surveyRuntimeContext';

/** Under a result question title: each condition's wording, reverse coding, and how many responses saw it. */
export default function ConditionWordingSummary({
  question,
  surveyConfig,
  responses
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const variants = conditionVariants(question);
  if (!variants.length) return null;
  const conditions = normalizeConditions(surveyConfig);
  const ids = [...conditions.map(c => c.id), ...variants.map(v => v.condition).filter(id => !conditions.some(c => c.id === id))];
  const counts = {};
  (responses || []).forEach(r => {
    const c = r?.survey_metadata?.condition;
    if (c && r?.responses?.[question.name] != null) counts[c] = (counts[c] || 0) + 1;
  });
  return <Box sx={{
    mt: 0.5,
    mb: 0.75,
    display: 'flex',
    flexDirection: 'column',
    gap: 0.25
  }}>
      {ids.map(id => {
      const v = variants.find(x => x.condition === id);
      const label = conditions.find(c => c.id === id)?.label || id;
      return <Box key={id} sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap'
      }}>
            <Chip label={label} size="small" color="primary" variant="outlined" sx={{
          fontSize: '0.7rem',
          height: 20
        }} />
            <Typography variant="caption">{v?.title?.trim() || question.title || question.name}</Typography>
            {v?.reverseCoded && <Chip label={uiPair(language, 'Reverse-coded', '反向计分')} size="small" color="warning" variant="outlined" sx={{
          fontSize: '0.7rem',
          height: 20
        }} />}
            <Typography variant="caption" color="text.secondary">· {zh ? `${counts[id] || 0} 份` : `${counts[id] || 0} responses`}</Typography>
          </Box>;
    })}
    </Box>;
}