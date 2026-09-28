import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { ExpandMore, PlayArrow, Download } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { resolveSkillQuestions } from '../../lib/surveyMediaInjection';
import { runSurveyPreflight } from '../../lib/surveyPreflight';
import { downloadTextFile } from '../../lib/methodsExport';

export default function SurveyPreflight({ surveyConfig, currentProject }) {
  const { language } = useRegion(); const zh = language === 'zh';
  const [participants, setParticipants] = useState(5);
  const [report, setReport] = useState(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const sequence = useRef(0);
  useEffect(() => { sequence.current += 1; setReport(null); setBusy(false); setError(''); return () => { sequence.current += 1; }; }, [surveyConfig, currentProject?.id, currentProject?.preloadedImages, currentProject?.imageDatasetConfig?.mediaFolderTags]);
  const run = async () => {
    if (busy) return;
    const runId = ++sequence.current;
    setBusy(true); setError(''); setReport(null); setProgress(0);
    try {
      const config = JSON.parse(JSON.stringify(surveyConfig || {}));
      await resolveSkillQuestions(config);
      const result = await runSurveyPreflight(config, currentProject, { participants, cancelled: () => runId !== sequence.current,
        onProgress: (done) => { if (runId === sequence.current) setProgress(done); } });
      if (runId === sequence.current) setReport(result);
    } catch (err) { if (runId === sequence.current) setError(err.message); }
    finally { if (runId === sequence.current) setBusy(false); }
  };
  const issues = report && (report.validation.errors.length + report.validation.warnings.length + report.questions.filter((q) => q.missing || q.reused || q.warnings.length).length);
  return <Box sx={{ p: { xs: 2, sm: 3 }, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 0 }}>
    <Typography variant="h6">{zh ? '发出问卷前，先试跑一次' : 'Run a check before sharing'}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{zh ? '检查媒体分配、轮数及示例答案的分析导出。只在浏览器生成测试数据，不保存为正式答卷。' : 'Check media assignment, trials and example-answer exports. Test data stays in this browser and is never submitted.'}</Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', my: 2 }}>
      <TextField size="small" type="number" label={zh ? '模拟人数' : 'Simulated participants'} value={participants} disabled={busy}
        onChange={(e) => setParticipants(e.target.value)} inputProps={{ min: 1, max: 50 }} sx={{ width: 160 }} />
      <Button variant="contained" startIcon={busy ? <CircularProgress size={16} /> : <PlayArrow />} onClick={run} disabled={busy || !surveyConfig || Number(participants) < 1 || Number(participants) > 50} sx={{ minHeight: 44 }}>
        {busy ? `${zh ? '检查中' : 'Checking'} ${progress}/${participants}` : zh ? '开始试运行' : 'Run check'}
      </Button>
      {busy && <Button onClick={() => { sequence.current += 1; setBusy(false); }} sx={{ minHeight: 44 }}>{zh ? '取消' : 'Cancel'}</Button>}
    </Box>
    {error && <Alert severity="error">{error}</Alert>}
    {report && <>
      <Alert severity={issues ? 'warning' : 'success'} sx={{ mb: 1 }}>{zh ? `已模拟 ${report.participants} 人、${report.assignments} 轮。${issues ? '请检查下面的提醒。' : '本次配置分配与示例导出检查通过。'}` : `${report.participants} participants · ${report.assignments} configured rounds checked. ${issues ? 'Review the notes below.' : 'Assignment and example-export checks passed.'}`}</Alert>
      <Typography variant="caption" component="p" sx={{ mb: 1 }}>{zh ? '此检查不验证媒体能否实际打开、不执行自定义 HTML、不预测真实回答或完成时间。正式分享前仍需体验参与者预览。' : 'This does not fetch media, execute custom HTML, or predict real answers or completion time. Also test the participant preview.'}</Typography>
      {[...report.validation.errors, ...report.validation.warnings].map((v, i) => <Typography key={i} variant="body2">{v.path}: {v.message}</Typography>)}
      {report.questions.map((q, i) => <Accordion key={`${q.name}_${i}`} disableGutters sx={{ minWidth: 0 }}>
        <AccordionSummary expandIcon={<ExpandMore />} sx={{ '& .MuiAccordionSummary-content': { minWidth: 0 } }}>
          <Typography sx={{ overflowWrap: 'anywhere' }}>{i + 1}. {typeof q.title === 'string' ? q.title : q.name} · {q.missing || q.reused || q.warnings.length ? (zh ? '需检查' : 'Review') : (zh ? '已检查' : 'Checked')}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ minWidth: 0 }}>
          <Typography variant="body2">{zh ? `每人 ${q.rounds} 轮 · 展示 ${Object.keys(q.exposures).length} 份不同媒体 · 导出 ${q.exportRows} 行` : `${q.rounds} rounds/person · ${Object.keys(q.exposures).length} distinct media · ${q.exportRows} export rows`}</Typography>
          {!!q.missing && <Alert severity="error" sx={{ mt: 1 }}>{zh ? `${q.missing} 轮没有分配到足够媒体。检查媒体数量、文件类型和文件夹标签。` : `${q.missing} rounds could not assign enough media. Check pool size, types and folder tags.`}</Alert>}
          {!!q.reused && <Alert severity="warning" sx={{ mt: 1 }}>{zh ? `检测到 ${q.reused} 次重复展示。当前媒体池可能无法满足“不重复”的设置。` : `${q.reused} repeated exposures detected despite excluding reuse. The media pool may be too small.`}</Alert>}
          {q.warnings.map((w) => <Typography key={w} variant="body2" sx={{ mt: 1 }}>• {w}</Typography>)}
          {q.example !== undefined && <Box component="pre" sx={{ p: 1, bgcolor: 'grey.100', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(q.example, null, 2)}</Box>}
          {!!q.headers.length && <Typography variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>{zh ? '导出字段：' : 'Export fields: '}{q.headers.join(', ')}</Typography>}
        </AccordionDetails>
      </Accordion>)}
      <Button startIcon={<Download />} sx={{ mt: 2, minHeight: 44 }} onClick={() => downloadTextFile(JSON.stringify(report, null, 2), 'survey-test-report.json', 'application/json')}>{zh ? '下载测试报告（含模拟答卷）' : 'Download test report with simulated answers'}</Button>
    </>}
  </Box>;
}
