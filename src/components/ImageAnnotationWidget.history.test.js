import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageAnnotationCanvas from './ImageAnnotationWidget';
const originalObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalObserver; });

test('clear, undo and redo restore the actual answer without requiring an admin provider', () => {
  const onAnswer = jest.fn();
  const shapes = [{ id: 'tree', tool: 'point', label: 'tree', points: [{ x: 0.5, y: 0.5 }] }];
  function Harness() {
    const [value, setValue] = useState({ image: 'https://example.test/a.jpg', shapes });
    return <ImageAnnotationCanvas imageUrl={value.image} value={value} onChange={(next) => { setValue(next); onAnswer(next); }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear', exact: true }));
  expect(onAnswer.mock.calls.at(-1)[0].shapes).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(onAnswer.mock.calls.at(-1)[0].shapes).toEqual(shapes);
  fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
  expect(onAnswer.mock.calls.at(-1)[0].shapes).toEqual([]);
});

test('browse mode and tool collapse do not change annotations', () => {
  const onChange = jest.fn();
  render(<ImageAnnotationCanvas imageUrl="https://example.test/a.jpg" value={{ shapes: [] }} onChange={onChange} annotationLabels={['tree']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide tools', exact: true }));
  expect(screen.queryByRole('button', { name: 'Clear', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in', exact: true }));
  expect(screen.getByRole('button', { name: '150%', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Browse / pan', exact: true }));
  expect(screen.getByRole('button', { name: 'Resume drawing', exact: true })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

test('renders legacy structured annotation labels as text', () => {
  render(
    <ImageAnnotationCanvas
      imageUrl="https://example.test/a.jpg"
      value={{ shapes: [] }}
      onChange={() => {}}
      annotationLabels={[{ text: '危险点', value: 'danger' }]}
    />,
  );
  expect(screen.getAllByText('危险点')).toHaveLength(2);
});
