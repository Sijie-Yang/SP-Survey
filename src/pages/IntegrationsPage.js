import React, { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useNavigate } from 'react-router-dom';
import { useRegion } from '../contexts/RegionContext';
import { uiPair } from '../lib/uiLanguages';
import { API_BASE_URL } from '../lib/apiConfig';
import ModelsSettings from '../components/admin/ModelsSettings';

function CopyBox({ value, onCopy }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        sx={{
          m: 0, p: 2, pr: 6, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
          borderRadius: 1, overflow: 'auto', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </Box>
      <IconButton size="small" onClick={() => onCopy(value)} aria-label="copy" sx={{ position: 'absolute', top: 8, right: 8 }}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

/**
 * Self-hosted AI & Integrations: model keys for the in-browser Assistant, and the
 * localhost agent API that Codex / Claude Code use to edit the same projects.
 */
export default function IntegrationsPage() {
  const { t, language } = useRegion();
  const navigate = useNavigate();
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState(null);
  const agentUrl = `${API_BASE_URL}/api/agent`;

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ severity: 'info', text: uiPair(language, 'Copied.', '已复制。') });
    } catch {
      setMessage({ severity: 'warning', text: uiPair(language, 'Copy failed. Select the text instead.', '复制失败，请手动选中文字。') });
    }
  };

  const agentPrompt = uiPair(
    language,
    `Use the SP-Survey local agent API at ${agentUrl} (GET it first for the list of endpoints).\nOpen my current project, then make this change: <describe the change>.\nValidate it and give me the local Admin and Live Survey links.`,
    `使用 SP-Survey 本地 agent API：${agentUrl}（先 GET 它查看接口列表）。\n打开我当前的项目，然后做这个修改：<描述修改>。\n校验后给我本地 Admin 和线上问卷预览的链接。`,
  );

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin')} sx={{ mb: 2 }}>
        {t.integBackAdmin}
      </Button>
      <Typography variant="h4" gutterBottom>{t.integTitle}</Typography>

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      <Stack spacing={3}>
        <Card variant="outlined" sx={{ borderColor: 'primary.main', borderWidth: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">{t.integAssistantTitle}</Typography>
              <Chip label={t.integRecommended} color="primary" size="small" />
              {configured && <Chip icon={<CheckCircleIcon />} label={t.integReady} color="success" size="small" />}
            </Stack>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {uiPair(
                language,
                'Keys are stored by your local SP-Survey server, never in the project files. There are no free or subsidized models.',
                'API key 由你本机的 SP-Survey 服务保存，不会写进项目文件。没有免费或补贴的模型。',
              )}
            </Typography>
            <ModelsSettings onConfiguredChange={(status) => setConfigured(Boolean(status?.openai?.configured || status?.configured))} />
            <Button variant="outlined" onClick={() => navigate('/admin')} sx={{ mt: 2 }}>
              {t.openSurveyBuilder}
            </Button>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">{uiPair(language, '2. Codex, Claude Code or Cursor on this computer', '2. 本机的 Codex、Claude Code 或 Cursor')}</Typography>
              <Chip label={t.integAdvanced} size="small" />
            </Stack>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {uiPair(
                language,
                'Open the SP-Survey folder in your coding agent while npm run dev is running. It edits the same local projects through the localhost-only agent API, with the same checks and a backup before every write. Never give it your Supabase keys.',
                '在 npm run dev 运行时，用编程 agent 打开 SP-Survey 文件夹。它通过只在本机可用的 agent API 编辑同一批本地项目，检查规则相同，每次写入前都会备份。不要把 Supabase 密钥交给它。',
              )}
            </Typography>
            <CopyBox value={agentPrompt} onCopy={copy} />
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
