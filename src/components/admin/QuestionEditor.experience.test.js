import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import QuestionEditor from './QuestionEditor';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('../../lib/skillManager', () => ({ listSkillsForBuilder: () => Promise.resolve([]) }));
jest.mock('./QuestionParticipantPreview', () => () => <div>Preview fixture</div>);

const question = { name: 'scale', title: 'Rate this', type: 'slidergroup', dimensions: [{ id: 'x', left: 'Low', right: 'High' }], scaleMin: 1, scaleMax: 7 };
const setup = (onCancel = jest.fn(), onSave = jest.fn()) => render(<RegionProvider><QuestionEditor question={question} onCancel={onCancel} onSave={onSave} /></RegionProvider>);

test('cancel warns only after editing and keep-editing preserves changes', async () => {
  const onCancel = jest.fn(); setup(onCancel);
  fireEvent.change(screen.getByLabelText('Scale maximum'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Scale maximum')).toHaveValue(10);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
test('invalid effective scales disable saving; decimal scales remain editable', () => {
  const onSave = jest.fn(); setup(jest.fn(), onSave);
  fireEvent.change(screen.getByLabelText('Scale minimum'), { target: { value: '8' } });
  expect(screen.getByRole('button', { name: 'Save Question' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Scale minimum'), { target: { value: '0.5' } });
  expect(screen.getByLabelText('Scale minimum')).toHaveValue(0.5);
  expect(screen.getByRole('button', { name: 'Save Question' })).toBeEnabled();
});
