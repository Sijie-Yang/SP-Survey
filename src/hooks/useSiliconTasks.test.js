import { act, renderHook } from '@testing-library/react';
import { useSiliconTasks } from './useSiliconTasks';
import * as agentApi from '../lib/agentApi';

jest.mock('../lib/agentApi', () => ({
  listSiliconTasks: jest.fn(),
  getSiliconProgress: jest.fn(),
  cancelSiliconRun: jest.fn(),
  createSiliconRun: jest.fn(),
  listSiliconResponses: jest.fn(),
  resumeSiliconRun: jest.fn(),
  retryFailedSiliconRun: jest.fn(),
}));

function idleList() {
  return Promise.resolve({ success: true, active: [], recent: [] });
}

function runningList() {
  return Promise.resolve({
    success: true,
    active: [{ id: 'run-1', status: 'running', project_id: 'proj-a' }],
    recent: [],
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  agentApi.listSiliconTasks.mockReset();
  agentApi.listSiliconTasks.mockImplementation(idleList);
});

afterEach(() => {
  jest.useRealTimers();
});

test('staying on Assistant does not keep polling when no Silicon run is active', async () => {
  const { rerender } = renderHook(({ watch }) => useSiliconTasks({
    enabled: true,
    watch,
    pollMs: 1500,
  }), { initialProps: { watch: false } });

  await act(async () => {
    await Promise.resolve();
  });
  expect(agentApi.listSiliconTasks).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(4500);
    await Promise.resolve();
  });
  expect(agentApi.listSiliconTasks).toHaveBeenCalledTimes(1);

  rerender({ watch: true });
  await act(async () => {
    await Promise.resolve();
  });
  expect(agentApi.listSiliconTasks).toHaveBeenCalledTimes(2);

  await act(async () => {
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
  });
  expect(agentApi.listSiliconTasks).toHaveBeenCalledTimes(3);
});

test('keeps polling while a Silicon run is active even if the tab is not open', async () => {
  agentApi.listSiliconTasks.mockImplementation(runningList);
  renderHook(() => useSiliconTasks({
    enabled: true,
    watch: false,
    pollMs: 1500,
  }));

  await act(async () => {
    await Promise.resolve();
  });
  const afterLoad = agentApi.listSiliconTasks.mock.calls.length;
  expect(afterLoad).toBeGreaterThanOrEqual(1);

  await act(async () => {
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
  });
  expect(agentApi.listSiliconTasks.mock.calls.length).toBeGreaterThan(afterLoad);
});
