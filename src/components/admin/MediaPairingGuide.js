import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
/**
 * Guide: organize media with folders tagged set.
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

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
  const { t } = useRegion();
  const { tr, zh } = useQuestionEditorText();
  const eligible = eligibleSetCount ?? eligibleGroupCount;
  const body = (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t.guideFixedSets}
      </Typography>
      <Typography variant={compact ? 'body2' : 'body1'} sx={{ mb: 1 }}>
        {t.guideFixedSetsBody}
        {filesPerSet != null ? ` (${filesPerSet})` : ''}
      </Typography>
      <Box
        sx={{
          p: 1.25,
          mb: 0.5,
          borderRadius: 1,
          bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'rgba(255,255,255,0.65)'),
          border: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t.guideExample}
        </Typography>
        <Typography
          variant="body2"
          component="div"
          sx={{ fontSize: compact ? '0.8rem' : undefined, whiteSpace: 'pre-line' }}
        >
          {t.guideFixedSetsExample}
        </Typography>
      </Box>
      {context === 'question' && eligible != null && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          {zh ? '可用分组：' : 'Eligible sets: '}{eligible}
          {pairedSetCount != null ? (zh ? ` · 已标记：${pairedSetCount}` : ` · tagged: ${pairedSetCount}`) : ''}
          {matchingFileCount != null ? (zh ? ` · 匹配文件：${matchingFileCount}` : ` · matching files: ${matchingFileCount}`) : ''}
          {mediaTypeFilter && mediaTypeFilter !== 'any' ? ` (${tr(mediaTypeFilter)})` : ''}
          {totalFileCount != null ? (zh ? ` · 项目文件：${totalFileCount}` : ` · project: ${totalFileCount}`) : ''}
        </Typography>
      )}
      {context === 'dataset' && pairedSetCount > 0 && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          {tf(t.guideTaggedSets, { n: pairedSetCount })}
          {totalFileCount != null ? tf(t.guideProjectFiles, { n: totalFileCount }) : ''}
        </Typography>
      )}
    </Box>
  );

  if (compact || context === 'dataset') {
    return <Alert severity="info" sx={{ m: 0, height: '100%' }}>{body}</Alert>;
  }
  return body;
}
