import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import QuestionEditor from './QuestionEditor';
import { RegionProvider, useRegion } from '../../contexts/RegionContext';
import { questionSettingErrorText } from '../../contexts/questionEditorI18n';

jest.mock('../../lib/skillManager', () => ({ listSkillsForBuilder: () => Promise.resolve([]) }));
jest.mock('./QuestionParticipantPreview', () => () => <div>预览</div>);
jest.mock('./QuestionDataPreview', () => () => <div>导出示例</div>);

beforeEach(() => localStorage.setItem('sp-survey-language', 'zh'));
afterEach(() => localStorage.clear());
const project = { preloadedImages: [{ url: '/a.jpg', name: 'My file.jpg', type: 'image', folder: 'photos' }], imageDatasetConfig: { mediaFolderTags: { photos: 'category' } } };
const base = { name: 'original_id', title: 'Keep my English question', description: 'User-authored description', type: 'text' };
function SwitchLanguage() {
  const { setLanguage } = useRegion();
  return <button data-testid="language" onClick={() => setLanguage('en')}>English</button>;
}
function setup(question = {}, onSave = jest.fn()) {
  return render(<RegionProvider><SwitchLanguage /><QuestionEditor question={{ ...base, ...question }} currentProject={project} onSave={onSave} onCancel={jest.fn()} /></RegionProvider>);
}

test('Chinese settings and type menu translate native/preset types without altering identifiers', () => {
  setup();
  expect(screen.getByLabelText('题干')).toHaveValue(base.title);
  expect(screen.getByLabelText('题目标识（内部 ID）')).toHaveValue(base.name);
  expect(screen.getByText('基本设置')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '题目类型' }));
  const menu = screen.getByRole('listbox');
  for (const name of ['图片标注', '文字矩阵', '媒体选择', '成对偏好（A/B 滑块）', '视频关键时刻标记']) {
    expect(within(menu).getByRole('option', { name })).toBeInTheDocument();
  }
});

test('switching admin language retains edited question content and saved choice values', () => {
  const save = jest.fn();
  setup({ type: 'radiogroup', choices: [{ value: 'agree_original', text: 'Agree exactly as written' }] }, save);
  fireEvent.change(screen.getByLabelText('题干'), { target: { value: 'My revised question' } });
  expect(screen.getByText('Agree exactly as written')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('language'));
  expect(screen.getByLabelText('Question Title')).toHaveValue('My revised question');
  expect(screen.getByText('Basic Settings')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Question' }));
  expect(save.mock.calls[0][0]).toMatchObject({ name: base.name, title: 'My revised question', choices: [{ value: 'agree_original', text: 'Agree exactly as written' }] });
});

test('random folder scope can select specific folders and explicitly return to all media', () => {
  const save = jest.fn();
  setup({ type: 'imagepicker', randomImageSelection: true, imageSelectionMode: 'huggingface_random' }, save);
  const scope = screen.getByRole('combobox', { name: '随机抽取范围' });
  expect(screen.getByText('全部媒体（所有文件夹）')).toBeInTheDocument();
  fireEvent.mouseDown(scope);
  fireEvent.click(screen.getByRole('option', { name: 'photos', exact: true }));
  fireEvent.keyDown(scope, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }));
  expect(save.mock.calls[0][0]).toMatchObject({ mediaFolders: ['photos'], name: base.name, title: base.title });
  fireEvent.mouseDown(scope);
  fireEvent.click(screen.getByRole('option', { name: '全部媒体（所有文件夹）', exact: true }));
  fireEvent.keyDown(scope, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }));
  expect(save.mock.calls[1][0].mediaFolders).toEqual([]);
});

test('annotation settings and media sampling details are Chinese', () => {
  setup({ type: 'imageannotation', imageCount: 1, mediaAssignmentMode: 'category', trialCount: 2 });
  expect(screen.getByLabelText('每个分类抽取的文件数')).toBeInTheDocument();
  expect(screen.getByLabelText('轮次数（重复作答本题）')).toBeInTheDocument();
  expect(screen.getByLabelText('分类标签（可选）')).toBeInTheDocument();
  expect(screen.getByLabelText('最少标注数量')).toBeInTheDocument();
  expect(screen.getByText(/将展示 1 个文件/)).toBeInTheDocument();
  expect(screen.getByText(/2 轮作答/)).toBeInTheDocument();
});

