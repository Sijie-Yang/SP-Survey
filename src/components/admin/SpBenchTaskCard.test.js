import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SpBenchTaskCard from './SpBenchTaskCard';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';
import { flattenQuestions } from '../../lib/quality';
import { saveBenchTasks } from '../../lib/benchTaskStore';

jest.mock('../../lib/benchTaskStore', () => ({
  ...jest.requireActual('../../lib/benchTaskStore'),
  saveBenchTasks: jest.fn(),
}));

const config = syntheticSurveyConfig({ images: 6 });
const questions = flattenQuestions(config);
const human = syntheticResponses(25, { config });
const project = { id: 'abcd1234-0000', name: 'Street', metadata: { datasetRelease: { doi: '10.5281/zenodo.9', license: 'CC0-1.0' } } };

test('publishes an image question as a frozen task', async () => {
  saveBenchTasks.mockImplementation(async (_id, changes) => ({ spBenchTasks: changes }));
  const onProjectUpdated = jest.fn();
  render(<SpBenchTaskCard project={project} questions={questions} humanRows={human} language="en" onProjectUpdated={onProjectUpdated} />);
  fireEvent.click(screen.getByRole('button', { name: /Choose questions/ }));
  const row = await screen.findByTestId('bench-candidate-abcd1234-safe');
  expect(row).toHaveTextContent('6 images · 25 responses');
  expect(screen.getByTestId('bench-candidate-abcd1234-feel-calm')).toHaveTextContent('Calm');
  expect(screen.queryByTestId('bench-candidate-abcd1234-gender')).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(saveBenchTasks).toHaveBeenCalled());
  const [id, changes] = saveBenchTasks.mock.calls[0];
  expect(id).toBe('abcd1234-0000');
  expect(changes['abcd1234-safe']).toMatchObject({ task_id: 'abcd1234-safe', n_human: 25, dataset_doi: '10.5281/zenodo.9', license: 'CC0-1.0' });
  await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledWith({ metadata: { spBenchTasks: changes } }));
});

test('shows published tasks, and small samples cannot be published', () => {
  const published = { ...project, metadata: { spBenchTasks: { 'abcd1234-safe': { version: '2026-10-20' } } } };
  render(<SpBenchTaskCard project={published} questions={questions} humanRows={human.slice(0, 5)} language="zh" />);
  expect(screen.getByTestId('sp-bench-task-card')).toHaveTextContent('已有 1 道题发布为评测任务');
  fireEvent.click(screen.getByRole('button', { name: '选择题目' }));
  const row = screen.getByTestId('bench-candidate-abcd1234-safe');
  expect(row).toHaveTextContent('已发布 2026-10-20');
  expect(row).toHaveTextContent('至少需要 20 份回答');
  expect(within(row).getByRole('button', { name: '更新' })).toBeDisabled();
  expect(within(row).getByRole('button', { name: '撤下' })).toBeEnabled();
});

test('renders nothing without image questions', () => {
  const plain = questions.filter((q) => ['gender', 'age', 'comment'].includes(q.name));
  const { container } = render(<SpBenchTaskCard project={project} questions={plain} humanRows={human} language="en" />);
  expect(container).toBeEmptyDOMElement();
});
