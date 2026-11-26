import React, { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { PhoneIphone } from '@mui/icons-material';
import SurveyQrCode from './SurveyQrCode';
import { surveyShareUrl } from '../../lib/publicSlug';
import { uiPair } from '../../lib/uiLanguages';

/** Builder shortcut: scan to open the participant link on a phone. */
export default function PhonePreviewButton({ project, language }) {
  const [open, setOpen] = useState(false);
  if (!project?.id) return null;
  const L = (en, zh) => uiPair(language, en, zh);
  const url = surveyShareUrl(window.location.origin, { id: project.id, publicSlug: project.publicSlug || '' });
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  return <>
    <Button size="small" variant="outlined" startIcon={<PhoneIphone />} onClick={() => setOpen(true)}>
      {L('View on phone', '手机上看')}
    </Button>
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{L('View on your phone', '在手机上看')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          {open && <SurveyQrCode key={url} surveyUrl={url} projectId={project.id} projectName={project.name} />}
        </Box>
        <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', mb: 1.5 }}>{url}</Typography>
        <Typography variant="body2" color="text.secondary">
          {project.releaseManaged
            ? L(`This opens the participant link, which shows the published version (v${project.publishedVersion}). Publish a new version to see your latest edits on the phone.`,
              `扫码打开的是参与者链接，显示已发布的版本（v${project.publishedVersion}）。要在手机上看最新修改，先发布新版本。`)
            : L('This opens the participant link. Saved changes show up right away; answers you submit count as real responses, so delete them in Results afterwards.',
              '扫码打开的是参与者链接，保存后的修改立即可见。在手机上提交的回答会算作真实回答，看完请到结果页删掉。')}
        </Typography>
        {local && <Alert severity="info" sx={{ mt: 2 }}>{L('This address is on your computer only; a phone cannot open it.', '这是本机地址，手机打不开。')}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(false)}>{L('Close', '关闭')}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
