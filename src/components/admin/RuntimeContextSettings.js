import React, { useEffect, useState } from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import { Add, DeleteOutline } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { captureParamNames } from '../../lib/surveyRuntimeContext';
const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export function conditionIdFromLabel(label, taken = []) {
  const base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 30) || 'condition';
  let id = base;
  for (let i = 2; taken.includes(id); i += 1) id = `${base}_${i}`;
  return id;
}

/** Rows → stored conditions; rows without a label are dropped, ids are kept stable once assigned. */
export function rowsToConditions(rows) {
  const taken = [];
  const out = rows.filter(r => String(r.label || '').trim()).map(r => {
    const id = ID_RE.test(r.id || '') && !taken.includes(r.id) ? r.id : conditionIdFromLabel(r.label, taken);
    taken.push(id);
    const c = {
      id,
      label: r.label.trim()
    };
    if (r.weight && r.weight !== 1) c.weight = r.weight;
    return c;
  });
  return out.length ? out : undefined;
}
export function parseUrlParamsText(text) {
  const names = captureParamNames({
    captureUrlParams: String(text || '').split(/[\s,]+/)
  });
  return names.length ? names : undefined;
}
const rowsFromConfig = config => (Array.isArray(config?.conditions) ? config.conditions : []).map(c => typeof c === 'string' ? {
  id: c,
  label: c
} : {
  id: c?.id || '',
  label: c?.label || c?.id || '',
  weight: c?.weight
});

/** Project-level between-participant conditions and URL parameter allow-list. */
export default function RuntimeContextSettings({
  config,
  onChange
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const [rows, setRows] = useState(() => rowsFromConfig(config));
  const [paramsText, setParamsText] = useState(() => captureParamNames(config).join(', '));
  useEffect(() => {
    setRows(rowsFromConfig(config));
  }, [config?.conditions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setParamsText(captureParamNames(config).join(', '));
  }, [config?.captureUrlParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = next => {
    setRows(next);
    onChange('conditions', rowsToConditions(next));
  };
  const named = rows.filter(r => String(r.label || '').trim()).length;
  return <>
      <Box sx={{
      p: 2,
      border: 1,
      borderColor: 'divider',
      borderRadius: 1
    }}>
        <Typography variant="subtitle2" sx={{
        fontWeight: 600
      }}>
          {uiPair(language, 'Experimental conditions (optional)', '实验条件（可选）')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{
        mb: 1.5
      }}>
          {uiPair(language, 'Each participant is randomly assigned to one condition, keeping the groups balanced. With two or more conditions, each question can use different wording per condition (in question settings).', '每位参与者会被随机分到其中一个条件，各条件人数自动保持平衡。添加至少两个条件后，可以在题目设置里为每个条件写不同的题干。')}
        </Typography>
        <Stack gap={1}>
          {rows.map((row, i) => <Stack key={i} direction="row" gap={1} alignItems="center">
              <TextField size="small" fullWidth label={zh ? `条件 ${i + 1} 名称` : `Condition ${i + 1} name`} value={row.label} onChange={e => setRows(rows.map((r, j) => j === i ? {
            ...r,
            label: e.target.value
          } : r))} onBlur={() => commit(rows)} placeholder={i === 0 ? uiPair(language, 'e.g. Positive wording', '例如：正向措辞') : uiPair(language, 'e.g. Negative wording', '例如：反向措辞')} helperText={row.id ? zh ? `数据中记为 ${row.id}` : `Recorded as ${row.id}` : ' '} />
              <IconButton aria-label={uiPair(language, 'Remove condition', '删除条件')} onClick={() => commit(rows.filter((_, j) => j !== i))} sx={{
            mb: 2.5
          }}>
                <DeleteOutline />
              </IconButton>
            </Stack>)}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={() => setRows([...rows, {
            id: '',
            label: ''
          }])}>
              {uiPair(language, 'Add condition', '添加条件')}
            </Button>
          </Box>
          {named === 1 && <Typography variant="caption" color="warning.main">
              {uiPair(language, 'Add at least two conditions to enable assignment.', '至少需要两个条件才会分组。')}
            </Typography>}
        </Stack>
      </Box>
      <TextField fullWidth variant="outlined" label={uiPair(language, 'URL parameters to record (optional)', '记录的链接参数（可选）')} value={paramsText} onChange={e => setParamsText(e.target.value)} onBlur={() => onChange('captureUrlParams', parseUrlParamsText(paramsText))} placeholder="site, pid" helperText={uiPair(language, 'e.g. site or pid, comma-separated. When a participant link contains ?site=S01 the value is recorded (exported as url_site). The Share tab builds one link and QR code per value.', '例如 site 或 pid，用逗号分隔。参与者链接里带上 ?site=S01 时会记录这个值（导出为 url_site 列）。在「分享」页可以为每个取值生成专属链接和二维码。')} />
    </>;
}