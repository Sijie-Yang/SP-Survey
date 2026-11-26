import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { defaultMediaSlots, normalizeMediaLayout, savedMediaLayout, setMediaLayout } from '../../lib/mediaLayout';

export function studioGallery(canvas, name) {
  return [...(canvas?.querySelectorAll('[data-sp-question-name]') || [])].find(n => n.dataset.spQuestionName === name)?.querySelector('.sd-imagepicker, .sp-image-gallery:not(.sp-image-gallery--vertical), .sd-image');
}
export function galleryRatios(root) {
  return [...(root?.querySelectorAll('img') || [])].map(img => img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4 / 3);
}
export default function StudioMediaPanel({ config, viewport, question, canvasRef, onChange, onStart, onEnd, zh, selectedImage, onSelectImage, onSample, onReverse }) {
  const [stats, setStats] = useState({ ratios: [] });
  const [targets, setTargets] = useState([]);
  const saved = savedMediaLayout(config, viewport, question.name);
  const rule = normalizeMediaLayout(saved || { height: config.viewportLayout?.[viewport]?.questions?.[question.name]?.mediaMaxHeight || 240 });
  const tr = (en, cn) => zh ? cn : en;
  useEffect(() => {
    const update = () => {
      const gallery = studioGallery(canvasRef.current, question.name);
      const next = { ratios: galleryRatios(gallery), ready: [...(gallery?.querySelectorAll('img') || [])].every(i => i.naturalWidth > 0), fallback: gallery?.dataset.spMediaFallback, rows: Number(gallery?.dataset.spMediaRows), height: gallery?.querySelector('img')?.height };
      setStats(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    update(); const timer = setInterval(update, 350);
    return () => clearInterval(timer);
  }, [canvasRef, question.name]);
  const change = patch => onChange(setMediaLayout(config, viewport, question.name, { ...rule, ...patch }));
  const number = (field, label, min, max, step = 1) => <TextField key={field} size="small" type="number" label={label} value={rule[field]} onFocus={onStart} onBlur={() => onEnd(false)} onChange={e => { if (e.target.value !== '') change({ [field]: Number(e.target.value) }); }} inputProps={{ min, max, step }} />;
  const select = (field, label, choices) => <TextField size="small" select label={label} value={rule[field]} onChange={e => change({ [field]: e.target.value })}>{choices.map(([v, en, cn]) => <MenuItem key={v} value={v}>{tr(en, cn)}</MenuItem>)}</TextField>;
  const slot = rule.slots[selectedImage];
  const otherQuestions = config.pages.flatMap(p => p.elements || []).filter(q => q.name !== question.name && /image|media/.test(q.type) && !/ranking/.test(q.type));
  return <Stack spacing={1.5} data-studio-media-panel="">
    <Typography variant="subtitle2">{tr('Image layout', '图片排版')}</Typography>
    
    <TextField size="small" select label={tr('Layout mode', '排版模式')} value={saved ? rule.mode : 'legacy'} onChange={e => {
      onSelectImage(0);
      if (e.target.value === 'legacy') onChange(setMediaLayout(config, viewport, question.name, null));
      else change({ mode: e.target.value, ...(e.target.value === 'free' ? { slots: defaultMediaSlots(stats.ratios) } : {}) });
    }}>
      <MenuItem value="legacy">{tr('Original automatic layout', '原有自动排版')}</MenuItem>
      <MenuItem value="dynamic">{tr('Dynamic equal height', '动态等高')}</MenuItem>
      <MenuItem value="grid">{tr('Fixed grid', '固定网格')}</MenuItem>
      <MenuItem value="free" disabled={!stats.ratios.length || !stats.ready}>{tr('Free layout', '自由布局')}</MenuItem>
    </TextField>
    <Typography variant="caption" color="text.secondary">{!saved ? tr('Automatic sizing from the survey defaults.', '按问卷默认设置自动排版。') : rule.mode === 'dynamic' ? tr('Best for random images with different proportions. Keeps whole images visible.', '适合比例不同的随机图片，完整展示图片并自动换行。') : rule.mode === 'grid' ? tr('Stable columns for consistent image sets. Images keep their proportions.', '适合固定数量的图片组，按列排列并保留原始比例。') : tr('For one image or predictable image sets. Drag images and resize their corners.', '适合单图或比例固定的图片组。拖动图片移动，拖动角点缩放。')}</Typography>
    {saved && <>
      {rule.mode !== 'free' && <>
        <Box className="sp-field-grid">{number('height', tr('Target image height (px)', '目标图片高度（px）'), 40, 800)}
        {rule.mode === 'dynamic' ? number('minHeight', tr('Wrap below height (px)', '换行高度阈值（px）'), 40, rule.height) : number('columns', tr('Columns', '列数'), 1, 8)}</Box>
        {rule.mode === 'dynamic' && <>{select('packing', tr('Arrangement', '排列策略'), [['auto','Wrap automatically','自动换行'],['row','Prefer one row','优先同排'],['stack','Always stack','始终上下排列']])}{select('align', tr('Group alignment', '整组对齐'), [['left','Left','左对齐'],['center','Center','居中'],['right','Right','右对齐']])}</>}
        <Box className="sp-field-grid">{number('gap', tr('Horizontal gap (px)', '水平间距（px）'), 0, 80)}{number('rowGap', tr('Vertical gap (px)', '垂直间距（px）'), 0, 80)}</Box>
      </>}
      {rule.mode === 'free' && <>

        {number('stageHeight', tr('Canvas height (% of width)', '画布高度（相对宽度 %）'), 15, 250)}
        {rule.slots.length > 0 && <TextField size="small" select label={tr('Image position', '图片位置')} value={Math.min(selectedImage, rule.slots.length - 1)} onChange={e => onSelectImage(Number(e.target.value))}>{rule.slots.map((s, i) => <MenuItem key={i} value={i}>{tr('Position', '位置')} {i + 1}</MenuItem>)}</TextField>}
        <Box className="sp-field-grid">{slot && ['x','y','width'].map(field => <TextField key={field} size="small" type="number" label={field === 'width' ? tr('Image width (%)', '图片宽度（%）') : `${field.toUpperCase()} (%)`} value={Math.round(slot[field] * 10) / 10} inputProps={{ min: 0, max: field === 'y' ? 250 : 100, step: 1 }} onFocus={onStart} onBlur={() => onEnd(false)} onChange={e => { if (e.target.value !== '') change({ slots: rule.slots.map((s,i) => i === selectedImage ? { ...s, [field]: Number(e.target.value) } : s) }); }} />)}</Box>
        {slot && <Stack direction="row">{['left','center','right'].map((a,i) => <Button key={a} size="small" onClick={() => change({ slots: rule.slots.map((s,n) => n === selectedImage ? { ...s, x: i * (100 - s.width) / 2 } : s) })}>{tr(['Left','Center','Right'][i], ['左','中','右'][i])}</Button>)}</Stack>}
        <details><summary>{tr('Canvas & snapping', '画布与吸附')}</summary><Stack spacing={1}>
        <Typography variant="caption" color="text.secondary">{tr('Snap: 2%; hold Alt for fine movement. Positions follow display order, not image identity.', '按 2% 吸附，按住 Alt 可精调。位置按展示顺序保存，不绑定具体图片。')}</Typography>
        <Button size="small" disabled={!stats.ready || !stats.ratios.length} onClick={() => change({ slots: defaultMediaSlots(stats.ratios) })}>{tr('Reset positions for this sample', '按当前样本重置位置')}</Button>
        <Button size="small" onClick={() => change({ stageHeight: Math.max(15, ...rule.slots.map(s => s.y + s.width / s.ar)) })}>{tr('Fit canvas to images', '画布适应图片高度')}</Button></Stack></details>
        {stats.fallback && <Alert severity="info">{tr('The sampled count or proportions changed. Automatic equal-height layout is used until compatible images return.', '当前样本的数量或比例不匹配，已自动改用等高排版；兼容样本会恢复所存布局。')}</Alert>}
      </>}
      <Box className="sp-field-grid">{number('top', tr('Space above (px)', '上方留白（px）'), 0, 160)}{number('bottom', tr('Space below (px)', '下方留白（px）'), 0, 160)}</Box>
      <Typography variant="caption">{stats.ratios.length} {tr('images', '张图片')}{stats.rows > 0 ? ` · ${stats.rows} ${tr('rows', '行')}` : ''}{stats.height ? ` · ${tr('Height', '高度')} ${Math.round(stats.height)} px` : ''}</Typography>
      <Button size="small" onClick={() => onChange(setMediaLayout(config, viewport, question.name, null))}>{tr('Restore automatic layout', '恢复默认自动排版')}</Button>
    </>}
    <details><summary>{tr('Test different samples', '验证随机样本')}</summary>
    <Stack direction="row"><Button size="small" onClick={onSample}>{tr('Resample preview', '换一组样本')}</Button><Button size="small" onClick={onReverse}>{tr('Reverse preview order', '反转预览顺序')}</Button></Stack>
    <Typography variant="caption" color="text.secondary">{tr('Preview only. Sampling settings and stored option order stay unchanged.', '仅验证预览，不修改抽样设置和已存选项顺序。')}</Typography></details>
    {saved && otherQuestions.length > 0 && <details><summary>{tr('Reuse this layout', '复用此布局')}</summary>
      <Typography variant="caption">{tr('Copy this device’s image layout to:', '将当前设备的图片布局复制到：')}</Typography>
      <Box sx={{ maxHeight: 200, overflow: 'auto' }}>{otherQuestions.map(q => <FormControlLabel key={q.name} control={<Checkbox size="small" checked={targets.includes(q.name)} onChange={(_, checked) => setTargets(old => checked ? [...old, q.name] : old.filter(n => n !== q.name))} />} label={<Typography variant="caption">{typeof q.title === 'string' ? q.title : q.name}</Typography>} />)}</Box>
      <Button size="small" disabled={!targets.length} onClick={() => { let next = config; targets.forEach(name => { next = setMediaLayout(next, viewport, name, rule); }); onChange(next); setTargets([]); }}>{tr('Apply to selected questions', '应用到勾选题目')}</Button>
    </details>}
  </Stack>;
}
