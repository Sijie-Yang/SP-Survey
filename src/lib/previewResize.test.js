import { startPreviewResize } from './previewResize';

function pointer(type, values) {
  const event = new Event(type);
  Object.assign(event, values);
  window.dispatchEvent(event);
}

test('drag accounts for zoom, clamps dimensions, and commits a single gesture', () => {
  const change = jest.fn(); const end = jest.fn(); const start = jest.fn();
  startPreviewResize({ clientX: 100, preventDefault() {}, stopPropagation() {} }, { value: 500, min: 280, max: 900, scale: 0.5, factor: 2, onStart: start, onChange: change, onEnd: end });
  pointer('pointermove', { clientX: 150 });
  expect(change).toHaveBeenLastCalledWith(700);
  pointer('pointermove', { clientX: 300 });
  expect(change).toHaveBeenLastCalledWith(900);
  pointer('pointerup', {});
  expect(start).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledWith(false);
  pointer('pointermove', { clientX: 400 });
  expect(change).toHaveBeenCalledTimes(2);
  expect(document.body.style.cursor).toBe('');
});

test('Escape, pointer cancellation and unmount cleanup cancel and release listeners', () => {
  const end = jest.fn(); const change = jest.fn();
  const cancel = startPreviewResize({ clientY: 10, preventDefault() {}, stopPropagation() {} }, { axis: 'y', value: 200, min: 80, max: 800, onChange: change, onEnd: end });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  cancel();
  expect(end).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledWith(true);
  pointer('pointermove', { clientY: 30 });
  expect(change).not.toHaveBeenCalled();
  expect(document.body.style.userSelect).toBe('');
});
