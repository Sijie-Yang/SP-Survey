/* eslint-disable import/first -- Jest mocks must be declared before the router import. */
jest.mock('react-router-dom', () => {
  // The router needs TextEncoder. Its bytes must be this window's Uint8Array, or
  // fflate (which builds the example zip) mistakes them for a folder.
  const { TextEncoder: NodeTextEncoder } = require('util');
  global.TextEncoder = class TextEncoder {
    encode(text) { return new Uint8Array(new NodeTextEncoder().encode(text)); }
  };
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

jest.mock('../contexts/AuthContext', () => {
  const auth = { user: { id: 'u1' }, isAuthenticated: true, loading: false };
  return { useAuth: () => auth, useOptionalAuth: () => auth };
});
jest.mock('../components/admin/RegionSwitcher', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/StreetscapeAtmosphere', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/admin/SurveyPreview', () => ({ __esModule: true, default: ({ viewport }) => <div data-testid="survey-preview">preview {viewport}</div> }));
jest.mock('../lib/projectManager', () => ({ setActiveProject: jest.fn(), setProjectPublicSlug: jest.fn() }));
jest.mock('../lib/r2', () => ({
  uploadImageToR2: jest.fn(),
  deleteImagesFromR2: jest.fn(),
  projectR2Prefix: (userId, projectId) => `${userId}/${projectId}/`,
  r2KeyFromUrl: () => null,
}));
jest.mock('../lib/imageCompress', () => ({ compressImage: jest.fn() }));
jest.mock('../components/admin/ChatAssistant', () => ({ __esModule: true, default: (props) => <div data-testid="chat-assistant">mode {props.assistantMode}</div> }));
jest.mock('../hooks/useSurveyAssistant', () => {
  const calls = [];
  const send = jest.fn();
  const setUserMessage = jest.fn();
  const state = { apiKeyValid: true };
  const hook = (options) => {
    calls.push(options);
    return { assistantMode: options.defaultMode || 'agent', apiKeyValid: state.apiKeyValid, credentialsChecked: true, isLoading: false, loadingStatus: '', handleSendMessage: send, setUserMessage };
  };
  return {
    __esModule: true,
    default: hook,
    chatPropsFromAssistant: (a) => ({ assistantMode: a.assistantMode }),
    __mock: { calls, send, setUserMessage, state },
  };
});
jest.mock('../lib/studioData', () => ({
  isStudioLocalMode: jest.fn(),
  isStudioAiAvailable: () => true,
  listStudioProjects: jest.fn(),
  loadStudioProject: jest.fn(),
  loadStudioRelease: jest.fn(),
  saveStudioProject: jest.fn(),
  writeStudioProject: jest.fn(),
  createStudioProject: jest.fn(),
  removeStudioProject: jest.fn(),
  countStudioResponses: jest.fn(),
  publishStudioProject: jest.fn(),
}));

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { strToU8, zipSync } from 'fflate';
import { RegionProvider } from '../contexts/RegionContext';
import { ToastProvider } from '../components/layout/ToastProvider';
import StudioPage from './StudioPage';
import { buildExampleSite, buildExampleZip, readSpSchemeUpload } from '../lib/spScheme';
import { finalizeSpSchemeImport, prepareSpSchemeUpload } from '../lib/spSchemeImport';
import { LEGACY_SURVEY_HTML } from '../lib/__fixtures__/legacySurvey';
import { setActiveProject } from '../lib/projectManager';
import { deleteImagesFromR2, uploadImageToR2 } from '../lib/r2';
import { compressImage } from '../lib/imageCompress';
import { __mock as assistantMock } from '../hooks/useSurveyAssistant';
import {
  countStudioResponses,
  createStudioProject,
  isStudioLocalMode,
  listStudioProjects,
  loadStudioProject,
  loadStudioRelease,
  publishStudioProject,
  saveStudioProject,
  writeStudioProject,
} from '../lib/studioData';

function ClassicStub() {
  const location = useLocation();
  return <div data-testid="classic-editor">{location.search}</div>;
}

function setDesktop(desktop) {
  window.matchMedia = (query) => ({
    matches: desktop && /min-width/.test(query),
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function openAt(path) {
  localStorage.setItem('sp-survey-language', 'en');
  const router = createMemoryRouter([
    { path: '/studio', element: <StudioPage /> },
    { path: '/studio/:projectId', element: <StudioPage /> },
    { path: '/admin', element: <ClassicStub /> },
  ], { initialEntries: [path] });
  render(<RegionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></RegionProvider>);
  return router;
}

const examplePage = { pages: [], spSite: { html: buildExampleSite(), id: 'site-1' } };
const twelveImages = Array.from({ length: 12 }, (_, i) => ({
  url: `https://media.test/u1/p1/images/${i}.jpg`, name: `${i}.jpg`, key: `u1/p1/images/${i}.jpg`, folder: 'images', logicalFolder: 'images', type: 'image',
}));
const readyPage = { pages: [], spSite: { html: buildExampleSite(), id: 'site-1', mediaFolders: ['images'] } };
const classicConfig = { pages: [{ name: 'p', elements: [{ type: 'text', name: 'q1', title: 'Your name' }] }] };

function project(overrides = {}) {
  return {
    id: 'p1',
    userId: 'u1',
    name: 'Street perception study',
    description: '',
    preloadedImages: [],
    imageDatasetConfig: {},
    releaseManaged: false,
    publishedVersion: 0,
    lastModified: new Date().toISOString(),
    _surveyConfig: examplePage,
    ...overrides,
  };
}

// What writeStudioProject does, on the project the test's loadStudioProject returns
// (read without counting as a load).
async function applyChange(id, change) {
  const fresh = await loadStudioProject.getMockImplementation()(id);
  if (!fresh) return { success: false, error: 'not found' };
  const current = fresh._surveyConfig || {};
  const { fields = null, config = null } = change(fresh, current) || {};
  return { success: true, project: { ...fresh, ...(fields || {}), _surveyConfig: config || current } };
}

beforeEach(() => {
  setDesktop(true);
  isStudioLocalMode.mockReturnValue(false);
  listStudioProjects.mockResolvedValue([project(), project({ id: 'p2', name: 'Classic one', _surveyConfig: classicConfig })]);
  loadStudioProject.mockImplementation(async (id) => (id === 'p2' ? project({ id: 'p2', name: 'Classic one', _surveyConfig: classicConfig }) : project()));
  loadStudioRelease.mockResolvedValue(undefined);
  saveStudioProject.mockResolvedValue({ success: true });
  writeStudioProject.mockImplementation(applyChange);
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p1', name: 'Street perception study' }, surveyConfig: { pages: [] } });
  countStudioResponses.mockResolvedValue(0);
  publishStudioProject.mockResolvedValue({ success: true, publishedVersion: 1 });
  uploadImageToR2.mockImplementation(async (file, key) => ({ success: true, url: `https://media.test/${key}`, key }));
  deleteImagesFromR2.mockResolvedValue({ success: true });
  compressImage.mockImplementation(async (file) => file);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('the new-study screen offers the AI page and the classic editor as equal choices', async () => {
  openAt('/studio');
  expect(screen.getByRole('heading', { name: 'What are we researching today?' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Let AI make the survey' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Build it question by question' })).toBeInTheDocument();
  expect(screen.getByText('Drop the survey your AI built here')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy the instructions for your AI' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start from the example' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create and open the classic editor' })).toBeInTheDocument();
  const list = await screen.findByTestId('studio-project-list');
  expect(within(list).getByText('Street perception study')).toBeInTheDocument();
  // Not release-managed, with a page or questions: participants already get the latest save.
  expect(within(list).getAllByText('Live')).toHaveLength(2);
  expect(screen.getByRole('link', { name: /Classic editor/ })).toHaveAttribute('href', '/admin');
  // Templates are listed in the classic editor, so the link goes there (not back to the home page).
  expect(screen.getByRole('link', { name: 'Start from a paper template' })).toHaveAttribute('href', '/admin');
});

test('describing a study creates it, waits for the first version on the new-study screen, then opens it', async () => {
  assistantMock.send.mockReset();
  let finishRun;
  assistantMock.send.mockImplementation(() => new Promise((resolve) => { finishRun = resolve; }));
  const router = openAt('/studio');
  const box = screen.getByRole('textbox', { name: 'Describe your study' });
  expect(screen.getByRole('button', { name: 'Make it with AI' })).toBeDisabled();
  fireEvent.change(box, { target: { value: 'Compare street photos for cycling safety\n20 pairs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make it with AI' }));
  expect(await screen.findByTestId('studio-first-run')).toBeInTheDocument();
  expect(createStudioProject).toHaveBeenCalledWith('Compare street photos for cycling safety');
  await waitFor(() => expect(assistantMock.send).toHaveBeenCalledWith({ message: 'Compare street photos for cycling safety\n20 pairs', assistantMode: 'spscheme' }));
  expect(router.state.location.pathname).toBe('/studio');
  finishRun({ success: true });
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/p1'));
  expect(await screen.findByTestId('studio-assistant')).toBeInTheDocument();
  expect(assistantMock.send).toHaveBeenCalledTimes(1);
  assistantMock.send.mockReset();
});

test('without a model the new study opens with the description waiting in its chat box', async () => {
  assistantMock.send.mockReset();
  assistantMock.setUserMessage.mockClear();
  assistantMock.state.apiKeyValid = false;
  try {
    const router = openAt('/studio');
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your study' }), { target: { value: 'Rate parks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make it with AI' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/p1'));
    await waitFor(() => expect(assistantMock.setUserMessage).toHaveBeenCalledWith('Rate parks'));
    expect(assistantMock.send).not.toHaveBeenCalled();
  } finally {
    assistantMock.state.apiKeyValid = true;
  }
});

test('a study with a page has the built-in assistant in SP-Scheme mode', async () => {
  assistantMock.send.mockClear();
  openAt('/studio/p1');
  expect(await screen.findByTestId('chat-assistant')).toHaveTextContent('mode spscheme');
  expect(assistantMock.calls.at(-1).defaultMode).toBe('spscheme');
  expect(assistantMock.calls.at(-1).currentProject.id).toBe('p1');
  expect(assistantMock.send).not.toHaveBeenCalled();
});

test('a classic study keeps the same AI assistant in Studio, opening in Classic mode', async () => {
  openAt('/studio/p2');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Classic one');
  expect(await screen.findByTestId('chat-assistant')).toHaveTextContent('mode agent');
  expect(assistantMock.calls.at(-1).defaultMode).toBe('agent');
});
test('copying the instructions puts SP-Scheme on the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Copy the instructions for your AI' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(writeText.mock.calls[0][0]).toContain('SPSite.answer');
});

test('starting from the example imports it as a new study and opens it', async () => {
  const router = openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Start from the example' }));
  expect(await screen.findByTestId('studio-import-verdict')).toHaveTextContent('Matches SP-Scheme: the platform records and analyses 3 question(s).');
  expect(screen.queryByTestId('studio-import-hosts')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/p1'));
  expect(createStudioProject).toHaveBeenCalledWith('Street perception study');
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  expect(saveStudioProject.mock.calls[0][1].spSite.html).toContain('SPSite.onReady');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Street perception study');
});

test('a page that is not SP-Scheme says it is imported as it is, with what the AI can fix and the sites it uses', async () => {
  openAt('/studio');
  const broken = LEGACY_SURVEY_HTML.replace('<head>', '<head><script id="sp-scheme" type="application/json">{"format":"sp-scheme-package","spScheme":"2.0","survey":{"pages":[{"name":"p","elements":[{"type":"imagepicker","name":"q","choices":[{"value":"a","imageLink":"https://x.org/a.jpg"}]}]}]}}</script>');
  fireEvent.change(screen.getByTestId('studio-file'), { target: { files: [new File([broken], 'survey.html', { type: 'text/html' })] } });
  expect(await screen.findByTestId('studio-import-verdict')).toHaveTextContent('Not fully SP-Scheme, so it is imported as it is');
  expect(screen.getByTestId('studio-import-problems')).toHaveTextContent(/media URLs are not allowed/);
  expect(screen.getByRole('button', { name: 'Copy the instructions and these problems for your AI' })).toBeInTheDocument();
  const hosts = screen.getByTestId('studio-import-hosts');
  expect(within(hosts).getByRole('checkbox', { name: /cdn\.legacy-lab\.org/ })).toBeChecked();
  expect(within(hosts).getByRole('checkbox', { name: /api\.legacy-lab\.org/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Drop the survey your AI built here')).toBeInTheDocument();
});

test('the classic choice creates a study and opens it in the classic editor', async () => {
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p7', name: 'New study' }, surveyConfig: {} });
  openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Create and open the classic editor' }));
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p7');
  expect(createStudioProject).toHaveBeenCalledWith('New study');
  expect(setActiveProject).toHaveBeenCalledWith('p7');
});

test('a study that is not release-managed is live: saves go live, publishing fixes a version', async () => {
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Street perception study');
  expect(screen.getByText(/^AI page · 0 image folder\(s\)/)).toBeInTheDocument();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Live · saves go live');
  const publish = screen.getByRole('button', { name: 'Publish a fixed version' });
  expect(publish).toBeEnabled();
  fireEvent.mouseOver(publish);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('After you publish, participants see only this version. Later changes take effect when you publish again.');
  expect(screen.getByRole('button', { name: 'Use another page' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy for your AI to edit' })).toBeInTheDocument();
  expect(screen.getByTestId('studio-share-url')).toHaveTextContent(`${window.location.origin}/survey?project=p1`);
  expect(screen.getByTestId('studio-link-live')).toHaveTextContent('Participants see the latest saved version.');
  expect(await screen.findByText('No responses yet. Send the link to participants.')).toBeInTheDocument();
  expect(screen.queryByText(/After you publish, send the link/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
  expect(screen.getByTestId('survey-preview')).toHaveTextContent('preview mobile');
});

test('an empty study is a draft: no link yet, and the drop zone is in the preview card', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [{ name: 'p', elements: [] }] } }));
  openAt('/studio/p1');
  const preview = await screen.findByTestId('studio-preview');
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Draft, not published yet');
  expect(screen.getByRole('button', { name: 'Publish and get the link' })).toBeEnabled();
  expect(screen.getByTestId('studio-link')).toHaveTextContent('After you publish, the participant link and QR code appear here.');
  expect(await screen.findByText('No responses yet. After you publish, send the link to participants.')).toBeInTheDocument();
  expect(within(preview).getByText('Drop the survey your AI built here')).toBeInTheDocument();
  expect(within(preview).getByRole('button', { name: 'open the classic editor' })).toBeInTheDocument();
});

test('publishing checks what is stored now, releases it once and reloads the study', async () => {
  loadStudioProject.mockResolvedValue(project({ preloadedImages: twelveImages, _surveyConfig: readyPage }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Publish a fixed version' }));
  await waitFor(() => expect(publishStudioProject).toHaveBeenCalledWith('p1'));
  expect(publishStudioProject).toHaveBeenCalledTimes(1);
  // First open, the fresh read before checking, and the reload after publishing.
  await waitFor(() => expect(loadStudioProject).toHaveBeenCalledTimes(3));
});

test('the example page cannot be published while the image library is empty', async () => {
  const read = readSpSchemeUpload(buildExampleZip());
  const prepared = prepareSpSchemeUpload(read, { name: 'example.zip' });
  const config = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: config }));
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-image-need')).toHaveTextContent(/This survey needs at least \d+ images\./);
  fireEvent.click(screen.getByRole('button', { name: 'Publish a fixed version' }));
  expect(await screen.findByTestId('studio-publish-problems')).toHaveTextContent(/does not have enough images/);
  expect(publishStudioProject).not.toHaveBeenCalled();
});

test('publishing stops with plain reasons when the page needs images that are not there', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } } }));
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-missing-folder')).toHaveTextContent('The page uses the folder streets, but it has no images yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Publish a fixed version' }));
  expect(await screen.findByTestId('studio-publish-problems')).toHaveTextContent('The page uses the folder streets, but it has no images yet. Upload images first.');
  expect(publishStudioProject).not.toHaveBeenCalled();
});

test('the database setup message is for admins; others are told to contact the administrator', async () => {
  loadStudioProject.mockResolvedValue(project({ preloadedImages: twelveImages, _surveyConfig: readyPage }));
  publishStudioProject.mockResolvedValue({ success: false, code: 'site-pages-sql', error: 'draft has no pages' });
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Publish a fixed version' }));
  expect(await screen.findByTestId('studio-publish-problems')).toHaveTextContent('run supabase/release_site_pages.sql once in Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByTestId('studio-publish-problems')).toBeNull());
  publishStudioProject.mockResolvedValue({ success: false, code: 'site-pages-unsupported', error: 'draft has no pages' });
  fireEvent.click(screen.getByRole('button', { name: 'Publish a fixed version' }));
  const problems = await screen.findByTestId('studio-publish-problems');
  expect(problems).toHaveTextContent('This kind of page cannot be published yet. Please contact the administrator.');
  expect(problems).not.toHaveTextContent('supabase');
});

test('a published study shows its link; the clocks alone never make it look changed', async () => {
  // The draft was saved after publishing (a rename, say), but participants get the same survey.
  const published = { releaseManaged: true, publishedVersion: 3, publishedAt: '2026-01-01T10:00:00Z', draftUpdatedAt: '2026-01-05T10:00:00Z', publicSlug: 'campus' };
  loadStudioProject.mockResolvedValue(project(published));
  loadStudioRelease.mockResolvedValue({ config: examplePage, media: { preloadedImages: [], imageDatasetConfig: {} } });
  countStudioResponses.mockResolvedValue(12);
  openAt('/studio/p1');
  expect(await screen.findByRole('button', { name: 'Published' })).toBeDisabled();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Published v3');
  expect(screen.getByTestId('studio-share-url')).toHaveTextContent(`${window.location.origin}/s/campus`);
  await waitFor(() => expect(screen.getByTestId('studio-response-count')).toHaveTextContent('12'));
  expect(countStudioResponses).toHaveBeenCalledWith('p1', expect.anything());
  expect(screen.getByRole('button', { name: 'Download data' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View analysis' })).toBeInTheDocument();
  expect(screen.queryByTestId('studio-link-pending')).toBeNull();
  expect(screen.queryByText(/After you publish/)).toBeNull();
  expect(loadStudioRelease).toHaveBeenCalledWith('p1');
});

test('a published study whose draft differs from the release offers a new version', async () => {
  loadStudioProject.mockResolvedValue(project({ releaseManaged: true, publishedVersion: 3, publishedAt: '2026-01-02T10:00:00Z', draftUpdatedAt: '2026-01-01T10:00:00Z' }));
  loadStudioRelease.mockResolvedValue({ config: { pages: [], spSite: { html: '<p>older page</p>', id: 'site-0' } }, media: { preloadedImages: [], imageDatasetConfig: {} } });
  openAt('/studio/p1');
  expect(await screen.findByRole('button', { name: 'Publish new version' })).toBeEnabled();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Changes not published yet');
  expect(screen.getByTestId('studio-link-pending')).toHaveTextContent('Participants now see v3. Your changes take effect after you publish.');
});

test('a classic study is edited in the classic editor', async () => {
  openAt('/studio/p2');
  expect(await screen.findByText(/^Question by question/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use another page' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit in the classic editor' }));
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p2&tab=builder');
  expect(setActiveProject).toHaveBeenCalledWith('p2');
});

test('renaming writes the name on a fresh read and updates the list in place', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByTestId('studio-project-name'));
  const input = screen.getByRole('textbox', { name: 'Study name' });
  fireEvent.change(input, { target: { value: 'Walkability' } });
  fireEvent.blur(input);
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(1));
  expect(writeStudioProject.mock.calls[0][0]).toBe('p1');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Walkability');
  expect(within(screen.getByTestId('studio-project-list')).getByText('Walkability')).toBeInTheDocument();
  // No whole-project reload after the write: the write result is shown.
  expect(loadStudioProject).toHaveBeenCalledTimes(1);
  expect(listStudioProjects).toHaveBeenCalledTimes(1);
});

test('while a write runs, publish, settings, rename and upload wait', async () => {
  let finish;
  writeStudioProject.mockImplementationOnce((id, change) => new Promise((resolve) => { finish = () => resolve(applyChange(id, change)); }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByTestId('studio-project-name'));
  const input = screen.getByRole('textbox', { name: 'Study name' });
  fireEvent.change(input, { target: { value: 'Walkability' } });
  fireEvent.blur(input);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Publish a fixed version' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload images' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use another page' })).toBeDisabled();
  expect(screen.getByTestId('studio-project-name')).toHaveAttribute('aria-disabled', 'true');
  finish();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Publish a fixed version' })).toBeEnabled();
});

test('uploading images compresses them, puts them in the folder the page reads and links it', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } } }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Upload images' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveValue('streets');
  fireEvent.change(within(dialog).getByTestId('studio-upload-files'), {
    target: { files: [new File([new Uint8Array([1, 2])], 'a.jpg', { type: 'image/jpeg' }), new File(['x'], 'notes.txt', { type: 'text/plain' })] },
  });
  expect(within(dialog).getByText(/1 file\(s\) selected\./)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(1));
  expect(compressImage).toHaveBeenCalledTimes(1);
  expect(uploadImageToR2.mock.calls[0][1]).toMatch(/^u1\/p1\/streets\/a__.+\.jpg$/);
  const written = await writeStudioProject.mock.results[0].value;
  expect(written.project.preloadedImages).toEqual([expect.objectContaining({ folder: 'streets', name: 'a.jpg' })]);
  expect(written.project._surveyConfig.spSite.mediaFolders).toEqual(['streets']);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(saveStudioProject).not.toHaveBeenCalled();
});

