/**
 * Lightbox-style preview for media library entries (image / video / audio).
 */
import React, { useEffect, useMemo } from 'react';
import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography, Chip, Tooltip,
} from '@mui/material';
import {
  Close, ChevronLeft, ChevronRight, OpenInNew, Image as ImageIcon,
  Videocam, Audiotrack,
} from '@mui/icons-material';
import { inferMediaType } from '../../lib/mediaUtils';
import { MediaPlayer } from '../MediaWidgets';

function typeIcon(type) {
  if (type === 'video') return <Videocam fontSize="small" />;
  if (type === 'audio') return <Audiotrack fontSize="small" />;
  return <ImageIcon fontSize="small" />;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object|null} props.entry - media entry with url/name/type
 * @param {object[]} [props.items] - optional playlist for prev/next
 * @param {(next: object) => void} [props.onNavigate]
 */
export default function MediaFilePreviewDialog({
  open,
  onClose,
  entry,
  items = null,
  onNavigate = null,
}) {
  const list = useMemo(
    () => (Array.isArray(items) ? items.filter((m) => m?.url) : []),
    [items],
  );
  const index = useMemo(() => {
    if (!entry?.url || !list.length) return -1;
    const byUrl = list.findIndex((m) => m.url === entry.url);
    if (byUrl >= 0) return byUrl;
    const key = entry.media_id || entry.key || entry.name;
    return list.findIndex((m) => (m.media_id || m.key || m.name) === key);
  }, [entry, list]);

  const type = entry?.type || inferMediaType(entry?.name || entry?.url || '');
  const canPrev = index > 0 && typeof onNavigate === 'function';
  const canNext = index >= 0 && index < list.length - 1 && typeof onNavigate === 'function';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && canPrev) {
        e.preventDefault();
        onNavigate(list[index - 1]);
      } else if (e.key === 'ArrowRight' && canNext) {
        e.preventDefault();
        onNavigate(list[index + 1]);
      } else if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, canPrev, canNext, index, list, onNavigate, onClose]);

  return (
    <Dialog
      open={open && !!entry?.url}
      onClose={onClose}
      maxWidth={type === 'audio' ? 'sm' : 'md'}
      fullWidth
      PaperProps={{ sx: { bgcolor: 'grey.900', color: 'grey.100' } }}
    >
      <DialogTitle sx={{ pr: 6, py: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            icon={typeIcon(type)}
            label={type || 'media'}
            sx={{ bgcolor: 'grey.800', color: 'grey.100', '& .MuiChip-icon': { color: 'grey.300' } }}
          />
          <Typography variant="subtitle1" fontWeight={600} noWrap title={entry?.name} sx={{ minWidth: 0, flex: 1 }}>
            {entry?.name || 'Media'}
          </Typography>
          {list.length > 1 && index >= 0 && (
            <Typography variant="caption" color="grey.400">
              {index + 1} / {list.length}
            </Typography>
          )}
          {entry?.url && (
            <Tooltip title="Open in new tab">
              <IconButton
                size="small"
                component="a"
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: 'grey.300' }}
              >
                <OpenInNew fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8, color: 'grey.300' }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'grey.800', position: 'relative', minHeight: 200 }}>
        {canPrev && (
          <IconButton
            aria-label="Previous"
            onClick={() => onNavigate(list[index - 1])}
            sx={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 2, bgcolor: 'rgba(0,0,0,0.45)', color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
            }}
          >
            <ChevronLeft />
          </IconButton>
        )}
        {canNext && (
          <IconButton
            aria-label="Next"
            onClick={() => onNavigate(list[index + 1])}
            sx={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 2, bgcolor: 'rgba(0,0,0,0.45)', color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
            }}
          >
            <ChevronRight />
          </IconButton>
        )}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: type === 'audio' ? 80 : 280,
            px: list.length > 1 ? 5 : 0,
          }}
        >
          {entry?.url && (
            <Box sx={{ width: '100%', maxWidth: type === 'audio' ? 480 : '100%' }}>
              <MediaPlayer url={entry.url} type={type} name={entry.name} />
            </Box>
          )}
        </Box>
        {(entry?.folder || entry?.key) && (
          <Typography variant="caption" color="grey.500" sx={{ display: 'block', mt: 1.5 }}>
            {[entry.folder && `folder: ${entry.folder}`, entry.key && `key: ${entry.key}`]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
