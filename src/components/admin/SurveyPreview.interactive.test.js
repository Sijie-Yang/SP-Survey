/* eslint-disable testing-library/no-node-access -- Verify layout wrappers and SurveyJS-generated editing/width attributes. */
import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FullSurveyPreview from './FullSurveyPreview';
import SurveyPreview, { createSurveyPreviewModel } from './SurveyPreview';
import { RegionProvider } from '../../contexts/RegionContext';

jest.setTimeout(20000);

jest.mock('../../lib/previewMediaLibrary', () => ({
  resolveMediaPoolForPreview: async () => [],
  resolvePreviewMediaContext: async () => ({ images: [], imageDatasetConfig: {}, fromPreviewLibrary: false }),
  adaptSurveyForPreviewLibrary: (config) => config,
  surveyUsesSampledMedia: () => false,
}));

const initialConfig = {
  title: 'Preview study',
  pages: [
    {
      name: 'p1',
      title: 'Page One',
      elements: [
        { type: 'text', name: 'q1', title: 'Alpha question' },
        { type: 'text', name: 'q2', title: 'Beta question' },
      ],
    },
    {
      name: 'p2',
      title: 'Page Two',
      elements: [
        { type: 'text', name: 'q3', title: 'Gamma question' },
        { type: 'text', name: 'q4', title: 'Delta question' },
      ],
    },
  ],
};

let latest = initialConfig;

function Harness() {
  const [config, setConfig] = useState(initialConfig);
  latest = config;
  return (
    <RegionProvider>
      <FullSurveyPreview
        config={config}
        currentProject={{ preloadedImages: [] }}
        onConfigChange={setConfig}
      />
    </RegionProvider>
  );
}

