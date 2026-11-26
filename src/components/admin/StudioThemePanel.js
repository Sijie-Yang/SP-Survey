import { applySurveyThemePreset, DEFAULT_SURVEY_THEME, matchesSurveyThemePreset, SURVEY_THEME_OPTIONS, SURVEY_THEME_PRESETS } from '../../lib/surveyThemePresets';
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
const groups = [
  ['Surfaces', '背景', [['backgroundColor','Page background','页面背景'],['cardBackground','Question cards','题卡背景'],['headerBackground','Header','页眉背景']]],
  ['Text', '文字', [['textColor','Body text','正文'],['secondaryText','Secondary text','次要文字'],['disabledText','Disabled text','禁用文字']]],
  ['Controls', '控件', [['primaryColor','Primary / selected','主色／选中'],['primaryLight','Primary light','主色浅色'],['primaryDark','Primary dark','主色深色'],['secondaryColor','Secondary','辅助色'],['borderColor','Border','边框'],['focusBorder','Focus border','焦点边框'],['successColor','Success / progress','成功／进度'],['accentColor','Accent / error','强调／错误']]],
];
const defaults = DEFAULT_SURVEY_THEME;
export default function StudioThemePanel({ config, onChange, onStart, onEnd, zh }) {
  const theme = { ...defaults, ...config.theme };
  const colorField = ([key,en,cn]) => <Box key={key} className="sp-theme-color">
    <Typography component="label" htmlFor={`studio-color-${key}`} variant="caption">{zh ? cn : en}</Typography>
    <Typography component="span" variant="caption" color="text.secondary">{theme[key]}</Typography>
    <input id={`studio-color-${key}`} type="color" aria-label={zh ? cn : en} value={/^#[a-f\d]{6}$/i.test(theme[key]) ? theme[key] : defaults[key]}
      onFocus={onStart} onBlur={() => onEnd(false)} onChange={e => onChange({ ...config, theme: { ...config.theme, [key]: e.target.value } })} />
  </Box>;
  const common = ['primaryColor', 'backgroundColor', 'cardBackground', 'headerBackground', 'textColor'];
  const fields = groups.flatMap(group => group[2]);
  return <Stack spacing={1.5}>
    <Typography variant="subtitle2">{zh ? '全局主题 · 所有设备' : 'Global theme · All devices'}</Typography>
    <Typography variant="caption" color="text.secondary">{zh ? '与 Theme Customization 共用设置，颜色跨设备同步。' : 'Shared with Theme Customization. Colors apply to both devices.'}</Typography>
    <Typography variant="caption" color="text.secondary">{zh ? '预设替换整套颜色，包括页眉、背景和文字。' : 'Presets replace the full palette, including header, backgrounds and text.'}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.75 }}>
      {SURVEY_THEME_OPTIONS.map(option => <Button key={option.id} size="small" variant="outlined" aria-pressed={matchesSurveyThemePreset(config.theme, option.id)}
        sx={{ minWidth: 0, px: 0.5, fontSize: 11, bgcolor: matchesSurveyThemePreset(config.theme, option.id) ? 'action.selected' : undefined }}
        startIcon={<Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SURVEY_THEME_PRESETS[option.id].primaryColor }} />}
        onClick={() => { onEnd(false); onChange(applySurveyThemePreset(config, option.id)); }}>{zh ? option.zh : option.name}</Button>)}
    </Box>
    <Box sx={{ bgcolor: theme.backgroundColor, color: theme.textColor, border: `1px solid ${theme.borderColor}`, borderRadius: 1, p: 1.5 }}>
      <Typography variant="caption">{zh ? '选项状态示例' : 'Option state preview'}</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>{[['Normal','未选中',theme.borderColor],['Hover','悬停',theme.primaryLight],['Selected','已选中',theme.primaryColor]].map(([en,cn,color]) => <Box key={en} sx={{ flex: 1, p: 0.75, bgcolor: theme.cardBackground, border: `2px solid ${color}`, fontSize: 11 }}>{zh ? cn : en}</Box>)}</Stack>
      <Box sx={{ height: 5, mt: 1.5, bgcolor: theme.primaryColor, width: '65%' }} />
    </Box>
    <Box className="sp-studio-section">{common.map(key => colorField(fields.find(field => field[0] === key)))}</Box>
    <details className="sp-studio-section"><summary>{zh ? '更多主题颜色' : 'More theme colors'}</summary>
      {groups.map(([en,cn,fields]) => <Box key={en} sx={{ mb: 2 }}><Typography variant="caption" fontWeight={700}>{zh ? cn : en}</Typography>{fields.filter(([key]) => !common.includes(key)).map(colorField)}</Box>)}
    </details>
    <Button size="small" onClick={() => { onEnd(false); onChange(applySurveyThemePreset(config, 'default')); }}>{zh ? '恢复默认颜色' : 'Restore default colors'}</Button>
  </Stack>;
}
