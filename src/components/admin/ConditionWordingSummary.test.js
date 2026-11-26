import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ConditionWordingSummary from './ConditionWordingSummary';
import { RegionProvider } from '../../contexts/RegionContext';

test('lists each condition wording with reverse coding and counts', () => {
  const question = { name: 'safety', title: 'Which place looks safe?', conditionVariants: [{ condition: 'less_safe', title: 'Which place looks less safe?', reverseCoded: true }] };
  const surveyConfig = { conditions: [{ id: 'safe', label: 'Looks safe' }, { id: 'less_safe', label: 'Looks less safe' }] };
  const row = (condition) => ({ survey_metadata: { condition }, responses: { safety: { answer: 'a' } } });
  render(<RegionProvider><ConditionWordingSummary question={question} surveyConfig={surveyConfig} responses={[row('safe'), row('less_safe'), row('less_safe')]} /></RegionProvider>);
  expect(screen.getByText('Which place looks safe?')).toBeInTheDocument();
  expect(screen.getByText('Which place looks less safe?')).toBeInTheDocument();
  expect(screen.getByText('Looks less safe')).toBeInTheDocument();
  expect(screen.getByText(/2 (份|responses)/)).toBeInTheDocument();
});
