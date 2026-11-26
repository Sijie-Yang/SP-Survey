import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DescriptionMarkdownEditor from './DescriptionMarkdownEditor';
import { RegionProvider } from '../../contexts/RegionContext';

test('formats selected source without losing paragraphs and previews the same Markdown', async () => {
  const change = jest.fn();
  function Harness() {
    const [source, setSource] = useState('First paragraph\n\nSecond paragraph');
    return <RegionProvider><DescriptionMarkdownEditor label="Description" value={source} onChange={(value) => { change(value); setSource(value); }} /></RegionProvider>;
  }
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Description' });
  fireEvent.focus(input);
  input.setSelectionRange(0, 5);
  fireEvent.click(screen.getByRole('button', { name: 'Bold', exact: true }));
  expect(input).toHaveValue('**First** paragraph\n\nSecond paragraph');
  await waitFor(() => expect(input.selectionStart).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Preview formatting' }));
  expect(screen.getByRole('region', { name: 'Description · Preview' })).toHaveTextContent('First paragraph Second paragraph');
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('**First** paragraph\n\nSecond paragraph');
  expect(change).toHaveBeenCalledTimes(1);
});

test('canvas keyboard editing creates paragraphs, hard breaks and continues lists', async () => {
  let value;
  function Harness() {
    const [source, setSource] = useState('First');
    value = source;
    return <RegionProvider><DescriptionMarkdownEditor label="Body" paragraphKeys value={source} onChange={setSource} /></RegionProvider>;
  }
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Body' });
  input.setSelectionRange(5, 5);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(value).toBe('First\n\n');
  await waitFor(() => expect(input.selectionStart).toBe(7));
  fireEvent.change(input, { target: { value: 'First\n\nSecond' } });
  input.setSelectionRange(13, 13);
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(value).toBe('First\n\nSecond  \n');
  fireEvent.change(input, { target: { value: '- One' } });
  input.setSelectionRange(5, 5);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(value).toBe('- One\n- ');
  await waitFor(() => expect(input.selectionStart).toBe(8));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(value).toBe('- One\n\n');
});

test('focus restores a collapsed caret and preserves it across source/preview switches', async () => {
  const ref = React.createRef();
  render(<RegionProvider><DescriptionMarkdownEditor ref={ref} label="Description" value={'First\n\nSecond paragraph'} onChange={jest.fn()} /></RegionProvider>);
  act(() => ref.current.focus(10));
  let input = screen.getByRole('textbox', { name: 'Description' });
  await waitFor(() => expect(input).toHaveFocus());
  expect(input.selectionStart).toBe(10);
  expect(input.selectionEnd).toBe(10);
  expect(await screen.findByText('Line 3, column 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Preview formatting' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  input = screen.getByRole('textbox', { name: 'Description' });
  await waitFor(() => expect(input).toHaveFocus());
  expect(input.selectionStart).toBe(10);
  expect(input.selectionEnd).toBe(10);
});
