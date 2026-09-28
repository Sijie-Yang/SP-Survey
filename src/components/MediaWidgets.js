import { canChooseTie, isNoPreference, noPreferenceLabel, NO_PREFERENCE } from '../lib/choiceTie';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import { Visibility, TimerOutlined } from '@mui/icons-material';
import { SurveyJsBooleanControl } from './ImageBooleanWidget';
import { SurveyJsCheckboxControl } from './ImageCheckboxWidget';
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

export function MediaPlayer({ url, type, name, onReady, onError }) {
  if (!url) return <Typography color="text.secondary">No media selected</Typography>;
  if (type === 'video') {
    return (
      <video
        key={url}
        src={url}
        controls
        onCanPlay={onReady}
        onError={onError}
        preload={onReady ? 'auto' : 'metadata'}
        playsInline
        style={{ display: 'block', width: '100%', maxHeight: 480, borderRadius: 8, background: '#111' }}
      />
    );
  }
  if (type === 'audio') {
    return (
      <audio key={url} src={url} onCanPlay={onReady} onError={onError} preload={onReady ? 'auto' : 'metadata'} controls style={{ display: 'block', width: '100%' }} />
    );
  }
  return (
    <img
      key={url}
      src={url}
      alt={name || 'media'}
      onLoad={onReady}
      onError={onError}
      style={{ display: 'block', width: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 8 }}
    />
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
    return <MediaSequentialSlots key={list.map((s) => s.url).join('|')} slots={list} />;
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
export function MediaTimedExposure({ url, type, name, exposureSeconds = 5, language = 'en' }) {
  const zh = language === 'zh';
  const seconds = Number.isFinite(Number(exposureSeconds)) && Number(exposureSeconds) > 0 ? Number(exposureSeconds) : 5;
  const [phase, setPhase] = useState('idle');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [remaining, setRemaining] = useState(seconds);
  const deadline = useRef(0);
  useEffect(() => { setPhase('idle'); setReady(false); setFailed(false); setRemaining(seconds); }, [url, seconds]);
  useEffect(() => {
    if (phase !== 'showing') return undefined;
    const tick = () => {
      const left = Math.max(0, (deadline.current - performance.now()) / 1000);
      setRemaining(Math.ceil(left));
      if (left <= 0) setPhase('done');
    };
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [phase]);
  return <Box sx={{ whiteSpace: 'normal' }}>
    {phase !== 'done' && <Box sx={{ display: phase === 'showing' ? 'block' : 'none', position: 'relative' }}>
      <MediaPlayer key={`${url}_${attempt}`} url={url} type={type} name={name}
        onReady={() => setReady(true)} onError={() => { setFailed(true); setReady(false); setPhase('idle'); }} />
      {phase === 'showing' && <Chip icon={<TimerOutlined />} label={`${remaining}s`} sx={{ position: 'absolute', top: 8, right: 8 }} />}
    </Box>}
    {phase === 'idle' && <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
      <Typography sx={{ mb: 1 }}>{zh ? `准备好后点击开始，媒体将展示 ${seconds} 秒。结束后不会再次显示。` : `Start when ready. The media will be shown for ${seconds} seconds and then hidden.`}</Typography>
      <Typography role="status" variant="body2" sx={{ mb: 1 }}>{failed ? (zh ? '媒体加载失败，请重试。' : 'Media failed to load. Please retry.') : !ready ? (zh ? '正在加载媒体，尚未开始计时…' : 'Loading media. The timer has not started…') : (zh ? '媒体已就绪。' : 'Media ready.')}</Typography>
      {failed ? <Button sx={{ minHeight: 44 }} onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>{zh ? '重试加载' : 'Retry loading'}</Button>
        : <Button fullWidth variant="contained" startIcon={<Visibility />} disabled={!ready} sx={{ minHeight: 44 }} onClick={() => {
          deadline.current = performance.now() + seconds * 1000; setRemaining(seconds); setPhase('showing');
        }}>{zh ? '准备好了，开始展示' : "I'm ready — show it"}</Button>}
    </Box>}
    {phase === 'done' && <Typography role="status" sx={{ p: 2 }}>{zh ? '展示结束，请根据刚才的印象作答。' : 'Viewing time is over — please answer based on your impression.'}</Typography>}
  </Box>;
}

export function MediaDisplayContent({
  mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation,
  displayMode = 'single', exposureSeconds = 5, language = 'en', beforeLabel = 'Before', afterLabel = 'After',
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
          language={language}
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
  minRateDescription = '', maxRateDescription = '', disabled = false,
}) {
  return (
    <Box sx={{ width: '100%' }}>
      {renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation })}
      <SurveyJsRatingControl
        disabled={disabled}
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
  value, onChange, labelTrue = 'Yes', labelFalse = 'No', name = 'mediaboolean', disabled = false,
}) {
  return (
    <Box sx={{ width: '100%' }}>
      {renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation })}
      <SurveyJsBooleanControl
        name={name}
        labelTrue={labelTrue}
        labelFalse={labelFalse}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
    </Box>
  );
}

