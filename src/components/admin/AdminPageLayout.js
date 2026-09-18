import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

/** Shared header for top-level Admin workspace tabs. */
export function AdminPageHeader({ icon, title, description, actions, subtitle, children, sx }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
        mb: 3,
        ...sx,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          {icon && (
            <Box sx={{ color: 'primary.main', display: 'inline-flex', flexShrink: 0 }}>
              {icon}
            </Box>
          )}
          {title ? (
            <Typography variant="h5" color="primary.main">
              {title}
            </Typography>
          ) : null}
        </Stack>
        {(description || subtitle) && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 840 }}>
            {description || subtitle}
          </Typography>
        )}
        {children}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Box>
  );
}

/** Consistent centered empty state for the Admin workspace. */
export function AdminEmptyState({ icon, title, description, actionLabel, onAction }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center', borderRadius: 1.5 }}>
      {icon && (
        <Box sx={{ color: 'text.secondary', display: 'inline-flex', mb: 2 }}>
          {icon}
        </Box>
      )}
      <Typography variant="h5" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: actionLabel ? 3 : 0 }}>
        {description}
      </Typography>
      {actionLabel && (
        <Button variant="contained" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Paper>
  );
}

/** Loading fallback used by lazily loaded Admin tabs and dialogs. */
export function AdminLoadingState({ label = 'Loading…' }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 180 }}>
      <CircularProgress size={22} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

export default function AdminPageLayout({ children }) {
  return <Box>{children}</Box>;
}
