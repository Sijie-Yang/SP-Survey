import { useEffect, useState } from 'react';
import {
  DEFAULT_REVIEW_SETTINGS,
  REVIEW_SETTINGS_EVENT,
  cacheReviewSettings,
  normalizeReviewSettings,
  readCachedReviewSettings,
} from '../lib/reviewMode';
import { isPlatformMode } from './surveyAssistantUtils';

/** Per-user Review defaults; follows saves made in Assistant settings. */
export default function useReviewSettings(userId) {
  const [settings, setSettings] = useState(() => readCachedReviewSettings(userId) || { ...DEFAULT_REVIEW_SETTINGS });

  useEffect(() => {
    setSettings(readCachedReviewSettings(userId) || { ...DEFAULT_REVIEW_SETTINGS });
    const onChange = (event) => {
      if (event?.detail?.userId && userId && event.detail.userId !== userId) return;
      setSettings(normalizeReviewSettings(event?.detail?.settings));
    };
    window.addEventListener(REVIEW_SETTINGS_EVENT, onChange);
    let cancelled = false;
    if (isPlatformMode() && userId && !readCachedReviewSettings(userId)) {
      import('../lib/agentApi')
        .then(({ getCredentialStatus }) => getCredentialStatus())
        .then((status) => {
          if (!cancelled && status?.settings) cacheReviewSettings(userId, status.settings.review_settings);
        })
        .catch(() => null);
    }
    return () => {
      cancelled = true;
      window.removeEventListener(REVIEW_SETTINGS_EVENT, onChange);
    };
  }, [userId]);

  return settings;
}
