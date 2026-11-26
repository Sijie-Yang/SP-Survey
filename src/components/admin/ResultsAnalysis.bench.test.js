import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ResultsAnalysis from './ResultsAnalysis';
import { RegionProvider } from '../../contexts/RegionContext';
import { fetchAdminResponsePage } from '../../lib/adminResults';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';

jest.mock('../../lib/supabase', () => ({ supabase: null }));
jest.mock('../../lib/projectManager', () => ({ saveProjectFull: jest.fn() }));
jest.mock('./ImagePerceptionPanel', () => () => null);
jest.mock('../../lib/adminResults', () => ({
  fetchAdminResponsePage: jest.fn(),
  fetchOwnerResponsePage: jest.fn(),
  createResponseLoadSession: () => ({ contracts: new Map(), mode: 'auto' }),
}));

const N = Number(process.env.BENCH_N || 500);
const PAGE = 40;
const run = process.env.BENCH ? test : test.skip;
jest.setTimeout(600000);

run(`bench: ${N} responses`, async () => {
  const config = syntheticSurveyConfig();
  const rows = syntheticResponses(N, { config });
  const pages = [];
  fetchAdminResponsePage.mockImplementation(async (_id, _offset, after) => {
    const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
    pages.push(performance.now());
    return rows.slice(start, start + PAGE);
  });
  const log = {};
  const t0 = performance.now();
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'proj_synthetic', name: 'Synthetic' }} surveyConfig={config} adminMode /></RegionProvider>);
  const firstPaint = performance.now();
  await screen.findByText(new RegExp(`${N} / ${N} submissions in analysis`), {}, { timeout: 600000 });
  log.overviewReady = performance.now() - t0;
  log.firstCommit = firstPaint - t0;
  log.pageCalls = pages.length;

  const q0 = performance.now();
  fireEvent.click(screen.getByRole('tab', { name: /Questions/i }));
  await screen.findAllByText(/Which place looks safer/);
  log.questionsView = performance.now() - q0;

  const e0 = performance.now();
  fireEvent.click(screen.getByRole('button', { name: 'Expand analysis: safe' }));
  await screen.findAllByText(/TrueSkill \(pairwise/);
  log.expandPicker = performance.now() - e0;

  const p0 = performance.now();
  const score = screen.queryAllByRole('combobox')[0];
  if (score) fireEvent.mouseDown(score);
  log.openPaperMethods = performance.now() - p0;

  // eslint-disable-next-line no-console
  console.log('BENCH', JSON.stringify(Object.fromEntries(Object.entries(log).map(([k, v]) => [k, Math.round(v)]))));
});
