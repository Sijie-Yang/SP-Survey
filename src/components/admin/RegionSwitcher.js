import React, { useState } from 'react';
import { Button, Menu, MenuItem, Tooltip } from '@mui/material';
import Translate from '@mui/icons-material/Translate';
import { useRegion } from '../../contexts/RegionContext';
import { UI_LANGUAGES, uiLanguageById } from '../../lib/uiLanguages';

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

/** Language menu. SP-Wiki article text stays on its own en/zh switch. */
export default function RegionSwitcher({ variant = 'admin' }) {
  const { language, setLanguage } = useRegion();
  const current = uiLanguageById(language);
  const [anchor, setAnchor] = useState(null);

  return (
    <>
      <Tooltip title={current.nativeName}>
        <Button
          color="inherit"
          size="small"
          startIcon={<Translate />}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={variant === 'public' ? publicHeaderSx : adminToolbarSx}
          aria-label={`Language: ${current.nativeName}`}
          aria-haspopup="menu"
          aria-expanded={anchor ? 'true' : undefined}
        >
          {current.short}
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {UI_LANGUAGES.map((item) => (
          <MenuItem
            key={item.id}
            selected={item.id === current.id}
            onClick={() => { setLanguage(item.id); setAnchor(null); }}
          >
            {item.nativeName}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
