import React from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

/** Same toolbar chip family as 「任务 · N 运行中」. */
const chipSx = {
  ml: 0.5,
  px: 1.25,
  py: 0.35,
  minWidth: 0,
  fontWeight: 700,
  textTransform: 'none',
  // Theme tokens, like the other top bar buttons, so every theme keeps its contrast.
  border: '1px solid',
  borderColor: 'divider',
  color: 'text.primary',
  bgcolor: 'transparent',
  '&:hover': {
    borderColor: 'text.secondary',
    bgcolor: 'action.hover',
  },
};

export default function CollectingSurveysChip({ count = 0, onClick }) {
  const { t } = useRegion();
  const label = tf(t.collectingSurveysBadge, { count });
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Tooltip title={t.collectingSurveysTitle}>
        <Button
          color="inherit"
          size="small"
          onClick={onClick}
          data-testid="collecting-surveys-chip"
          aria-label={label}
          sx={chipSx}
        >
          {label}
        </Button>
      </Tooltip>
    </Box>
  );
}
