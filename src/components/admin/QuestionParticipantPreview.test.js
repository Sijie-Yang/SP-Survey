import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuestionParticipantPreview from './QuestionParticipantPreview';
import { RegionProvider } from '../../contexts/RegionContext';
import { PREVIEW_READY, PREVIEW_RENDERED, PREVIEW_UPDATE } from '../../lib/questionPreviewProtocol';

jest.mock('../../lib/previewMediaLibrary', () => ({
  resolveMediaPoolForPreview: async (media) => media,
  resolvePreviewMediaContext: async (project) => ({
    images: project?.preloadedImages || [],
    imageDatasetConfig: project?.imageDatasetConfig || {},
    fromPreviewLibrary: false,
  }),
}));
jest.mock('../../lib/surveyMediaInjection', () => ({ ...jest.requireActual('../../lib/surveyMediaInjection'), resolveSkillQuestions: async () => {} }));
const project = { preloadedImages: ['left', 'right'].flatMap(folder => [1, 2, 3, 4].map(i => ({ url: `/${folder}/${i}.jpg`, name: `${folder}-${i}.jpg`, folder, type: 'image' }))) };
const config = { locale: 'zh', theme: { primaryColor: '#123456' }, secretNotNeededInFrame: 'excluded' };
const q = { type: 'imagepicker', name: 'pair', imageCount: 2, allowTie: false };
const preview = (question = q) => <RegionProvider><QuestionParticipantPreview question={question} currentProject={project} surveyConfig={config} /></RegionProvider>;

test('device switch changes the actual iframe viewport without replacing it', () => {
  render(preview());
  const frame = screen.getByTitle('Survey device preview');
  expect(frame).toHaveStyle({ width: '1280px', height: '800px' });
  fireEvent.click(screen.getByRole('button', { name: 'Mobile', exact: true }));
  expect(screen.getByTitle('Survey device preview')).toBe(frame);
  expect(frame).toHaveStyle({ width: '390px', height: '844px' });
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }));
  expect(frame).toHaveStyle({ width: '1280px' });
});

test('handshake updates all draft settings and only accepts the matching frame and origin', async () => {
  const { rerender } = render(preview());
  const frame = screen.getByTitle('Survey device preview');
  const post = jest.spyOn(frame.contentWindow, 'postMessage');
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls.at(-1)[0]).toMatchObject({ type: PREVIEW_UPDATE, payload: { appearance: { locale: 'zh' } } });
  expect(post.mock.calls.at(-1)[0].payload.appearance.secretNotNeededInFrame).toBeUndefined();
  post.mockClear();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'https://unrelated.example', data: { type: PREVIEW_READY } }));
  fireEvent(window, new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: PREVIEW_READY } }));
  expect(post).not.toHaveBeenCalled();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin, data: { type: PREVIEW_READY } }));
  expect(post).toHaveBeenCalledTimes(1);
  rerender(preview({ ...q, allowTie: true, tieLabel: '一样好' }));
  await waitFor(() => expect(post.mock.calls.at(-1)[0].payload.surveyJson.pages[0].elements[0]).toMatchObject({ allowTie: true, tieLabel: '一样好' }));
  const revision = post.mock.calls.at(-1)[0].revision;
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin, data: { type: PREVIEW_RENDERED, revision } })));
  expect(screen.queryByText('Updating preview…')).not.toBeInTheDocument();
});

test('editing the folder scope immediately rebuilds actual random trial media', async () => {
  const { rerender } = render(preview({ ...q, mediaFolders: ['left'], trialCount: 2 }));
  const frame = screen.getByTitle('Survey device preview');
  const post = jest.spyOn(frame.contentWindow, 'postMessage');
  await waitFor(() => expect(post).toHaveBeenCalled());
  const element = () => post.mock.calls.at(-1)[0].payload.surveyJson.pages[0].elements[0];
  expect(element().trialMediaSets.flat().every(item => item.url.startsWith('/left/'))).toBe(true);
  expect(new Set(element().trialMediaSets.flat().map(item => item.url)).size).toBe(4);
  rerender(preview({ ...q, mediaFolders: ['right'], trialCount: 2 }));
  await waitFor(() => expect(element().trialMediaSets.flat().every(item => item.url.startsWith('/right/'))).toBe(true));
  rerender(preview({ ...q, mediaFolders: ['missing'], trialCount: 2 }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not enough matching media'));
  expect(frame).not.toBeVisible();
});

test('reset resamples the current draft while keeping the selected preview device', async () => {
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.1);
  try {
    render(preview({ ...q, mediaFolders: ['left'], trialCount: 2 }));
    const frame = screen.getByTitle('Survey device preview');
    const post = jest.spyOn(frame.contentWindow, 'postMessage');
    await waitFor(() => expect(post).toHaveBeenCalled());
    const first = post.mock.calls.at(-1)[0];
    fireEvent.click(screen.getByRole('button', { name: 'Mobile', exact: true }));
    random.mockReturnValue(0.9);
    fireEvent.click(screen.getByRole('button', { name: 'Reset preview', exact: true }));
    await waitFor(() => expect(post.mock.calls.at(-1)[0].revision).toBeGreaterThan(first.revision));
    const next = post.mock.calls.at(-1)[0].payload.surveyJson.pages[0].elements[0];
    expect(next.trialMediaSets[0]).not.toEqual(first.payload.surveyJson.pages[0].elements[0].trialMediaSets[0]);
    expect(next.trialMediaSets.flat().every(item => item.folder === 'left')).toBe(true);
    expect(screen.getByTitle('Survey device preview')).toBe(frame);
    expect(frame).toHaveStyle({ width: '390px' });
    expect(screen.getByRole('button', { name: 'Expand preview', exact: true }).parentElement)
      .toContainElement(screen.getByRole('button', { name: 'Reset preview', exact: true }));
  } finally { random.mockRestore(); }
});
