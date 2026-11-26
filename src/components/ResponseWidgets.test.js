import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PointAllocationContent, SliderGroupContent } from './ResponseWidgets';

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
test('point sliders cannot pass the points still left', () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <PointAllocationContent choices={['Greenery', 'Safety']} budget={100} value={{}} onChange={onChange} />
  );
  const greenery = screen.getByRole('slider', { name: 'Greenery' });
  const safety = screen.getByRole('slider', { name: 'Safety' });
  expect(greenery).toHaveAttribute('aria-valuemax', '100');
  expect(safety).toHaveAttribute('aria-valuemax', '100');
  fireEvent.change(greenery, { target: { value: '70' } });
  expect(onChange).toHaveBeenCalledWith({ Greenery: 70 });

  rerender(<PointAllocationContent choices={['Greenery', 'Safety']} budget={100} value={{ Greenery: 70 }} onChange={onChange} />);
  const safetyCapped = screen.getByRole('slider', { name: 'Safety' });
  expect(safetyCapped).toHaveAttribute('aria-valuemax', '30');
  expect(screen.getByText('30 / 100')).toBeTruthy();
  fireEvent.change(safetyCapped, { target: { value: '80' } });
  expect(onChange).toHaveBeenLastCalledWith({ Greenery: 70, Safety: 30 });

  rerender(<PointAllocationContent choices={['Greenery', 'Safety', 'Activity']} budget={100} value={{ Greenery: 70, Safety: 30 }} onChange={onChange} />);
  expect(screen.getByRole('slider', { name: 'Greenery' })).toHaveAttribute('aria-valuemax', '70');
  expect(screen.getByRole('slider', { name: 'Safety' })).toHaveAttribute('aria-valuemax', '30');
  expect(screen.getByRole('slider', { name: 'Activity' })).toBeDisabled();
  expect(screen.getByText('0 / 100')).toBeTruthy();
  fireEvent.change(screen.getByRole('slider', { name: 'Greenery' }), { target: { value: '40' } });
  expect(onChange).toHaveBeenLastCalledWith({ Greenery: 40, Safety: 30 });

  rerender(<PointAllocationContent choices={['Greenery', 'Safety']} budget={100} value={{ Greenery: 40, Safety: 30 }} onChange={onChange} />);
  expect(screen.getByRole('slider', { name: 'Safety' })).toHaveAttribute('aria-valuemax', '60');
  expect(screen.getByText('30 / 100')).toBeTruthy();
});

test('point numbers do not commit on each keystroke and cannot exceed the budget', () => {
  const onChange = jest.fn();
  render(<PointAllocationContent choices={['Greenery', 'Safety']} budget={100} value={{ Greenery: 70 }} onChange={onChange} />);
  const safetyPoints = screen.getByRole('spinbutton', { name: 'Safety points' });
  fireEvent.focus(safetyPoints);
  fireEvent.change(safetyPoints, { target: { value: '8' } });
  fireEvent.change(safetyPoints, { target: { value: '80' } });
  expect(onChange).not.toHaveBeenCalled();
  expect(safetyPoints).toHaveValue(30);
  fireEvent.blur(safetyPoints);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ Greenery: 70, Safety: 30 });
});

test('recorded zero is visible and read-only sliders cannot confirm a new score', () => {
  render(<SliderGroupContent dimensions={[{ id: 'a' }]} scaleMin={0} value={{ a: 0 }} readOnly />);
  expect(screen.getByRole('slider')).toHaveValue('0');
  expect(screen.getByRole('slider')).toBeDisabled();
  expect(screen.queryByRole('button')).toBeNull();
});
