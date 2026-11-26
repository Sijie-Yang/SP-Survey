/* eslint-disable import/first -- Jest mock must be declared before the router import. */
// CRA's Jest resolver predates package exports; use the same v7 router's CJS entry.
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { useAdminTabHistory } from './adminTabHistory';

function Screen() {
  const { tab, overlay, openTab, openOverlay, closeOverlay } = useAdminTabHistory();
  const location = useLocation();
  return (
    <div>
      <div data-testid="tab">{tab}</div>
      <div data-testid="overlay">{overlay || 'none'}</div>
      <div data-testid="url">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => openTab(2)}>builder</button>
      <button type="button" onClick={() => openTab(3)}>share</button>
      <button type="button" onClick={() => openTab(4, { replace: true })}>replace-results</button>
      <button type="button" onClick={() => openOverlay('preview')}>preview</button>
      <button type="button" onClick={() => openOverlay('layout')}>layout</button>
      <button type="button" onClick={closeOverlay}>close</button>
    </div>
  );
}

function mountHistory(initialEntries, initialIndex = initialEntries.length - 1) {
  const router = createMemoryRouter([
    { path: '/', element: <div>home</div> },
    { path: '/admin', element: <Screen /> },
  ], { initialEntries, initialIndex });
  render(<RouterProvider router={router} />);
  return router;
}

async function goBack(router) {
  await act(async () => { await router.navigate(-1); });
}

async function goForward(router) {
  await act(async () => { await router.navigate(1); });
}

test('back walks creation steps and keeps the address on /admin', async () => {
  const router = mountHistory(['/', '/admin'], 1);
  expect(screen.getByTestId('url')).toHaveTextContent('/admin');

  fireEvent.click(screen.getByRole('button', { name: 'builder' }));
  expect(screen.getByTestId('tab')).toHaveTextContent('2');
  expect(screen.getByTestId('url')).toHaveTextContent('/admin');

  fireEvent.click(screen.getByRole('button', { name: 'share' }));
  expect(screen.getByTestId('tab')).toHaveTextContent('3');

  await goBack(router);
  expect(screen.getByTestId('tab')).toHaveTextContent('2');
  expect(screen.getByTestId('url')).toHaveTextContent('/admin');

  await goBack(router);
  expect(screen.getByTestId('tab')).toHaveTextContent('0');

  await goForward(router);
  expect(screen.getByTestId('tab')).toHaveTextContent('2');

  await goBack(router);
  await goBack(router);
  expect(screen.getByText('home')).toBeInTheDocument();
});

test('a restored step replaces the current entry instead of adding one', async () => {
  const router = mountHistory(['/', '/admin'], 1);
  fireEvent.click(screen.getByRole('button', { name: 'replace-results' }));
  expect(screen.getByTestId('tab')).toHaveTextContent('4');
  await goBack(router);
  expect(screen.getByText('home')).toBeInTheDocument();
});

test('back closes a preview before leaving the step, and the query string stays', async () => {
  const router = mountHistory([{ pathname: '/admin', search: '?preview=abc' }]);
  fireEvent.click(screen.getByRole('button', { name: 'builder' }));
  fireEvent.click(screen.getByRole('button', { name: 'preview' }));
  expect(screen.getByTestId('overlay')).toHaveTextContent('preview');
  expect(screen.getByTestId('url')).toHaveTextContent('/admin?preview=abc');

  await goBack(router);
  expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  expect(screen.getByTestId('tab')).toHaveTextContent('2');
  expect(screen.getByTestId('url')).toHaveTextContent('/admin?preview=abc');

  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(screen.getByTestId('tab')).toHaveTextContent('2');

  fireEvent.click(screen.getByRole('button', { name: 'layout' }));
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  expect(screen.getByTestId('tab')).toHaveTextContent('2');
});
