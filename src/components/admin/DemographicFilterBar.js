import React from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
function choiceValue(choice) {
  return typeof choice === 'object' ? choice.value : choice;
}
function choiceText(choice) {
  return typeof choice === 'object' ? choice.text || choice.value : choice;
}
function QuestionHeading({
  number,
  title,
  zh
}) {
  return <Box sx={{
    mb: 0.75,
    minWidth: 0
  }}>
      <Typography variant="caption" sx={{
      fontWeight: 700,
      color: 'primary.main',
      letterSpacing: 0.2
    }}>
        {number ? zh ? `第 ${number} 题` : `Question ${number}` : uiPair(zh ? "zh" : "en", 'Question', '题目')}
      </Typography>
      <Typography variant="body2" title={title} sx={{
      lineHeight: 1.35,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }}>
        {title}
      </Typography>
    </Box>;
}

/** Workbench-wide participant filter. Conditions combine with AND. */
export default function DemographicFilterBar({
  questions = [],
  questionNumbers = null,
  filters = [],
  onChange
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const background = questions.filter((question) => ['radiogroup', 'dropdown', 'checkbox'].includes(question.type) || question.inputType === 'number');
  if (!background.length) return null;
  const update = (questionName, next) => {
    const rest = filters.filter((filter) => filter.question !== questionName);
    onChange(next ? [...rest, next] : rest);
  };
  return <Box sx={{
    mb: 2,
    p: 1.5,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 1,
    bgcolor: 'grey.50'
  }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} sx={{
      mb: 1.25
    }}>
        <Box sx={{
        minWidth: 0
      }}>
          <Typography variant="subtitle2">{uiPair(language, 'Participant attributes', '参与者属性')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {uiPair(language, 'Question numbers match the list below. Every selected condition must match.', '题号与下方题目列表一致。多个条件要同时满足。')}
          </Typography>
        </Box>
        {!!filters.length && <Chip size="small" label={uiPair(language, 'Clear filters', '清除筛选')} onDelete={() => onChange([])} sx={{
        flexShrink: 0
      }} />}
      </Stack>
      <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
      gap: 1.25
    }}>
        {background.map((question) => {
        const current = filters.find((filter) => filter.question === question.name);
        const number = questionNumbers?.get?.(question.name) || null;
        const title = question.title || question.name;
        if (question.inputType === 'number') {
          return <Box key={question.name} sx={{
            minWidth: 0,
            p: 1,
            borderRadius: 1,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider'
          }}>
                <QuestionHeading number={number} title={title} zh={zh} />
                <Stack direction="row" gap={1}>
                  <TextField size="small" type="number" label={uiPair(language, 'Min', '最小')} value={current?.min ?? ''} onChange={(event) => update(question.name, {
                question: question.name,
                op: 'range',
                min: event.target.value,
                max: current?.max ?? ''
              })} fullWidth />
                  <TextField size="small" type="number" label={uiPair(language, 'Max', '最大')} value={current?.max ?? ''} onChange={(event) => update(question.name, {
                question: question.name,
                op: 'range',
                min: current?.min ?? '',
                max: event.target.value
              })} fullWidth />
                </Stack>
              </Box>;
        }
        const selected = current?.values || [];
        return <Box key={question.name} sx={{
          minWidth: 0,
          p: 1,
          borderRadius: 1,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider'
        }}>
              <QuestionHeading number={number} title={title} zh={zh} />
              <TextField select fullWidth size="small" label={selected.length ? zh ? `已选 ${selected.length} 项` : `${selected.length} selected` : uiPair(language, 'Any answer', '不限')} InputLabelProps={{
            shrink: true
          }} value={selected} SelectProps={{
            multiple: true,
            displayEmpty: true
          }} onChange={(event) => {
            const values = event.target.value;
            update(question.name, values.length ? {
              question: question.name,
              op: 'in',
              values
            } : null);
          }}>
                <MenuItem value="__missing__">{uiPair(language, 'Missing / not answered', '未作答')}</MenuItem>
                {(question.choices || []).map((choice) => <MenuItem key={String(choiceValue(choice))} value={String(choiceValue(choice))}>{choiceText(choice)}</MenuItem>)}
              </TextField>
            </Box>;
      })}
      </Box>
    </Box>;
}