test('a classic survey uploads without asking for a folder', async () => {
  openAt('/studio/p2');
  fireEvent.click(await screen.findByRole('button', { name: 'Upload images' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('combobox', { name: 'Folder' })).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
});

test('a folder with images that the page reads but is not linked to can be linked in one click', async () => {
  const streets = [{ url: 'https://media.test/u1/p1/streets/a.jpg', name: 'a.jpg', key: 'u1/p1/streets/a.jpg', folder: 'streets', logicalFolder: 'streets', type: 'image' }];
  loadStudioProject.mockResolvedValue(project({ preloadedImages: streets, _surveyConfig: { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } } }));
  openAt('/studio/p1');
  const alert = await screen.findByTestId('studio-missing-folder');
  expect(alert).toHaveTextContent('The page uses the folder streets, but it is not linked to the page yet.');
  fireEvent.click(within(alert).getByRole('button', { name: 'Link' }));
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(1));
  const written = await writeStudioProject.mock.results[0].value;
  expect(written.project._surveyConfig.spSite.mediaFolders).toEqual(['streets']);
  await waitFor(() => expect(screen.queryByTestId('studio-missing-folder')).toBeNull());
});

test('the settings dialog saves the response limit into the survey and words the delete plainly', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  const limit = await screen.findByRole('spinbutton', { name: 'Response limit' });
  fireEvent.change(limit, { target: { value: '120' } });
  fireEvent.blur(limit);
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(1));
  const written = await writeStudioProject.mock.results[0].value;
  expect(written.project._surveyConfig.responseQuota).toBe(120);
  expect(written.project._surveyConfig.spSite.id).toBe('site-1');
  expect(screen.getByRole('button', { name: 'Delete this study' })).toBeInTheDocument();
  expect(screen.getByText('Deletes the survey, its images and its settings. This cannot be undone.')).toBeInTheDocument();
});

