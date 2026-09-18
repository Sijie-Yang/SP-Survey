import React from 'react';
import { Alert, Typography } from '@mui/material';

/** OSS stub — hosted catalog / vault is not ported. Settings use the local key fields. */
export default function ModelsSettings() {
  return (
    <Alert severity="info">
      <Typography variant="body2">
        Use your own OpenAI or OpenRouter key in Assistant settings. This app does not provide a hosted model catalog.
      </Typography>
    </Alert>
  );
}

export function routeOptions() {
  return [];
}
