import { FONT_FAMILIES } from './viewportTypography';

export function findSelectedTextHost(container, target) {
  if (!container || !target) return null;
  return [...container.querySelectorAll('[data-sp-edit]')].find((host) => {
    if (host.dataset.spEdit !== `${target.kind}-${target.field}`) return false;
    if (target.kind === 'survey') return true;
    const owner = target.kind === 'question' ? host.closest('[data-sp-question-name]')?.dataset.spQuestionName : host.closest('[data-sp-page-name]')?.dataset.spPageName;
    return owner === target.name;
  }) || null;
}

export function selectedTextNodes(container, target) {
  const host = findSelectedTextHost(container, target);
  if (!host || host.textContent !== target.text) return [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const end = offset + node.textContent.length;
    if (offset < target.end && end > target.start) nodes.push({ node, start: Math.max(0, target.start - offset), end: Math.min(node.textContent.length, target.end - offset) });
    offset = end;
  }
  return nodes;
}

export function selectedTextRange(container, target) {
  const nodes = selectedTextNodes(container, target);
  if (!nodes.length) return null;
  const range = document.createRange();
  range.setStart(nodes[0].node, nodes[0].start);
  range.setEnd(nodes[nodes.length - 1].node, nodes[nodes.length - 1].end);
  return range;
}

const normalizeFamily = (family) => family.split(',').map((part) => part.trim().replace(/["']/g, '').toLowerCase()).join(',');

function uniform(values) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}
export function colorToHex(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
  const channels = String(value).match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3 || channels[3] === 0) return 'transparent';
  return `#${channels.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

// Read rendered values, including inherited theme/card styles and mixed selections.
export function readSelectedTextFormat(container, target) {
  const nodes = selectedTextNodes(container, target);
  if (!nodes.length) return null;
  const styles = nodes.map(({ node }) => getComputedStyle(node.parentElement));
  const families = [...new Set(styles.map((style) => normalizeFamily(style.fontFamily)))];
  const sizes = [...new Set(styles.map((style) => parseFloat(style.fontSize)).filter(Number.isFinite))];
  const family = styles[0].fontFamily;
  const fontId = Object.keys(FONT_FAMILIES).find((id) => normalizeFamily(FONT_FAMILIES[id]) === families[0]);
  return {
    bold: uniform(styles.map((s) => s.fontWeight === 'bold' || Number(s.fontWeight) >= 600)),
    italic: uniform(styles.map((s) => /italic|oblique/.test(s.fontStyle))),
    underline: uniform(styles.map((s) => /underline/.test(s.textDecorationLine || s.textDecoration))),
    color: uniform(styles.map((s) => colorToHex(s.color))),
    highlight: uniform(styles.map((s) => colorToHex(s.backgroundColor))),
    fontFamily: families.length > 1 ? '__mixed' : fontId || '__computed',
    fontLabel: family.split(',')[0].trim().replace(/["']/g, ''),
    fontSize: sizes.length === 1 ? sizes[0] : '',
    mixedSize: sizes.length > 1,
  };
}

// CSS highlights keep the visual selection while focus stays in the toolbar.
// The fallback paints only the text rectangles, without changing editable DOM.
export function createTextSelectionHighlight(canvas, name) {
  const supportsHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof window.Highlight !== 'undefined';
  let overlay = null;
  if (!supportsHighlight) {
    overlay = document.createElement('div');
    overlay.dataset.spSelectionOverlay = '';
    overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;pointer-events:none;z-index:10;';
    canvas.appendChild(overlay);
  }
  return {
    update(range) {
      if (supportsHighlight) {
        if (range) CSS.highlights.set(name, new window.Highlight(range));
        else CSS.highlights.delete(name);
        return;
      }
      overlay.replaceChildren();
      if (!range) return;
      const bounds = canvas.getBoundingClientRect();
      [...range.getClientRects()].forEach((rect) => {
        if (!rect.width || !rect.height) return;
        const mark = document.createElement('div');
        mark.style.cssText = `position:absolute;left:${rect.left - bounds.left + canvas.scrollLeft}px;top:${rect.top - bounds.top + canvas.scrollTop}px;width:${rect.width}px;height:${rect.height}px;background:rgba(49,121,215,.23);`;
        overlay.appendChild(mark);
      });
    },
    clear() { if (supportsHighlight) CSS.highlights.delete(name); overlay?.remove(); },
  };
}
