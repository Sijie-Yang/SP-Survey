import React, { useContext } from 'react';
import { Alert, Stack, Chip, Typography } from '@mui/material';
import { RegionContext } from '../../contexts/RegionContext';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { summarizeChoiceOutcomes } from '../../lib/choiceOutcomes';
export default function ChoiceOutcomeSummary({
  units,
  enabled
}) {
  const zh = isChineseLanguage(useContext(RegionContext)?.language);
  const counts = summarizeChoiceOutcomes(units);
  if (!enabled && !counts.tie) return null;
  return <Alert severity="info" sx={{
    mb: 2
  }}>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{
      mb: 1
    }}>
      {['A', 'B', 'tie'].map((outcome) => <Chip key={outcome} size="small" label={`${outcome === 'tie' ? uiPair(zh ? "zh" : "en", 'Tie', '平局') : `${outcome} ${uiPair(zh ? "zh" : "en", 'wins', '胜')}`} · ${counts[outcome]} (${counts.total ? (100 * counts[outcome] / counts.total).toFixed(1) : '0'}%)`} />)}
    </Stack>
    <Typography variant="caption">
      {uiPair(zh ? "zh" : "en", 'A/B refer to the first/second stimulus in each recorded media list. Ties are valid answers counted separately; TrueSkill uses decisive outcomes only and excludes ties.', 'A/B 对应每条记录中展示媒体的第一/第二项。平局是有效回答，单独统计；TrueSkill 排名仅使用明确胜负，不包含平局。')}
    </Typography>
  </Alert>;
}