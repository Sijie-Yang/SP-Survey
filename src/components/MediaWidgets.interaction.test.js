import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { MediaPickerContent, MediaRatingContent, MediaBooleanContent } from './MediaWidgets';
import SurveyJsMatrixControl from './SurveyJsMatrixControl';

test('playing media does not choose it; an explicit accessible button records the choice', () => {
  const onChange = jest.fn();
  const { container } = render(<MediaPickerContent mediaItems={[{ url: '/clip.mp4', type: 'video', name: 'Clip A' }]} onChange={onChange} language="zh" />);
  fireEvent.click(container.querySelector('video'));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择 · Clip A' }));
  expect(onChange).toHaveBeenCalledWith('media_0');
});
test('disabled media selection, zero-based rating and boolean cannot change answers', () => {
  const onChange = jest.fn();
  const { container } = render(<><MediaPickerContent disabled mediaItems={[{ url: '/a.jpg', name: 'A' }]} onChange={onChange} />
    <MediaRatingContent disabled rateMin={0} rateMax={2} value={0} onChange={onChange} />
    <MediaBooleanContent disabled value={false} onChange={onChange} /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Select · A' }));
  for (const input of container.querySelectorAll('input')) { expect(input).toBeDisabled(); fireEvent.click(input); }
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(onChange).not.toHaveBeenCalled();
});
test('matrix inputs have row/column labels and independent radio groups for concurrent previews', () => {
  const q = { name: 'same', rows: ['Safety'], columns: ['Low', 'High'], onChange: jest.fn() };
  render(<><SurveyJsMatrixControl {...q} /><SurveyJsMatrixControl {...q} /></>);
  const radios = screen.getAllByRole('radio', { name: 'Safety — High' });
  expect(radios[0].name).not.toBe(radios[1].name);
});
