import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
/**
 * Guide: category sampling via folders tagged category.
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

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
  singleCategory = false,
}) {
  const { t } = useRegion();
  const { tr, zh } = useQuestionEditorText();
  const per = mediaPerCategory || 1;
  if (context === 'question' && singleCategory) {
    return <Alert severity="info">
      {tr('Each trial randomly chooses one selected category and draws {count} files only from it.', { count: per })}
      {' '}{tr('Categories may repeat across trials. The existing exclude-used setting still applies.')}
    </Alert>;
  }
  const body = (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t.guideCategories}
      </Typography>
      <Typography variant={compact ? 'body2' : 'body1'} sx={{ mb: 1 }}>
        {t.guideCategoriesBody}
        {context === 'question' ? ` (${per})` : ''}
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
          {t.guideCategoriesExample}
        </Typography>
      </Box>
      {context === 'question' && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          {zh ? '分类数：' : 'Categories: '}{categoryCount}
          {categoryLabels?.length ? ` (${categoryLabels.join(', ')})` : ''}
          {zh ? ` · 每类 ${per} 个文件` : ` · ${per} per category`}
          {categoryCount > 0 ? (zh ? ` · 共 ${categoryCount * per} 个` : ` · total ${categoryCount * per}`) : ''}
          {projectCategoryCount != null ? (zh ? ` · 项目中已标记：${projectCategoryCount}` : ` · tagged in project: ${projectCategoryCount}`) : ''}
          {matchingFileCount != null ? (zh ? ` · 匹配文件：${matchingFileCount}` : ` · matching files: ${matchingFileCount}`) : ''}
          {mediaTypeFilter && mediaTypeFilter !== 'any' ? ` (${tr(mediaTypeFilter)})` : ''}
          {totalFileCount != null ? (zh ? ` · 项目文件：${totalFileCount}` : ` · project: ${totalFileCount}`) : ''}
        </Typography>
      )}
      {context === 'dataset' && (categoryCount > 0 || categoryLabels?.length > 0) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          {tf(t.guideTaggedCategories, { n: categoryCount || categoryLabels.length })}
          {categoryLabels?.length ? ` (${categoryLabels.join(', ')})` : ''}
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
