import React, { useState } from 'react';
import {
  Box,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Popover,
  Paper,
} from '@mui/material';
import { useRegion, LANGUAGES } from '../../contexts/RegionContext';

export default function RegionSwitcher() {
  const { language, setLanguage } = useRegion();
  const [anchorEl, setAnchorEl] = useState(null);

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleLanguage = (_, newLang) => {
    if (newLang) { setLanguage(newLang); handleClose(); }
  };

  return (
    <>
      <Tooltip title={language === 'zh' ? '切换语言 / Switch Language' : 'Switch Language / 切换语言'}>
        <Box
          onClick={handleOpen}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            px: 1.2,
            py: 0.5,
            borderRadius: '16px',
            border: '1px solid',
            borderColor: 'rgba(255,255,255,0.35)',
            bgcolor: 'rgba(255,255,255,0.08)',
            transition: 'all 0.25s',
            '&:hover': {
              bgcolor: 'rgba(255,255,255,0.15)',
              borderColor: 'rgba(255,255,255,0.6)',
            },
          }}
        >
          <Typography variant="body2" sx={{ fontSize: '1rem', lineHeight: 1 }}>
            {language === 'zh' ? '🇨🇳' : '🌐'}
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'inherit', display: { xs: 'none', sm: 'block' } }}
          >
            {language === 'zh' ? '中文' : 'EN'}
          </Typography>
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { mt: 1, borderRadius: 2, minWidth: 200 } }}
      >
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
            🗣 LANGUAGE / 语言
          </Typography>
          <ToggleButtonGroup
            value={language}
            exclusive
            onChange={handleLanguage}
            fullWidth
            size="small"
          >
            <ToggleButton value={LANGUAGES.EN} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              🌐 English
            </ToggleButton>
            <ToggleButton value={LANGUAGES.ZH} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              🇨🇳 中文
            </ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      </Popover>
    </>
  );
}
