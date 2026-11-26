import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import RecruitmentSettings, { draftToRecruitment } from './RecruitmentSettings';
import RecruitmentLinks from './RecruitmentLinks';
import { RegionProvider } from '../../contexts/RegionContext';
import { buildResponsesWideCsv } from '../../lib/responsesWideExport';

afterEach(() => localStorage.clear());

function Harness({ initial = {}, onSaved, hideClassicHints = false }) {
  const [config, setConfig] = useState(initial);
  return <RegionProvider><RecruitmentSettings config={config} hideClassicHints={hideClassicHints} onChange={(k, v) => { const next = { ...config, [k]: v }; setConfig(next); onSaved(next); }} /></RegionProvider>;
}

test('draft → stored setting keeps only what the chosen platform uses', () => {
  const draft = { platform: 'prolific', completionCode: ' C1 ', quotaFullCode: '', returnUrl: 'https://x', idParam: 'uid' };
  expect(draftToRecruitment(draft)).toEqual({ platform: 'prolific', completionCode: 'C1' });
  expect(draftToRecruitment({ ...draft, platform: '' })).toBeUndefined();
  expect(draftToRecruitment({ ...draft, platform: 'other' })).toEqual({ platform: 'other', returnUrl: 'https://x', idParam: 'uid' });
});

test('choosing Prolific asks for the completion code, then points to the Share tab', () => {
  let saved = null;
  render(<Harness onSaved={(c) => { saved = c; }} />);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: 'Prolific' }));
  expect(saved.recruitment).toEqual({ platform: 'prolific', completionCode: '' });
  expect(screen.getByText(/Fill in the field above before sharing/)).toBeInTheDocument();
  const code = screen.getByRole('textbox', { name: 'Completion code' });
  fireEvent.change(code, { target: { value: 'C1ABC' } });
  fireEvent.blur(code);
  expect(saved.recruitment).toEqual({ platform: 'prolific', completionCode: 'C1ABC' });
  expect(screen.getByText(/Share → Recruitment platform/)).toBeInTheDocument();
});

test('a bad return link is flagged right away', () => {
  render(<Harness initial={{ recruitment: { platform: 'other', idParam: 'uid' } }} onSaved={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: /Completion redirect link/ }), { target: { value: 'javascript:alert(1)' } });
  expect(screen.getByText('Must start with https://')).toBeInTheDocument();
});

test('share panel: Prolific link with placeholders, one link per country', () => {
  render(<RegionProvider><RecruitmentLinks surveyUrl="https://sp-survey.org/s/park" projectId="p1"
    surveyConfig={{ captureUrlParams: ['country'], recruitment: { platform: 'prolific', completionCode: 'C1ABC' } }} /></RegionProvider>);
  expect(screen.getByTestId('recruitment-main-link')).toHaveTextContent('https://sp-survey.org/s/park?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}');
  expect(screen.getByText('C1ABC')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: /Values for country/ }), { target: { value: 'UK\nUS' } });
  expect(screen.getByText('https://sp-survey.org/s/park?country=US&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy all 2 links' })).toBeInTheDocument();
});

test('share panel without a platform explains where to set one', () => {
  render(<RegionProvider><RecruitmentLinks surveyUrl="https://sp-survey.org/s/park" projectId="p1" surveyConfig={{}} /></RegionProvider>);
  expect(screen.getByTestId('recruitment-links-empty')).toHaveTextContent('Survey Builder → Basic Information');
});

test('without the classic hints (Studio) the settings do not point to classic screens', () => {
  let saved = null;
  render(<Harness hideClassicHints initial={{ recruitment: { platform: 'prolific', completionCode: 'C1ABC' } }} onSaved={(c) => { saved = c; }} />);
  expect(screen.queryByText(/Share → Recruitment platform/)).toBeNull();
  const code = screen.getByRole('textbox', { name: 'Completion code' });
  fireEvent.change(code, { target: { value: 'C2XYZ' } });
  fireEvent.blur(code);
  expect(saved.recruitment).toEqual({ platform: 'prolific', completionCode: 'C2XYZ' });
});

test('without the classic hints (Studio) the links panel shows only what helps', () => {
  const { container } = render(<RegionProvider><RecruitmentLinks hideClassicHints surveyUrl="https://sp-survey.org/s/park" projectId="p1" surveyConfig={{}} /></RegionProvider>);
  expect(container).toBeEmptyDOMElement();
  render(<RegionProvider><RecruitmentLinks hideClassicHints surveyUrl="https://sp-survey.org/s/park" projectId="p1"
    surveyConfig={{ recruitment: { platform: 'prolific', completionCode: '' } }} /></RegionProvider>);
  expect(screen.getByTestId('recruitment-main-link')).toBeInTheDocument();
  expect(screen.queryByText(/Survey Builder → Basic Information/)).toBeNull();
  expect(screen.queryByText('Several countries or groups')).toBeNull();
});

test('wide export adds recruit_* columns only when someone came from a platform', () => {
  const questions = [{ type: 'text', name: 'feel' }];
  const rows = [
    { participant_id: 'a', responses: { feel: 'calm' }, survey_metadata: { recruitment: { platform: 'prolific', id: '5f1a', study: 'st9', session: 'se3' } } },
    { participant_id: 'b', responses: { feel: 'ok' }, survey_metadata: {} },
  ];
  const [header, first, second] = buildResponsesWideCsv(rows, questions, { pages: [] }).trim().split('\n');
  const cols = header.replace(/^\ufeff/, '').split(',').map((c) => c.replace(/"/g, ''));
  const at = (line, name) => line.split(',')[cols.indexOf(name)].replace(/"/g, '');
  expect(cols).toEqual(expect.arrayContaining(['recruit_platform', 'recruit_id', 'recruit_study', 'recruit_session']));
  expect(at(first, 'recruit_platform')).toBe('prolific');
  expect(at(first, 'recruit_id')).toBe('5f1a');
  expect(at(second, 'recruit_id')).toBe('');
  expect(buildResponsesWideCsv([rows[1]], questions, { pages: [] })).not.toContain('recruit_id');
});
