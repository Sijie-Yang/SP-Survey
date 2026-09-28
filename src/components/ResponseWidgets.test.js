import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SliderGroupContent } from './ResponseWidgets';

test('untouched slider shows no recorded score; midpoint requires explicit confirmation', () => {
  const onChange = jest.fn();
  render(<SliderGroupContent dimensions={[{ id: 'a', left: 'Low', right: 'High', min: 0, max: 3, step: 0.5 }]} onChange={onChange} language="zh" />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getAllByText('尚未评分')).toHaveLength(2);
  const slider = screen.getByRole('slider');
  expect(slider).toHaveAttribute('min', '0');
  expect(slider).toHaveAttribute('max', '3');
  expect(slider).toHaveAttribute('step', '0.5');
  fireEvent.click(screen.getByRole('button', { name: '选择 1.5' }));
  expect(onChange).toHaveBeenCalledWith({ a: 1.5 });
});
test('recorded zero is visible and read-only sliders cannot confirm a new score', () => {
  render(<SliderGroupContent dimensions={[{ id: 'a' }]} scaleMin={0} value={{ a: 0 }} readOnly />);
  expect(screen.getByRole('slider')).toHaveValue('0');
  expect(screen.getByRole('slider')).toBeDisabled();
  expect(screen.queryByRole('button')).toBeNull();
});
