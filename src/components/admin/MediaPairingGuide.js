/**
 * Guide: organize media with folders tagged set.
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';

export default function MediaPairingGuide({
  compact = false,
  context = 'dataset',
  totalFileCount = 0,
  matchingFileCount = 0,
  mediaTypeFilter = 'any',
  pairedSetCount = 0,
  eligibleGroupCount = null,
  eligibleSetCount = null,
  filesPerSet = null,
}) {
  const eligible = eligibleSetCount ?? eligibleGroupCount;
  const body = (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Fixed sets
      </Typography>
      <Typography variant={compact ? 'body2' : 'body1'} sx={{ mb: 1 }}>
        Tag folders as <code>set</code>. Each tagged folder&apos;s <em>direct</em> files are shown together
        (set size must match the question&apos;s media count
        {filesPerSet != null ? ` — currently ${filesPerSet}` : ''}).
      </Typography>
      <Box
        sx={{
          p: 1.25,
          mb: 0.5,
          borderRadius: 1,
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'rgba(255,255,255,0.65)'),
          border: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 700, mb: 0.5 }}>
          Example
        </Typography>
        <Typography variant="body2" component="div" sx={{ fontSize: compact ? '0.8rem' : undefined }}>
          1. Create folders <code>block01</code>, <code>block02</code>, <code>block03</code><br />
          2. Put 2 images in each folder (same count)<br />
          3. Check those folders → click <strong>Set</strong><br />
          4. In Survey Builder, choose media mode <strong>Random fixed sets</strong> with count = 2<br />
          → each respondent sees <em>one whole folder</em> (both images together)
        </Typography>
      </Box>
      {context === 'question' && eligible != null && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          Eligible sets: {eligible}
          {pairedSetCount != null ? ` · tagged: ${pairedSetCount}` : ''}
          {matchingFileCount != null ? ` · matching files: ${matchingFileCount}` : ''}
          {mediaTypeFilter && mediaTypeFilter !== 'any' ? ` (${mediaTypeFilter})` : ''}
          {totalFileCount != null ? ` · project: ${totalFileCount}` : ''}
        </Typography>
      )}
      {context === 'dataset' && pairedSetCount > 0 && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          Currently tagged sets: {pairedSetCount}
          {totalFileCount != null ? ` · project files: ${totalFileCount}` : ''}
        </Typography>
      )}
    </Box>
  );

  if (compact || context === 'dataset') {
    return <Alert severity="info" sx={{ m: 0, height: '100%' }}>{body}</Alert>;
  }
  return body;
}