beforeEach(() => {
  // JSDOM has text ranges but no layout rectangles (real browser QA covers highlighting).
  Range.prototype.getClientRects = () => [];
  latest = initialConfig;
  localStorage.setItem('sp-survey-language', 'en');
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => localStorage.clear());

test('format preview starts on page 1 and cannot be answered', async () => {
  expect(createSurveyPreviewModel(initialConfig).mode).toBe('display');
  const formatPreview = createSurveyPreviewModel(initialConfig, null, { interactive: true });
  expect(formatPreview.mode).toBe('display');
  expect(formatPreview.currentPageNo).toBe(0);

  render(<Harness />);
  expect(await screen.findByText('Alpha question')).toBeInTheDocument();
  expect(screen.queryByText('Gamma question')).not.toBeInTheDocument();
  expect(document.querySelector('[data-preview-mode]')).toHaveAttribute('data-preview-mode', 'format');
  expect(document.querySelector('[data-preview-page]')).toHaveAttribute('data-preview-page', '1');
  expect(screen.getByText('Sizing: Desktop')).toBeInTheDocument();
  expect(screen.getByText('Layout only. Questions cannot be answered here.')).toBeInTheDocument();

  const answer = screen.getByRole('textbox', { name: 'Alpha question' });
  expect(answer).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  expect(await screen.findByText('Gamma question')).toBeInTheDocument();
  expect(screen.queryByText('Alpha question')).not.toBeInTheDocument();
});

test('viewport sizes save separately and text or order stays shared', async () => {
  render(<Harness />);
  expect(await screen.findByText('Alpha question')).toBeInTheDocument();

  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '480');
  expect(screen.getByText('Question 1 of 2: Alpha question')).toBeInTheDocument();
  expect(screen.getByText('Page 1 of 2: Page One')).toBeInTheDocument();

  fireEvent.click(screen.getByText('Default media sizing'));
  const media = screen.getByRole('slider', { name: 'Media height' });
  fireEvent.change(media, { target: { value: '360' } });
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);
  expect(latest.viewportLayout.mobile).toBeUndefined();
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '360');
  expect(document.querySelector('[data-sp-viewport]')).toHaveAttribute('data-sp-viewport', 'desktop');
  expect(screen.getByText('360 px')).toBeInTheDocument();

  const width = screen.getByRole('slider', { name: 'Content width' });
  fireEvent.change(width, { target: { value: '1040' } });
  expect(latest.viewportLayout.desktop.contentWidth).toBe(1040);
  expect(document.querySelector('[data-sp-content-width]')).toHaveAttribute('data-sp-content-width', '1040');

  const card = screen.getByRole('slider', { name: 'Question card width' });
  fireEvent.change(card, { target: { value: '720' } });
  expect(latest.viewportLayout.desktop.questionWidth).toBe(720);
  expect(latest.viewportLayout.mobile).toBeUndefined();
  expect(document.querySelector('[data-sp-question-width]')).toHaveAttribute('data-sp-question-width', '720');

  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  fireEvent.change(screen.getByLabelText('Survey title'), { target: { value: 'Renamed study' } });
  expect(latest.title).toBe('Renamed study');
  fireEvent.change(screen.getByLabelText('Survey description'), { target: { value: 'A short intro' } });
  expect(latest.description).toBe('A short intro');
  fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://example.com/mark.png' } });
  expect(latest.logo).toBe('https://example.com/mark.png');
  await waitFor(() => {
    expect(document.querySelector('.sd-logo__image')).toHaveAttribute('src', 'https://example.com/mark.png');
  });

  fireEvent.click(screen.getByRole('button', { name: 'Layout', exact: true }));
  fireEvent.click(screen.getByText('Default media sizing'));
  fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
  expect(screen.getByText('Sizing: Mobile')).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Media height' })).toHaveAttribute('aria-valuenow', '320');
  expect(document.querySelector('[data-sp-viewport]')).toHaveAttribute('data-sp-viewport', 'mobile');
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '320');
  expect(latest.viewportLayout.desktop.questionWidth).toBe(720);
  expect(latest.viewportLayout.mobile?.questionWidth).toBeUndefined();

  fireEvent.change(screen.getByRole('slider', { name: 'Media height' }), { target: { value: '240' } });
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);
  expect(latest.viewportLayout.mobile.mediaMaxHeight).toBe(240);
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '240');

  fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
  const title = document.querySelector('[data-sp-edit="question-title"]');
  expect(title).toBeTruthy();
  title.textContent = 'Alpha edited';
  fireEvent.blur(title);
  expect(latest.pages[0].elements[0].title).toBe('Alpha edited');
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);

  fireEvent.click(screen.getAllByRole('button', { name: 'Move question down' })[0]);
  expect(latest.pages[0].elements.map((element) => element.name)).toEqual(['q2', 'q1']);
  expect(latest.pages[0].elements[1].title).toBe('Alpha edited');

  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  expect(await screen.findByText('Gamma question')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Move question down' })[0]);
  expect(latest.pages[1].elements.map((element) => element.name)).toEqual(['q4', 'q3']);
  expect(screen.queryByText('Alpha question')).not.toBeInTheDocument();
  expect(latest.viewportLayout.mobile.mediaMaxHeight).toBe(240);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});

test('single-question resizing supports undo, redo, device isolation and inherited reset', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.change(screen.getByRole('slider', { name: 'Question card width' }), { target: { value: '600' } });
  expect(latest.viewportLayout.desktop.questions.q1.questionWidth).toBe(600);
  expect(latest.viewportLayout.desktop.questionWidth).toBeUndefined();
  expect(document.querySelector('[data-sp-question-name="q1"]').style.getPropertyValue('--sp-question-width')).toBe('600px');
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.viewportLayout).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
  expect(latest.viewportLayout.desktop.questions.q1.questionWidth).toBe(600);
  fireEvent.click(screen.getByRole('button', { name: 'Mobile', exact: true }));
  expect(screen.getByRole('slider', { name: 'Question card width' })).toHaveAttribute('aria-valuenow', '390');
  expect(screen.queryByRole('slider', { name: 'Media height' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('slider', { name: 'Question card width' }), { target: { value: '280' } });
  expect(latest.viewportLayout.mobile.questions.q1.questionWidth).toBe(280);
  fireEvent.click(screen.getByText('Reset layout'));
  fireEvent.click(screen.getByRole('button', { name: 'Use survey defaults' }));
  expect(latest.viewportLayout.mobile.questions.q1).toBeUndefined();
  expect(latest.viewportLayout.desktop.questions.q1.questionWidth).toBe(600);
});

