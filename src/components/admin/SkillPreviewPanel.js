import React, { lazy, Suspense, useState } from 'react';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import SkillQuestionFrame, { skillAnswerPresent } from '../SkillQuestionWidget';
import { getPresetSkill } from '../../lib/presetSkills';
import { useRegion } from '../../contexts/RegionContext';
import { checkAnswerAgainstResultSchema, SKILL_RESULT_TYPES } from '../../lib/skillResultTypes';

const NativeResultPreview = lazy(() => import('./ResultsAnalysis').then(({ QuestionCard, buildQuestionCardProps }) => ({
  default: function Preview({ skill, answer, images }) {
    const question = { name: 'preview', title: skill.name || 'Preview', type: 'skillquestion',
      skillId: skill.id || 'custom_preview', skillResultSchema: skill.resultSchema || [], skillConfig: skill.defaultConfig || {} };
    const responses = [{ id: 'preview', participant_id: 'preview', responses: {
      preview: { answer, shown_images: images.map((m) => m.url || m) },
    } }];
    return <QuestionCard {...buildQuestionCardProps(question, responses, { surveyConfig: { pages: [{ elements: [question] }] } })} />;
  },
})));

export function SkillResultPreview({ skill, answer, images = [] }) {
  const { language } = useRegion();
  const zh = language === 'zh';
  const check = checkAnswerAgainstResultSchema(answer, skill.resultSchema, skill.defaultConfig);
  const preset = getPresetSkill(String(skill.id || '').replace(/^preset_/, ''));
  const valid = preset ? skillAnswerPresent(answer) : check.recorded && check.fields.every((f) => f.ok);
  return (
    <Box sx={{ mt: 2, minWidth: 0 }}>
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} sx={{ mb: 1 }}>
        {(skill.resultSchema || []).map((f) => <Chip key={f.key} size="small"
          label={`${f.label || f.key}: ${f.type} → ${SKILL_RESULT_TYPES[f.type]?.analysis || 'legacy'}`} />)}
      </Stack>
      {answer != null && !valid && <Alert severity="warning">{check.fields.filter((f) => !f.ok).map((f) => `${f.key}: ${f.detail}`).join('; ')}</Alert>}
      {valid && <>
        <Alert severity="info" sx={{ mb: 1 }}>{zh ? '以下仅使用本次试答展示正式分析与导出，不会保存答卷。单条试答不能说明统计可靠性。' : 'Analysis and export below use only this test answer. No response is saved; one test answer cannot establish statistical reliability.'}</Alert>
        <Suspense fallback={<Typography>{zh ? '加载分析预览…' : 'Loading analysis preview…'}</Typography>}>
          <NativeResultPreview skill={skill} answer={answer} images={images} />
        </Suspense>
      </>}
    </Box>
  );
}

export default function SkillPreviewPanel({ skill, images = [] }) {
  const [answer, setAnswer] = useState(null);
  return <>
    <SkillQuestionFrame skillHtml={skill.sourceHtml} skillId={skill.id} config={skill.defaultConfig || {}}
      images={images} resultSchema={skill.resultSchema} value={answer} onChange={setAnswer} />
    <SkillResultPreview skill={skill} answer={answer} images={images} />
  </>;
}
