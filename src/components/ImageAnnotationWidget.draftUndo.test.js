import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageAnnotationCanvas from './ImageAnnotationWidget';

const originalObserver = global.ResizeObserver;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
beforeAll(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get(_target, prop) {
      if (prop === 'canvas') return null;
      return () => {};
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this.dataset.src || ''; },
    set(value) { this.dataset.src = value; },
  });
});
afterAll(() => {
  global.ResizeObserver = originalObserver;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  Object.defineProperty(HTMLImageElement.prototype, 'src', originalSrc);
});

function installImage() {
  const Real = window.Image;
  window.Image = class {
    set src(_value) { if (this.onload) this.onload(); }
  };
  return () => { window.Image = Real; };
}

function readyCanvas() {
  const img = screen.getByAltText('annotate');
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(img, 'clientWidth', { configurable: true, get: () => 200 });
  Object.defineProperty(img, 'clientHeight', { configurable: true, get: () => 100 });
  fireEvent.load(img);
  const canvas = screen.getByLabelText('Annotation canvas');
  jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON() { return {}; },
  });
  return canvas;
}

function pointAt(canvas, x, y) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, pointerId: 1, button: 0 });
}

test('Ctrl+Z and Backspace remove the last polygon point until the draft is empty', () => {
  const restore = installImage();
  const onChange = jest.fn();
  render(<ImageAnnotationCanvas imageUrl="https://example.test/a.jpg" value={{ shapes: [] }} onChange={onChange} />);
  const canvas = readyCanvas();
  fireEvent.click(screen.getByRole('button', { name: 'Polygon', exact: true }));
  pointAt(canvas, 30, 30);
  pointAt(canvas, 120, 40);
  pointAt(canvas, 80, 90);
  const confirm = screen.getByRole('button', { name: 'Confirm annotation' });
  expect(confirm.disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(screen.getByRole('button', { name: 'Confirm annotation' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(screen.getByRole('button', { name: 'Discard annotation' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Backspace' });
  expect(screen.queryByRole('button', { name: 'Discard annotation' })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  restore();
});

test('Delete still discards a polygon draft, and a committed polygon still uses shape undo', () => {
  const restore = installImage();
  const onChange = jest.fn();
  function Harness() {
    const [value, setValue] = useState({ image: 'https://example.test/a.jpg', shapes: [] });
    return <ImageAnnotationCanvas imageUrl={value.image} value={value} onChange={(next) => { setValue(next); onChange(next); }} />;
  }
  render(<Harness />);
  const canvas = readyCanvas();
  fireEvent.click(screen.getByRole('button', { name: 'Polygon', exact: true }));
  pointAt(canvas, 30, 30);
  pointAt(canvas, 120, 40);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(screen.queryByRole('button', { name: 'Discard annotation' })).toBeNull();
  pointAt(canvas, 30, 30);
  pointAt(canvas, 120, 40);
  pointAt(canvas, 80, 90);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm annotation' }));
  expect(onChange.mock.calls.at(-1)[0].shapes).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(onChange.mock.calls.at(-1)[0].shapes).toEqual([]);
  fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
  expect(onChange.mock.calls.at(-1)[0].shapes).toHaveLength(1);
  restore();
});

test('Ctrl+Z, Undo, and Backspace remove only the last point of a line draft', () => {
  const restore = installImage();
  const onChange = jest.fn();
  function Harness() {
    const [value, setValue] = useState({ image: 'https://example.test/a.jpg', shapes: [] });
    return <ImageAnnotationCanvas imageUrl={value.image} value={value} onChange={(next) => { setValue(next); onChange(next); }} />;
  }
  render(<Harness />);
  const canvas = readyCanvas();
  fireEvent.click(screen.getByRole('button', { name: 'Line', exact: true }));
  pointAt(canvas, 30, 30);
  pointAt(canvas, 120, 40);
  pointAt(canvas, 80, 90);
  expect(screen.getByRole('button', { name: 'Confirm annotation' }).disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(screen.getByRole('button', { name: 'Discard annotation' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm annotation' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(screen.getByRole('button', { name: 'Confirm annotation' }).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Backspace' });
  expect(screen.queryByRole('button', { name: 'Discard annotation' })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  pointAt(canvas, 30, 30);
  pointAt(canvas, 120, 40);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm annotation' }));
  expect(onChange.mock.calls.at(-1)[0].shapes).toHaveLength(1);
  expect(onChange.mock.calls.at(-1)[0].shapes[0].tool).toBe('line');
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(onChange.mock.calls.at(-1)[0].shapes).toEqual([]);
  fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
  expect(onChange.mock.calls.at(-1)[0].shapes).toHaveLength(1);
  restore();
});

test('toolbar open state stays when the image changes', () => {
  const { rerender } = render(<ImageAnnotationCanvas imageUrl="https://example.test/a.jpg" value={{ shapes: [] }} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide tools', exact: true }));
  rerender(<ImageAnnotationCanvas imageUrl="https://example.test/b.jpg" value={{ shapes: [] }} onChange={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Polygon', exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Annotation tools', exact: true })).toBeTruthy();
});
