import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Box, Button, ClickAwayListener, Paper, Popper, Stack, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

export const ADMIN_TOUR_STEPS = [
  { target: 'projects', titleKey: 'guideTourProjectsTitle', bodyKey: 'guideTourProjectsBody' },
  { target: 'tabs', titleKey: 'guideTourTabsTitle', bodyKey: 'guideTourTabsBody' },
  { target: 'save', titleKey: 'guideTourSaveTitle', bodyKey: 'guideTourSaveBody' },
  { target: 'preview', titleKey: 'guideTourPreviewTitle', bodyKey: 'guideTourPreviewBody' },
  { target: 'ai', titleKey: 'guideTourAiTitle', bodyKey: 'guideTourAiBody' },
  { target: 'live', titleKey: 'guideTourLiveTitle', bodyKey: 'guideTourLiveBody' },
  { target: 'more', titleKey: 'guideTourMoreTitle', bodyKey: 'guideTourMoreBody' },
  { target: 'guide-restart', titleKey: 'guideTourRestartTitle', bodyKey: 'guideTourRestartBody' },
];

function findVisibleTarget(name) {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll(`[data-tour="${name}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

/**
 * Non-modal tour over elements tagged with data-tour. Steps whose target is
 * hidden (compact toolbar, disabled feature) are skipped.
 */
export default function AdminGuideTour({ open, onClose }) {
  const { t } = useRegion();
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const [rect, setRect] = useState(null);

  const steps = useMemo(
    () => (open ? ADMIN_TOUR_STEPS.filter((step) => findVisibleTarget(step.target)) : []),
    [open],
  );
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !step) {
      setAnchor(null);
      return undefined;
    }
    const node = findVisibleTarget(step.target);
    setAnchor(node);
    node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const update = () => setRect(node ? node.getBoundingClientRect() : null);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (open && steps.length === 0) onClose?.();
  }, [open, steps.length, onClose]);

  const finish = useCallback(() => onClose?.(), [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open || !step || !anchor) return null;
  const isLast = index === steps.length - 1;

  return (
    <>
      {rect && (
        <Box
          aria-hidden
          sx={{
            position: 'fixed',
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            borderRadius: 1.5,
            border: '2px solid',
            borderColor: 'warning.main',
            boxShadow: '0 0 0 4px rgba(255, 167, 38, 0.25)',
            pointerEvents: 'none',
            zIndex: (theme) => theme.zIndex.tooltip,
            transition: 'all 0.2s ease',
          }}
        />
      )}
      <Popper
        open
        anchorEl={anchor}
        placement="bottom"
        modifiers={[{ name: 'offset', options: { offset: [0, 12] } }, { name: 'preventOverflow', options: { padding: 8 } }]}
        sx={{ zIndex: (theme) => theme.zIndex.tooltip + 1 }}
      >
        <ClickAwayListener onClickAway={finish} mouseEvent="onMouseDown">
          <Paper
            role="dialog"
            aria-label={t.guideTourLabel}
            elevation={8}
            sx={{ p: 2, maxWidth: 320, borderTop: '3px solid', borderColor: 'primary.main' }}
          >
            <Typography variant="caption" color="text.secondary">
              {tf(t.guideTourStepOf, { n: index + 1, total: steps.length })}
            </Typography>
            <Typography fontWeight={700} sx={{ mb: 0.5 }}>{t[step.titleKey]}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t[step.bodyKey]}</Typography>
            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
              <Button size="small" color="inherit" onClick={finish} sx={{ textTransform: 'none' }}>
                {t.guideTourSkip}
              </Button>
              <Stack direction="row" spacing={1}>
                {index > 0 && (
                  <Button size="small" onClick={() => setIndex(index - 1)} sx={{ textTransform: 'none' }}>
                    {t.guideTourBack}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="contained"
                  autoFocus
                  onClick={() => (isLast ? finish() : setIndex(index + 1))}
                  sx={{ textTransform: 'none' }}
                >
                  {isLast ? t.guideTourDone : t.guideTourNext}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}
