import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { Close, DownloadOutlined, InsightsOutlined } from '@mui/icons-material';
import { countStudioResponses } from '../../lib/studioData';
import { downloadStudioResults } from '../../lib/studioResults';
import { StudioCard, useL } from './studioUi';

const ResultsAnalysis = lazy(() => import('../admin/ResultsAnalysis'));

/**
 * Response count, one-click download, and the full analysis in a dialog. The
 * count is what the download holds (practice runs only when the survey
 * includes them). `status` is projectStatus(); `onProjectUpdated(patch)`
 * receives what the analysis saved on the project.
 */
export default function StudioResultsCard({ project, config, status, localMode = false, onProjectUpdated }) {
  const L = useL();
  const [count, setCount] = useState(undefined);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const includePractice = config?.includeResearcherPractice === true;
  useEffect(() => {
    let cancelled = false;
    setCount(undefined);
    countStudioResponses(project.id, { includeResearcherPractice: includePractice })
      .then((n) => { if (!cancelled) setCount(n); })
      .catch(() => { if (!cancelled) setCount(null); });
    return () => { cancelled = true; };
  }, [project.id, includePractice]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadStudioResults({ project, config });
    } catch (err) {
      setError(L(`The data could not be downloaded: ${err?.message || err}`, `下载数据失败：${err?.message || err}`));
    } finally {
      setDownloading(false);
    }
  };

  const none = count === 0;
  const canOpen = localMode || (status?.state && status.state !== 'draft');

  return (
    <StudioCard title={L('Results', '结果')} data-testid="studio-results">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography component="span" sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }} data-testid="studio-response-count">
          {count === undefined ? <CircularProgress size={20} aria-label={L('Loading', '加载中')} /> : (count ?? '–')}
        </Typography>
        <Typography component="span" variant="body2" color="text.secondary">{L('responses', '份回答')}</Typography>
      </Box>
      {none ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {canOpen
            ? L('No responses yet. Send the link to participants.', '还没有回答。把链接发给参与者。')
            : L('No responses yet. After you publish, send the link to participants.', '还没有回答。发布后把链接发给参与者。')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          <Button size="small" variant="outlined" startIcon={<DownloadOutlined />} onClick={download} disabled={downloading || count === undefined}>
            {downloading ? L('Preparing…', '正在准备…') : L('Download data', '下载数据')}
          </Button>
          <Button size="small" variant="outlined" startIcon={<InsightsOutlined />} onClick={() => setOpen(true)} disabled={count === undefined}>
            {L('View analysis', '查看分析')}
          </Button>
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}

      <Dialog fullScreen open={open} onClose={() => setOpen(false)}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
              {L(`Results · ${project.name || ''}`, `结果 · ${project.name || ''}`)}
            </Typography>
            <Tooltip title={L('Close', '关闭')}>
              <IconButton edge="end" onClick={() => setOpen(false)} aria-label={L('Close', '关闭')}><Close /></IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
        <Box sx={{ p: { xs: 1.5, sm: 3 }, bgcolor: 'background.default', flex: 1 }}>
          {open && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress aria-label={L('Loading', '加载中')} /></Box>}>
              <ResultsAnalysis currentProject={project} surveyConfig={config} onProjectUpdated={onProjectUpdated} />
            </Suspense>
          )}
        </Box>
      </Dialog>
    </StudioCard>
  );
}
