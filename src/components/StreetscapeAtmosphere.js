import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export const HERO_VIDEO_SRC = '/hero/streetscape-loop.mp4';
export const HERO_POSTER_SRC = '/hero/streetscape-poster.jpg';

function armMutedInline(video) {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.playsInline = true;
  video.controls = false;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.removeAttribute('controls');
}

/**
 * Full-bleed streetscape atmosphere: muted looping video + Ken Burns poster fallback.
 *
 * Safari cold-load lessons:
 * - Never call video.load() from play retries (resets the element and blocks first paint).
 * - Do not put CSS transform animations on the <video> itself.
 * - Keep the video laid out under a poster; fade the poster only after `playing`.
 */
export default function StreetscapeAtmosphere({
  overlay,
  showKenBurns = true,
  zIndex = 0,
}) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return undefined;

    armMutedInline(video);

    let cancelled = false;

    const markPlaying = () => {
      if (cancelled || !video || video.paused) return;
      setPlaying(true);
    };

    const tryPlay = () => {
      if (cancelled || !video) return;
      armMutedInline(video);
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(markPlaying).catch(() => {
          // Muted autoplay can still fail (Low Power Mode). Poster stays up.
        });
      }
    };

    tryPlay();
    video.addEventListener('loadedmetadata', tryPlay);
    video.addEventListener('loadeddata', tryPlay);
    video.addEventListener('canplay', tryPlay);
    video.addEventListener('playing', markPlaying);

    // If Safari pauses after a successful start, re-cover with poster and retry once in a while.
    const onPause = () => {
      if (cancelled || !video) return;
      if (!video.paused) return;
      setPlaying(false);
      // Avoid hammering play() in a tight pause/play loop.
      setTimeout(() => {
        if (!cancelled && video.paused) tryPlay();
      }, 250);
    };
    video.addEventListener('pause', onPause);

    const onVis = () => {
      if (document.visibilityState === 'visible') tryPlay();
    };
    const unlock = () => tryPlay();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', unlock);
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    // Sparse retries for cold load without resetting the media element.
    const timers = [100, 300, 800, 1600, 3000].map((ms) => setTimeout(tryPlay, ms));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      video.removeEventListener('loadedmetadata', tryPlay);
      video.removeEventListener('loadeddata', tryPlay);
      video.removeEventListener('canplay', tryPlay);
      video.removeEventListener('playing', markPlaying);
      video.removeEventListener('pause', onPause);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', unlock);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [failed]);

  const mediaStyle = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        bgcolor: '#0b1210',
        zIndex,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          background: overlay || [
            'linear-gradient(180deg, rgba(8,14,12,0.55) 0%, rgba(8,14,12,0.35) 42%, rgba(8,14,12,0.72) 100%)',
            'radial-gradient(120% 80% at 50% 20%, rgba(20,40,32,0.15) 0%, rgba(8,14,12,0.55) 70%)',
          ].join(', '),
          pointerEvents: 'none',
        },
      }}
    >
      {!failed && (
        <video
          ref={(node) => {
            videoRef.current = node;
            // Arm muted/playsinline as early as the node exists (before layout effect).
            armMutedInline(node);
          }}
          className="sp-hero-atmosphere-video"
          src={HERO_VIDEO_SRC}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          controls={false}
          controlsList="nodownload nofullscreen noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          onError={() => setFailed(true)}
          style={{
            ...mediaStyle,
            zIndex: 0,
            pointerEvents: 'none',
            // No CSS transform on the video — Safari is unreliable with animated <video>.
          }}
        />
      )}
      <img
        src={HERO_POSTER_SRC}
        alt=""
        className={showKenBurns ? 'sp-landing-hero-video' : undefined}
        style={{
          ...mediaStyle,
          zIndex: 1,
          opacity: playing && !failed ? 0 : 1,
          transition: 'opacity 0.7s ease',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
