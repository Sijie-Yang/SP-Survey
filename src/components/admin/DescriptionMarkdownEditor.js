import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { descriptionMarkdownToHtml } from '../../lib/surveyMarkdown';
import { revealMarkdownCaret } from '../../lib/markdownCaret';

/** Controlled Markdown source: the same description string used by SurveyJS. */
const DescriptionMarkdownEditor = forwardRef(function DescriptionMarkdownEditor({ value = '', label, onChange, onFocus, onBlur, paragraphKeys = false }, ref) {
  const { language } = useRegion();
  const zh = language === 'zh';
  const input = useRef(null);
  const [preview, setPreview] = useState(false);
  const [caret, setCaret] = useState(0);
  const selection = useRef({ start: 0, end: 0 });
  const focusFrame = useRef();
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  const source = typeof value === 'string' ? value : '';
  const html = useMemo(() => descriptionMarkdownToHtml(source), [source]);
  const rememberSelection = (node) => {
    selection.current = { start: node.selectionStart, end: node.selectionEnd };
    setCaret(node.selectionStart);
  };
  const focus = (offset) => {
    const position = typeof offset === 'number' ? { start: offset, end: offset } : { ...selection.current };
    setPreview(false);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const node = input.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(position.start, position.end);
      rememberSelection(node);
      revealMarkdownCaret(node);
    });
  };
  useImperativeHandle(ref, () => ({ focus }));
  const insert = (prefix, suffix = '', block = false) => {
    const node = input.current;
    if (!node) return;
    let start = node.selectionStart, end = node.selectionEnd;
    if (block) start = source.lastIndexOf('\n', start - 1) + 1;
    const selected = source.slice(start, end);
    const text = selected || (zh ? '文字' : 'text');
    const replacement = block ? text.split('\n').map((line) => prefix + line).join('\n') : prefix + text + suffix;
    onChange(source.slice(0, start) + replacement + source.slice(end));
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length);
      rememberSelection(node);
    });
  };
  const actions = [
    [zh ? '加粗' : 'Bold', '**', '**'], [zh ? '斜体' : 'Italic', '*', '*'],
    [zh ? '标题' : 'Heading', '### ', '', true], [zh ? '列表' : 'List', '- ', '', true],
    [zh ? '链接' : 'Link', '[', '](https://example.com)'], [zh ? '引用' : 'Quote', '> ', '', true],
  ];
  const handleKeyDown = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const marker = event.key.toLowerCase() === 'b' ? '**' : '*';
      insert(marker, marker);
    } else if (paragraphKeys && event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const node = event.target;
      const start = node.selectionStart, end = node.selectionEnd;
      const before = source.slice(0, start);
      // Within fenced code, Enter keeps its usual literal newline behavior.
      if ((before.match(/^\s*(```|~~~)/gm) || []).length % 2) return;
      const lineStart = before.lastIndexOf('\n') + 1;
      const list = before.slice(lineStart).match(/^(\s*)([-+*]|\d+[.)]) (.*)$/);
      let replacement = event.shiftKey ? '  \n' : '\n\n';
      let from = start;
      if (list && !event.shiftKey) {
        if (!list[3].trim()) { from = lineStart; replacement = '\n'; }
        else {
          const marker = /^\d/.test(list[2]) ? `${parseInt(list[2], 10) + 1}${list[2].slice(-1)}` : list[2];
          replacement = `\n${list[1]}${marker} `;
        }
      }
      event.preventDefault();
      onChange(source.slice(0, from) + replacement + source.slice(end));
      requestAnimationFrame(() => {
        node.setSelectionRange(from + replacement.length, from + replacement.length);
        rememberSelection(node);
      });
    }
  };
  const linesBeforeCaret = source.slice(0, caret).split('\n');
  const positionLabel = zh ? `第 ${linesBeforeCaret.length} 行，第 ${Array.from(linesBeforeCaret.at(-1)).length + 1} 列` : `Line ${linesBeforeCaret.length}, column ${Array.from(linesBeforeCaret.at(-1)).length + 1}`;
  return <Box data-description-editor="" sx={{ minWidth: 0 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
      <Typography variant="caption" color="text.secondary">Markdown</Typography>
      <Button size="small" aria-pressed={preview} onClick={() => preview ? focus() : setPreview(true)}>{preview ? (zh ? '编辑源码' : 'Edit source') : (zh ? '预览效果' : 'Preview formatting')}</Button>
    </Stack>
    {preview ? <Box role="region" aria-label={`${label} · ${zh ? '预览' : 'Preview'}`} className="sp-description-markdown" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, minHeight: 100, overflowWrap: 'anywhere' }}>
      {source ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <Typography color="text.secondary" variant="body2">{zh ? '暂无说明' : 'No description yet'}</Typography>}
    </Box> : <>
      <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ mb: 0.5 }}>
        {actions.map(([name, prefix, suffix, block]) => <Button key={name} size="small" sx={{ minWidth: 0, px: 0.8 }} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(prefix, suffix, block)}>{name}</Button>)}
      </Stack>
      <Typography variant="caption" color="primary.main" data-markdown-position="" sx={{ display: 'block', mb: 0.75, fontVariantNumeric: 'tabular-nums' }}>{positionLabel}</Typography>
      <TextField inputRef={input} name="description" fullWidth size="small" multiline minRows={4} maxRows={18} label={label} value={source}
        onFocus={(event) => { rememberSelection(event.target); onFocus?.(event); }} onBlur={onBlur} onSelect={(event) => rememberSelection(event.target)} onKeyDown={handleKeyDown} onChange={(event) => { rememberSelection(event.target); onChange(event.target.value); }}
        sx={(theme) => ({ '& textarea': { fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6, caretColor: theme.palette.primary.main, color: theme.palette.text.primary } })} />
    </>}
    {paragraphKeys && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{zh ? 'Enter 新建段落 · Shift+Enter 换行 · Ctrl/⌘+Enter 完成。修改实时同步。' : 'Enter: new paragraph · Shift+Enter: line break · Ctrl/⌘+Enter: done. Changes sync live.'}</Typography>}
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, lineHeight: 1.5 }}>
      {zh ? '空行分段；支持加粗、斜体、列表、链接、标题、引用、代码和表格。内容及 Markdown 格式在电脑与手机端共用。' : 'Blank lines separate paragraphs. Supports bold, italic, lists, links, headings, quotes, code and tables. Content and Markdown formatting are shared across desktop and mobile.'}
    </Typography>
  </Box>;
});

export default DescriptionMarkdownEditor;
