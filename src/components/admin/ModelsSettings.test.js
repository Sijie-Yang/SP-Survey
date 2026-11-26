import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RegionProvider } from '../../contexts/RegionContext';
import ModelsSettings, { routeOptions } from './ModelsSettings';
import * as agentApi from '../../lib/agentApi';

jest.mock('../../lib/agentApi', () => ({
  deleteProviderCredential: jest.fn(),
  fetchProviderModels: jest.fn(),
  getCredentialStatus: jest.fn(),
  listProviderModels: jest.fn(),
  saveAiSettings: jest.fn(),
  storeProviderCredential: jest.fn(),
}));

function renderSettings() {
  return render(
    <RegionProvider>
      <ThemeProvider theme={createTheme()}>
        <ModelsSettings />
      </ThemeProvider>
    </RegionProvider>,
  );
}

describe('ModelsSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    agentApi.getCredentialStatus.mockResolvedValue({
      success: true,
      settings: {},
      directory: [
        {
          id: 'deepseek',
          displayName: 'DeepSeek',
          recommended: true,
          catalog: true,
          configured: false,
          models: [],
        },
        {
          id: 'openai',
          displayName: 'OpenAI',
          catalog: true,
          configured: false,
          models: [],
        },
        {
          id: 'qwen-dashscope',
          displayName: 'Qwen DashScope',
          catalog: true,
          configured: false,
          models: [],
        },
        {
          id: 'amazon-bedrock',
          displayName: 'Amazon Bedrock',
          catalog: true,
          configured: false,
          authUnsupported: true,
          authHint: 'Requires AWS credentials and a region.',
          models: [],
        },
      ],
    });
    agentApi.listProviderModels.mockResolvedValue({
      success: true,
      fetched: false,
      models: [
        {
          id: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          input: ['text'],
          contextWindow: 1000000,
        },
        {
          id: 'deepseek-v4-flash-vision-exp',
          label: 'DeepSeek V4 Flash Vision Exp',
          input: ['text', 'image'],
          vision: true,
          contextWindow: 1000000,
        },
      ],
    });
    agentApi.storeProviderCredential.mockResolvedValue({ success: true });
  });

  test('keeps unsupported native-auth providers out of the default and add-provider views', async () => {
    renderSettings();

    expect(await screen.findByText('DeepSeek')).toBeInTheDocument();
    expect(screen.queryByText('Amazon Bedrock')).not.toBeInTheDocument();

    const add = screen.getByRole('button', { name: 'Add provider' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Provider' }));

    expect(await screen.findByRole('option', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qwen DashScope' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Amazon Bedrock' })).not.toBeInTheDocument();
  });

  test('loads and searches a catalog lazily without rendering editable model cards', async () => {
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText('Search models')).toBeInTheDocument();
    await waitFor(() => expect(agentApi.listProviderModels).toHaveBeenCalledWith('deepseek'));

    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'vision' } });
    expect(await screen.findByText('DeepSeek V4 Flash Vision Exp')).toBeInTheDocument();
    expect(screen.queryByLabelText('Model ID')).not.toBeInTheDocument();
  });

  test('keeps only image-capable models in the Silicon route picker', () => {
    const directory = [{
      id: 'deepseek',
      displayName: 'DeepSeek',
      configured: true,
      models: [
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', input: ['text'] },
        { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek Vision', input: ['text', 'image'] },
      ],
    }];
    expect(routeOptions(directory).map((route) => route.model)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
    ]);
    expect(routeOptions(directory, { visionOnly: true }).map((route) => route.model)).toEqual([
      'deepseek-v4-flash-vision-exp',
    ]);
  });

  test('keeps shared free models out of the Silicon picker', () => {
    const directory = [{
      id: 'qwen-dashscope',
      displayName: 'Qwen DashScope',
      configured: true,
      shared: true,
      userConfigured: false,
      models: [{ id: 'deepseek-v3.2', label: 'DeepSeek V3.2', input: ['text', 'image'], vision: true, shared: true }],
    }];
    expect(routeOptions(directory, { visionOnly: true, userOwnedOnly: true })).toEqual([]);
    expect(routeOptions(directory, { visionOnly: true }).map((route) => route.model)).toEqual(['deepseek-v3.2']);
  });
});
