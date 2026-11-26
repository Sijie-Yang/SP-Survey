import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box } from '@mui/material';
import { recordMediaWatch, watchGateSettings } from '../lib/mediaWatch';
import { resolveSurveyUiLanguage } from '../lib/surveyLocale';
import { isChineseLanguage, uiPair } from '../lib/uiLanguages';
const MAX_SEEK_GAP = 1.5;
function gateMessage(zh, {
  requireEnded,
  remaining
}) {
  if (requireEnded && remaining > 0) {
    return zh ? `请完整观看/收听媒体，并至少停留 ${remaining} 秒后再作答。` : `Please play the media to the end and wait ${remaining} s before answering.`;
  }
  if (requireEnded) return uiPair(zh ? "zh" : "en", 'Please play the media to the end before answering.', '请完整观看/收听媒体后再作答。');
  return zh ? `请先观看 ${remaining} 秒后再作答。` : `Please watch for ${remaining} s before answering.`;
}

/**
 * Keeps answer controls disabled until every video/audio has ended and/or a minimum
 * time has passed. Media elements stay interactive. Inactive unless the question opts in.
 */
export default function MediaWatchGate({
  question,
  trialIndex = 0,
  children
}) {
  const settings = watchGateSettings(question);
  const isDisplay = question?.survey?.mode === 'display' || question?.survey?.isDisplayMode;
  if (!settings.active || isDisplay) return children;
  return <ActiveGate question={question} trialIndex={trialIndex} settings={settings}>{children}</ActiveGate>;
}
function ActiveGate({
  question,
  trialIndex,
  settings,
  children
}) {
  const ref = useRef(null);
  const startedAt = useRef(Date.now());
  const media = useRef(new Map());
  const [elapsed, setElapsed] = useState(0);
  const [mediaDone, setMediaDone] = useState(!settings.requireEnded);
  const unlockedAt = useRef(null);
  const zh = isChineseLanguage(resolveSurveyUiLanguage(question?.survey));
  const entryFor = (el) => {
    const key = el.currentSrc || el.src || `media_${media.current.size}`;
    if (!media.current.has(key)) media.current.set(key, {
      url: key,
      watched: 0,
      last: null,
      ended: false,
      duration: null
    });
    return media.current.get(key);
  };
  const evaluate = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll('video, audio')];
    els.forEach(entryFor);
    const done = !settings.requireEnded || [...media.current.values()].every((m) => m.ended);
    setMediaDone(done);
  }, [settings.requireEnded]);
  const persist = useCallback(() => {
    recordMediaWatch(question.name, trialIndex, {
      media: [...media.current.values()].map((m) => ({
        url: m.url,
        watched_seconds: Math.round(m.watched * 10) / 10,
        ended: m.ended,
        duration: m.duration
      })),
      unlocked_after_seconds: unlockedAt.current
    });
  }, [question.name, trialIndex]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const onTime = (e) => {
      const el = e.target;
      if (!(el instanceof HTMLMediaElement)) return;
      const m = entryFor(el);
      const t = el.currentTime;
      if (m.last != null && !el.paused && t > m.last && t - m.last < MAX_SEEK_GAP) m.watched += t - m.last;
      m.last = t;
      if (Number.isFinite(el.duration)) m.duration = Math.round(el.duration * 10) / 10;
    };
    const onSeek = (e) => {
      if (e.target instanceof HTMLMediaElement) entryFor(e.target).last = e.target.currentTime;
    };
    const onEnded = (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return;
      entryFor(e.target).ended = true;
      evaluate();
      persist();
    };
    root.addEventListener('timeupdate', onTime, true);
    root.addEventListener('seeked', onSeek, true);
    root.addEventListener('ended', onEnded, true);
    const observer = new MutationObserver(evaluate);
    observer.observe(root, {
      childList: true,
      subtree: true
    });
    evaluate();
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => {
      root.removeEventListener('timeupdate', onTime, true);
      root.removeEventListener('seeked', onSeek, true);
      root.removeEventListener('ended', onEnded, true);
      observer.disconnect();
      window.clearInterval(timer);
      persist();
    };
  }, [evaluate, persist]); // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = Math.max(0, Math.ceil(settings.minSeconds - elapsed));
  const locked = !mediaDone || remaining > 0;
  if (!locked && unlockedAt.current == null) unlockedAt.current = Math.round(elapsed * 10) / 10;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const s = question.survey;
    if (!s?.onCurrentPageChanging) return undefined;
    const block = (_sender, options) => {
      if (options?.isPrevPage || s.currentPage !== question.page || question.isVisible === false) return;
      if (!lockedRef.current) return;
      options.allow = false;
      try {
        question.addError?.(uiPair(zh ? "zh" : "en", 'Please finish watching first.', '请先完成观看/收听。'));
      } catch {/* ignore */}
    };
    s.onCurrentPageChanging.add(block);
    return () => s.onCurrentPageChanging.remove(block);
  }, [question, zh]);
  return <Box data-watch-locked={locked ? 'true' : 'false'}>
      {locked && <Alert severity="info" sx={{
      mb: 1,
      py: 0.5
    }} role="status">
          {gateMessage(zh, {
        requireEnded: !mediaDone,
        remaining
      })}
        </Alert>}
      <Box ref={ref} aria-disabled={locked || undefined} onKeyDownCapture={locked ? (e) => {
      if (e.target instanceof HTMLMediaElement) return;
      if (e.key !== 'Tab') {
        e.preventDefault();
        e.stopPropagation();
      }
    } : undefined} sx={locked ? {
      pointerEvents: 'none',
      '& video, & audio': {
        pointerEvents: 'auto'
      },
      '& input, & button, & [role="radio"], & [role="slider"]': {
        opacity: 0.55
      }
    } : undefined}>
        {children}
      </Box>
    </Box>;
}