test('per-trial category mode updates the saved media count and switches back to legacy all-category sampling', () => {
  const save = jest.fn();
  const categoryProject = {
    preloadedImages: [{ url: '/a.jpg', name: 'a.jpg', folder: 'a' }, { url: '/b.jpg', name: 'b.jpg', folder: 'b' }],
    imageDatasetConfig: { mediaFolderTags: { a: 'category', b: 'category' } },
  };
  render(<RegionProvider><QuestionEditor question={{ ...base, type: 'imagepicker', imageCount: 2, mediaAssignmentMode: 'category', mediaPerCategory: 1, trialCount: 2 }} currentProject={categoryProject} onSave={save} onCancel={jest.fn()} /></RegionProvider>);
  const mode = screen.getByRole('combobox', { name: '每轮分类抽取方式' });
  fireEvent.mouseDown(mode);
  fireEvent.click(screen.getByRole('option', { name: '每轮单个分类', exact: true }));
  expect(screen.getByLabelText('每轮抽取文件数')).toHaveValue(1);
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }));
  expect(save.mock.calls[0][0]).toMatchObject({ mediaCategoryMode: 'single', mediaPerCategory: 1, imageCount: 1, trialCount: 2 });
  fireEvent.mouseDown(mode);
  fireEvent.click(screen.getByRole('option', { name: '每轮多个分类（全部已选分类）', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }));
  expect(save.mock.calls[1][0]).toMatchObject({ mediaCategoryMode: 'all', mediaPerCategory: 1, imageCount: 2, trialCount: 2 });
});

test('matrix labels are translated while researcher row/column names stay unchanged', () => {
  setup({ type: 'matrix', rows: ['My row'], columns: [{ value: 'score_1', text: 'My answer' }] });
  expect(screen.getByText('行（评价项目）')).toBeInTheDocument();
  expect(screen.getByText('列（答案选项）')).toBeInTheDocument();
  expect(screen.getByLabelText('名称（参与者可见）')).toHaveValue('My answer');
  expect(screen.getByLabelText('存储值（用于数据记录）')).toHaveValue('score_1');
});

test('preset editor translates task labels, hints and counts, preserving participant wording', () => {
  setup({ type: 'skillquestion', skillId: 'preset_image_preference_forced', randomImageSelection: true, skillConfig: { prompt: 'Keep this instruction', leftLabel: 'Original A', rightLabel: 'Original B' } });
  expect(screen.getByLabelText('选项 A 文字')).toHaveValue('Original A');
  expect(screen.getByLabelText('交互区域内的作答说明')).toHaveValue('Keep this instruction');
  expect(screen.getByText(/固定展示 2 张图片（A 与 B）/)).toBeInTheDocument();
});

test('media slot controls translate their options while retaining stored slot values', () => {
  const save = jest.fn();
  setup({ type: 'mediapicker', mediaSlots: [{ id: 'slot_original', role: 'stimulus', selection: 'random', mediaType: 'image', count: 1 }] }, save);
  expect(screen.getByLabelText('素材位标识')).toHaveValue('slot_original');
  expect(screen.getByRole('combobox', { name: '用途' })).toHaveTextContent('主要素材');
  expect(screen.getByRole('combobox', { name: '选择方式' })).toHaveTextContent('随机抽取');
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }));
  expect(save.mock.calls[0][0].mediaSlots[0]).toMatchObject({ id: 'slot_original', role: 'stimulus', selection: 'random', mediaType: 'image' });
});

test('validation explains invalid scales in Chinese and preserves duplicate IDs in the message', () => {
  setup({ type: 'slidergroup', scaleMin: 8, scaleMax: 7, dimensions: [{ id: 'x', left: 'Low', right: 'High' }] });
  expect(screen.getByRole('button', { name: '量表最小值必须小于最大值。' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存题目' })).toBeDisabled();
  expect(questionSettingErrorText('choices: duplicate ID "original_id".', 'zh')).toBe('选项中存在重复标识“original_id”。');
});
