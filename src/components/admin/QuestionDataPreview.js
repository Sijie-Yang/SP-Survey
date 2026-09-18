import React, { useMemo } from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { questionExample, displayOnly } from '../../lib/questionExample';
import { buildQuestionLongTable } from '../../lib/questionSummaryExport';
import { filterPoolForQuestion, defaultMediaCount, isRandomMediaQuestion, applyMediaToElement, resolveCuratedImages, isCuratedMediaMode } from '../../lib/surveyMediaInjection';
import { getPresetSkill } from '../../lib/presetSkills';

export default function QuestionDataPreview({ question, currentProject }) {
  const { language } = useRegion(); const zh = language === 'zh';
  const data = useMemo(() => {
    try {
      const q = JSON.parse(JSON.stringify(question));
      if (q.type === 'skillquestion' && q.skillId?.startsWith('preset_')) {
        const preset = getPresetSkill(q.skillId.slice(7));
        q.skillConfig = { ...preset?.defaultConfig, ...q.skillConfig };
      }
      const pool = currentProject?.preloadedImages || [];
      const media = !isRandomMediaQuestion(q) ? [] : isCuratedMediaMode(q) ? resolveCuratedImages(q, pool) : filterPoolForQuestion(pool, q).slice(0, q.imageCount || defaultMediaCount(q));
      applyMediaToElement(q, media);
      const example = questionExample(q, media);
      const table = buildQuestionLongTable(q, [], { pages: [{ elements: [q] }] });
      return { example, headers: table?.headers || [] };
    } catch { return { headers: [] }; }
  }, [question, currentProject?.preloadedImages]);
  if (displayOnly(question)) return null;
  return <Accordion disableGutters sx={{ mt: 2, minWidth: 0 }}>
    <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="subtitle2">{zh ? '答案与导出示例' : 'Answer and export example'}</Typography></AccordionSummary>
    <AccordionDetails sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{zh ? '这是数据格式示例，不是真实答案。多轮题会逐轮保存答案及当时展示的媒体。完整分配检查在“分享问卷”页运行。' : 'A data-format example, not a real answer. Multi-trial questions save each answer with its shown media. Run the full assignment check on Share Survey.'}</Typography>
      {data.example === undefined ? <Typography sx={{ mt: 1 }} variant="body2">{zh ? '请先补齐媒体或任务设置，再通过参与者预览验证答案。' : 'Complete the media/task settings and verify the answer in participant preview.'}</Typography>
        : <Box component="pre" sx={{ p: 1, bgcolor: 'grey.100', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(data.example, null, 2)}</Box>}
      <Typography variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>{zh ? '长表字段：' : 'Long-table fields: '}{data.headers.join(', ') || '—'}</Typography>
    </AccordionDetails>
  </Accordion>;
}
