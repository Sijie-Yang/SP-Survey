import { mediaPlacements, normalizeMediaLayout } from './mediaLayout';
const originals = new WeakMap();
function style(node, property, value) {
  if (!node) return;
  let saved = originals.get(node);
  if (!saved) { saved = new Map(); originals.set(node, saved); }
  if (!saved.has(property)) saved.set(property, [node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
  if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value, 'important');
}
export function resetMediaLayout(root) {
  if (!root.dataset.spMediaMode) return;
  [root, ...root.querySelectorAll('*')].forEach(node => {
    const saved = originals.get(node);
    saved?.forEach(([value, priority], property) => value ? node.style.setProperty(property, value, priority) : node.style.removeProperty(property));
    originals.delete(node);
    node.removeAttribute('data-sp-media-index');
  });
  delete root.dataset.spMediaMode; delete root.dataset.spMediaFallback; delete root.dataset.spMediaRows;
}
export function applyMediaLayout(root, items, width) {
  const source = root.closest('[data-sp-media-layout]')?.getAttribute('data-sp-media-layout');
  if (!source || !items.length || !width) { resetMediaLayout(root); return false; }
  let raw;
  try { raw = JSON.parse(source); } catch { return false; }
  const rule = normalizeMediaLayout(raw), layout = mediaPlacements(rule, items.map(i => i.ar), width);
  root.classList.remove('sp-gallery-stack');
  root.dataset.spMediaMode = layout.mode;
  root.dataset.spMediaFallback = layout.fallback || '';
  root.dataset.spMediaRows = String(layout.rows || 0);
  style(root, 'position', 'relative'); style(root, 'display', 'block');
  style(root, 'margin-top', `${rule.top}px`); style(root, 'margin-bottom', `${rule.bottom}px`);
  let bottom = layout.height;
  items.forEach((it, index) => {
    const p = layout.items[index], host = it.item === root ? it.img : it.item;
    if (!host) return;
    host.dataset.spMediaIndex = String(index);
    // All offsets are relative to the gallery, including SurveyJS column wrappers.
    for (let parent = host.parentElement; parent && parent !== root; parent = parent.parentElement) style(parent, 'position', 'static');
    style(host, 'position', 'absolute'); style(host, 'left', `${p.x}px`); style(host, 'top', `${p.y}px`);
    style(host, 'width', `${p.width}px`); style(host, 'margin', '0'); style(host, 'max-width', 'none');
    style(it.container, 'width', `${p.width}px`); style(it.container, 'height', `${p.height}px`);
    style(it.img, 'width', `${p.width}px`); style(it.img, 'height', `${p.height}px`);
    style(it.img, 'object-fit', 'contain'); style(it.img, 'max-width', 'none'); style(it.img, 'max-height', 'none');
    // Reserve space for choice labels and custom answer controls beneath images.
    bottom = Math.max(bottom, p.y + Math.max(p.height, host.offsetHeight));
  });
  // For row layouts, account for below-image controls before the next row starts.
  if (layout.mode !== 'free') {
    const rows = [...new Set(layout.items.map(p => p.y))].sort((a, b) => a - b);
    let y = 0;
    rows.forEach(row => {
      const indices = layout.items.map((p, i) => p.y === row ? i : -1).filter(i => i >= 0);
      let height = 0;
      indices.forEach(i => { const host = items[i].item === root ? items[i].img : items[i].item; style(host, 'top', `${y}px`); height = Math.max(height, host?.offsetHeight || 0, layout.items[i].height); });
      y += height + rule.rowGap;
    });
    bottom = Math.max(0, y - rule.rowGap);
  }
  style(root, 'height', `${Math.ceil(bottom)}px`);
  return true;
}
