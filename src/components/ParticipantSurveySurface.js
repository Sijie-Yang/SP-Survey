import React from 'react';
import { Box } from '@mui/material';

/** Shared viewport gutters for the live survey and isolated question preview. */
export default function ParticipantSurveySurface({ children, ...props }) {
  return (
    <Box className="sp-survey-with-progress"
      sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 0, sm: 2 }, py: { xs: 1, sm: 3 } }}
      {...props}>
      {children}
    </Box>
  );
}