test('outline navigates pages and inspector text changes and undo synchronize the canvas', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Gamma question', exact: true }));
  await screen.findByText('Gamma question');
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  fireEvent.change(screen.getByLabelText('Question text', { selector: 'input' }), { target: { value: 'Revised Gamma' } });
  expect(latest.pages[1].elements[0].title).toBe('Revised Gamma');
  await waitFor(() => expect(document.querySelector('[data-sp-question-name="q3"] [data-sp-edit="question-title"]')).toHaveTextContent('Revised Gamma'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  await waitFor(() => expect(document.querySelector('[data-sp-question-name="q3"] [data-sp-edit="question-title"]')).toHaveTextContent('Gamma question'));
  fireEvent.click(screen.getByRole('button', { name: 'Survey', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Layout', exact: true }));
  fireEvent.click(screen.getByText('Quick layouts'));
  fireEvent.click(screen.getByRole('button', { name: 'Compact', exact: true }));
  expect(latest.viewportLayout.desktop.contentWidth).toBe(760);
  expect(latest.viewportLayout.desktop.cardPadding).toBe(20);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.viewportLayout).toBeUndefined();
});

test('a multi-move pointer resize is one undo step and Escape restores its baseline', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  const handle = document.querySelector('[data-sp-question-name="q1"] [data-sp-resize="questionWidth"]');
  const pointer = (target, type, x) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { clientX: x, clientY: 0, button: 0, pointerId: 1 });
    act(() => target.dispatchEvent(event));
  };
  pointer(handle, 'pointerdown', 100);
  pointer(window, 'pointermove', 80);
  pointer(window, 'pointermove', 50);
  pointer(window, 'pointerup', 50);
  expect(latest.viewportLayout.desktop.questions.q1.questionWidth).toBeLessThan(900);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.viewportLayout).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  pointer(handle, 'pointerdown', 100);
  pointer(window, 'pointermove', 50);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(latest.viewportLayout).toBeUndefined();
  expect(document.body.style.cursor).toBe('');
});

test('add choice questions and text blocks inline, edit options, and undo deletion', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Add question', exact: true }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Single choice' }));
  await waitFor(() => expect(latest.pages[0].elements).toHaveLength(3));
  const added = latest.pages[0].elements[1];
  expect(added.type).toBe('radiogroup');
  expect(added.choices).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'A park' } });
  expect(latest.pages[0].elements[1].choices[0]).toEqual({ value: 'option_1', text: 'A park' });
  fireEvent.click(screen.getByRole('button', { name: 'Add text', exact: true }));
  expect(await screen.findByLabelText('Text content')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Read this before answering.' } });
  expect(latest.pages[0].elements[2]).toMatchObject({ type: 'expression', description: 'Read this before answering.' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected block' }));
  expect(latest.pages[0].elements).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.pages[0].elements[2].description).toBe('Read this before answering.');
});

test('adding with survey selected follows the current preview page and can create a page', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  await screen.findByText('Gamma question');
  fireEvent.click(screen.getByRole('button', { name: 'Add text', exact: true }));
  expect(latest.pages[0].elements).toHaveLength(2);
  expect(latest.pages[1].elements[2].type).toBe('expression');
  fireEvent.click(screen.getByRole('button', { name: 'Add page', exact: true }));
  expect(latest.pages).toHaveLength(3);
  await waitFor(() => expect(screen.getByLabelText('Page title', { selector: 'input' })).toHaveValue('New page'));
});

test('ordinary Preview keeps the original display UI and applies saved card widths without editor controls', async () => {
  const config = { ...initialConfig, viewportLayout: { desktop: { contentWidth: 1078, questions: { q1: { questionWidth: 648 } } } } };
  render(<SurveyPreview config={config} currentProject={{ preloadedImages: [] }} />);
  await screen.findByText('Alpha question');
  expect(document.querySelector('[data-preview-mode]')).toHaveAttribute('data-preview-mode', 'display');
  expect(screen.getByText(/Preview Mode - This shows exactly/)).toBeInTheDocument();
  expect(document.querySelector('[data-sp-content-width]')).toHaveAttribute('data-sp-content-width', '1078');
  await waitFor(() => expect(document.querySelector('[data-sp-layout-question]')).toHaveStyle('--sp-question-width: 648px'));
  expect(document.querySelector('[data-sp-edit]')).not.toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Question card width' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  expect(await screen.findByText('Gamma question')).toBeInTheDocument();
});

