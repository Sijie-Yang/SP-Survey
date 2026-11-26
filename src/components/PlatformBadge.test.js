import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import PlatformBadge, { PLATFORM_BADGE_URL, showPlatformBadge } from './PlatformBadge';

describe('PlatformBadge', () => {
  test('shows a link to sp-survey.org by default', () => {
    render(<PlatformBadge surveyJson={{ pages: [] }} locale="en" />);
    const link = screen.getByTestId('platform-badge');
    expect(link).toHaveTextContent('Made with SP-Survey');
    expect(link).toHaveAttribute('href', PLATFORM_BADGE_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('uses Chinese text for Chinese surveys', () => {
    render(<PlatformBadge surveyJson={{ pages: [] }} locale="zh-cn" />);
    expect(screen.getByTestId('platform-badge')).toHaveTextContent('用 SP-Survey 制作');
  });

  test('hidden when turned off or for uploaded pages', () => {
    expect(showPlatformBadge({ hidePlatformBadge: true })).toBe(false);
    expect(showPlatformBadge({ spSite: { html: '<p>x</p>' } })).toBe(false);
    expect(showPlatformBadge(null)).toBe(false);
    expect(showPlatformBadge({ pages: [] })).toBe(true);
    const { container } = render(<PlatformBadge surveyJson={{ hidePlatformBadge: true }} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });
});
