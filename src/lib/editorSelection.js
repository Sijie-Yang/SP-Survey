/** Shell identity. Working-copy text is not part of it, so typing does not repaint the admin. */
export function editorSelectionIdentity(selection) {
  if (!selection) return '';
  return [
    selection.panel || '',
    selection.pageName || '',
    selection.questionName || '',
    selection.dirty ? '1' : '0',
    selection.pageDirty ? '1' : '0',
  ].join('\0');
}

/** Keep the previous state object when only the working copy changed. */
export function nextEditorSelectionState(current, next) {
  if (editorSelectionIdentity(current) === editorSelectionIdentity(next)) return current;
  return next ?? null;
}
