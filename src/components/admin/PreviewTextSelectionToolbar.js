import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, IconButton, MenuItem, Stack, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { FormatBold, FormatItalic, FormatUnderlined, FormatColorFill, FormatColorReset } from '@mui/icons-material';
import { FONT_FAMILIES } from '../../lib/viewportTypography';
import { selectedTextTarget, setSelectedTextStyle } from '../../lib/selectedTextStyles';
import { setDescriptionFormatting } from '../../lib/descriptionFormatting';
import { createTextSelectionHighlight, readSelectedTextFormat, selectedTextRange } from '../../lib/textSelectionPresentation';

export default function PreviewTextSelectionToolbar({ canvasRef, config, viewport, labels, onChange, onStart, onEnd, enabled, onEditDescription, selectionScope, editingText = false }) {
  const [target, setTarget] = useState(null);
  const [format, setFormat] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(null);
  const dragging = useRef(false);
  const toolbarFocus = useRef(false);
  const highlightName = `sp-selection-${useId().replace(/:/g, '')}`;
  const stateRef = useRef();
  stateRef.current = { config, viewport, target, enabled, onChange, onEnd };
  const clear = () => { onEnd(false); setTarget(null); setFormat(null); setSizeDraft(null); };
  useEffect(() => {
    const current = stateRef.current.target;
    if (current && selectionScope && (current.kind !== selectionScope.kind || (current.name || '') !== (selectionScope.name || ''))) {
      setTarget(null); setFormat(null); setSizeDraft(null);
    }
  }, [selectionScope]);
  useEffect(() => { setTarget(null); setFormat(null); setSizeDraft(null); }, [viewport, enabled]);

  useEffect(() => {
    const capture = (event) => {
      if (event?.type === 'pointerup') dragging.current = false;
      if (event?.target?.closest?.('[data-sp-inline-editor]') || document.activeElement?.closest('[data-sp-inline-editor]')) return;
      if (!enabled || !canvasRef.current || dragging.current || toolbarFocus.current) return;
      const next = selectedTextTarget(window.getSelection(), canvasRef.current, event?.type === 'pointerup');
      if (next) {
        setTarget((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        setSizeDraft(null);
      }
    };
    const canvas = canvasRef.current;
    const startDrag = (event) => {
      toolbarFocus.current = false;
      dragging.current = true;
      if (!event.target.closest('[data-sp-edit]')) { setTarget(null); setFormat(null); }
    };
    const onKey = () => { toolbarFocus.current = false; };
    const endDrag = () => { dragging.current = false; };
    document.addEventListener('selectionchange', capture);
    canvas?.addEventListener('pointerdown', startDrag);
    canvas?.addEventListener('keydown', onKey);
    canvas?.addEventListener('pointerup', capture);
    document.addEventListener('pointerup', endDrag);
    return () => {
      document.removeEventListener('selectionchange', capture);
      canvas?.removeEventListener('pointerup', capture);
      canvas?.removeEventListener('pointerdown', startDrag);
      canvas?.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerup', endDrag);
    };
  }, [canvasRef, enabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !target || !enabled) return undefined;
    const highlight = createTextSelectionHighlight(canvas, highlightName);
    let frame;
    const refresh = () => {
      const current = readSelectedTextFormat(canvas, target);
      if (current) setFormat((old) => JSON.stringify(old) === JSON.stringify(current) ? old : current);
      highlight.update(selectedTextRange(canvas, target));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => !(m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest('[data-sp-selection-overlay]') && (m.type !== 'childList' || ![...m.addedNodes, ...m.removedNodes].every((n) => n.nodeType === 1 && n.hasAttribute('data-sp-selection-overlay'))))) refresh();
    });
    observer.observe(canvas, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    canvas.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    refresh(); schedule();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); highlight.clear();
      canvas.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    };
  }, [canvasRef, target, enabled, highlightName, config]);

  const active = !!target && !!format && enabled;
  const apply = (style) => {
    const current = stateRef.current;
    if (!current.target || !current.enabled) return;
    const semanticField = ['bold', 'italic'].find((field) => typeof style?.[field] === 'boolean');
    if (current.target.field === 'description' && semanticField) {
      current.onChange(setDescriptionFormatting(current.config, current.target, semanticField, style[semanticField]));
      return;
    }
    current.onChange(setSelectedTextStyle(current.config, current.viewport, current.target, style));
  };
  const selectionLabel = active
    ? `${target.whole ? labels.selectedTextBox : labels.selectedText} · ${viewport === 'mobile' ? labels.mobileOnly : labels.desktopOnly}: “${target.text.slice(target.start, target.end)}”`
    : editingText ? labels.finishTextBeforeFormatting : enabled ? labels.selectTextPrompt : labels.enableTextEditing;
  return <Box data-sp-text-toolbar="" role="region" aria-label={labels.selectedText} onPointerDownCapture={() => { toolbarFocus.current = true; }} onFocusCapture={() => { toolbarFocus.current = true; }} className="sp-text-tools" sx={{ flexBasis: '100%', minWidth: 0, borderTop: '1px solid', borderColor: 'divider', pt: 1, mt: 0 }}>
    <style>{`::highlight(${highlightName}) { background-color: rgba(49, 121, 215, .28); }`}</style>
    <Stack className="sp-text-controls" direction="row" useFlexGap gap={0.75} alignItems="center">
      <TextField select size="small" disabled={!active} label={labels.fontFamily} value={active ? format.fontFamily : ''} sx={{ width: 170 }} onChange={(event) => {
        if (!FONT_FAMILIES[event.target.value]) return;
        onEnd(false); apply({ fontFamily: event.target.value });
      }}>
        <MenuItem value="" disabled>{labels.fontFamily}</MenuItem>
        {format?.fontFamily === '__mixed' && <MenuItem value="__mixed" disabled>{labels.mixedFormatting}</MenuItem>}
        {format?.fontFamily === '__computed' && <MenuItem value="__computed" disabled>{format.fontLabel}</MenuItem>}
        {Object.keys(FONT_FAMILIES).map((font) => <MenuItem key={font} value={font} sx={{ fontFamily: FONT_FAMILIES[font] }}>{labels.fontNames[font]}</MenuItem>)}
      </TextField>
      <TextField size="small" disabled={!active} type="number" label={labels.selectedFontSize}
        value={sizeDraft ?? (active ? format.fontSize : '')} placeholder={format?.mixedSize ? labels.mixedFormatting : ''}
        onFocus={() => { setSizeDraft(String(format?.fontSize ?? '')); onStart(); }}
        onChange={(event) => {
          const raw = event.target.value; setSizeDraft(raw);
          if (raw !== '' && Number(raw) >= 10 && Number(raw) <= 96) apply({ fontSize: Number(raw) });
        }}
        onBlur={() => {
          if (sizeDraft !== null && sizeDraft !== '' && Number.isFinite(Number(sizeDraft)) && (Number(sizeDraft) < 10 || Number(sizeDraft) > 96)) apply({ fontSize: Math.max(10, Math.min(96, Number(sizeDraft))) });
          setSizeDraft(null); onEnd(false);
        }} inputProps={{ min: 10, max: 96, step: 1 }} InputLabelProps={{ shrink: active || undefined }} sx={{ width: 110 }} />
      <Stack direction="row" spacing={0.25}>
        {[[ 'bold', <FormatBold /> ], [ 'italic', <FormatItalic /> ], [ 'underline', <FormatUnderlined /> ]].map(([field, icon]) => (
          <Tooltip key={field} title={`${labels[field]}${target?.field === 'description' && field !== 'underline' ? ` · ${labels.sharedMarkdown}` : format?.[field] === null ? ` · ${labels.mixedFormatting}` : ''}`}>
            <span><ToggleButton size="small" value={field} aria-label={labels[field]} selected={active && format[field] === true} aria-pressed={active && format[field] === null ? 'mixed' : active && format[field] === true} disabled={!active}
              onChange={() => { onEnd(false); apply({ [field]: format[field] !== true }); }}>{icon}</ToggleButton></span>
          </Tooltip>
        ))}
        <Tooltip title={labels.toggleHighlight}><span><ToggleButton size="small" value="highlight" aria-label={labels.toggleHighlight} disabled={!active}
          selected={active && !!format.highlight && format.highlight !== 'transparent'} onChange={() => { onEnd(false); apply({ highlight: format.highlight && format.highlight !== 'transparent' ? 'transparent' : '#fff59d' }); }}><FormatColorFill /></ToggleButton></span></Tooltip>
      </Stack>
      {['color', 'highlight'].map((field) => <Tooltip key={field} describeChild title={format?.[field] === null ? labels.mixedFormatting : field === 'highlight' && format?.highlight === 'transparent' ? labels.noHighlight : labels[field]}>
        <TextField size="small" type="color" label={labels[field]} disabled={!active}
          value={active && format[field] && format[field] !== 'transparent' ? format[field] : field === 'color' ? '#000000' : '#fff59d'}
          onFocus={onStart} onBlur={() => onEnd(false)} onChange={(event) => apply({ [field]: event.target.value })}
          inputProps={{ 'aria-label': labels[field] }} InputLabelProps={{ shrink: true }} sx={{ width: 82, '& input': { height: 24, p: '7px' } }} />
      </Tooltip>)}
      <Tooltip title={labels.clearHighlight}><span><IconButton size="small" aria-label={labels.clearHighlight} disabled={!active || format.highlight === 'transparent'} onClick={() => { onEnd(false); apply({ highlight: 'transparent' }); }}><FormatColorReset /></IconButton></span></Tooltip>
      <Button size="small" disabled={!active} onClick={() => { onEnd(false); apply(null); }}>{labels.restoreInheritance}</Button>
      {onEditDescription && <Button size="small" disabled={!active || target?.field !== 'description'} onClick={() => { onEnd(false); onEditDescription(target); clear(); }}>{labels.editMarkdown}</Button>}
      <Button size="small" disabled={!active} onClick={clear}>{labels.dismissSelection}</Button>
    </Stack>
    <Stack className="sp-text-selection-status" direction="row" spacing={2}>
      <Typography variant="caption" color="text.secondary" title={selectionLabel} sx={{ flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectionLabel}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ visibility: active && target.field === 'description' ? 'visible' : 'hidden', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labels.sharedMarkdownHint}</Typography>
    </Stack>
  </Box>;
}