/** Stimulus media + text multi-select (which labels apply to this scene). */
export function MediaCheckboxContent({
  mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation,
  choices = [], value, onChange, name = 'mediacheckbox', disabled = false,
}) {
  return (
    <Box sx={{ width: '100%' }}>
      {renderStimulus({ mediaUrl, mediaType, mediaName, mediaItems, mediaSlots, mediaPresentation })}
      <SurveyJsCheckboxControl
        name={name}
        choices={choices}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </Box>
  );
}

/** Choice among media items (video/audio/image). */
export function MediaPickerContent({
  mediaItems, mediaSlots, choices, value, onChange, multiSelect = false, disabled = false, language = 'en', allowTie = false, tieLabel = '',
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

  const zh = language === 'zh';
  const toggle = (v) => {
    if (disabled) return;
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
    <Box sx={{ display: 'grid', whiteSpace: 'normal', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 1.5 }}>
      {choiceList.map((c, i) => {
        const url = c.imageLink || items[i]?.url;
        const type = items[i]?.type || inferTypeFromUrl(url);
        const name = c.imageName || items[i]?.name || c.value;
        const v = c.value;
        const isOn = multiSelect ? selected.includes(v) : selected === v;
        return (
          <Box
            key={v || i}
            onClick={type === 'image' ? () => toggle(v) : undefined}
            sx={{
              minWidth: 0,
              overflowWrap: 'anywhere',
              border: '2px solid',
              borderColor: isOn ? 'primary.main' : 'divider',
              borderRadius: 2,
              p: 1.5,
              cursor: disabled || type !== 'image' ? 'default' : 'pointer',
              bgcolor: isOn ? 'action.selected' : 'background.paper',
            }}
          >
            <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
              {name}
            </Typography>
            <MediaPlayer url={url} type={type} name={name} />
            <Button fullWidth variant={isOn ? 'contained' : 'outlined'} aria-pressed={isOn} disabled={disabled}
              aria-label={`${isOn ? (zh ? '已选择' : 'Selected') : (zh ? '选择' : 'Select')} · ${name}`}
              sx={{ mt: 1, minHeight: 44, whiteSpace: 'normal', overflowWrap: 'anywhere' }} onClick={(event) => { event.stopPropagation(); toggle(v); }}>
              {isOn ? (zh ? '已选择' : 'Selected') : (zh ? '选择' : 'Select')}
            </Button>
          </Box>
        );
      })}
      {canChooseTie({ allowTie, multiSelect }, choiceList.length) && <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center' }}>
        <Button variant={isNoPreference(value) ? 'contained' : 'outlined'} aria-pressed={isNoPreference(value)} disabled={disabled}
          sx={{ minHeight: 44, maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' }}
          onClick={() => onChange(NO_PREFERENCE)}>{noPreferenceLabel({ tieLabel }, language)}</Button>
      </Box>}
    </Box>
  );
}

function inferTypeFromUrl(url) {
  const n = String(url || '').toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(n)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)(\?|$)/.test(n)) return 'audio';
  return 'image';
}
