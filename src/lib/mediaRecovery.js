/** Error capture for both SurveyJS-owned images and React media widgets. */
export function handleSurveyMediaError(event, language = 'en') {
  const media = event.target;
  if (!['IMG', 'VIDEO', 'AUDIO'].includes(media?.tagName) || !media.parentElement) return;
  if (media.nextElementSibling?.dataset.spMediaRetry) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.spMediaRetry = 'true';
  button.className = 'sp-media-retry';
  button.textContent = language === 'zh' ? '媒体加载失败，点击重试' : 'Media failed to load. Retry';
  button.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    button.remove();
    if (media.tagName === 'IMG') {
      const source = media.getAttribute('src');
      media.removeAttribute('src');
      media.setAttribute('src', source);
    } else { media.load(); }
  };
  media.after(button);
}