test('text styles support mobile globals, single-card overrides, reset, copy, undo and redo', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: 'Mobile', exact: true }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Question title size', exact: true }), { target: { value: '18' } });
  expect(latest.viewportLayout.mobile.typography.questionTitleSize).toBe(18);
  expect(latest.viewportLayout.desktop).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Question title size', exact: true })).toHaveValue(18);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Question title size', exact: true }), { target: { value: '20' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Line height', exact: true }), { target: { value: '1.8' } });
  expect(latest.viewportLayout.mobile.questions.q1.typography).toEqual({ questionTitleSize: 20, lineHeight: 1.8 });
  expect(document.querySelector('[data-sp-question-name="q1"]').style.getPropertyValue('--sjs-font-questiontitle-size')).toBe('20px');
  fireEvent.click(screen.getByRole('button', { name: 'Copy text styles to Desktop' }));
  expect(latest.viewportLayout.desktop.questions.q1.typography).toEqual({ questionTitleSize: 20, lineHeight: 1.8 });
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.viewportLayout.desktop).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
  expect(latest.viewportLayout.desktop.questions.q1.typography.questionTitleSize).toBe(20);
  fireEvent.click(screen.getByRole('button', { name: 'Restore inheritance: Question title size' }));
  expect(screen.getByRole('spinbutton', { name: 'Question title size', exact: true })).toHaveValue(18);
  expect(latest.viewportLayout.mobile.questions.q1.typography.questionTitleSize).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Question title size', exact: true })).toHaveValue(20);
});

test('survey header selection and the question inspector link expose survey title styles', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  expect(screen.queryByRole('spinbutton', { name: 'Survey title size' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit survey title & global text styles' }));
  expect(screen.getByRole('spinbutton', { name: 'Survey title size' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.click(document.querySelector('[data-sp-edit="survey-title"]'));
  expect(screen.getByRole('spinbutton', { name: 'Survey title size' })).toBeInTheDocument();
});

test('Markdown source updates the canvas and survives selection, blur, undo and device changes', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  const markdown = '### Read carefully\n\nA **bold** instruction.\n\n- First\n- Second';
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  const input = screen.getByLabelText('Question description', { selector: 'textarea' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: markdown } });
  fireEvent.blur(input);
  expect(await screen.findByText('Read carefully', { selector: 'h3' })).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector('[data-sp-edit="question-description"] h3')).toHaveTextContent('Read carefully'));
  const viewer = document.querySelector('[data-sp-edit="question-description"]');
  expect(viewer.contentEditable).toBe('false');
  expect(viewer.querySelectorAll('li')).toHaveLength(2);
  fireEvent.focus(viewer);
  fireEvent.blur(viewer);
  expect(latest.pages[0].elements[0].description).toBe(markdown);
  fireEvent.click(screen.getByRole('button', { name: 'Mobile', exact: true }));
  expect(screen.getByLabelText('Question description', { selector: 'textarea' })).toHaveValue(markdown);
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(latest.pages[0].elements[0].description).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
  expect(latest.pages[0].elements[0].description).toBe(markdown);
});

test('description italic button writes shared Markdown and undo restores source', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  const input = screen.getByLabelText('Question description', { selector: 'textarea' });
  fireEvent.change(input, { target: { value: 'First **bold** last' } });
  await waitFor(() => expect(document.querySelector('[data-sp-edit="question-description"] strong')).toHaveTextContent('bold'));
  const text = document.querySelector('[data-sp-edit="question-description"] strong');
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  fireEvent.pointerUp(text);
  fireEvent.click(text);
  expect(screen.queryByRole('textbox', { name: 'Edit full description' })).not.toBeInTheDocument();
  const toolbar = screen.getByRole('region', { name: 'Selected text' });
  const italic = within(toolbar).getByRole('button', { name: 'Italic', exact: true });
  await waitFor(() => expect(italic).toBeEnabled());
  fireEvent.click(italic);
  expect(latest.pages[0].elements[0].description).toBe('First ***bold*** last');
  expect(input).toHaveValue('First ***bold*** last');
  await waitFor(() => expect(document.querySelector('[data-sp-edit="question-description"] em strong')).toHaveTextContent('bold'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(input).toHaveValue('First **bold** last');
});

test('single click opens the canvas description at the clicked caret and allows clearing and retyping', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  const source = screen.getByLabelText('Question description', { selector: 'textarea' });
  const markdown = 'First paragraph\n\nSecond **paragraph**';
  fireEvent.change(source, { target: { value: markdown } });
  await waitFor(() => expect(document.querySelector('[data-sp-edit="question-description"] p')).toHaveTextContent('First paragraph'));
  const clickedText = document.querySelector('[data-sp-edit="question-description"] strong');
  const caret = document.createRange();
  caret.setStart(clickedText.firstChild, 3);
  caret.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(caret);
  fireEvent.click(clickedText);
  const editor = await screen.findByRole('textbox', { name: 'Edit full description' });
  expect(editor).toHaveValue(markdown);
  await waitFor(() => expect(editor).toHaveFocus());
  expect(editor.selectionStart).toBe(markdown.indexOf('**paragraph**') + 5);
  expect(editor.selectionEnd).toBe(editor.selectionStart);
  fireEvent.change(editor, { target: { value: '' } });
  expect(latest.pages[0].elements[0].description).toBe('');
  expect(editor).toBeInTheDocument();
  fireEvent.change(editor, { target: { value: 'New\n\nParagraph' } });
  expect(source).toHaveValue('New\n\nParagraph');
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.queryByRole('textbox', { name: 'Edit full description' })).not.toBeInTheDocument();
  await waitFor(() => expect(document.querySelectorAll('[data-sp-edit="question-description"] p')).toHaveLength(2));
});

