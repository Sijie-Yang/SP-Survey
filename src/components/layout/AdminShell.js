import React from 'react';
import { AppBar, Toolbar, Typography, Box, Container, IconButton, Tooltip } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

/**
 * Shared admin chrome: quiet AppBar + padded content container.
 * Used by Skills pages to match AdminApp density.
 */
export default function AdminShell({
  title,
  subtitle,
  actions = null,
  backTo = null,
  onBack = null,
  maxWidth = 'xl',
  children,
}) {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="inherit" sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ gap: 1, minHeight: 64 }}>
          {backTo && (
            <Tooltip title="Back">
              <IconButton edge="start" onClick={onBack || (() => navigate(backTo))} size="small">
                <ArrowBack />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {subtitle}
              </Typography>
            )}
          </Box>
          {actions}
        </Toolbar>
      </AppBar>
      <Container maxWidth={maxWidth} sx={{ py: { xs: 2, sm: 3 }, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
