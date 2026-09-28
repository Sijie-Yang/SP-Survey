import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageRankingWidget from './ImageRankingWidget';

jest.mock('../lib/questionImageChoices', () => ({resolveQuestionImageChoices: () => [
  {value: 'image_0', imageLink: '/a.jpg'}, {value: 'image_1', imageLink: '/b.jpg'},
]}));

test('displayed ranking is not an answer until explicitly confirmed', () => {
  const onValueChanged = jest.fn();
  render(<ImageRankingWidget question={{survey: {locale: 'zh-cn'}}} value={[]} onValueChanged={onValueChanged} />);
  expect(onValueChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: '确认当前顺序'}));
  expect(onValueChanged).toHaveBeenCalledWith(['image_0', 'image_1']);
});

test('up/down alternatives reorder and persist without dragging', () => {
  const onValueChanged = jest.fn();
  render(<ImageRankingWidget question={{ survey: { locale: 'en' } }} value={[]} onValueChanged={onValueChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move item 1 down' }));
  expect(onValueChanged).toHaveBeenCalledTimes(1);
  expect(onValueChanged).toHaveBeenCalledWith(['image_1', 'image_0']);
});
test('read-only question disables both confirmation and reorder actions', () => {
  const onValueChanged = jest.fn();
  render(<ImageRankingWidget question={{ isReadOnly: true, survey: { locale: 'en' } }} value={[]} onValueChanged={onValueChanged} />);
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(onValueChanged).not.toHaveBeenCalled();
});
