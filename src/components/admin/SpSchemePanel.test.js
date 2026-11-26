import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import SpSchemePanel from './SpSchemePanel';
import { RegionProvider } from '../../contexts/RegionContext';
import { buildExampleSite, buildExampleZip } from '../../lib/spScheme';
import { fetchSurveyPage } from '../../lib/agentApi';
import { uploadImageToR2 } from '../../lib/r2';
import { LEGACY_SURVEY_HTML } from '../../lib/__fixtures__/legacySurvey';

jest.mock('../../lib/agentApi', () => ({ fetchSurveyPage: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../lib/r2', () => ({ uploadImageToR2: jest.fn() }));

function renderPanel(props = {}) {
  const onChange = jest.fn();
  render(
    <RegionProvider>
      <SpSchemePanel config={{ pages: [], theme: { primaryColor: '#111111' } }} onChange={onChange} {...props} />
    </RegionProvider>,
  );
  return { onChange };
}

const importButton = () => screen.getByRole('button', { name: /Import into Builder|导入 Builder/ });

test('copies the scheme to the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Copy SP-Scheme|复制 SP-Scheme/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toContain('SPSite.answer');
});

test('pasted code that does not match SP-Scheme is imported as it is, with no questions', async () => {
  const { onChange } = renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Paste code|粘贴代码/ }));
  fireEvent.change(screen.getByLabelText('SP-Scheme package'), { target: { value: '<!doctype html><html><body>hello<script>localStorage.setItem("done","true")</script></body></html>' } });
  fireEvent.click(screen.getByRole('button', { name: /Check format|检查格式/ }));
  expect(await screen.findByTestId('sp-scheme-verdict')).toHaveTextContent(/imported as it is|原样导入/);
  expect(screen.queryByTestId('sp-scheme-match')).toBeNull();
  expect(importButton()).toBeEnabled();
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.pages).toEqual([]);
  expect(next.spSite.convertedFrom).toBe('index.html');
  expect(next.spSite.pageQuestions).toBeUndefined();
  expect(next.spSite.html).toContain('hello');
  expect(next.spSite.html).toContain('id="sp-scheme"');
});

test('an uploaded zip is checked, then imported with its page', async () => {
  const { onChange } = renderPanel();
  const file = new File([buildExampleZip()], 'study.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByText(/Format aligned|格式与平台对齐/)).toBeInTheDocument();
  expect(screen.getByTestId('sp-scheme-site')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ }));

  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.html).toContain('SPSite.onReady');
  expect(next.spSite.html).not.toContain('sp-site-preview');
  expect(next.theme.primaryColor).toBe('#111111');
});

test('shows the active page and can remove it', () => {
  const { onChange } = renderPanel({ config: { pages: [], spSite: { html: buildExampleSite(), id: 'site-1' } } });
  expect(screen.getByTestId('sp-site-active')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Remove|移除/ }));
  expect(onChange.mock.calls[0][0].spSite).toBeUndefined();
});

test('an ordinary survey page is imported as it is, with the ticked domains and no model', async () => {
  const { onChange } = renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByTestId('sp-scheme-verdict')).toHaveTextContent(/imported as it is|原样导入/);
  expect(screen.queryByTestId('sp-scheme-convert')).toBeNull();
  const hosts = screen.getByTestId('sp-scheme-hosts');
  expect(hosts).toHaveTextContent('cdn.legacy-lab.org');
  expect(hosts).toHaveTextContent('api.legacy-lab.org');

  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.allowedHosts).toEqual(['cdn.legacy-lab.org']);
  expect(next.spSite.convertedFrom).toBe('survey.html');
  expect(next.spSite.html).not.toContain('data-sp-adapter');
  expect(next.spSite.html).toContain('How safe does this street feel?');
  expect(next.pages).toEqual([]);
  expect(fetchSurveyPage).not.toHaveBeenCalled();
});

test('unticking a domain the page loads its script from warns that the page may break, and the choice is kept', async () => {
  const { onChange } = renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  await screen.findByTestId('sp-scheme-hosts');
  fireEvent.click(screen.getByRole('checkbox', { name: /cdn\.legacy-lab\.org/ }));
  expect(await screen.findByText(/will be blocked, which may break the page/)).toBeInTheDocument();
  expect(importButton()).toBeEnabled();
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(onChange.mock.calls[0][0].spSite.allowedHosts).toBeUndefined();
});

