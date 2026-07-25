import React from 'react';
import { Box, Typography } from '@mui/material';

/** Lightweight stand-in for Platform AdminPageHeader. */
export function AdminPageHeader({ title, subtitle, children, actions }) {
  return (
    <Box sx={{ mb: 2 }}>
      {title ? (
        <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 700 }}>
          {title}
        </Typography>
      ) : null}
      {subtitle ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {subtitle}
        </Typography>
      ) : null}
      {actions ? <Box sx={{ mt: 1 }}>{actions}</Box> : null}
      {children}
    </Box>
  );
}

export default function AdminPageLayout({ children }) {
  return <Box>{children}</Box>;
}
