import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegionContext } from '../../contexts/RegionContext';
import MediaPreannotatePanel from './MediaPreannotatePanel';

const originalObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalObserver; });

const region = { language: 'en', region: 'global', t: {}, isChinaMode: false, setLanguage() {}, setRegion() {} };
const image = (name) => ({ name: `${name}.jpg`, url: `https://example.test/${name}.jpg`, type: 'image', media_id: name });

test('switching images keeps the annotation toolbar mounted and collapsed', () => {
  const first = image('a');
  const second = image('b');
  const ui = (entry, index) => <RegionContext.Provider value={region}>
    <MediaPreannotatePanel mediaEntry={entry} imageIndex={index} imageTotal={2} mediaList={[first, second]} r2Prefix="" />
  </RegionContext.Provider>;
  const { rerender } = render(ui(first, 0));
  fireEvent.click(screen.getByRole('button', { name: 'Hide tools', exact: true }));
  rerender(ui(second, 1));
  expect(screen.queryByRole('button', { name: 'Polygon', exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Annotation tools', exact: true })).toBeTruthy();
});
