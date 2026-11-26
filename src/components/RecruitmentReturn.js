import React, { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { resolveSurveyJsLocale } from '../lib/surveyLocale';
import { PLATFORM_PRESETS } from '../lib/recruitment';

export const RECRUITMENT_REDIRECT_SECONDS = 3;

const TEXT = {
  en: {
    complete: 'Thank you! Your answers are saved.',
    already_done: 'You have already completed this survey.',
    quota_full: 'This survey has reached its number of participants.',
    returning: (platform, n) => `Returning you to ${platform} in ${n} s…`,
    returnNow: (platform) => `Return to ${platform} now`,
    code: 'Completion code:',
    codeHint: 'If the page does not move on, copy this code into the platform.',
    noReturn: 'You can close this page.',
  },
  zh: {
    complete: '感谢参与！回答已保存。',
    already_done: '你已经完成过这份问卷。',
    quota_full: '这份问卷的名额已满。',
    returning: (platform, n) => `${n} 秒后自动返回 ${platform}…`,
    returnNow: (platform) => `立即返回 ${platform}`,
    code: '完成码：',
    codeHint: '如果页面没有跳转，请把这个完成码复制到平台上。',
    noReturn: '可以关闭本页了。',
  },
};

/**
 * End page for a participant who came from a recruitment platform: the answers are already saved
 * (or there is nothing to save); this only sends them back, with the code as a fallback.
 */
export default function RecruitmentReturn({ outcome, returnUrl = '', code = '', platform, locale, message = '', redirect = (url) => window.location.assign(url) }) {
  const t = resolveSurveyJsLocale(locale) === 'zh-cn' ? TEXT.zh : TEXT.en;
  const name = platform === 'other' ? (t === TEXT.zh ? '招募平台' : 'the recruitment platform') : (PLATFORM_PRESETS[platform]?.label || '');
  // Already-completed participants are not moved on automatically; they choose to go back.
  const auto = Boolean(returnUrl) && outcome !== 'already_done';
  const [left, setLeft] = useState(RECRUITMENT_REDIRECT_SECONDS);

  useEffect(() => {
    if (!auto) return undefined;
    if (left <= 0) { redirect(returnUrl); return undefined; }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [auto, left, returnUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }} data-testid="recruitment-return">
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t[outcome] || t.complete}</Typography>
      {message && outcome === 'complete' && <Typography variant="body1" sx={{ mb: 2 }}>{message}</Typography>}
      {auto && <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>{t.returning(name, Math.max(left, 0))}</Typography>}
      {returnUrl && (
        <Button variant="contained" href={returnUrl} sx={{ mb: 2 }}>{t.returnNow(name)}</Button>
      )}
      {code && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, letterSpacing: 1 }}>
            {t.code} <strong data-testid="recruitment-code">{code}</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">{t.codeHint}</Typography>
        </Box>
      )}
      {!returnUrl && !code && <Typography variant="body2" color="text.secondary">{t.noReturn}</Typography>}
    </Box>
  );
}
