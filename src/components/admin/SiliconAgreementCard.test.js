import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';
import { flattenQuestions } from '../../lib/quality';
import SiliconAgreementCard from './SiliconAgreementCard';
import { listSiliconResponses, listSiliconRuns } from '../../lib/agentApi';

jest.mock('../../lib/agentApi', () => ({
  listSiliconRuns: jest.fn(),
  listSiliconResponses: jest.fn(),
}));

const config = syntheticSurveyConfig({ images: 6 });
const questions = flattenQuestions(config);
const human = syntheticResponses(30, { config });

test('renders nothing when the project has no silicon run', async () => {
  listSiliconRuns.mockResolvedValue({ success: true, runs: [] });
  const { container } = render(<SiliconAgreementCard projectId="p" questions={questions} humanRows={human} language="en" />);
  await waitFor(() => expect(listSiliconRuns).toHaveBeenCalledWith('p'));
  expect(container).toBeEmptyDOMElement();
});

test('compares the latest run with the human answers and hands CSVs to the export', async () => {
  listSiliconRuns.mockResolvedValue({ success: true, runs: [{ id: 'r1', model: 'qwen', status: 'completed', progress_valid: 10 }] });
  listSiliconResponses.mockResolvedValue({
    success: true,
    responses: syntheticResponses(20, { config, seed: 3 }).map((r, i) => ({ ...r, persona_id: i % 2 ? 'a' : 'b', survey_metadata: { persona_name: i % 2 ? 'Alice' : 'Bob' } })),
  });
  const onResult = jest.fn();
  render(<SiliconAgreementCard projectId="p" questions={questions} humanRows={human} language="en" onResult={onResult} />);
  expect(await screen.findByText('Silicon vs human')).toBeInTheDocument();
  await screen.findAllByText('Kendall τ of the TrueSkill ranking');
  expect(screen.getByText('Where they disagree most')).toBeInTheDocument();
  expect(screen.getByLabelText('Personas')).toBeInTheDocument();
  await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ path: 'silicon_agreement.csv' })])));
  const csv = onResult.mock.calls.at(-1)[0][0].content;
  expect(csv).toMatch(/persona:a/);
  expect(csv).toMatch(/,all\n|,all$/m);
  expect(screen.getAllByTestId('silicon-calibration')[0]).toHaveTextContent(/Calibration: human ≈ .* × silicon · R²/);
  expect(onResult.mock.calls.at(-1)[0].map((f) => f.path)).toContain('silicon_calibration.csv');
});

jest.mock('../../lib/methodsExport', () => ({ downloadTextFile: jest.fn() }));

test('a run can be saved as an SP-Bench submission for the published tasks', async () => {
  const { downloadTextFile } = require('../../lib/methodsExport');
  const { buildHumanTask } = require('../../lib/benchHumanTrack');
  const { fireEvent } = require('@testing-library/react');
  const task = buildHumanTask({ project: { id: 'abcd1234-x', name: 'S' }, question: questions.find((q) => q.name === 'safe'), humanRows: human });
  listSiliconRuns.mockResolvedValue({ success: true, runs: [{ id: 'r1', model: 'qwen-vl', status: 'completed', progress_valid: 10 }] });
  listSiliconResponses.mockResolvedValue({ success: true, responses: syntheticResponses(20, { config, seed: 3 }) });
  render(<SiliconAgreementCard projectId="p" questions={questions} humanRows={human} language="en" benchTasks={{ [task.task_id]: task }} />);
  const button = await screen.findByRole('button', { name: 'SP-Bench' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  const [content, name] = downloadTextFile.mock.calls.at(-1);
  const sub = JSON.parse(content);
  expect(sub).toMatchObject({ model: 'qwen-vl', kind: 'silicon' });
  expect(Object.keys(sub.predictions)).toEqual(['abcd1234-safe']);
  expect(Object.keys(sub.predictions['abcd1234-safe']).length).toBeGreaterThanOrEqual(3);
  expect(name).toMatch(/-qwen-vl\.json$/);
  expect(screen.getByText(/To put it on the leaderboard/)).toBeInTheDocument();
});
