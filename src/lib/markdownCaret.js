/** Scroll a textarea's actual caret into view, including wrapped source lines. */
export function revealMarkdownCaret(input) {
  if (!input?.isConnected) return;
  const style = getComputedStyle(input);
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden',
    width: `${input.clientWidth}px`, boxSizing: 'border-box', whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word', font: style.font, letterSpacing: style.letterSpacing,
    padding: style.padding, border: style.border, tabSize: style.tabSize,
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
  input.scrollTop = Math.max(0, top - input.clientHeight / 2);
  mirror.remove();
  input.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}
