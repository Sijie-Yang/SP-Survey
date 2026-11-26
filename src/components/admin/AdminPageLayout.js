import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

/** Secondary workspace actions follow the Builder settings buttons. */
export const AdminActionButton = React.forwardRef(function AdminActionButton({ sx, ...props }, ref) {
  return (
    <Button
      ref={ref}
      size="small"
      variant="outlined"
      {...props}
      sx={[
        {
          color: 'text.primary',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          justifyContent: 'flex-start',
          textAlign: 'left',
          minHeight: 34,
          maxWidth: '100%',
          px: 1.5,
          '& .MuiButton-startIcon, & .MuiButton-endIcon': { color: 'text.secondary' },
          '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
});

/** Settings on the left; one main action anchored at the right. */
export function AdminActionBar({ children, primaryAction, label }) {
  return (
    <Paper
      variant="outlined"
      role="group"
      aria-label={label}
      data-admin-action-bar
      sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, borderRadius: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}
    >
      <Box data-admin-secondary-actions sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
        {children}
      </Box>
      <Box data-admin-primary-action sx={{ ml: 'auto', flexShrink: 0, maxWidth: '100%', '& .MuiButton-root': { minHeight: 34 } }}>
        {primaryAction}
      </Box>
    </Paper>
  );
}

/** Shared header for top-level Admin workspace tabs. */
export function AdminPageHeader({ icon, title, description, actions, subtitle, children, sx }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1.5,
        flexWrap: 'wrap',
        mb: 2.5,
        ...sx,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: description ? 0.75 : 0 }}>
          {icon && (
            <Box sx={{ color: 'primary.main', display: 'inline-flex', flexShrink: 0 }}>
              {icon}
            </Box>
          )}
          {title ? (
            <Typography variant="h5" component="h2" color="primary.main" sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 700 }}>
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
