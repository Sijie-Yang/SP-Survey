import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RegionProvider } from '../../contexts/RegionContext';
import SiliconSamples from './SiliconSamples';
import * as agentApi from '../../lib/agentApi';

jest.mock('../../lib/agentApi', () => ({
  cancelSiliconRun: jest.fn(),
  createSiliconRun: jest.fn(),
  deleteSiliconPersona: jest.fn(),
  getCredentialStatus: jest.fn(),
  getSiliconCompare: jest.fn(),
  listSiliconPersonas: jest.fn(),
  listSiliconRuns: jest.fn(),
  processSiliconRun: jest.fn(),
  resumeSiliconRun: jest.fn(),
  retryFailedSiliconRun: jest.fn(),
  saveSiliconPersona: jest.fn(),
  exportSiliconRun: jest.fn(),
}));

function renderPage(surveyConfig) {
  return render(
    <RegionProvider>
      <ThemeProvider theme={createTheme()}>
        <SiliconSamples currentProject={{ id: 'p1', name: 'Study' }} surveyConfig={surveyConfig} />
      </ThemeProvider>
    </RegionProvider>,
  );
}

async function selectResident() {
  fireEvent.click(screen.getByRole('button', { name: /^Personas ·/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Resident' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Personas' })).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

async function closeQuestions() {
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Questions' })).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('SiliconSamples', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    agentApi.listSiliconPersonas.mockResolvedValue({
      success: true,
      personas: [{ id: 'persona-1', name: 'Resident' }],
    });
    agentApi.listSiliconRuns.mockResolvedValue({ success: true, runs: [] });
    agentApi.getCredentialStatus.mockResolvedValue({
      success: true,
      directory: [{
        id: 'openai',
        displayName: 'OpenAI',
        configured: true,
        models: [{ id: 'gpt-4o', label: 'GPT-4o', vision: true }],
      }],
      siliconRoute: { provider: 'openai', model: 'gpt-4o' },
    });
    agentApi.createSiliconRun.mockResolvedValue({
      success: true,
      run: { id: 'run-1', progress_total: 1 },
    });
    agentApi.processSiliconRun.mockResolvedValue({
      success: true,
      finished: true,
      status: 'completed',
    });
    agentApi.getSiliconCompare.mockResolvedValue({
      success: true,
      responseCount: 1,
      byQuestion: {},
      eventCounts: { answer: 1, skip: 0, error: 0 },
      disclaimer: 'Synthetic only',
    });
  });

  test('starts a bounded draft-snapshot run with the configured vision model', async () => {
    renderPage({
      pages: [{ elements: [{ type: 'rating', name: 'age', title: 'Age' }] }],
    });
    await selectResident();
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith({
      projectId: 'p1',
      personaIds: ['persona-1'],
      repeats: 1,
      budgetTokens: 25000,
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: undefined,
      questionNames: ['age'],
    }));
    expect(agentApi.processSiliconRun).not.toHaveBeenCalled();
    expect(agentApi.getSiliconCompare).not.toHaveBeenCalled();
  });

  test('keeps persona input after a failed save and closes the dialog after a successful retry', async () => {
    agentApi.saveSiliconPersona
      .mockResolvedValueOnce({ success: false, error: 'Could not save persona' })
      .mockResolvedValueOnce({ success: true });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Personas ·/ }));
    await screen.findByRole('checkbox', { name: 'Resident' });
    fireEvent.click(screen.getByRole('button', { name: 'Add persona' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add persona' }));
    const save = dialog.getByRole('button', { name: 'Add persona' });
    expect(save).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Visitor' } });
    fireEvent.click(save);
    await dialog.findByText('Could not save persona');
    expect(dialog.getByLabelText('Name')).toHaveValue('Visitor');
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add persona' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Personas' })).toBeInTheDocument();
    expect(agentApi.saveSiliconPersona).toHaveBeenLastCalledWith({
      projectId: 'p1', name: 'Visitor', attributes: { city: '', notes: '' },
    });
  });

  test('disables start when every supported question is deselected', async () => {
    renderPage({
      pages: [{ elements: [{ type: 'rating', name: 'age', title: 'Age' }] }],
    });
    fireEvent.click(screen.getByRole('button', { name: /^Questions ·/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Question 1 Age/ }));
    await closeQuestions();
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeDisabled());
  });

  test('starts a slider pretest and lists annotation as not preview-accepted', async () => {
    renderPage({
      pages: [{
        elements: [
          {
            type: 'imageslidergroup',
            name: 'scales',
            dimensions: [{ id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' }],
          },
          { type: 'imageannotation', name: 'mark' },
        ],
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: /^Questions ·/ }));
    expect(await screen.findByText(/scales \(imageslidergroup\)/)).toBeInTheDocument();
    expect(screen.getByText(/Listed but not preview-accepted/)).toBeInTheDocument();
    expect(screen.getByText(/mark \(imageannotation\)/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Question 2 mark/ })).toBeDisabled();
    await closeQuestions();
    await selectResident();
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith(expect.objectContaining({
      questionNames: ['scales'],
    })));
    expect(screen.getByText(/1 personas · 1 simulated responses · 1 questions, 1 trials/)).toBeInTheDocument();
  });

  test('does not reselect every question when the supported list refreshes', async () => {
    const first = {
      pages: [{
        elements: [
          { type: 'rating', name: 'age', title: 'Age' },
          { type: 'imagerating', name: 'comfort', title: 'Comfort', trialCount: 4 },
        ],
      }],
    };
    const { rerender } = renderPage(first);
    fireEvent.click(screen.getByRole('button', { name: /^Questions ·/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Question 1 Age/ }));
    await closeQuestions();
    rerender(
      <RegionProvider>
        <ThemeProvider theme={createTheme()}>
          <SiliconSamples
            currentProject={{ id: 'p1', name: 'Study' }}
            surveyConfig={{
              pages: [{
                elements: [
                  { type: 'rating', name: 'age', title: 'Age' },
                  { type: 'imagerating', name: 'comfort', title: 'Comfort', trialCount: 4 },
                  { type: 'text', name: 'note', title: 'Note' },
                ],
              }],
            }}
          />
        </ThemeProvider>
      </RegionProvider>,
    );
    await selectResident();
    fireEvent.click(screen.getByRole('button', { name: 'Run silicon pretest' }));
    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith(expect.objectContaining({
      questionNames: ['comfort'],
    })));
  });

  test('keeps survey numbering through unsupported questions, pages and search', async () => {
    renderPage({ pages: [
      { elements: [{ type: 'html', name: 'intro' }, { type: 'rating', name: 'comfort', title: 'Comfort' }] },
      { elements: [{ type: 'imageannotation', name: 'mark', title: 'Mark a place' }, { type: 'text', name: 'reason', title: 'Reason' }] },
    ] });
    fireEvent.click(screen.getByRole('button', { name: /^Questions ·/ }));
    expect(await screen.findByRole('checkbox', { name: /Question 1 Comfort/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Question 2 Mark a place/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Question 3 Reason/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Search by number or question'), { target: { value: 'Reason' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: /Question 3 Reason/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Select all supported' }));
    await closeQuestions();
    expect(screen.getByRole('button', { name: 'Questions · 2' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('renders an existing run status without crashing', async () => {
    agentApi.listSiliconRuns.mockResolvedValue({
      success: true,
      runs: [{
        id: 'run-existing',
        status: 'completed',
        progress_done: 1,
        progress_total: 1,
        progress_processed: 1,
        progress_valid: 1,
        progress_failed: 0,
        counts_ready: true,
        tokens_used: 100,
        question_names: ['age'],
      }],
    });
    renderPage();
    expect(await screen.findByText(/1\/1 trials/)).toBeInTheDocument();
    expect(await screen.findByText(/Finished with valid answers/)).toBeInTheDocument();
    expect(agentApi.getSiliconCompare).not.toHaveBeenCalled();
  });
});
