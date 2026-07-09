import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Typography, Rating, FormControlLabel, Radio, RadioGroup, Button, Chip } from '@mui/material';
import { Visibility, TimerOutlined } from '@mui/icons-material';

function isImageMedia(type) {
  return !type || type === 'image' || type === 'any';
}

/** Justified image grid — same layout engine as Image Choice (imagePickerLayout.js). */
export function ImageGalleryGrid({ items = [], vertical = false }) {
  const imageItems = (items || []).filter((item) => item?.url && isImageMedia(item.type));
  if (!imageItems.length) return null;
  const className = vertical
    ? 'sp-image-gallery sp-image-gallery--vertical'
    : 'sp-image-gallery';
  return (
    <Box className={className} sx={{ width: '100%' }}>
      {imageItems.map((item, i) => (
        <Box key={item.url || item.name || i} className="sp-image-gallery__item">
          <Box className="sp-image-gallery__image-container">
            <Box
              component="img"
              src={item.url}
              alt={item.name || `Image ${i + 1}`}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function MediaPlayer({ url, type, name }) {
  if (!url) return <Typography color="text.secondary">No media selected</Typography>;
  if (type === 'video') {
    return (
      <video src={url} controls style={{ width: '100%', maxHeight: 400, borderRadius: 8 }} />
    );
  }
  if (type === 'audio') {
    return <audio src={url} controls style={{ width: '100%' }} />;
  }
  return (
    <img src={url} alt={name || 'media'} style={{ width: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 8 }} />
  );
}

export function MediaGallery({ items = [] }) {
  if (!items.length) return null;
  const imageItems = items.filter((item) => item?.url && isImageMedia(item.type));
  const otherItems = items.filter((item) => item?.url && !isImageMedia(item.type));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {imageItems.length > 0 && <ImageGalleryGrid items={imageItems} />}
      {otherItems.map((item, i) => (
        <Box key={item.url || item.name || i}>
          {item.name && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              {item.name}
            </Typography>
          )}
          <MediaPlayer url={item.url} type={item.type} name={item.name} />
        </Box>
      ))}
    </Box>
  );
}

/** Legacy side-by-side for video/audio; images use ImageGalleryGrid instead. */
export function MediaSideBySide({ items = [] }) {
  if (!items.length) return null;
  const imageItems = items.filter((item) => item?.url && isImageMedia(item.type));
  const otherItems = items.filter((item) => item?.url && !isImageMedia(item.type));
  if (imageItems.length) {
    return <ImageGalleryGrid items={imageItems} />;
  }
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {otherItems.map((item, i) => (
        <Box key={item.url || i} sx={{ flex: '1 1 0', minWidth: 200 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', textAlign: 'center', fontWeight: 600 }}>
            {item.label || item.name || `Option ${String.fromCharCode(65 + i)}`}
          </Typography>
          <MediaPlayer url={item.url} type={item.type} name={item.name} />
        </Box>
      ))}
    </Box>
  );
}

/** Before/after drag-to-reveal comparison of two images. */
export function MediaRevealCompare({ beforeUrl, afterUrl, beforeLabel = 'Before', afterLabel = 'After' }) {
  const boxRef = useRef(null);
  const [pct, setPct] = useState(50);
  const draggingRef = useRef(false);

  const moveTo = useCallback((clientX) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = ((clientX - r.left) / r.width) * 100;
    setPct(Math.max(5, Math.min(95, p)));
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      moveTo(e.touches ? e.touches[0].clientX : e.clientX);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [moveTo]);

  if (!beforeUrl || !afterUrl) {
    return (
      <Typography color="text.secondary" variant="body2">
        Reveal comparison needs two images (before + after). Set media count to 2 or use a paired media set.
      </Typography>
    );
  }

  return (
    <Box
      ref={boxRef}
      onMouseDown={(e) => { draggingRef.current = true; moveTo(e.clientX); }}
      onTouchStart={(e) => { draggingRef.current = true; moveTo(e.touches[0].clientX); }}
      sx={{
        position: 'relative', height: { xs: 240, sm: 340 }, borderRadius: 2, overflow: 'hidden',
        border: '1px solid', borderColor: 'divider', userSelect: 'none', touchAction: 'none', cursor: 'ew-resize',
      }}
    >
      <img src={afterUrl} alt={afterLabel} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
      <Box sx={{ position: 'absolute', inset: 0, width: `${pct}%`, overflow: 'hidden' }}>
        <img
          src={beforeUrl}
          alt={beforeLabel}
          style={{ position: 'absolute', top: 0, left: 0, height: '100%', objectFit: 'cover', width: boxRef.current ? boxRef.current.getBoundingClientRect().width : '100%' }}
          draggable={false}
        />
      </Box>
      <Box sx={{
        position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: 4,
        bgcolor: '#fff', transform: 'translateX(-50%)', boxShadow: '0 0 8px rgba(0,0,0,.4)',
      }}>
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 36, height: 36, borderRadius: '50%', bgcolor: 'primary.main', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>⇔</Box>
      </Box>
      <Chip size="small" label={beforeLabel} sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'rgba(255,255,255,0.9)', fontWeight: 600 }} />
      <Chip size="small" label={afterLabel} sx={{ position: 'absolute', top: 10, right: 10, bgcolor: 'rgba(255,255,255,0.9)', fontWeight: 600 }} />
    </Box>
  );
}

/** Timed exposure: participant starts viewing; media hides permanently after N seconds. */
export function MediaTimedExposure({ url, type, name, exposureSeconds = 5 }) {
  const [phase, setPhase] = useState('idle'); // idle | showing | done
  const [remaining, setRemaining] = useState(exposureSeconds);

  useEffect(() => {
    if (phase !== 'showing') return undefined;
    if (remaining <= 0) {
      setPhase('done');
      return undefined;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining]);

  if (phase === 'idle') {
    return (
      <Box sx={{
        height: 260, borderRadius: 2, border: '1px dashed', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, bgcolor: 'grey.50',
      }}>
        <Typography variant="body2" color="text.secondary">
          You will see the media for {exposureSeconds} second{exposureSeconds === 1 ? '' : 's'}. Watch carefully — it will not be shown again.
        </Typography>
        <Button variant="contained" startIcon={<Visibility />} onClick={() => { setRemaining(exposureSeconds); setPhase('showing'); }}>
          I'm ready — show it
        </Button>
      </Box>
    );
  }
  if (phase === 'showing') {
    return (
      <Box sx={{ position: 'relative' }}>
        <MediaPlayer url={url} type={type} name={name} />
        <Chip
          icon={<TimerOutlined />}
          label={`${remaining}s`}
          color="primary"
          sx={{ position: 'absolute', top: 10, right: 10, fontWeight: 700 }}
        />
      </Box>
    );
  }
  return (
    <Box sx={{
      height: 120, borderRadius: 2, border: '1px dashed', borderColor: 'divider',
      display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100',
    }}>
      <Typography variant="body2" color="text.secondary">
        Viewing time is over — please answer based on your impression.
      </Typography>
    </Box>
  );
}

export function MediaDisplayContent({
  mediaUrl, mediaType, mediaName, mediaItems,
  displayMode = 'single', exposureSeconds = 5, beforeLabel = 'Before', afterLabel = 'After',
}) {
  const items = mediaItems?.length ? mediaItems : (mediaUrl ? [{ url: mediaUrl, type: mediaType, name: mediaName }] : []);

  if (displayMode === 'reveal') {
    return (
      <Box sx={{ mb: 2 }}>
        <MediaRevealCompare
          beforeUrl={items[0]?.url}
          afterUrl={items[1]?.url}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      </Box>
    );
  }
  if (displayMode === 'sideBySide' || displayMode === 'single' || !displayMode) {
    if (items.length > 1) {
      return (
        <Box sx={{ mb: 2 }}>
          <MediaGallery items={items} />
        </Box>
      );
    }
    const one = items[0];
    if (one?.url && isImageMedia(one.type)) {
      return (
        <Box sx={{ mb: 2 }}>
          <ImageGalleryGrid items={[one]} />
        </Box>
      );
    }
    return (
      <Box sx={{ mb: 2 }}>
        <MediaPlayer url={one?.url || mediaUrl} type={one?.type || mediaType} name={one?.name || mediaName} />
      </Box>
    );
  }
  if (displayMode === 'timed') {
    return (
      <Box sx={{ mb: 2 }}>
        <MediaTimedExposure
          url={items[0]?.url}
          type={items[0]?.type || mediaType}
          name={items[0]?.name}
          exposureSeconds={exposureSeconds}
        />
      </Box>
    );
  }
  // fallback (unknown displayMode)
  if (items.length > 1) {
    return (
      <Box sx={{ mb: 2 }}>
        <MediaGallery items={items} />
      </Box>
    );
  }
  const one = items[0];
  if (one?.url && isImageMedia(one.type)) {
    return (
      <Box sx={{ mb: 2 }}>
        <ImageGalleryGrid items={[one]} />
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <MediaPlayer url={one?.url || mediaUrl} type={one?.type || mediaType} name={one?.name || mediaName} />
    </Box>
  );
}

export function MediaRatingContent({ mediaUrl, mediaType, mediaName, mediaItems, value, onChange, rateMin = 1, rateMax = 5 }) {
  const items = mediaItems?.length ? mediaItems : (mediaUrl ? [{ url: mediaUrl, type: mediaType, name: mediaName }] : []);
  const imageItems = items.filter((item) => item?.url && isImageMedia(item.type));
  const one = items[0];
  return (
    <Box>
      {imageItems.length > 0 ? (
        <ImageGalleryGrid items={imageItems} />
      ) : (
        <MediaPlayer url={one?.url || mediaUrl} type={one?.type || mediaType} name={one?.name || mediaName} />
      )}
      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="body2">{rateMin}</Typography>
        <Rating
          value={value || null}
          max={rateMax - rateMin + 1}
          onChange={(_, v) => onChange(v ? v + rateMin - 1 : null)}
        />
        <Typography variant="body2">{rateMax}</Typography>
      </Box>
    </Box>
  );
}

export function MediaBooleanContent({ mediaUrl, mediaType, mediaName, mediaItems, value, onChange, labelTrue = 'Yes', labelFalse = 'No' }) {
  const items = mediaItems?.length ? mediaItems : (mediaUrl ? [{ url: mediaUrl, type: mediaType, name: mediaName }] : []);
  const imageItems = items.filter((item) => item?.url && isImageMedia(item.type));
  const one = items[0];
  return (
    <Box>
      {imageItems.length > 0 ? (
        <ImageGalleryGrid items={imageItems} />
      ) : (
        <MediaPlayer url={one?.url || mediaUrl} type={one?.type || mediaType} name={one?.name || mediaName} />
      )}
      <RadioGroup
        row
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={(e) => onChange(e.target.value === 'yes')}
        sx={{ mt: 2 }}
      >
        <FormControlLabel value="yes" control={<Radio />} label={labelTrue} />
        <FormControlLabel value="no" control={<Radio />} label={labelFalse} />
      </RadioGroup>
    </Box>
  );
}