test('the replace dialog cannot be closed while the import runs', async () => {
  let finishSave;
  saveStudioProject.mockImplementationOnce(() => new Promise((resolve) => { finishSave = () => resolve({ success: true }); }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Use another page' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByTestId('studio-file'), { target: { files: [new File([buildExampleSite()], 'index.html', { type: 'text/html' })] } });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Import' }));
  await waitFor(() => expect(saveStudioProject).toHaveBeenCalledTimes(1));
  expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  finishSave();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('dropping the same zip again says how many images were new, replaced or already there', async () => {
  const library = [
    { url: 'https://media.test/u1/p1/images/a__1.jpg', name: 'a.jpg', key: 'u1/p1/images/a__1.jpg', logicalFolder: 'images', original_bytes: 3 },
    { url: 'https://media.test/u1/p1/images/b__1.jpg', name: 'b.jpg', key: 'u1/p1/images/b__1.jpg', logicalFolder: 'images', original_bytes: 99 },
  ];
  loadStudioProject.mockResolvedValue(project({ preloadedImages: library, _surveyConfig: readyPage }));
  const zip = zipSync({
    'study/index.html': strToU8(buildExampleSite()),
    'study/images/a.jpg': new Uint8Array([1, 2, 3]),
    'study/images/b.jpg': new Uint8Array([4, 5, 6]),
    'study/images/c.jpg': new Uint8Array([7, 8, 9]),
  });
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Use another page' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByTestId('studio-file'), { target: { files: [new File([zip], 'study.zip', { type: 'application/zip' })] } });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Import' }));
  expect(await screen.findByText(
    'The page was replaced. 1 new image(s) uploaded. 1 image(s) with the same name replaced the old ones. 1 image(s) were already in the image library and were not uploaded again.',
  )).toBeInTheDocument();
  expect(uploadImageToR2).toHaveBeenCalledTimes(2);
  expect(deleteImagesFromR2).toHaveBeenCalledWith(['u1/p1/images/b__1.jpg'], { allowedPrefix: 'u1/p1/' });
});

