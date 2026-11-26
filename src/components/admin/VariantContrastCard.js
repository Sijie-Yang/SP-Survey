import React, { useMemo, useState } from 'react';
import {
  Box, Button, Card, CardContent, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Download } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { surveyVariantAnalysis, variantExportFiles } from '../../lib/variantAnalysis';
import { downloadZip } from '../../lib/zipDownload';

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const fmtP = (p) => (p == null ? '—' : p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, ''));

const GROUPING_TEXT = {
  file_suffix: ['versions from file names (scene__version.jpg)', '按文件名识别版本（场景__版本.jpg）'],
  folder_is_variant: ['versions from folders (version/scene.jpg)', '按文件夹识别版本（版本/场景.jpg）'],
  file_is_variant: ['scenes from folders (scene/version.jpg)', '按文件夹识别场景（场景/版本.jpg）'],
};

/**
 * Results overview card for counterfactual image designs: the same scene in
 * several versions. Renders nothing unless some question's images group into
 * versions. Computed by the platform; the same tables go into the full export.
 */
export default function VariantContrastCard({ questions, responses, language, numberByName, projectName = '' }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const [baselines, setBaselines] = useState({});
  const analysis = useMemo(() => surveyVariantAnalysis(questions, responses, { baselines }), [questions, responses, baselines]);
  if (!analysis.length) return null;

  const qLabel = (q) => (numberByName?.get(q.name) ? `Q${numberByName.get(q.name)}` : q.name);
  const setBaseline = (qName, attr, value) => setBaselines((prev) => ({ ...prev, [qName]: { ...(prev[qName] || {}), [attr]: value } }));

  return (
    <Card variant="outlined" sx={{ mb: 3 }} data-testid="variant-contrasts">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>{L('Image versions', '图片版本对比')}</Typography>
          <Button size="small" startIcon={<Download />}
            onClick={() => downloadZip(`${(projectName || 'survey').replace(/[^\w.-]+/g, '_')}_variant_contrasts.zip`, variantExportFiles(analysis))}>
            CSV
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {L(
            'Some images are versions of the same scene. Each scene counts once: the table shows the average per-scene difference from the baseline version, with a 95% CI and a paired t-test (Holm-adjusted across versions).',
            '有些图片是同一场景的不同版本。每个场景算一次：表里是各版本相对基准版本的平均逐场景差值，附 95% 置信区间和配对 t 检验（多个版本间做 Holm 校正）。',
          )}
        </Typography>
        <Stack spacing={3}>
          {analysis.flatMap(({ question, blocks }) => blocks.map((b) => (
            <Box key={`${question.name}-${b.attribute_key}`} data-testid={`variant-block-${question.name}`}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {qLabel(question)}{b.attribute_label ? ` · ${b.attribute_label}` : ''}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' · '}{b.metric === 'mu' ? L('TrueSkill μ', 'TrueSkill μ') : L('mean rating', '平均评分')}
                      {' · '}{L(...(GROUPING_TEXT[b.grouping] || ['', '']))}
                    </Typography>
                  </Typography>
                </Box>
                <TextField select size="small" label={L('Baseline', '基准版本')} value={b.baseline} sx={{ minWidth: 160 }}
                  onChange={(e) => setBaseline(question.name, b.attribute_key, e.target.value)}>
                  {b.variants.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Stack>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{L('Version', '版本')}</TableCell>
                      <TableCell align="right">{L('Scenes', '场景数')}</TableCell>
                      <TableCell align="right">{L('Difference (95% CI)', '差值（95% CI）')}</TableCell>
                      <TableCell align="right">{L('p (Holm)', 'p（Holm）')}</TableCell>
                      <TableCell align="right">d<sub>z</sub></TableCell>
                      <TableCell align="right">{L('Higher / lower', '更高 / 更低')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {b.contrasts.map((c) => (
                      <TableRow key={c.variant}>
                        <TableCell>{c.variant} <Typography component="span" variant="caption" color="text.secondary">− {c.baseline}</Typography></TableCell>
                        <TableCell align="right">{c.n_scenes}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {c.mean_diff > 0 ? '+' : ''}{fmt(c.mean_diff)}{c.ci95_low != null ? ` [${fmt(c.ci95_low)}, ${fmt(c.ci95_high)}]` : ''}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          <Tooltip title={L(`unadjusted p = ${fmtP(c.p)}; t(${c.df}) = ${fmt(c.t)}`, `未校正 p = ${fmtP(c.p)}；t(${c.df}) = ${fmt(c.t)}`)}>
                            <span>{fmtP(c.p_holm)}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.cohens_dz)}</TableCell>
                        <TableCell align="right">{c.n_higher} / {c.n_lower}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )))}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          {L(
            'Name files scene__version.jpg (e.g. s12__base.jpg, s12__trees.jpg) or put each version in its own folder to get this table. Scenes, not participants, are the unit of analysis. ',
            '把文件命名为 场景__版本.jpg（如 s12__base.jpg、s12__trees.jpg），或把每个版本放进单独的文件夹，就会出现这张表。分析单位是场景，不是参与者。',
          )}
          <a href="https://sp-survey.org/docs/image-versions" target="_blank" rel="noopener noreferrer">{L('How it works', '说明')}</a>
        </Typography>
      </CardContent>
    </Card>
  );
}
