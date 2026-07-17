import React, { useEffect, useMemo, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import { Box, Typography, Paper } from '@mui/material';
import { applyAdminThemeToSurveyModel, buildSurveyHostStyle } from '../lib/surveyStorage';
import ProgressChromeThemePreview from './ProgressChromeThemePreview';

const THEME_PREVIEW_SURVEY = {
  title: '',
  showQuestionNumbers: 'on',
  showProgressBar: 'off',
  showNavigationButtons: true,
  showCompletedPage: false,
  pages: [
    {
      name: 'p1',
      elements: [
        {
          type: 'rating',
          name: 'theme_preview_rating',
          title: 'How would you rate this experience?',
          description: 'Live SurveyJS controls — same widgets participants see.',
          isRequired: false,
          rateType: 'labels',
          rateMin: 1,
          rateMax: 5,
          minRateDescription: 'Low',
          maxRateDescription: 'High',
          defaultValue: 4,
        },
      ],
    },
    {
      name: 'p2',
      elements: [
        {
          type: 'boolean',
          name: 'theme_preview_bool',
          title: 'Would you participate again?',
          labelTrue: 'Yes',
          labelFalse: 'No',
        },
      ],
    },
  ],
};

/**
 * Theme preview using a real SurveyJS model + ProgressChrome mock.
 * Avoids fake MUI / hand-drawn controls that do not exist in the live survey.
 */
export default function SurveyThemePreviewPanel({
  theme = null,
  showProgress = true,
}) {
  const themeKey = useMemo(() => {
    try {
      return JSON.stringify(theme || {});
    } catch {
      return '';
    }
  }, [theme]);

  const [model, setModel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      try {
        const m = new Model(JSON.parse(JSON.stringify(THEME_PREVIEW_SURVEY)));
        m.showPreviewBeforeComplete = false;
        m.showCompletedPage = false;
        applyAdminThemeToSurveyModel(m, { theme: theme || {} });
        // Keep nav visible so Previous / Next are the real SurveyJS buttons
        m.showNavigationButtons = true;
        if (!cancelled) setModel(m);
      } catch (err) {
        console.warn('Theme preview SurveyJS model failed:', err);
        if (!cancelled) setModel(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [themeKey, theme]);

  const bg = theme?.backgroundColor || '#ffffff';
  const border = theme?.borderColor || '#e0e0e0';
  const secondaryText = theme?.secondaryText || '#757575';

  return (
    <Paper
      className="sp-survey-theme-host"
      style={buildSurveyHostStyle(theme)}
      sx={{
        p: 0,
        overflow: 'hidden',
        border: 1,
        borderColor: border,
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5 }}>
        <ProgressChromeThemePreview theme={theme} showProgress={showProgress} />
      </Box>

      <Box
        sx={{
          px: 1,
          pb: 1,
          '& .sd-root-modern': {
            ['--sjs-font-size']: '14px',
          },
          '& .sd-body': {
            padding: '8px 12px 12px !important',
          },
          '& .sd-title': {
            display: 'none',
          },
        }}
      >
        {model ? (
          <Survey model={model} />
        ) : (
          <Typography variant="caption" sx={{ color: secondaryText, px: 1.5, py: 2, display: 'block' }}>
            Loading SurveyJS preview…
          </Typography>
        )}
      </Box>

      <Box sx={{ px: 2, py: 1.25, borderTop: `1px solid ${border}`, bgcolor: bg }}>
        <Typography sx={{ color: secondaryText, fontSize: '0.72rem', lineHeight: 1.45 }}>
          Real SurveyJS rating / boolean / Previous·Next above. Progress chrome is the same
          component family as live surveys. Secondary / Accent rarely appear as solid nav buttons.
        </Typography>
      </Box>
    </Paper>
  );
}
