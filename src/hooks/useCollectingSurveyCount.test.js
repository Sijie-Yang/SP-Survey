import { renderHook, waitFor } from '@testing-library/react';
import { useCollectingSurveyCount } from './useCollectingSurveyCount';
import { getUserProjects } from '../lib/projectManager';

jest.mock('../lib/projectManager', () => ({
  getUserProjects: jest.fn(),
}));

const ME = 'user-me';

beforeEach(() => {
  getUserProjects.mockReset();
  getUserProjects.mockResolvedValue([
    { id: 'mine', userId: ME, accessRole: 'owner', publishedVersion: 1 },
    { id: 'draft', userId: ME, accessRole: 'owner', publishedVersion: 0 },
    { id: 'shared', userId: 'user-other', accessRole: 'collaborator', publishedVersion: 3 },
  ]);
});

test('counts only this user\'s published surveys from getUserProjects', async () => {
  const { result } = renderHook(() => useCollectingSurveyCount({ userId: ME, pollMs: 60000 }));
  await waitFor(() => expect(result.current).toBe(1));
  expect(getUserProjects).toHaveBeenCalledTimes(1);
});

test('reloads when the open project publish state changes', async () => {
  const { rerender } = renderHook(
    ({ refreshKey }) => useCollectingSurveyCount({ userId: ME, refreshKey, pollMs: 60000 }),
    { initialProps: { refreshKey: 'v0' } },
  );
  await waitFor(() => expect(getUserProjects).toHaveBeenCalledTimes(1));
  getUserProjects.mockResolvedValue([
    { id: 'mine', userId: ME, accessRole: 'owner', publishedVersion: 1 },
    { id: 'second', userId: ME, accessRole: 'owner', publishedVersion: 1 },
  ]);
  rerender({ refreshKey: 'v1' });
  await waitFor(() => expect(getUserProjects).toHaveBeenCalledTimes(2));
});

test('a failed project list shows zero', async () => {
  getUserProjects.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useCollectingSurveyCount({ userId: ME, pollMs: 60000 }));
  await waitFor(() => expect(getUserProjects).toHaveBeenCalled());
  expect(result.current).toBe(0);
});