test('recruitment links appear once a platform is chosen, and typing is never reset by the save', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Recruitment platforms' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByTestId('recruitment-main-link')).toBeNull();
  expect(within(dialog).queryByText(/Survey Builder/)).toBeNull();
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Platform' }));
  fireEvent.click(screen.getByRole('option', { name: 'Prolific' }));
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(1));
  expect(within(dialog).getByTestId('recruitment-main-link')).toBeInTheDocument();
  const code = within(dialog).getByRole('textbox', { name: 'Completion code' });
  fireEvent.change(code, { target: { value: 'C1ABC' } });
  fireEvent.blur(code);
  fireEvent.change(code, { target: { value: 'C1ABCD' } });
  await waitFor(() => expect(writeStudioProject).toHaveBeenCalledTimes(2));
  const written = await writeStudioProject.mock.results[1].value;
  expect(written.project._surveyConfig.recruitment).toEqual({ platform: 'prolific', completionCode: 'C1ABC' });
  expect(code).toHaveValue('C1ABCD');
});

test('unsaved classic-editor edits are pointed out, with a way to open them', async () => {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ p1: { surveyConfig: { title: 'x' }, hasUnsavedChanges: true } }));
  openAt('/studio/p1');
  const note = await screen.findByTestId('studio-classic-unsaved');
  expect(note).toHaveTextContent('The classic editor still has changes that are not saved. Open the classic editor to save or drop them.');
  fireEvent.click(within(note).getByRole('button', { name: 'Open the classic editor' }));
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p1');
  expect(setActiveProject).toHaveBeenCalledWith('p1');
});

