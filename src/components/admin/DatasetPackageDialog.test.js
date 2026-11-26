import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatasetPackageDialog from './DatasetPackageDialog';

const project = { id: 'p', name: 'Street study', metadata: { datasetRelease: { authors: [{ name: 'Sijie Yang', orcid: '0000-0002-1825-0097', affiliation: 'NUS' }], keywords: ['street'], license: 'CC0-1.0' } } };

test('the form starts from the saved details and hands the cleaned values to the builder', async () => {
  const onBuild = jest.fn(async () => 14);
  render(<DatasetPackageDialog open onClose={() => {}} onBuild={onBuild} project={project} language="en" nSubmissions={3} freeTextNames={['comment']} />);
  expect(screen.getByLabelText(/Dataset title/)).toHaveValue('Street study');
  expect(screen.getByLabelText(/Authors, one per line/)).toHaveValue('Sijie Yang; 0000-0002-1825-0097; NUS');
  expect(screen.getByText(/Remove typed free-text answers \(comment\)/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/DOI/), { target: { value: 'https://doi.org/10.5281/zenodo.42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download package' }));
  await waitFor(() => expect(screen.getByText(/Downloaded the package \(14 files\)/)).toBeInTheDocument());
  const meta = onBuild.mock.calls[0][0];
  expect(meta.doi).toBe('10.5281/zenodo.42');
  expect(meta.license).toBe('CC0-1.0');
  expect(meta.keywords).toEqual(['street']);
  expect(meta.anonymize).toEqual({ pseudonymizeIds: true, dateOnly: true, dropFreeText: true });
  expect(meta.includeImages).toBe(false);
});

test('download stays off until there is a title, an author and data', () => {
  render(<DatasetPackageDialog open onClose={() => {}} onBuild={jest.fn()} project={{ id: 'p', name: '' }} language="en" nSubmissions={3} />);
  expect(screen.getByRole('button', { name: 'Download package' })).toBeDisabled();
});

test('a reuse question narrows the package and shows how many agreed', async () => {
  const onBuild = jest.fn(async () => 9);
  render(<DatasetPackageDialog open onClose={() => {}} onBuild={onBuild} project={project} language="en" nSubmissions={10}
    reuseQuestions={[{ name: 'share', title: 'May we reuse your answers?', yes: 6 }]} />);
  fireEvent.mouseDown(screen.getByLabelText('Which submissions'));
  fireEvent.click(await screen.findByText('Only those answering yes to: May we reuse your answers?'));
  expect(screen.getByText('6 of 10 answered yes.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Download package' }));
  await waitFor(() => expect(onBuild).toHaveBeenCalled());
  expect(onBuild.mock.calls[0][0].onlyAgreedTo).toBe('share');
});
