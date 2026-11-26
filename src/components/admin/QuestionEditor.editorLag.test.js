import React, { useRef, useState } from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import QuestionEditor from './QuestionEditor';
import SurveyBuilder from './SurveyBuilder';
import { RegionProvider } from '../../contexts/RegionContext';
import { nextEditorSelectionState } from '../../lib/editorSelection';

jest.mock('../../lib/skillManager', () => ({ listSkillsForBuilder: () => Promise.resolve([]) }));
jest.mock('./QuestionParticipantPreview', () => () => <div>Preview fixture</div>);
jest.mock('./QuestionDataPreview', () => () => <div>Export fixture</div>);
jest.mock('./AiAssistantPanel', () => () => null);
jest.mock('./FullSurveyPreview', () => () => null);
jest.mock('./SurveyPreview', () => () => null);

const ratingQuestion = {
  type: 'imagerating',
  name: 'comfort',
  title: 'Comfort',
  imageCount: 1,
  trialCount: 8,
  rateMin: 1,
  rateMax: 7,
  minRateDescription: 'Poor',
  maxRateDescription: 'Excellent',
  excludePreviouslyUsedImages: false,
};

function setup(question = ratingQuestion) {
  return render(
    <RegionProvider>
      <QuestionEditor question={question} onSave={jest.fn()} onCancel={jest.fn()} />
    </RegionProvider>,
  );
}

test('opening a rating question keeps stored fields and names the two counts separately', () => {
  setup();
  expect(screen.getByLabelText('Images shown each round')).toHaveValue(1);
  expect(screen.getByLabelText('Number of trials')).toHaveValue(8);
  expect(screen.getByText(/This is not how many answers are recorded in total/)).toBeInTheDocument();
  expect(screen.getByText(/8 answers are recorded in total/)).toBeInTheDocument();
  expect(screen.getByText(/Each round shows 1\./)).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: /Prefer unused media/ })).not.toBeChecked();
  expect(screen.getByLabelText('Minimum Rating Value')).toHaveValue(1);
  expect(screen.getByLabelText('Question Title')).toHaveValue('Comfort');
  fireEvent.change(screen.getByLabelText('Question Title'), { target: { value: 'Comfort now' } });
  expect(screen.getByLabelText('Images shown each round')).toHaveValue(1);
  expect(screen.getByLabelText('Number of trials')).toHaveValue(8);
  expect(screen.getByLabelText('Minimum Rating Value')).toHaveValue(1);
  expect(screen.getByRole('switch', { name: /Prefer unused media/ })).not.toBeChecked();
});

test('question keystrokes do not re-render the builder host once the draft is dirty', async () => {
  const renders = { current: 0 };
  function Host() {
    renders.current += 1;
    const selectionRef = useRef(null);
    const [, setSelection] = useState(null);
    const report = (next) => {
      selectionRef.current = next;
      setSelection((current) => nextEditorSelectionState(current, next));
    };
    return (
      <RegionProvider>
        <div data-testid="host-renders">{renders.current}</div>
        <SurveyBuilder
          hideAssistant
          config={{
            title: 'Study',
            pages: [{ name: 'page1', title: 'Page 1', elements: [ratingQuestion] }],
          }}
          onChange={jest.fn()}
          onEditorSelectionChange={report}
          currentProject={{ id: 'project-1' }}
        />
      </RegionProvider>
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
  const title = screen.getByLabelText('Question Title');
  fireEvent.change(title, { target: { value: 'Comfort A' } });
  await act(async () => {});
  const before = Number(screen.getByTestId('host-renders').textContent);
  fireEvent.change(title, { target: { value: 'Comfort AB' } });
  fireEvent.change(title, { target: { value: 'Comfort ABC' } });
  fireEvent.change(title, { target: { value: 'Comfort ABCD' } });
  await act(async () => {});
  expect(Number(screen.getByTestId('host-renders').textContent)).toBe(before);
  expect(title).toHaveValue('Comfort ABCD');
  expect(screen.getByLabelText('Images shown each round')).toHaveValue(1);
  expect(screen.getByLabelText('Number of trials')).toHaveValue(8);
});
