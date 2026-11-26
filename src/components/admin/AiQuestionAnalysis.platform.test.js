import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import AiQuestionAnalysis from './AiQuestionAnalysis';
import { buildAnalysisRecords, makeSavedAnalysis } from '../../lib/aiQuestionAnalysis';
import { checkPlan, fieldInventory } from '../../lib/analysisPlan';

jest.mock('../../lib/agentApi', () => ({ writeQuestionAnalysis: jest.fn() }));
jest.mock('../../lib/aiAnalysisSandbox', () => ({ runAnalysisInSandbox: jest.fn() }));

const value = (i, compare) => ({ round: i + 1, imageA: `a${i}.jpg`, imageB: `b${i}.jpg`, compare, ratingA: 4, ratingB: 2, reasonsA: ['有人行道'], reasonsB: ['路太窄'], startedAt: 1793174875928, savedAt: 1793174906097 + i, durationMs: 30000 + i * 5000 });
const rows = [
  { participant_id: 'p1', responses: { grade: '二年级', pair_task: { trials: [value(0, 'a_safer'), value(1, 'b_safer'), value(2, 'similar')].map((v) => ({ value: v, shown_images: [v.imageA, v.imageB] })) } } },
  { participant_id: 'p2', responses: { grade: '五年级', pair_task: { trials: [value(0, 'a_safer'), value(1, 'a_safer'), value(2, 'unclear')].map((v) => ({ value: v, shown_images: [v.imageA, v.imageB] })) } } },
];
const question = { name: 'pair_task', type: 'custom', title: '哪条街更安全' };
const records = buildAnalysisRecords(rows, question);
const plan = checkPlan({
  summary: '每轮两张街景选更安全的一张，各打分并勾理由。',
  fields: [
    { path: 'round', use: 'skip', meaning: '轮次' },
    { path: 'imageA', use: 'image', meaning: '左图' },
    { path: 'imageB', use: 'image', meaning: '右图' },
    { path: 'compare', use: 'pick', meaning: '哪张更安全', images: ['imageA', 'imageB'], options: { a_safer: { label: '左图更安全', picks: 'imageA' }, b_safer: { label: '右图更安全', picks: 'imageB' }, similar: { label: '差不多', picks: null }, unclear: { label: '说不清', picks: null } } },
    { path: 'ratingA', use: 'score', meaning: '左图安全感', image: 'imageA', measure: '安全感' },
    { path: 'ratingB', use: 'score', meaning: '右图安全感', image: 'imageB', measure: '安全感' },
    { path: 'reasonsA', use: 'tags', meaning: '左图的理由', image: 'imageA', measure: '理由' },
    { path: 'reasonsB', use: 'tags', meaning: '右图的理由', image: 'imageB', measure: '理由' },
    { path: 'startedAt', use: 'time', meaning: '开始时间' },
    { path: 'savedAt', use: 'time', meaning: '保存时间' },
    { path: 'durationMs', use: 'duration', meaning: '每轮用时', unit: 'ms' },
    { path: '@grade', use: 'group', meaning: '年级' },
  ],
}, fieldInventory(records)).plan;

test('before any analysis a custom question explains the plan flow and offers to generate', () => {
  render(<RegionProvider><AiQuestionAnalysis question={question} records={records} saved={null} onSave={jest.fn()} /></RegionProvider>);
  expect(screen.getByTestId('ai-analysis-empty')).toBeTruthy();
  expect(screen.queryByTestId('ai-analysis-coverage')).toBeNull();
  expect(screen.getByTestId('ai-analysis-generate')).toBeTruthy();
  expect(screen.getByText(/writes a plan/)).toBeTruthy();
});

test('a saved plan shows the field → meaning → analysis table and the platform blocks titled in the survey\'s words, with no model code', () => {
  const saved = makeSavedAnalysis({ code: '', plan, model: 'qwen3.6-flash', provider: 'qwen', questionTitle: question.title });
  render(<RegionProvider><AiQuestionAnalysis question={question} records={records} saved={saved} onSave={jest.fn()} /></RegionProvider>);
  const coverage = screen.getByTestId('ai-analysis-coverage');
  expect(coverage).toBeTruthy();
  expect(screen.getByText('每轮两张街景选更安全的一张，各打分并勾理由。')).toBeTruthy();
  // Analysed fields are listed with the model's reading; skipped ones are behind a toggle.
  expect(screen.getAllByText('reasonsA').length).toBeGreaterThan(0);
  expect(screen.getAllByText('哪张更安全').length).toBeGreaterThan(0);
  expect(screen.queryByText('startedAt')).toBeNull();
  fireEvent.click(screen.getByTestId('ai-analysis-coverage-skipped'));
  expect(screen.getByText('startedAt')).toBeTruthy();
  // Blocks are named after the plan's meanings, not the field names.
  expect(screen.getByText('哪张更安全：图片排名（TrueSkill）')).toBeTruthy();
  expect(screen.getByText('安全感：每张图的分数')).toBeTruthy();
  expect(screen.getByText('理由：标签被选的次数')).toBeTruthy();
  expect(screen.getByText('参与者背景')).toBeTruthy();
  expect(screen.queryByText(/按年级分组/)).toBeNull();
  // No code was needed, so there is nothing to view and no sandbox run.
  expect(screen.queryByText('View code')).toBeNull();
  expect(screen.getByText('Plan read by the model')).toBeTruthy();
});
