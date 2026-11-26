import React, { useContext, useMemo, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import SpSiteFrame from '../SpSiteFrame';
import { buildSiteQuestions, siteMatchLevel, siteMediaFolders, sitePreviewMediaFolders } from '../../lib/spSite';
import { applyPageState, captureRecord, pageSaysFinished } from '../SpSiteSurvey';
import { RegionContext } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';

const VIEWPORT_WIDTH = { mobile: 390, tablet: 820 };

/**
 * Builder preview of an SP-Scheme site: the same page participants get, with
 * media drawn the same way. Answers are checked and shown, never submitted.
 * `hideImportNotice` drops the long notice about how the page was imported
 * (Studio says it in its own words) and instead says in one line when the
 * preview shows the platform's sample images.
 */
export default function SpSitePreview({ config: baseConfig, spSite, mediaPool = [], previewLibrary = false, viewport = 'desktop', height = '78vh', hideImportNotice = false }) {
  const language = useContext(RegionContext)?.language || 'en';
  const L = (en, zh) => uiPair(language, en, zh);
  // Memoized so media are drawn once per preview run, not on every render.
  const config = useMemo(() => ({ ...baseConfig, spSite: spSite || baseConfig?.spSite }), [baseConfig, spSite]);
  const [run, setRun] = useState(0);
  const questions = useMemo(() => buildSiteQuestions(config), [config, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState({});
  const [completed, setCompleted] = useState(false);
  const [problems, setProblems] = useState([]);
  const [captured, setCaptured] = useState([]);
  const [pageState, setPageState] = useState({});
  const media = useMemo(() => (previewLibrary ? sitePreviewMediaFolders(mediaPool, config) : siteMediaFolders(mediaPool, config)), [mediaPool, previewLibrary, config]);
  const match = useMemo(() => siteMatchLevel(config), [config]);
  const converted = Boolean(config?.spSite?.convertedFrom);
  const width = VIEWPORT_WIDTH[viewport] || '100%';

  const restart = () => {
    setAnswers({});
    setCompleted(false);
    setProblems([]);
    setCaptured([]);
    setPageState({});
    setRun((n) => n + 1);
  };

  return (
    <Box data-testid="sp-site-preview">
      {hideImportNotice && previewLibrary && (
        <Alert severity="info" sx={{ mb: 1.5 }} data-testid="sp-site-sample-images">
          {L("The preview uses the platform's sample images. Upload your own images.", '预览用的是平台示例图片，请上传自己的图片。')}
        </Alert>
      )}
      {!hideImportNotice && <Alert severity={!converted && match.level === 'full' ? 'info' : 'warning'} sx={{ mb: 1.5 }} data-testid="sp-site-match">
        {converted && L(
          'This page was imported as it is (it does not match SP-Scheme). Participants see exactly this page; what it saves and sends is recorded as it is and nothing is analysed, so export the records and analyse them yourself. Nothing is submitted from the preview.',
          '这个页面是原样导入的（不符合 SP-Scheme）。参与者看到的就是这个页面；它保存和发出的数据原样记录，平台不做分析，请导出记录后自行分析。预览不会提交数据。',
        )}
        {!converted && match.level === 'full' && L(
          `This page was imported with SP-Scheme. Participants see exactly this page; all ${match.total} questions use platform types and can be analysed on the Results page. Nothing is submitted from the preview.`,
          `这个页面由 SP-Scheme 导入。参与者看到的就是这个页面；全部 ${match.total} 道题都是平台题型，可在结果页分析。预览不会提交数据。`,
        )}
        {!converted && match.level === 'partial' && L(
          `This page was imported with SP-Scheme. ${match.native} question(s) use platform types and can be analysed; ${match.custom} are recorded as the page sends them (type "custom") and must be analysed by you from the export.`,
          `这个页面由 SP-Scheme 导入。${match.native} 道题是平台题型，可以分析；另外 ${match.custom} 道题按页面自己的格式原样记录（custom），平台不分析，需要你导出后自行处理。`,
        )}
        {!converted && match.level === 'custom' && L(
          `This page was imported with SP-Scheme. All ${match.total} questions are recorded as the page sends them (type "custom"): the platform stores and exports them but does not analyse them.`,
          `这个页面由 SP-Scheme 导入。全部 ${match.total} 道题按页面自己的格式原样记录（custom）：平台只保存和导出，不做分析，需要你自行处理。`,
        )}
        {!converted && match.level === 'none' && L(
          'This page declares no questions. The platform records every request the page sends, as it is, and exports it; nothing is analysed. Participants finish with the bar under the page, or when the page sends its own "finish" request.',
          '这个页面没有声明任何题目。平台会原样记录页面发出的每个请求并导出，不做任何分析。参与者通过页面下方的提交栏完成，或者页面自己发出“完成”请求时自动完成。',
        )}
      </Alert>}
      {problems.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="sp-site-problems">
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {L(
              'The page reported problems. If it is stuck, send these lines back to the model that built it.',
              '页面报告了以下问题。如果页面卡住，请把这些内容发回给生成页面的模型修正。',
            )}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 13, wordBreak: 'break-word' }}>
            {problems.map((p) => <li key={p.message}>{p.message}</li>)}
          </Box>
        </Alert>
      )}
      <Box sx={{ width, maxWidth: '100%', height, mx: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <SpSiteFrame
          key={run}
          html={config.spSite.html}
          allowedHosts={config.spSite.allowedHosts || []}
          questions={questions}
          media={media}
          survey={{ title: config.title || '', description: config.description || '', language: config.locale || 'en', preview: true }}
          onAnswer={(name, stored) => setAnswers((prev) => {
            const next = { ...prev };
            if (stored == null) delete next[name];
            else next[name] = stored;
            return next;
          })}
          onComplete={() => setCompleted(true)}
          onProblem={(p) => setProblems((prev) => (prev.some((x) => x.message === p.message) ? prev : [...prev, p].slice(-20)))}
          onCapture={(request) => setCaptured((prev) => [...prev, captureRecord(request)].slice(-200))}
          onState={(area, key, value) => {
            setPageState((prev) => applyPageState(prev, area, key, value));
            if ((converted || match.level === 'none') && area !== 'sp-media' && pageSaysFinished(value)) setCompleted(true);
          }}
          title={config.title || 'Survey preview'}
        />
      </Box>
      <Box sx={{ mt: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {completed
              ? L('Preview finished: the participant would now submit these answers, and the page stays on screen.', '预览完成：参与者此时会自动提交这些数据，页面保持显示。')
              : L('Recorded so far', '目前记录的数据')}
          </Typography>
          <Button size="small" onClick={restart}>{L('Restart', '重新开始')}</Button>
        </Box>
        {questions.length > 0 ? (
          <Box
            component="pre"
            data-testid="sp-site-preview-answers"
            sx={{ m: 0, maxHeight: 240, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {Object.keys(answers).length ? JSON.stringify(answers, null, 2) : L('(no answers yet)', '（还没有答案）')}
          </Box>
        ) : !Object.keys(pageState).length && !captured.length && (
          <Typography variant="body2" color="text.secondary">
            {L('Nothing recorded yet. What the page saves and sends appears here as you answer.', '还没有记录。作答时，页面保存和发出的数据会显示在这里。')}
          </Typography>
        )}
        {Object.keys(pageState).length > 0 && (
          <Box sx={{ mt: 1.5 }} data-testid="sp-site-preview-state">
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {L('What the page saved (its own storage, latest value)', '页面自己保存的数据（最新一版）')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {L('Stored on each response under __sp_page_state and included in the export.', '存在每份回答的 __sp_page_state 里并随导出一起输出。')}
            </Typography>
            <Box component="pre" sx={{ m: 0, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(pageState, null, 2)}
            </Box>
          </Box>
        )}
        {(captured.length > 0 || match.level === 'none') && (
          <Box sx={{ mt: 1.5 }} data-testid="sp-site-preview-captured">
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {L(`Requests recorded as sent by the page (${captured.length})`, `页面发出、原样记录的请求（${captured.length} 条）`)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {L('Stored on each response under __sp_requests and included in the export; the platform does not analyse them.', '存在每份回答的 __sp_requests 里并随导出一起输出；平台不分析这些数据。')}
            </Typography>
            <Box component="pre" sx={{ m: 0, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {captured.length ? JSON.stringify(captured, null, 2) : L('(nothing recorded yet)', '（还没有记录）')}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
