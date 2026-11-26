import {
  countStudioResponses,
  loadStudioProject,
  loadStudioRelease,
  publishStudioProject,
  removeStudioProject,
  writeStudioProject,
} from './studioData';
import {
  deleteProject,
  getProjectById,
  saveProjectDraftOptimistic,
  saveProjectFull,
} from './projectManager';
import { deleteImagesFromR2, isR2Configured, listImagesFromR2 } from './r2';
import { loadStudioResponses, studioExportRows } from './studioResults';

jest.mock('./projectManager', () => ({
  createProject: jest.fn(),
  deleteProject: jest.fn(),
  getProjectById: jest.fn(),
  getUserProjects: jest.fn(),
  saveProjectDraftOptimistic: jest.fn(),
  saveProjectFull: jest.fn(),
}));
jest.mock('./adminResults', () => ({ countOwnerResponses: jest.fn() }));
jest.mock('./r2', () => ({ deleteImagesFromR2: jest.fn(), isR2Configured: jest.fn(), listImagesFromR2: jest.fn() }));
jest.mock('./surveyStorage', () => ({ loadSurveyConfig: jest.fn() }));
jest.mock('./studioResults', () => ({ loadStudioResponses: jest.fn(), studioExportRows: jest.fn() }));

const stored = (overrides = {}) => ({
  id: 'p1',
  userId: 'u1',
  name: 'Study',
  preloadedImages: [],
  draftUpdatedAt: '2026-01-01T00:00:00Z',
  _surveyConfig: { pages: [], title: 'A' },
  ...overrides,
});

beforeEach(() => {
  getProjectById.mockResolvedValue(stored());
  saveProjectFull.mockResolvedValue({ success: true });
  saveProjectDraftOptimistic.mockResolvedValue({ success: true, draftUpdatedAt: '2026-01-02T00:00:00Z' });
});

afterEach(() => sessionStorage.clear());

test('self-hosted: every local project can be opened, with or without an owner', async () => {
  getProjectById.mockResolvedValue(stored({ userId: null }));
  expect(await loadStudioProject('p1')).toMatchObject({ id: 'p1' });
});

test('self-hosted: no release is read in Studio (releases live on the Host tab)', async () => {
  expect(await loadStudioRelease('p1')).toBeUndefined();
});

test('a config change is a patch on the fresh draft, saved with its draft stamp', async () => {
  const result = await writeStudioProject('p1', (fresh, config) => ({ config: { ...config, responseQuota: 50 } }));
  expect(saveProjectDraftOptimistic).toHaveBeenCalledWith('p1', { pages: [], title: 'A', responseQuota: 50 }, { expectedDraftUpdatedAt: '2026-01-01T00:00:00Z' });
  expect(saveProjectFull).not.toHaveBeenCalled();
  expect(result).toMatchObject({ success: true, project: { name: 'Study', draftUpdatedAt: '2026-01-02T00:00:00Z', _surveyConfig: { responseQuota: 50 } } });
});

test('when another write landed first, the change is applied again to the newer draft', async () => {
  getProjectById
    .mockResolvedValueOnce(stored())
    .mockResolvedValueOnce(stored({ draftUpdatedAt: '2026-01-03T00:00:00Z', _surveyConfig: { pages: [], title: 'Changed elsewhere' } }));
  saveProjectDraftOptimistic
    .mockResolvedValueOnce({ success: false, conflict: true, error: 'conflict' })
    .mockResolvedValueOnce({ success: true, draftUpdatedAt: '2026-01-04T00:00:00Z' });
  const result = await writeStudioProject('p1', (fresh, config) => ({ config: { ...config, responseQuota: 50 } }));
  expect(saveProjectDraftOptimistic).toHaveBeenCalledTimes(2);
  expect(saveProjectDraftOptimistic.mock.calls[1]).toEqual(['p1', { pages: [], title: 'Changed elsewhere', responseQuota: 50 }, { expectedDraftUpdatedAt: '2026-01-03T00:00:00Z' }]);
  expect(result.success).toBe(true);
});

test('row fields (name, media list) are saved on the fresh row; a no-op writes nothing', async () => {
  const result = await writeStudioProject('p1', () => ({ fields: { name: 'Renamed' } }));
  expect(saveProjectFull).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Renamed', preloadedImages: [] }), { pages: [], title: 'A' });
  expect(saveProjectFull.mock.calls[0][0]).not.toHaveProperty('_surveyConfig');
  expect(result.project.name).toBe('Renamed');
  saveProjectFull.mockClear();
  expect(await writeStudioProject('p1', (fresh, config) => ({ config: { ...config } }))).toMatchObject({ success: true, unchanged: true });
  expect(saveProjectFull).not.toHaveBeenCalled();
  expect(saveProjectDraftOptimistic).not.toHaveBeenCalled();
});

test('without the draft RPC a config change falls back to a full save', async () => {
  saveProjectDraftOptimistic.mockResolvedValue({ success: false, code: 'DRAFT_SAVE_RPC_MISSING', error: 'missing' });
  const result = await writeStudioProject('p1', (fresh, config) => ({ config: { ...config, title: 'B' } }));
  expect(saveProjectFull).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), { pages: [], title: 'B' });
  expect(result.success).toBe(true);
});

test('a write keeps a classic working copy with unsaved edits and drops a clean one', async () => {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ p1: { hasUnsavedChanges: true }, p2: { hasUnsavedChanges: false } }));
  await writeStudioProject('p1', () => ({ fields: { name: 'X' } }));
  expect(JSON.parse(sessionStorage.getItem('project_editing_states')).p1).toEqual({ hasUnsavedChanges: true });
  getProjectById.mockResolvedValue(stored({ id: 'p2' }));
  await writeStudioProject('p2', () => ({ fields: { name: 'Y' } }));
  expect(JSON.parse(sessionStorage.getItem('project_editing_states')).p2).toBeUndefined();
});

test('a study is deleted before its images, and a failed delete keeps the images', async () => {
  isR2Configured.mockReturnValue(true);
  listImagesFromR2.mockResolvedValue({ success: true, images: [{ key: 'u1/p1/a.jpg' }, { key: 'templates/x.jpg' }] });
  deleteImagesFromR2.mockResolvedValue({ success: true });
  deleteProject.mockResolvedValueOnce({ success: false, error: 'denied' });
  expect(await removeStudioProject('p1', { userId: 'u1' })).toMatchObject({ success: false });
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
  deleteProject.mockResolvedValueOnce({ success: true });
  expect(await removeStudioProject('p1', { userId: 'u1' })).toMatchObject({ success: true });
  expect(deleteImagesFromR2).toHaveBeenCalledWith(['u1/p1/a.jpg'], { allowedPrefix: 'u1/p1/' });
  expect(deleteProject.mock.invocationCallOrder[1]).toBeLessThan(deleteImagesFromR2.mock.invocationCallOrder[0]);
});

test('the response count matches the download rows', async () => {
  loadStudioResponses.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
  studioExportRows.mockImplementation((rows) => rows.slice(1));
  expect(await countStudioResponses('p1', {})).toBe(2);
  loadStudioResponses.mockRejectedValue(new Error('offline'));
  expect(await countStudioResponses('p1', {})).toBeNull();
});

test('self-hosted: publishing points to the Host tab', async () => {
  expect(await publishStudioProject('p1')).toMatchObject({ success: false, code: 'failed' });
});
