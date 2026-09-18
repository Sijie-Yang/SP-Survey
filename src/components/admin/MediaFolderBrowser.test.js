import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MediaFolderBrowser from './MediaFolderBrowser';
import { moveImagesInR2, deleteImagesFromR2 } from '../../lib/r2';
import { normalizeMediaEntry, getDirectChildMedia, mediaRelativePathFromListing } from '../../lib/mediaUtils';
jest.mock('../../lib/r2', () => ({ projectR2Prefix: (u, p) => `${u}/${p}/`, moveImagesInR2: jest.fn(), deleteImagesFromR2: jest.fn() }));
const entry = (key) => ({ name: 'scene.jpg', key, media_id: key, url: `https://media.test/${key}`, folder: 'source', original_bytes: 4000 });
beforeEach(() => jest.clearAllMocks());
async function move(pool, save, target = 'target', onMoveComplete = jest.fn()) {
  render(<MediaFolderBrowser currentProject={{ id: 'p', preloadedImages: pool, imageDatasetConfig: { mediaFolders: ['source', 'target'] } }} userId="u" onProjectUpdate={save} currentFolder="source" onCurrentFolderChange={jest.fn()} selectedMediaEntries={[pool[0]]} onMoveComplete={onMoveComplete} />);
  fireEvent.click(screen.getByRole('button', { name: /^Move selected/ }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target folder' }));
  fireEvent.click(await screen.findByRole('option', { name: target || '(project root)', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  await waitFor(() => expect(save).toHaveBeenCalled());
}
test('same-name files move independently while historical URLs and metadata remain unchanged', async () => {
  const original = entry('u/p/source/scene__one.jpg');
  const save = jest.fn();
  await move([original, entry('u/p/source/scene__two.jpg')], save);
  const moved = save.mock.calls[0][0].preloadedImages;
  expect(moved[0]).toMatchObject({ ...original, folder: 'target', logicalFolder: 'target' });
  expect(moved[1].folder).toBe('source');
  expect(normalizeMediaEntry(moved[0]).folder).toBe('target');
  expect(moveImagesInR2).not.toHaveBeenCalled();
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
});
test('moving back to root survives normalization and retains a unique ZIP filename', async () => {
  const save = jest.fn();
  await move([entry('u/p/source/scene__one.jpg')], save, '');
  const moved = save.mock.calls[0][0].preloadedImages[0];
  expect(normalizeMediaEntry(normalizeMediaEntry(moved)).folder).toBe('');
  expect(getDirectChildMedia([moved], '', 'u/p/')).toHaveLength(1);
  expect(mediaRelativePathFromListing(moved, 'u/p/')).toBe('scene__one.jpg');
});
test('failed metadata save never changes storage objects', async () => {
  await move([entry('u/p/source/scene__one.jpg')], jest.fn().mockRejectedValue(new Error('Save denied')));
  await waitFor(() => expect(screen.getByText('Save denied')).toBeTruthy());
  expect(deleteImagesFromR2).not.toHaveBeenCalled(); expect(moveImagesInR2).not.toHaveBeenCalled();
});

test('only a successful saved move clears the parent file selection', async () => {
  let finish;
  const save = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const clear = jest.fn();
  await move([entry('u/p/source/scene.jpg')], save, 'target', clear);
  expect(clear).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
test('failed moves retain file selection and the destination dialog', async () => {
  const clear = jest.fn();
  await move([entry('u/p/source/scene.jpg')], jest.fn().mockRejectedValue(new Error('Cannot save')), 'target', clear);
  await screen.findByText('Cannot save');
  expect(clear).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Target folder' })).toHaveValue('target');
});
test('file move signal ignores checked scope folders and clears both selections on success', async () => {
  const original = entry('u/p/source/scene.jpg');
  const save = jest.fn(); const clear = jest.fn(); const foldersChange = jest.fn();
  render(<MediaFolderBrowser currentProject={{ id: 'p', preloadedImages: [original], imageDatasetConfig: { mediaFolders: ['source', 'source/nested', 'target'] } }}
    userId="u" currentFolder="source" onProjectUpdate={save} onCurrentFolderChange={jest.fn()}
    selectedMediaEntries={[original]} selectedFolders={new Set(['source'])} onSelectedFoldersChange={foldersChange}
    openMoveSignal={1} onMoveComplete={clear} />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target folder' }));
  fireEvent.click(await screen.findByRole('option', { name: 'target', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  await waitFor(() => expect(clear).toHaveBeenCalled());
  expect(save.mock.calls[0][0].preloadedImages[0].logicalFolder).toBe('target');
  expect(save.mock.calls[0][0].imageDatasetConfig.mediaFolders).toContain('source/nested');
  expect(save.mock.calls[0][0].imageDatasetConfig.mediaFolders).not.toContain('target/source');
  expect(foldersChange).toHaveBeenCalledWith(new Set());
});
test('folder move picker prevents moving a folder into itself or its descendants', async () => {
  render(<MediaFolderBrowser currentProject={{ id: 'p', preloadedImages: [], imageDatasetConfig: { mediaFolders: ['source', 'source/nested', 'target'] } }}
    userId="u" currentFolder="source" onProjectUpdate={jest.fn()} onCurrentFolderChange={jest.fn()}
    selectedFolders={new Set(['source'])} />);
  fireEvent.click(screen.getByRole('button', { name: /^Move selected/ }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target folder' }));
  expect(await screen.findByRole('option', { name: 'source', exact: true })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('option', { name: 'source/nested', exact: true })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('option', { name: 'target', exact: true })).toHaveAttribute('aria-disabled', 'false');
});
