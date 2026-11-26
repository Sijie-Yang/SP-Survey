import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { CheckCircle, ContentCopy, GroupAddOutlined, QrCode2 } from '@mui/icons-material';
import SurveyQrCode from '../admin/SurveyQrCode';
import RecruitmentSettings from '../admin/RecruitmentSettings';
import RecruitmentLinks from '../admin/RecruitmentLinks';
import { surveyShareUrl } from '../../lib/publicSlug';
import { resolveShareSurveyUrl } from '../../lib/shareSurveyUrl';
import { StudioCard, useL } from './studioUi';

/**
 * The participant link, its QR code, recruitment platforms and a short link.
 * `status` is projectStatus(): there is a link as soon as participants can open
 * the survey (live, published or with changes waiting).
 * `onSaveConfig(patch)` saves fields of the survey config (queued by the project screen).
 */
export default function StudioLinkCard({ project, config, status, localMode = false, onSaveConfig }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState('');
  // The recruitment setting as the researcher edits it. Saves run in the
  // background and never reset what is being typed.
  const [recruitment, setRecruitment] = useState(config?.recruitment);
  const recruitmentConfig = useMemo(() => ({ ...config, recruitment }), [config, recruitment]);
  const state = status?.state || 'draft';
  const hasLink = localMode || state !== 'draft';
  const origin = window.location.origin;
  // Self-hosted: the deployed link once the study is deployed (Host tab), else the local test link.
  const local = localMode ? resolveShareSurveyUrl({ deployedParticipantUrl: project.deployedParticipantUrl, projectId: project.id, origin }) : null;
  const url = local ? local.url : surveyShareUrl(origin, { id: project.id, publicSlug: project.publicSlug });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The link stays selectable on screen.
    }
  };

  const openMore = () => {
    setRecruitment(config?.recruitment);
    setDialog('more');
  };

  const changeRecruitment = (field, value) => {
    if (field !== 'recruitment') return;
    setRecruitment(value);
    onSaveConfig({ recruitment: value });
  };

  return (
    <StudioCard title={L('Link', '链接')} data-testid="studio-link">
      {!hasLink ? (
        <Box sx={{ bgcolor: 'action.hover', borderRadius: '8px', px: 1.5, py: 1.25 }}>
          <Typography variant="body2" color="text.secondary">
            {L('After you publish, the participant link and QR code appear here.', '发布后这里出现参与者链接和二维码。')}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.hover', borderRadius: '8px', pl: 1.5, pr: 0.5, py: 0.5 }}>
            <Typography
              component="a"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="studio-share-url"
              sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, wordBreak: 'break-all', color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {url}
            </Typography>
            <Tooltip title={copied ? L('Copied', '已复制') : L('Copy link', '复制链接')}>
              <IconButton size="small" onClick={copy} aria-label={L('Copy link', '复制链接')}>
                {copied ? <CheckCircle color="success" fontSize="small" /> : <ContentCopy fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
          {local && !local.isDeployed && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="studio-link-local">
              {L('This link works on this computer only. Deploy the study on the Host tab to get a link for participants.', '这个链接只能在本机打开。在「部署」页部署后才有发给参与者的链接。')}
            </Typography>
          )}
          {!localMode && state === 'live' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="studio-link-live">
              {L('Participants see the latest saved version.', '参与者打开链接看到的是最新保存的版本。')}
            </Typography>
          )}
          {!localMode && state === 'pending' && (
            <Typography variant="body2" color="warning.dark" sx={{ mt: 1 }} data-testid="studio-link-pending">
              {L(`Participants now see v${status.version}. Your changes take effect after you publish.`, `参与者现在看到的是 v${status.version}；你的修改发布后才生效。`)}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            <Button size="small" variant="outlined" startIcon={<QrCode2 />} onClick={() => setDialog('qr')}>
              {L('QR code', '二维码')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<GroupAddOutlined />} onClick={openMore}>
              {L('Recruitment platforms', '招募平台')}
            </Button>
          </Box>
        </>
      )}

      <Dialog open={dialog === 'qr'} onClose={() => setDialog('')} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('QR code', '二维码')}</DialogTitle>
        <DialogContent>
          <SurveyQrCode surveyUrl={url} projectId={project.id} projectName={project.name} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog('')}>{L('Done', '完成')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'more'} onClose={() => setDialog('')} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('Recruitment platforms', '招募平台')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RecruitmentSettings config={recruitmentConfig} onChange={changeRecruitment} hideClassicHints />
          {recruitment?.platform && (
            <RecruitmentLinks surveyUrl={url} surveyConfig={recruitmentConfig} projectId={project.id} hideClassicHints />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog('')}>{L('Done', '完成')}</Button>
        </DialogActions>
      </Dialog>
    </StudioCard>
  );
}
