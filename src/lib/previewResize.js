/** One pointer gesture = one history entry. Cancel/Escape rolls back the gesture. */
export function startPreviewResize(event, { value, min, max, axis = 'x', scale = 1, factor = 1, onStart, onChange, onEnd }) {
  if (event.button != null && event.button !== 0) return () => {};
  event.preventDefault();
  event.stopPropagation();
  const start = axis === 'x' ? event.clientX : event.clientY;
  const pointerId = event.pointerId;
  const previousCursor = document.body.style.cursor;
  const previousSelect = document.body.style.userSelect;
  document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
  document.body.style.userSelect = 'none';
  onStart?.();
  const move = (e) => {
    if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
    const delta = ((axis === 'x' ? e.clientX : e.clientY) - start) / Math.max(0.1, scale);
    onChange(Math.max(min, Math.min(max, Math.round(value + delta * factor))));
  };
  let done = false;
  const finish = (cancelled) => {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    onEnd?.(cancelled);
  };
  const up = (e) => {
    if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
    finish(false);
  };
  const cancel = () => finish(true);
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
  return cancel;
}
