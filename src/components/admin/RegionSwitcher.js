import React from 'react';
import { Button, Tooltip } from '@mui/material';
import Translate from '@mui/icons-material/Translate';
import { useRegion, LANGUAGES } from '../../contexts/RegionContext';

const adminToolbarSx = {
  ml: 0.5,
  px: 1.25,
  py: 0.35,
  minWidth: 0,
  fontWeight: 700,
  letterSpacing: 0.4,
  border: '1px solid',
  borderColor: 'rgba(255, 255, 255, 0.65)',
  bgcolor: 'rgba(255, 255, 255, 0.12)',
  textTransform: 'none',
  '&:hover': {
    borderColor: 'rgba(255, 255, 255, 0.95)',
    bgcolor: 'rgba(255, 255, 255, 0.22)',
  },
};

const publicHeaderSx = {
  px: 1.25,
  py: 0.35,
  minWidth: 0,
  fontWeight: 700,
  letterSpacing: 0.4,
  border: '1px solid',
  borderColor: 'divider',
  textTransform: 'none',
  color: 'text.primary',
  bgcolor: 'transparent',
  '&:hover': {
    borderColor: 'text.secondary',
    bgcolor: 'action.hover',
  },
};

/**
 * Language toggle EN ↔ 中文 (no flag icons).
 * variant: "admin" (dark AppBar) | "public" (light public header)
 */
export default function RegionSwitcher({ variant = 'admin' }) {
  const { language, setLanguage } = useRegion();
  const isZh = language === LANGUAGES.ZH;

  return (
    <Tooltip title={isZh ? '切换为 English' : 'Switch to 中文'}>
      <Button
        color="inherit"
        size="small"
        startIcon={<Translate />}
        onClick={() => setLanguage(isZh ? LANGUAGES.EN : LANGUAGES.ZH)}
        sx={variant === 'public' ? publicHeaderSx : adminToolbarSx}
        aria-label={isZh ? 'Switch to English' : 'Switch to Chinese'}
      >
        {isZh ? '中文' : 'EN'}
      </Button>
    </Tooltip>
  );
}
