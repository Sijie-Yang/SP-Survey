import React, { useCallback, useRef, useState } from 'react';
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AutoAwesome, ListAlt } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';

/** `L(en, zh)` in the researcher's language. */
export function useL() {
  const { language } = useRegion();
  return useCallback((en, zh) => uiPair(language, en, zh), [language]);
}

/**
 * One write at a time: `queue(task)` runs `task` after every task queued
 * before it, and `busy` is true while any task waits or runs.
 */
export function useWriteQueue() {
  const tail = useRef(Promise.resolve());
  const [pending, setPending] = useState(0);
  const queue = useCallback((task) => {
    setPending((n) => n + 1);
    const run = tail.current.then(() => task());
    tail.current = run.catch(() => {});
    return run.finally(() => setPending((n) => n - 1));
  }, []);
  return { busy: pending > 0, queue };
}

export const SOFT_SHADOW = '0 2px 12px rgba(0,0,0,0.06)';

/** A Studio card: white, rounded, with a soft shadow (homepage style). */
export function StudioCard({ title, action = null, children, sx = {}, ...rest }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: '16px',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: SOFT_SHADOW,
        minWidth: 0,
        ...sx,
      }}
      {...rest}
    >
      {(title || action) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, minHeight: 32 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{title}</Typography>
          {action}
        </Box>
      )}
      {children}
    </Paper>
  );
}

const STATUS_TONE = { draft: 'warning', pending: 'warning', published: 'success', live: 'success' };

/** Draft / live / published / changes waiting, as a small soft chip. */
export function StatusChip({ status, long = false, size = 'small' }) {
  const L = useL();
  const { state, version } = status || { state: 'draft', version: 0 };
  const label = {
    draft: long ? L('Draft, not published yet', '草稿，还没发布') : L('Draft', '草稿'),
    live: long ? L('Live · saves go live', '已上线 · 保存即生效') : L('Live', '已上线'),
    published: long ? L(`Published v${version}`, `已发布 v${version}`) : L('Published', '已发布'),
    pending: long ? L('Changes not published yet', '有改动还没发布') : L('Changed', '有改动'),
    local: L('Local', '本地'),
  }[state];
  const tone = STATUS_TONE[state];
  return (
    <Chip
      size={size}
      label={label}
      data-testid={long ? 'studio-status' : 'studio-list-status'}
      sx={(theme) => ({
        fontWeight: 600,
        flexShrink: 0,
        height: size === 'small' ? 22 : 28,
        fontSize: size === 'small' ? 11.5 : 13,
        bgcolor: tone ? alpha(theme.palette[tone].main, 0.12) : theme.palette.action.selected,
        color: tone ? theme.palette[tone].dark : theme.palette.text.secondary,
        ...(state === 'draft' && !long ? { bgcolor: theme.palette.action.selected, color: theme.palette.text.secondary } : {}),
      })}
    />
  );
}

/** A tiny icon telling an AI page from a classic (question by question) survey. */
export function KindIcon({ kind, sx = {} }) {
  const L = useL();
  if (kind === 'page') {
    return (
      <Tooltip title={L('Page built by an AI', 'AI 做的页面')}>
        <AutoAwesome aria-label={L('Page built by an AI', 'AI 做的页面')} sx={{ fontSize: 15, color: 'primary.main', flexShrink: 0, ...sx }} />
      </Tooltip>
    );
  }
  if (kind === 'classic') {
    return (
      <Tooltip title={L('Built question by question', '逐题搭建')}>
        <ListAlt aria-label={L('Built question by question', '逐题搭建')} sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0, ...sx }} />
      </Tooltip>
    );
  }
  return null;
}

/** Download text as a file (used when the clipboard is unavailable). */
export function downloadTextFile(filename, text, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy to the clipboard; download the text instead when that fails. Returns 'copied' or 'downloaded'. */
export async function copyOrDownload(text, filename) {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    downloadTextFile(filename, text);
    return 'downloaded';
  }
}
