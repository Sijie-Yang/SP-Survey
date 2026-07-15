/**
 * Guide: category sampling via folders tagged category.
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';

export default function MediaCategoryGuide({
  compact = false,
  context = 'dataset',
  categoryCount = 0,
  projectCategoryCount = 0,
  categoryLabels = [],
  totalFileCount = 0,
  matchingFileCount = 0,
  mediaTypeFilter = 'any',
  mediaPerCategory = 1,
}) {
  const per = mediaPerCategory || 1;
  const body = (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Categories
      </Typography>
      <Typography variant={compact ? 'body2' : 'body1'} sx={{ mb: 1 }}>
        Tag folders as <code>category</code>. In Survey Builder, choose{' '}
        <strong>Per category</strong> and set <strong>Files per category</strong>
        {context === 'question' ? ` (currently ${per})` : ''}.
        Each tagged folder contributes that many random file(s) (drawn recursively).
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
          1. Create folders <code>street</code> and <code>park</code><br />
          2. Put several images in each (subfolders OK)<br />
          3. Check those folders → click <strong>Category</strong><br />
          4. In the question: Media Assignment → <strong>Per category</strong>,
          Files per category = 2<br />
          → each respondent sees 2 street + 2 park images (4 total)
        </Typography>
      </Box>
      {context === 'question' && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          Categories: {categoryCount}
          {categoryLabels?.length ? ` (${categoryLabels.join(', ')})` : ''}
          {' · '}{per} per category
          {categoryCount > 0 ? ` · total ${categoryCount * per}` : ''}
          {projectCategoryCount != null ? ` · tagged in project: ${projectCategoryCount}` : ''}
          {matchingFileCount != null ? ` · matching files: ${matchingFileCount}` : ''}
          {mediaTypeFilter && mediaTypeFilter !== 'any' ? ` (${mediaTypeFilter})` : ''}
          {totalFileCount != null ? ` · project: ${totalFileCount}` : ''}
        </Typography>
      )}
      {context === 'dataset' && (categoryCount > 0 || categoryLabels?.length > 0) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          Currently tagged categories: {categoryCount || categoryLabels.length}
          {categoryLabels?.length ? ` (${categoryLabels.join(', ')})` : ''}
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
