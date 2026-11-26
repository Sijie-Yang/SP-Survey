import React, { Suspense, lazy, useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { Map as MapIcon } from '@mui/icons-material';
import { useStreetLevelText } from '../../../contexts/streetLevelI18n';

const StreetLevelDialog = lazy(() => import('./StreetLevelDialog'));

/** Step 1 entry point; the Leaflet panel is code-split and loads on open. */
export default function StreetLevelCard({ currentProject, onProjectUpdate, projectPrefix, disabled, variant = 'card', open: controlledOpen, onClose }) {
  const tx = useStreetLevelText();
  const [localOpen, setOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const sl = currentProject?.imageDatasetConfig?.streetLevel || {};
  const count = Array.isArray(sl.points) ? sl.points.length : 0;
  const dialog = open ? (
    <Suspense fallback={<CircularProgress size={20} />}>
      <StreetLevelDialog
        open={open}
        onClose={() => { setOpen(false); onClose?.(); }}
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        projectPrefix={projectPrefix}
      />
    </Suspense>
  ) : null;
  if (variant === 'dialog') return dialog;
  if (variant === 'button') {
    return (
      <>
        <Button size="small" color="inherit" onClick={() => setOpen(true)} disabled={disabled || !currentProject?.id}>
          {tx('Street-level imagery')}
        </Button>
        {dialog}
      </>
    );
  }
  return (
    <Box sx={{
      mb: 3, p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'primary.light',
      bgcolor: (t) => (t.palette.mode === 'dark' ? 'background.paper' : 'action.hover'),
      display: 'flex', alignItems: { xs: 'stretch', md: 'center' }, gap: 2, flexDirection: { xs: 'column', md: 'row' },
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <MapIcon fontSize="small" /> {tx('Street-level imagery')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {tx('Pick points on our own map or paste Google Street View URLs, then a small helper on your computer downloads the views (no API key) into this media library with location metadata.')}
        </Typography>
        {count > 0 && (
          <Typography variant="caption" color="text.secondary">
            {tx('{n} point(s) · last run: {s}', { n: count, s: sl.lastJob?.status ? tx(`status:${sl.lastJob.status}`) : '—' })}
          </Typography>
        )}
      </Box>
      <Button variant="contained" color="primary" onClick={() => setOpen(true)} disabled={disabled || !currentProject?.id}>
        {tx('Open street-level panel')}
      </Button>
      {dialog}
    </Box>
  );
}
