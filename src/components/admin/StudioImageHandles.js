import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeMediaLayout, savedMediaLayout, setMediaLayout } from '../../lib/mediaLayout';
import { studioGallery } from './StudioMediaPanel';

/** The overlay lives outside the zoomed survey; geometry uses actual screen pixels. */
export default function StudioImageHandles({ canvasRef, config, viewport, name, enabled, selected, onSelect, onChange, onStart, onEnd, zh }) {
  const [boxes, setBoxes] = useState([]);
  const state = useRef(); state.current = { config, viewport, name, onChange, onEnd };
  const cancel = useRef(null);
  useEffect(() => () => cancel.current?.(), [name, viewport, enabled]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) { setBoxes([]); return undefined; }
    const update = () => {
      const gallery = studioGallery(canvas, name), bounds = canvas.getBoundingClientRect();
      const next = gallery?.dataset.spMediaMode === 'free' ? [...gallery.querySelectorAll('img')].map((img, index) => {
        const r = img.getBoundingClientRect();
        return { index, x: r.left - bounds.left + canvas.scrollLeft, y: r.top - bounds.top + canvas.scrollTop, width: r.width, height: r.height };
      }) : [];
      setBoxes(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    update(); const timer = setInterval(update, 50);
    return () => clearInterval(timer);
  }, [canvasRef, name, enabled]);
  const gesture = (event, index, resizing) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    // Finish a focused numeric/text edit before starting a separate drag entry.
    document.activeElement?.blur?.();
    onSelect(index); onStart();
    const initial = state.current, rule = normalizeMediaLayout(savedMediaLayout(initial.config, viewport, name));
    const gallery = studioGallery(canvasRef.current, name), width = gallery?.getBoundingClientRect().width;
    const slot = rule.slots[index]; if (!slot || !width) return;
    const x = event.clientX, y = event.clientY, pointerId = event.pointerId;
    const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
    document.body.style.cursor = resizing ? 'nwse-resize' : 'move'; document.body.style.userSelect = 'none';
    const move = e => {
      if (e.pointerId !== pointerId) return;
      const dx = (e.clientX - x) / width * 100, dy = (e.clientY - y) / width * 100;
      const snap = v => e.altKey ? v : Math.round(v / 2) * 2;
      const next = resizing ? { ...slot, width: Math.min(100 - slot.x, Math.max(5, snap(slot.width + dx))) } : { ...slot, x: Math.max(0, Math.min(100 - slot.width, snap(slot.x + dx))), y: Math.max(0, Math.min(250, snap(slot.y + dy))) };
      state.current.onChange(setMediaLayout(state.current.config, viewport, name, { ...rule, slots: rule.slots.map((s, i) => i === index ? next : s) }));
    };
    const finish = cancelled => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', abort); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', abort);
      document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; cancel.current = null; state.current.onEnd(cancelled);
    };
    const up = e => { if (e.pointerId === pointerId) finish(false); };
    const abort = () => finish(true);
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); abort(); } };
    cancel.current = abort;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', abort); window.addEventListener('keydown', key, true); window.addEventListener('blur', abort);
  };
  if (!enabled || !canvasRef.current) return null;
  return createPortal(<div className="sp-image-position-layer" aria-label={zh ? '图片位置编辑' : 'Image position editing'}>{boxes.map(box => <div key={box.index} className="sp-image-position-box" data-selected={selected === box.index} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
    <button type="button" className="sp-image-move" aria-label={`${zh ? '移动图片位置' : 'Move image position'} ${box.index + 1}`} onPointerDown={e => gesture(e, box.index, false)} onClick={e => { e.stopPropagation(); onSelect(box.index); }} onKeyDown={e => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const rule = normalizeMediaLayout(savedMediaLayout(config, viewport, name)), s = rule.slots[box.index], d = e.shiftKey ? 5 : 1;
      const next = { ...s, x: s.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0), y: s.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0) };
      onChange(setMediaLayout(config, viewport, name, { ...rule, slots: rule.slots.map((s, i) => i === box.index ? next : s) }));
    }}><span>{box.index + 1} · {Math.round(box.width)} × {Math.round(box.height)}</span></button>
    <button type="button" className="sp-image-corner" aria-label={`${zh ? '缩放图片位置' : 'Resize image position'} ${box.index + 1}`} onPointerDown={e => gesture(e, box.index, true)}>↘</button>
  </div>)}</div>, canvasRef.current);
}
