import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Stack, TablePagination } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { perceptionFeatureValue, imagePerceptionCsv, downloadPerceptionFile } from '../../lib/imagePerceptionJoin';

export function coverageGroups(rows, filteredRows, featureCols, reviewFilter = 'all') {
  const scored = (r) => r.n_ratings > 0 && Number.isFinite(r.mean_score);
  const features = (r) => featureCols.some((key) => Number.isFinite(perceptionFeatureValue(r, key)));
  return {
    annotated: rows.filter((r) => r.media_matched && r.sam_status === 'ready'),
    accepted: rows.filter((r) => r.media_matched && r.sam_review_status === 'accepted'),
    scored: rows.filter(scored),
    usable: filteredRows.filter((r) => scored(r) && features(r)),
    missing_annotation: rows.filter((r) => r.media_matched && r.sam_status !== 'ready'),
    needs_review: rows.filter((r) => r.media_matched && r.sam_status === 'ready' && r.sam_review_status !== 'accepted'),
    missing_score: rows.filter((r) => r.media_matched && !scored(r)),
    missing_features: rows.filter((r) => r.media_matched && scored(r) && (reviewFilter === 'all' || (reviewFilter === 'accepted' ? r.sam_review_status === 'accepted' : r.sam_review_status !== 'accepted')) && !features(r)),
    unmatched: rows.filter((r) => !r.media_matched && scored(r)),
  };
}

export default function PerceptionCoverage({ rows, filteredRows, featureCols, selectionReady, onOpenMedia, reviewFilter }) {
  const { language } = useRegion(); const zh = language === 'zh';
  const [category, setCategory] = useState(null); const [search, setSearch] = useState(''); const [page, setPage] = useState(0);
  const groups = useMemo(() => coverageGroups(rows, filteredRows, featureCols, reviewFilter), [rows, filteredRows, featureCols, reviewFilter]);
  const labels = zh ? { annotated:'已标注', accepted:'已审核', scored:'有评分', usable:'当前筛选可分析', missing_annotation:'缺标注', needs_review:'待审核', missing_score:'缺评分', missing_features:'当前筛选缺特征', unmatched:'匹配失败' }
    : { annotated:'Annotated', accepted:'Accepted', scored:'Scored', usable:'Analyzable with filters', missing_annotation:'Missing annotation', needs_review:'Needs review', missing_score:'Missing score', missing_features:'Missing features with filters', unmatched:'Unmatched' };
  const list = (groups[category] || []).filter((r) => `${r.name} ${r.media_id} ${r.media_folder}`.toLowerCase().includes(search.toLowerCase()));
  const safePage = Math.min(page, Math.max(0, Math.ceil(list.length / 20) - 1));
  const name = (row) => { const base = String(row.name || row.media_id).split(/[?#]/)[0].split('/').pop(); try { return decodeURIComponent(base); } catch { return base; } };
  return <Box sx={{ mb: 2 }}>
    <Typography variant="caption">{zh ? '点击数量查看具体图片。标注与审核统计全库；评分对应所选题目；可分析与缺特征遵循当前筛选。' : 'Click a count to inspect images. Annotation and review cover the library; scores use the selected question; analyzable and missing features use current filters.'}</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
      {Object.keys(groups).map((key) => <Chip key={key} variant="outlined" label={`${labels[key]} · ${groups[key].length}`} disabled={!selectionReady && !['annotated','accepted','missing_annotation','needs_review'].includes(key)} onClick={() => { setCategory(key); setSearch(''); setPage(0); }} />)}
    </Stack>
    <Dialog open={!!category} onClose={() => setCategory(null)} fullWidth maxWidth="md">
      <DialogTitle>{labels[category]}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{category === 'unmatched'
          ? (zh ? '这些历史评分无法确定对应的当前媒体。请核对来源记录；系统不会按文件名自动合并。' : 'These historical scores cannot be matched to current media. Check their source records; filenames are never merged automatically.')
          : (zh ? '可打开原始媒体核对；有权限时可直接进入该图片的标注。缺评分需通过对应题目收集回答。' : 'Open the source to inspect it, or go to its annotation when available. Missing scores require responses to the selected question.')}</Typography>
        <TextField fullWidth size="small" label={zh ? '搜索文件名、文件夹或媒体 ID' : 'Search filename, folder or media ID'} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        {!list.length && <Typography sx={{ py: 3 }}>{zh ? '没有符合条件的图片' : 'No matching images'}</Typography>}
        {list.slice(safePage * 20, safePage * 20 + 20).map((row) => <Box key={row.media_id} sx={{ py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{name(row)}</Typography>
          <Typography variant="caption" display="block" sx={{ overflowWrap: 'anywhere' }}>{row.media_folder || (zh ? '根目录 / 历史来源' : 'Root / historical source')}</Typography>
          <Typography variant="caption" display="block" sx={{ overflowWrap: 'anywhere' }}>ID: {row.media_id}</Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
            {/^https?:\/\//i.test(row.url || '') && <Button size="small" component="a" href={row.url} target="_blank" rel="noopener noreferrer">{zh ? '打开媒体' : 'Open media'}</Button>}
            {row.media_matched && onOpenMedia && <Button size="small" onClick={() => { onOpenMedia(row.media_id); setCategory(null); }}>{zh ? '定位并标注' : 'Locate & annotate'}</Button>}
          </Stack>
        </Box>)}
        <TablePagination component="div" count={list.length} page={safePage} rowsPerPage={20} rowsPerPageOptions={[]} onPageChange={(_, p) => setPage(p)} labelDisplayedRows={({from,to,count}) => zh ? `${from}–${to} / ${count}` : `${from}–${to} of ${count}`} getItemAriaLabel={(type) => zh ? (type === 'next' ? '下一页' : '上一页') : `${type} page`} />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}><Button disabled={!list.length} onClick={() => downloadPerceptionFile(imagePerceptionCsv(list), `perception_${category}.csv`, 'text/csv;charset=utf-8')}>{zh ? '导出当前列表' : 'Export this list'}</Button><Button onClick={() => setCategory(null)}>{zh ? '关闭' : 'Close'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
