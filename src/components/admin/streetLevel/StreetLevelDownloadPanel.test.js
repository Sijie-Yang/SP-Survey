import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RegionContext } from '../../../contexts/RegionContext';
import { helperHealth } from '../../../lib/streetLevel/localHelper';
import StreetLevelDownloadPanel from './StreetLevelDownloadPanel';

jest.mock('../../../lib/r2', () => ({
  getR2ServerUrl: () => 'https://sp-survey.org',
  getR2PublicBase: () => 'https://pub.example',
  listImagesFromR2: () => Promise.resolve({ success: true, images: [] }),
}));

jest.mock('../../../lib/streetLevel/api', () => ({
  currentAccessToken: jest.fn(async () => ''),
}));

jest.mock('../../../lib/streetLevel/localHelper', () => {
  const actual = jest.requireActual('../../../lib/streetLevel/localHelper');
  return { ...actual, helperHealth: jest.fn() };
});

function renderPanel(language) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <RegionContext.Provider value={{ language }}>
        <StreetLevelDownloadPanel
          points={[]}
          selectedIds={[]}
          currentProject={{ id: 'proj_1' }}
          projectRef={{ current: { id: 'proj_1', imageDatasetConfig: {} } }}
          projectPrefix=""
          onProjectUpdate={() => {}}
          commitStreetLevel={() => {}}
        />
      </RegionContext.Provider>
    </ThemeProvider>,
  );
}

describe('street-level download panel when the browser blocks the helper', () => {
  beforeEach(() => {
    helperHealth.mockResolvedValue({ running: false, blocked: true });
  });

  it('says the helper is running but blocked, in English, and shows the macOS reinstall note', async () => {
    renderPanel('en');
    expect(await screen.findByTestId('helper-blocked-chip')).toHaveTextContent('Browser blocked the helper');
    const alert = screen.getByTestId('helper-blocked');
    expect(alert).toHaveTextContent('The helper is running, but this browser blocked the connection. Use the backup command below.');
    expect(alert).toHaveTextContent('python3 -m sp_streetlevel run --project proj_1');
    await userEvent.click(screen.getByText('Download settings'));
    await userEvent.click(screen.getByRole('tab', { name: 'macOS' }));
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('~/.sp-streetlevel');
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('Anaconda');
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('https://127.0.0.1:47822');
    const commands = within(screen.getByTestId('helper-section')).getAllByTestId('helper-command').map((el) => el.textContent);
    expect(commands[0]).toBe('brew install gettext && brew install inih');
    expect(commands[1]).toContain('python3 -m venv ~/.sp-streetlevel');
    expect(commands[1]).not.toContain('--user');
    expect(commands[2].startsWith('~/.sp-streetlevel/bin/python -m sp_streetlevel serve')).toBe(true);
    expect(commands.some((cmd) => cmd.startsWith('python3 -m sp_streetlevel serve'))).toBe(true);
    expect(commands.join('\n')).not.toContain('.local/bin');
    expect(screen.getByTestId('mac-venv-why')).toHaveTextContent('cryptography');
    expect(screen.getByTestId('helper-listen')).toHaveTextContent('https://127.0.0.1:47822/health first, then http://127.0.0.1:47821/health');
    expect(screen.getByTestId('helper-status')).toHaveTextContent('The helper is running, but this browser blocked it.');
    expect(screen.queryByText('Helper not running')).not.toBeInTheDocument();
    expect(screen.queryByText('Not running on this computer.')).not.toBeInTheDocument();
  });

  it('says the same thing in Chinese', async () => {
    renderPanel('zh');
    expect(await screen.findByTestId('helper-blocked-chip')).toHaveTextContent('浏览器拦截了本地工具');
    const alert = screen.getByTestId('helper-blocked');
    expect(alert).toHaveTextContent('本地工具已在运行，但浏览器拦截了连接。请使用下面的备用命令。');
    expect(alert).toHaveTextContent('python3 -m sp_streetlevel run --project proj_1');
    await userEvent.click(screen.getByText('下载设置'));
    await userEvent.click(screen.getByRole('tab', { name: 'macOS' }));
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('~/.sp-streetlevel');
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('不会升级 Anaconda');
    expect(screen.getByTestId('mac-venv-why')).toHaveTextContent('cryptography');
    expect(screen.getByTestId('mac-already-serve')).toHaveTextContent('python3 -m sp_streetlevel serve 已经能用');
    expect(screen.getByTestId('mac-reinstall')).toHaveTextContent('https://127.0.0.1:47822');
    expect(screen.getByTestId('helper-listen')).toHaveTextContent('面板先请求 https://127.0.0.1:47822/health，再请求 http://127.0.0.1:47821/health。');
    expect(screen.getByTestId('helper-status')).toHaveTextContent('本地工具已在运行，但浏览器拦截了连接。');
  });

  it('shows connected when https health succeeds', async () => {
    helperHealth.mockResolvedValue({
      running: true, version: '0.2.0', streetlevel: '0.12.11', base: 'https://127.0.0.1:47822',
    });
    renderPanel('en');
    expect(await screen.findByText('Helper connected')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('helper-blocked')).not.toBeInTheDocument());
  });
});
