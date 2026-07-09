import React, { useState } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Alert, CircularProgress, Stack,
} from '@mui/material';
import { AutoAwesome, Send } from '@mui/icons-material';
import { generateSkillWithAi } from '../../lib/skillAiApi';

/**
 * AI assistant for creating/editing skills — lives on Skill Editor & Library (not Survey Builder).
 */
export default function SkillAiPanel({
  apiKey,
  currentSkill = null,
  onApply,
  compact = false,
}) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastReply, setLastReply] = useState('');

  const send = async () => {
    const text = message.trim();
    if (!text || !apiKey) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await generateSkillWithAi({
        message: text,
        apiKey,
        currentSkill,
        conversationHistory: history,
      });
      if (!result.success) throw new Error(result.error || 'AI request failed');
      const assistantMsg = result.message || 'Skill draft generated.';
      setLastReply(assistantMsg);
      setHistory((h) => [
        ...h,
        { role: 'user', content: text },
        { role: 'assistant', content: assistantMsg },
      ]);
      if (result.skill && onApply) onApply(result.skill);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Add your OpenAI API key in Survey Builder → AI Assistant settings to use AI skill generation.
        Keys are stored locally in your browser.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <AutoAwesome color="primary" fontSize="small" />
        <Typography variant="subtitle2" fontWeight={700}>
          AI Skill Assistant
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {currentSkill
          ? 'Describe changes to this skill — e.g. add a 1–7 safety scale, change prompt text, or support 3 images.'
          : 'Describe the question you want — e.g. "Rate street images on safety and beauty with semantic differential scales".'}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {lastReply && !compact && (
        <Alert severity="success" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>{lastReply}</Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={2}
          placeholder={currentSkill ? 'Adjust this skill…' : 'Create a new skill…'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          disabled={loading}
        />
        <Button
          variant="contained"
          onClick={send}
          disabled={loading || !message.trim()}
          sx={{ minWidth: 48 }}
        >
          {loading ? <CircularProgress size={22} color="inherit" /> : <Send />}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        Cmd/Ctrl + Enter to send. Review generated HTML before saving.
      </Typography>
    </Paper>
  );
}