test('a page that does not match SP-Scheme says so, with a copy button next to it', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  const verdict = await screen.findByTestId('sp-scheme-verdict');
  expect(verdict).toHaveTextContent(/does not match SP-Scheme|不符合 SP-Scheme/);
  fireEvent.click(within(verdict).getByRole('button', { name: /Copy SP-Scheme|复制 SP-Scheme/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toContain('SPSite.answer');
  expect(await within(verdict).findByRole('button', { name: /Copied|已复制/ })).toBeInTheDocument();
});

test('a page with a broken SP-Scheme block lists its problems and is still imported as it is', async () => {
  const html = '<!doctype html><html><head><script type="application/json" id="sp-scheme">{"format":"sp-scheme","spScheme":"0.1","survey":{"pages":[{"elements":[{"type":"nosuchtype","name":"q1"}]}]}}</script></head><body>hi</body></html>';
  const { onChange } = renderPanel();
  const file = new File([html], 'index.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByTestId('sp-scheme-verdict')).toHaveTextContent(/imported as it is|原样导入/);
  expect(screen.getByTestId('sp-scheme-asis-declared')).toBeInTheDocument();
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(onChange.mock.calls[0][0].pages).toEqual([]);
});

test('dropping the page with its config embeds the config for the page to read', async () => {
  const { onChange } = renderPanel();
  const files = [
    new File([LEGACY_SURVEY_HTML], 'index.html', { type: 'text/html' }),
    new File(['{"tasks":[{"id":"safety"}]}'], 'config.json', { type: 'application/json' }),
  ];
  fireEvent.drop(screen.getByTestId('sp-scheme-panel'), { dataTransfer: { files, types: ['Files'] } });
  await screen.findByTestId('sp-scheme-verdict');
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const html = onChange.mock.calls[0][0].spSite.html;
  expect(html).toContain('id="sp-data"');
  expect(html).toContain('config.json');
});

test('a zip with images uploads them to the media library in its own folders and links them to the page', async () => {
  const page = '<!doctype html><html><body><script>const PHOTO_URLS = []; localStorage.setItem("answers", "{}");</script></body></html>';
  const zip = zipSync({ 'study/index.html': strToU8(page), 'study/images/a.jpg': new Uint8Array([1, 2, 3]), 'study/images/b.jpg': new Uint8Array([4, 5, 6]) });
  uploadImageToR2.mockImplementation(async (file, key) => ({ success: true, url: `https://media.example/${key}` }));
  const onProjectUpdate = jest.fn(async () => {});
  const { onChange } = renderPanel({ currentProject: { id: 'p1', preloadedImages: [] }, onProjectUpdate });
  const file = new File([zip], 'study.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByTestId('sp-scheme-verdict')).toHaveTextContent(/imported as it is|原样导入/);
  expect(screen.getByTestId('sp-scheme-media-plan')).toHaveTextContent('images · 2');
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(uploadImageToR2).toHaveBeenCalledTimes(2);
  expect(onProjectUpdate.mock.calls.at(-1)[0].preloadedImages.map((m) => m.folder)).toEqual(['images', 'images']);
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.mediaFolders).toEqual(['images']);
  expect(next.spSite.convertedFrom).toBe('study.zip');
});

test('a survey link is fetched and imported as it is, with its own site allowed', async () => {
  const pageHtml = '<!doctype html><html><head><base href="https://lab.github.io/rating/"></head><body><img id="a" src="img/1.jpg"><button id="go">Next</button><script>fetch("https://script.google.com/macros/s/x/exec",{method:"POST",body:"{}"});</script></body></html>';
  fetchSurveyPage.mockResolvedValue({ success: true, html: pageHtml, url: 'https://lab.github.io/rating/', host: 'lab.github.io', dataFiles: [] });
  const { onChange } = renderPanel({ currentProject: { id: 'p1' }, onProjectUpdate: jest.fn() });
  fireEvent.click(screen.getByRole('button', { name: /Paste code|粘贴代码/ }));
  fireEvent.change(screen.getByLabelText('Survey web address'), { target: { value: 'https://lab.github.io/rating/' } });
  fireEvent.click(screen.getByTestId('sp-scheme-fetch-url'));
  expect(await screen.findByTestId('sp-scheme-hosts')).toHaveTextContent('lab.github.io');
  expect(screen.getByTestId('sp-scheme-verdict')).toHaveTextContent(/imported as it is|原样导入/);
  fireEvent.click(importButton());
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.allowedHosts).toContain('lab.github.io');
  expect(next.spSite.convertedFrom).toBe('https://lab.github.io/rating/');
});
