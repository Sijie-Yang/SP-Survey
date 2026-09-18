import React, { useContext } from 'react';
import { Alert, Stack, Chip, Typography } from '@mui/material';
import { RegionContext } from '../../contexts/RegionContext';
import { summarizeChoiceOutcomes } from '../../lib/choiceOutcomes';

export default function ChoiceOutcomeSummary({ units, enabled }) {
  const zh = useContext(RegionContext)?.language === 'zh';
  const counts = summarizeChoiceOutcomes(units);
  if (!enabled && !counts.tie) return null;
  return <Alert severity="info" sx={{ mb: 2 }}>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
      {['A', 'B', 'tie'].map((outcome) => <Chip key={outcome} size="small"
        label={`${outcome === 'tie' ? (zh ? '平局' : 'Tie') : `${outcome} ${zh ? '胜' : 'wins'}`} · ${counts[outcome]} (${counts.total ? (100 * counts[outcome] / counts.total).toFixed(1) : '0'}%)`} />)}
    </Stack>
    <Typography variant="caption">
      {zh ? 'A/B 对应每条记录中展示媒体的第一/第二项。平局是有效回答，单独统计；TrueSkill 排名仅使用明确胜负，不包含平局。' : 'A/B refer to the first/second stimulus in each recorded media list. Ties are valid answers counted separately; TrueSkill uses decisive outcomes only and excludes ties.'}
    </Typography>
  </Alert>;
}
