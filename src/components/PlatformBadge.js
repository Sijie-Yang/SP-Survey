import React from 'react';
import { Box, Link } from '@mui/material';
import { resolveSurveyJsLocale } from '../lib/surveyLocale';

export const PLATFORM_BADGE_URL = 'https://sp-survey.org/?ref=survey';

/** True when the participant page should carry the small "Made with SP-Survey" link. */
export function showPlatformBadge(surveyJson) {
  if (!surveyJson) return false;
  if (surveyJson.hidePlatformBadge === true) return false;
  if (surveyJson.spSite?.html) return false;
  return true;
}

/** Small footer link on participant pages; researchers can turn it off in display settings. */
export default function PlatformBadge({ surveyJson, locale, sx }) {
  if (!showPlatformBadge(surveyJson)) return null;
  const zh = resolveSurveyJsLocale(locale) === 'zh-cn';
  return (
    <Box component="footer" sx={{ textAlign: 'center', py: 2, ...sx }}>
      <Link href={PLATFORM_BADGE_URL} target="_blank" rel="noopener" underline="hover"
        variant="caption" color="text.secondary" data-testid="platform-badge">
        {zh ? '用 SP-Survey 制作' : 'Made with SP-Survey'}
      </Link>
    </Box>
  );
}
