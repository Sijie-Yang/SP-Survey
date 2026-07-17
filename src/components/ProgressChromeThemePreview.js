import React, { useState } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { buildProgressChromeCssVars } from '../lib/surveyStorage';

/**
 * Static mock of ProgressChrome for Theme Customization preview.
 * Shows page / question / trial labels + multi-trial segment fill using theme colors.
 */
export default function ProgressChromeThemePreview({ theme = null, showProgress = true }) {
  const [viewing, setViewing] = useState(1); // index into SAMPLE_QUESTIONS

  if (!showProgress) {
    return (
      <Box
        sx={{
          px: 2,
          py: 1,
          mb: 2,
          border: '1px dashed',
          borderColor: theme?.borderColor || 'divider',
          borderRadius: 1,
          bgcolor: theme?.headerBackground || theme?.backgroundColor || 'grey.50',
        }}
      >
        <Typography variant="caption" sx={{ color: theme?.secondaryText || 'text.secondary' }}>
          Progress bar is off — turn on “Show Progress Bar” in Display Settings to show
          page / question / trial progress for participants.
        </Typography>
      </Box>
    );
  }

  const q = SAMPLE_QUESTIONS[viewing] || SAMPLE_QUESTIONS[0];
  const cssVars = buildProgressChromeCssVars(theme);

  return (
    <Box
      className="sp-progress-chrome sp-progress-chrome--theme-preview"
      style={cssVars}
      sx={{
        mb: 2,
        px: 2,
        py: 1.25,
        border: '1px solid',
        borderColor: 'var(--sp-progress-border)',
        borderRadius: 1,
        bgcolor: 'var(--sp-progress-bg)',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mb: 0.75,
          fontWeight: 600,
          lineHeight: 1.4,
          color: 'var(--sp-progress-label)',
        }}
      >
        Page {q.page} / 2
        <Box component="span" sx={{ mx: 0.75, fontWeight: 400, opacity: 0.55 }}>·</Box>
        Question {viewing + 1} / {SAMPLE_QUESTIONS.length}
        {q.trialCount > 1 && (
          <>
            <Box component="span" sx={{ mx: 0.75, fontWeight: 400, opacity: 0.55 }}>·</Box>
            Trial {q.trialIndex + 1} / {q.trialCount}
          </>
        )}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
        {SAMPLE_QUESTIONS.map((item, i) => {
          const complete = item.answered >= item.trialCount;
          const multi = item.trialCount > 1;
          const fillPct = Math.round((item.answered / item.trialCount) * 100);
          const isViewing = i === viewing;
          const reached = i <= 2; // mock: first 3 reachable
          return (
            <Tooltip
              key={item.name}
              title={
                multi
                  ? `Q${i + 1} · ${item.answered}/${item.trialCount} trials`
                  : `Question ${i + 1}`
              }
            >
              <Box
                component="button"
                type="button"
                disabled={!reached}
                onClick={() => reached && setViewing(i)}
                sx={{
                  position: 'relative',
                  height: { xs: 22, sm: 16 },
                  minWidth: multi ? { xs: 28, sm: 28 } : { xs: 22, sm: 16 },
                  width: multi
                    ? { xs: Math.min(48, 22 + item.trialCount * 2), sm: Math.min(56, 16 + item.trialCount * 2) }
                    : { xs: 22, sm: 16 },
                  borderRadius: multi ? 1 : '50%',
                  border: '2px solid',
                  borderColor: complete
                    ? 'var(--sp-progress-success)'
                    : (isViewing ? 'var(--sp-progress-primary)' : 'var(--sp-progress-muted)'),
                  bgcolor: 'transparent',
                  overflow: 'hidden',
                  p: 0,
                  cursor: reached ? 'pointer' : 'not-allowed',
                  opacity: reached ? 1 : 0.35,
                  boxShadow: isViewing
                    ? {
                      xs: '0 0 0 1px var(--sp-progress-surface), 0 0 0 2px var(--sp-progress-primary)',
                      sm: '0 0 0 2px var(--sp-progress-surface), 0 0 0 4px var(--sp-progress-primary)',
                    }
                    : 'none',
                  flexShrink: 0,
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: `${complete ? 100 : fillPct}%`,
                    bgcolor: complete
                      ? 'var(--sp-progress-success-light)'
                      : 'var(--sp-progress-primary-light)',
                    opacity: 0.85,
                  }}
                />
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      <Box
        sx={{
          mt: 1,
          height: 4,
          borderRadius: 2,
          bgcolor: 'var(--sp-progress-track)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: '55%',
            bgcolor: 'var(--sp-progress-primary)',
          }}
        />
      </Box>

    </Box>
  );
}

const SAMPLE_QUESTIONS = [
  { name: 'q1', page: 1, trialCount: 1, trialIndex: 0, answered: 1 },
  { name: 'q2', page: 1, trialCount: 8, trialIndex: 2, answered: 3 },
  { name: 'q3', page: 2, trialCount: 1, trialIndex: 0, answered: 0 },
  { name: 'q4', page: 2, trialCount: 5, trialIndex: 0, answered: 0 },
];