test('a fresh pointer click edits despite a stale WebKit range, while a drag keeps text selected', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  fireEvent.change(screen.getByLabelText('Question description', { selector: 'textarea' }), { target: { value: '*First* paragraph' } });
  await waitFor(() => expect(document.querySelector('[data-sp-edit="question-description"] em')).toHaveTextContent('First'));
  const text = document.querySelector('[data-sp-edit="question-description"] em');
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  fireEvent(text, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, buttons: 1 }));
  fireEvent(text, new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 10, buttons: 1 }));
  fireEvent.pointerUp(text);
  fireEvent.click(text);
  expect(screen.queryByRole('textbox', { name: 'Edit full description' })).not.toBeInTheDocument();

  // Safari can leave the previous range in place even on a stationary click.
  // Editing must be based on this gesture, not Selection.isCollapsed alone.
  expect(window.getSelection().isCollapsed).toBe(false);
  fireEvent.pointerDown(text);
  fireEvent.pointerUp(text);
  fireEvent.click(text);
  const editor = await screen.findByRole('textbox', { name: 'Edit full description' });
  await waitFor(() => expect(editor).toHaveFocus());
  expect(editor.selectionStart).toBe(editor.selectionEnd);
  expect(editor).toHaveValue('*First* paragraph');
});


test('inspector scopes separate shared content, device layout and global theme', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  fireEvent.click(screen.getByRole('button', { name: 'Global theme', exact: true }));
  expect(screen.getByLabelText('Primary / selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1. Alpha question', exact: true }));
  expect(screen.getByRole('button', { name: 'Layout', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByLabelText('Primary / selected')).not.toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Media height' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '02 · Page Two', exact: true }));
  expect(screen.queryByRole('slider', { name: 'Content width' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit survey layout' }));
  expect(screen.getByRole('slider', { name: 'Content width' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Content', exact: true }));
  expect(screen.getByLabelText('Survey title')).toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});

test('a fresh canvas text selection remains editable and selecting another block clears it', async () => {
  render(<Harness />);
  await screen.findByText('Alpha question');
  const title = document.querySelector('[data-sp-question-name="q1"] [data-sp-edit="question-title"]');
  const range = document.createRange();
  range.selectNodeContents(title);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  // Pointer-up precedes the click that selects the card; the new text target must survive it.
  fireEvent.pointerUp(title);
  fireEvent.click(title);
  const toolbar = screen.getByRole('region', { name: 'Selected text' });
  const bold = within(toolbar).getByRole('button', { name: 'Bold', exact: true });
  await waitFor(() => expect(bold).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '2. Beta question', exact: true }));
  await waitFor(() => expect(bold).toBeDisabled());
});
