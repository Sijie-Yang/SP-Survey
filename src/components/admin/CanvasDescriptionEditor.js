import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import DescriptionMarkdownEditor from './DescriptionMarkdownEditor';

/** A stable input outside SurveyJS's rendered string, so live updates never move the caret. */
export default function CanvasDescriptionEditor({ host, value, label, labels, onChange, onClose, onStart, onEnd, initialOffset = 0 }) {
  const [mount, setMount] = useState(null);
  const input = useRef(null);
  useLayoutEffect(() => {
    if (!host?.isConnected) return undefined;
    const container = document.createElement('div');
    container.dataset.spInlineEditor = '';
    host.after(container);
    const display = host.style.display;
    host.style.display = 'none';
    setMount(container);
    return () => { host.style.display = display; container.remove(); };
  }, [host]);
  useLayoutEffect(() => { if (mount) input.current?.focus(initialOffset); }, [mount, initialOffset]);
  if (!mount) return null;
  return createPortal(<Box onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || (event.key === 'Escape' && !event.nativeEvent.isComposing)) {
        event.preventDefault(); event.stopPropagation(); onEnd(); onClose();
      }
    }} sx={{ border: '2px solid #3179d7', borderRadius: 1, p: 1.5, bgcolor: 'background.paper', color: 'text.primary' }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
      <Typography variant="caption">{labels.editWholeDescription}</Typography>
      <Button size="small" onMouseDown={(event) => event.preventDefault()} onClick={() => { onEnd(); onClose(); }}>{labels.finishTextEditing}</Button>
    </Stack>
    <DescriptionMarkdownEditor ref={input} value={value} label={label} paragraphKeys onChange={onChange} onFocus={onStart} onBlur={onEnd} />
  </Box>, mount);
}
