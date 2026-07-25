import React, { useContext } from 'react';
import { Box, Paper, Typography, Stack, Chip } from '@mui/material';
import { summarizeSkillAnswer } from '../lib/skillAnswerSummary';
import { RegionContext } from '../contexts/RegionContext';
import { adminI18n } from '../contexts/adminI18n';
import { checkAnswerAgainstResultSchema } from '../lib/skillResultTypes';

/** Read-only review of a skill answer (preview-before-complete / results). */
export default function SkillAnswerReview({
  value,
  title,
  dense = false,
  showEmpty = true,
  locale: localeProp,
  resultSchema = [],
}) {
  const region = useContext(RegionContext);
  const language = localeProp || region?.language || 'en';
  const t = region?.t || adminI18n[language] || adminI18n.en;
  const empty = value == null || value === '';
  if (empty && !showEmpty) return null;
  const lines = summarizeSkillAnswer(value, language);
  const heading = title || t.skillAnswerSubmittedTitle;
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  const contractCheck = checkAnswerAgainstResultSchema(normalized, resultSchema);
  const mismatches = contractCheck.fields.filter((field) => !field.ok);
  const mediaUrls = (resultSchema || []).flatMap((field) => {
    if (!['mediaChoice', 'mediaRankedList'].includes(field?.type)) return [];
    const fieldValue = normalized[field.key];
    return (Array.isArray(fieldValue) ? fieldValue : [fieldValue])
      .map((item) => (typeof item === 'string' ? item : item?.imageUrl || item?.videoUrl || item?.url))
      .filter(Boolean);
  });

  return (
    <Paper
      variant="outlined"
      sx={{
        p: dense ? 1.25 : 2,
        bgcolor: 'grey.50',
        borderRadius: 2,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {heading}
        </Typography>
        {!empty && (
          <Chip
            size="small"
            label={t.skillAnswerRecorded}
            color="success"
            variant="outlined"
            sx={{ height: 22 }}
          />
        )}
      </Stack>
      {empty ? (
        <Typography variant="body2" color="text.secondary">{t.skillAnswerEmpty}</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
          {lines.map((line, i) => (
            <Typography
              key={`${i}-${line}`}
              component="li"
              variant="body2"
              sx={{ mb: 0.35, color: 'text.primary' }}
            >
              {line}
            </Typography>
          ))}
        </Box>
      )}
      {mismatches.length > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
          contract_mismatch: {mismatches.map((field) => field.label || field.key).join(', ')}
        </Typography>
      )}
      {mediaUrls.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {mediaUrls.map((url, index) => (
            <Box
              key={`${url}-${index}`}
              component="img"
              src={url}
              alt={String(url).split('?')[0].split('/').pop() || `media ${index + 1}`}
              sx={{ width: 72, height: 54, objectFit: 'contain', borderRadius: 1, bgcolor: 'common.white' }}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}
