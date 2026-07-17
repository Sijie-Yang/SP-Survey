import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import { Visibility, TimerOutlined } from '@mui/icons-material';
import { SurveyJsBooleanControl } from './ImageBooleanWidget';
import { SurveyJsRatingControl } from './ImageRatingWidget';

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

/** Render resolved media slots (stack or sequential). */
export function MediaSlotLayout({
  slots = [],
  presentation = 'stack',
  items = null,
}) {
  const list = (slots?.length ? slots : (items || [])).filter((s) => s?.url);
  if (!list.length) return null;

  if (presentation === 'sequential') {
    return <MediaSequentialSlots slots={list} />;
  }

  const choiceSlots = list.filter((s) => (s.role || 'stimulus') === 'choice');
  if (choiceSlots.length >= 2 && choiceSlots.length === list.filter((s) => s.role === 'choice').length) {
    // Compare-style: choice slots side by side; companions below
    const companions = list.filter((s) => s.role !== 'choice');
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {choiceSlots.map((s, i) => (
            <Box key={s.slotId || s.url || i} sx={{ flex: '1 1 0', minWidth: { xs: '100%', sm: 160 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                {s.name || s.slotId || `Option ${i + 1}`}
              </Typography>
              <MediaPlayer url={s.url} type={s.type} name={s.name} />
            </Box>
          ))}
        </Box>
        {companions.length > 0 && <MediaGallery items={companions} />}
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <MediaGallery items={list} />
    </Box>
  );
}

function MediaSequentialSlots({ slots }) {
  const [idx, setIdx] = useState(0);
  const current = slots[idx];
  const done = idx >= slots.length;
  if (done) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        All media shown — please answer below.
      </Typography>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {idx + 1} / {slots.length}
        {current.slotId ? ` · ${current.slotId}` : ''}
        {current.name ? ` · ${current.name}` : ''}
      </Typography>
      <MediaPlayer url={current.url} type={current.type} name={current.name} />
      <Button
        sx={{ mt: 1.5, minHeight: { xs: 44, sm: 32 } }}
        variant="outlined"
        size="medium"
        fullWidth
        onClick={() => setIdx((i) => i + 1)}
      >
        {idx + 1 < slots.length ? 'Next media' : 'Done viewing'}
      </Button>
    </Box>
  );
}

function renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation }) {
  const slots = Array.isArray(mediaSlots) ? mediaSlots.filter((s) => s?.url) : [];
  if (slots.length) {
    return <MediaSlotLayout slots={slots} presentation={mediaPresentation || 'stack'} />;
  }
  const items = mediaItems?.length ? mediaItems : (mediaUrl ? [{ url: mediaUrl, type: mediaType, name: mediaName }] : []);
  return <MediaSlotLayout items={items} presentation="stack" />;
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
        <Box key={item.url || i} sx={{ flex: '1 1 0', minWidth: { xs: '100%', sm: 200 } }}>
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
        minHeight: { xs: 200, sm: 260 },
        height: { xs: 'auto', sm: 260 },
        borderRadius: 2,
        border: '1px dashed',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: 1.5,
        bgcolor: 'grey.50',
        px: 2,
        py: 2,
      }}>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          You will see the media for {exposureSeconds} second{exposureSeconds === 1 ? '' : 's'}. Watch carefully — it will not be shown again.
        </Typography>
        <Button
          variant="contained"
          fullWidth
          startIcon={<Visibility />}
          sx={{ minHeight: { xs: 44, sm: 36 } }}
          onClick={() => { setRemaining(exposureSeconds); setPhase('showing'); }}
        >
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
  mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation,
  displayMode = 'single', exposureSeconds = 5, beforeLabel = 'Before', afterLabel = 'After',
}) {
  const items = mediaItems?.length ? mediaItems : (mediaUrl ? [{ url: mediaUrl, type: mediaType, name: mediaName }] : []);
  if (mediaSlots?.length) {
    return renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation });
  }

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

export function MediaRatingContent({
  mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation,
  value, onChange, rateMin = 1, rateMax = 5,
  minRateDescription = '', maxRateDescription = '',
}) {
  return (
    <Box sx={{ width: '100%' }}>
      {renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation })}
      <SurveyJsRatingControl
        rateMin={rateMin}
        rateMax={rateMax}
        minRateDescription={minRateDescription}
        maxRateDescription={maxRateDescription}
        value={value}
        onChange={onChange}
      />
    </Box>
  );
}

export function MediaBooleanContent({
  mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation,
  value, onChange, labelTrue = 'Yes', labelFalse = 'No', name = 'mediaboolean',
}) {
  return (
    <Box sx={{ width: '100%' }}>
      {renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation })}
      <SurveyJsBooleanControl
        name={name}
        labelTrue={labelTrue}
        labelFalse={labelFalse}
        value={value}
        onChange={onChange}
      />
    </Box>
  );
}

/** Choice among media items (video/audio/image). */
export function MediaPickerContent({
  mediaItems, mediaSlots, choices, value, onChange, multiSelect = false,
}) {
  const items = (mediaItems?.length ? mediaItems : (mediaSlots || []).filter((s) => s.role === 'choice' || !s.role))
    .filter((m) => m?.url);
  const choiceList = (choices?.length ? choices : items.map((m, i) => ({
    value: `media_${i}`,
    imageLink: m.url,
    imageName: m.name,
  })));

  const selected = multiSelect
    ? (Array.isArray(value) ? value : [])
    : value;

  const toggle = (v) => {
    if (!multiSelect) {
      onChange(v);
      return;
    }
    const set = new Set(Array.isArray(selected) ? selected : []);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange([...set]);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {choiceList.map((c, i) => {
        const url = c.imageLink || items[i]?.url;
        const type = items[i]?.type || inferTypeFromUrl(url);
        const name = c.imageName || items[i]?.name || c.value;
        const v = c.value;
        const isOn = multiSelect ? selected.includes(v) : selected === v;
        return (
          <Box
            key={v || i}
            onClick={() => toggle(v)}
            sx={{
              border: '2px solid',
              borderColor: isOn ? 'primary.main' : 'divider',
              borderRadius: 2,
              p: 1.5,
              cursor: 'pointer',
              bgcolor: isOn ? 'action.selected' : 'background.paper',
            }}
          >
            <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
              {name}
            </Typography>
            <MediaPlayer url={url} type={type} name={name} />
          </Box>
        );
      })}
    </Box>
  );
}

function inferTypeFromUrl(url) {
  const n = String(url || '').toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(n)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)(\?|$)/.test(n)) return 'audio';
  return 'image';
}
