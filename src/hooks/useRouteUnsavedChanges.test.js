// CRA's Jest resolver predates package exports; use the same v7 router's CJS entry.
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });
import React, { useState } from 'react';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import useRouteUnsavedChanges from './useRouteUnsavedChanges';

function Editor() {
  const [value, setValue] = useState('');
  const guard = useRouteUnsavedChanges(!!value);
  return <><input aria-label="Draft" value={value} onChange={(e) => setValue(e.target.value)} /><Link to="/other">Other</Link>
    {guard.open && <><button onClick={guard.cancel}>Keep editing</button><button onClick={guard.discard}>Discard</button></>}</>;
}
test('history Back can be cancelled without losing the draft, then explicitly confirmed', async () => {
  const router = createMemoryRouter([{ path: '/library', element: <p>Library</p> }, { path: '/editor', element: <Editor /> }], { initialEntries: ['/library', '/editor'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved work' } });
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(await screen.findByText('Keep editing'));
  expect(screen.getByLabelText('Draft').value).toBe('Unsaved work');
  expect(router.state.location.pathname).toBe('/editor');
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(await screen.findByText('Discard'));
  await screen.findByText('Library');
});
test('link navigation is blocked when dirty and clean editors leave without a prompt', async () => {
  const router = createMemoryRouter([{ path: '/editor', element: <Editor /> }, { path: '/other', element: <p>Destination</p> }], { initialEntries: ['/editor'] });
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'draft' } });
  fireEvent.click(screen.getByText('Other'));
  fireEvent.click(await screen.findByText('Keep editing'));
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: '' } });
  fireEvent.click(screen.getByText('Other'));
  await waitFor(() => expect(screen.getByText('Destination')).toBeTruthy());
});