test('the sidebar opens the selected study in the classic editor', async () => {
  openAt('/studio/p2');
  await screen.findByText(/^Question by question/);
  const link = screen.getByTestId('studio-classic-link');
  expect(link).toHaveAttribute('href', '/admin?project=p2');
  fireEvent.click(link);
  expect(setActiveProject).toHaveBeenCalledWith('p2');
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p2');
});

test('copying a page imported as it is leaves out the blocks the platform added', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const html = '<html><head>\n<script type="application/json" id="sp-scheme">\n{"format":"sp-scheme-package"}\n</script>\n<title>t</title></head><body>hi</body></html>';
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [], spSite: { html, id: 's', convertedFrom: 'index.html' } } }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Copy for your AI to edit' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const text = writeText.mock.calls[0][0];
  // The page goes back as the AI wrote it: the injected declaration is gone.
  expect(text).toContain('<html><head>\n<title>t</title></head><body>hi</body></html>');
  expect(text).not.toContain('{"format":"sp-scheme-package"}\n</script>');
});

test('a study that cannot be read (deleted, or another account\'s) says it was not found', async () => {
  loadStudioProject.mockResolvedValue(null);
  openAt('/studio/p1');
  expect(await screen.findByText('This study was not found.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
});

test('local mode needs no publishing and links to the survey directly', async () => {
  isStudioLocalMode.mockReturnValue(true);
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-local-note')).toHaveTextContent('Release and deploy');
  expect(screen.queryByRole('button', { name: 'Publish and get the link' })).toBeNull();
  expect(screen.getByTestId('studio-share-url')).toHaveTextContent(`${window.location.origin}/survey?project=p1`);
});

test('on a phone the list of studies opens from a button', async () => {
  setDesktop(false);
  openAt('/studio');
  expect(screen.queryByTestId('studio-project-list')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'My studies' }));
  const list = await screen.findByTestId('studio-project-list');
  expect(within(list).getByText('Classic one')).toBeInTheDocument();
});
