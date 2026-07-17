/**
 * Image gallery layout — used by every image-based question type:
 *   - SurveyJS built-in `imagepicker` (root `.sd-imagepicker`)
 *   - Custom widgets (image rating, image boolean, image matrix, image
 *     ranking) — they opt in by wrapping their image grid in a
 *     `.sp-image-gallery` div and tagging each card / cell with
 *     `.sp-image-gallery__item`.
 *
 * Goals (from product feedback):
 *   1. Every image is shown at its NATURAL aspect ratio (no crop, no stretch).
 *   2. All images in the same QUESTION share the SAME visual height, so they
 *      line up nicely instead of looking jagged.
 *   3. As many items as possible sit on a single row; their widths grow /
 *      shrink proportionally to each image's natural aspect ratio so a
 *      panoramic photo gets a wider slot and a square photo gets a narrower
 *      slot.
 *   4. Never compress images below MIN_HEIGHT — wrap to a new row first.
 *   5. The image's box is exactly the rendered image's size, so any
 *      absolutely-positioned overlay (e.g. the imagepicker check decorator
 *      or the ranking #N badge) sits on the image, not next to it.
 *
 * Two layout modes:
 *   - HORIZONTAL (default): "justified rows" packing, multiple items per
 *     row, widths proportional to AR.
 *   - VERTICAL (`.sp-image-gallery--vertical`): one item per row at full
 *     row width — the image is sized to (unified_h x AR, unified_h) and
 *     centered horizontally within the row. This is what the image
 *     ranking widget uses, where each row must be a single draggable card.
 *
 * Implementation notes:
 *   - We strip the `width` / `height` HTML attributes that SurveyJS sometimes
 *     injects on imagepicker images, because those attributes set the image's
 *     INTRINSIC size and would otherwise interfere with our layout math.
 *   - We re-run on every image load, on resize, and whenever new gallery
 *     roots are inserted into the document.
 */

const ROOT_SELECTOR = '.sd-imagepicker, .sp-image-gallery, .sd-image';
const ATTRS_TO_STRIP = ['width', 'height'];

// Desktop defaults. Phones use denser tunables so imagepicker can fit 2–3
// thumbs per row instead of one luxury full-width image.
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 200;
const MAX_DISPLAY_HEIGHT = 480;
const ITEM_GAP = 12;       // px — keep in sync with CSS `gap` (desktop)
const FALLBACK_AR = 4 / 3; // used until an image's natural size is known
const MOBILE_WIDTH = 600;

let installed = false;
const pendingRoots = new Set();
let rafScheduled = false;

/** Viewport-aware sizing so narrow screens pack more images per row. */
function getLayoutTunables(availableWidth) {
  const narrow = availableWidth > 0 && availableWidth < MOBILE_WIDTH;
  if (narrow) {
    return {
      minHeight: 72,
      maxHeight: 132,
      // Ranking rows: keep shorter so 4–6 items don't fill the whole phone screen
      verticalMaxHeight: 96,
      maxDisplayHeight: 260,
      itemGap: 8,
    };
  }
  return {
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    verticalMaxHeight: MAX_HEIGHT,
    maxDisplayHeight: MAX_DISPLAY_HEIGHT,
    itemGap: ITEM_GAP,
  };
}

function stripSizeAttrs(img) {
  if (!img || img.nodeType !== 1) return false;
  let changed = false;
  for (const attr of ATTRS_TO_STRIP) {
    if (img.hasAttribute(attr)) {
      img.removeAttribute(attr);
      changed = true;
    }
  }
  return changed;
}

function getNaturalAR(img) {
  if (!img) return FALLBACK_AR;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w > 0 && h > 0) return w / h;
  return FALLBACK_AR;
}

function getRootConfig(root) {
  // Returns the per-root selector strategy + layout mode.
  if (root.classList.contains('sd-imagepicker')) {
    return {
      mode: 'horizontal',
      itemSelector: '.sd-imagepicker__item',
      imgSelector: '.sd-imagepicker__image',
      containerSelector: '.sd-imagepicker__image-container',
    };
  }
  if (root.classList.contains('sd-image')) {
    // SurveyJS read-only "image display" question. Has a single <img>
    // direct child; we treat the root itself as the only "item".
    return {
      mode: 'display',
      itemSelector: ':scope', // the root element is the item
      imgSelector: '.sd-image__image',
      containerSelector: null,
    };
  }
  // Custom .sp-image-gallery
  return {
    mode: root.classList.contains('sp-image-gallery--vertical') ? 'vertical' : 'horizontal',
    itemSelector: '.sp-image-gallery__item',
    imgSelector: 'img',
    containerSelector: '.sp-image-gallery__image-container',
  };
}

function findGalleryRoots(node) {
  if (!node) return [];
  const out = [];
  if (node.nodeType === 1) {
    if (node.matches && node.matches(ROOT_SELECTOR)) out.push(node);
    if (node.querySelectorAll) node.querySelectorAll(ROOT_SELECTOR).forEach((r) => out.push(r));
  } else if (node.nodeType === 9 && node.querySelectorAll) {
    node.querySelectorAll(ROOT_SELECTOR).forEach((r) => out.push(r));
  }
  return out;
}

function getContentWidth(el) {
  if (!el) return 0;
  const cs = window.getComputedStyle(el);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(0, (el.clientWidth || 0) - padX);
}

function packRows(items, availableWidth, minHeight = MIN_HEIGHT, itemGap = ITEM_GAP) {
  // Greedy first-fit. We keep adding items to the current row as long as the
  // row would still fit AT minHeight (the row's height is then computed as
  // the ideal that fills the row, clamped to [MIN, MAX]). Using MIN as the
  // cut-off lets two side-by-side panoramic images share one row at, say,
  // height 110, instead of being forced onto separate rows just because
  // they didn't fit at MAX_HEIGHT.
  const rows = [];
  let i = 0;
  while (i < items.length) {
    const row = [];
    let sumAR = 0;
    while (i < items.length) {
      const it = items[i];
      const newSum = sumAR + it.ar;
      const itemsInRow = row.length + 1;
      const totalGap = itemGap * (itemsInRow - 1);
      const minPossibleWidth = newSum * minHeight + totalGap;
      if (minPossibleWidth <= availableWidth || row.length === 0) {
        row.push(it);
        sumAR = newSum;
        i++;
      } else {
        break;
      }
    }
    rows.push({ items: row });
  }
  return rows;
}

// We use `setProperty(..., 'important')` everywhere so the inline styles we
// write always beat author CSS rules that may have used `!important`
// themselves (notably the broad `.sd-html img { height: auto !important }`
// fallback we keep around for non-gallery HTML images).
function setImportant(el, prop, value) {
  if (!el || !el.style) return;
  el.style.setProperty(prop, value, 'important');
}

function applyHorizontalLayout(rows) {
  for (const { items, height } of rows) {
    for (const it of items) {
      const w = Math.max(1, Math.round(height * it.ar));
      const h = Math.round(height);
      if (it.item) {
        setImportant(it.item, 'flex', '0 0 auto');
        setImportant(it.item, 'width', w + 'px');
      }
      if (it.container) {
        setImportant(it.container, 'width', w + 'px');
        setImportant(it.container, 'height', h + 'px');
      }
      if (it.img) {
        setImportant(it.img, 'width', w + 'px');
        setImportant(it.img, 'height', h + 'px');
        setImportant(it.img, 'object-fit', 'cover');
        setImportant(it.img, 'max-width', 'none');
        setImportant(it.img, 'max-height', 'none');
      }
    }
  }
}

function applyVerticalLayout(items, height) {
  const h = Math.round(height);
  for (const it of items) {
    const w = Math.max(1, Math.round(height * it.ar));
    if (it.item) {
      setImportant(it.item, 'width', '100%');
      setImportant(it.item, 'max-width', '100%');
    }
    if (it.container) {
      setImportant(it.container, 'width', w + 'px');
      setImportant(it.container, 'height', h + 'px');
      setImportant(it.container, 'margin-left', 'auto');
      setImportant(it.container, 'margin-right', 'auto');
    }
    if (it.img) {
      setImportant(it.img, 'width', w + 'px');
      setImportant(it.img, 'height', h + 'px');
      setImportant(it.img, 'object-fit', 'cover');
      setImportant(it.img, 'max-width', 'none');
      setImportant(it.img, 'max-height', 'none');
    }
  }
}

function layoutRoot(root) {
  if (!root || !root.isConnected) return;
  const cfg = getRootConfig(root);

  // Image-display mode: there are no nested .item elements — the root <div>
  // is the single item that wraps a single <img>. We size the image to its
  // natural AR with a separate, larger MAX_DISPLAY_HEIGHT.
  if (cfg.mode === 'display') {
    const img = root.querySelector(cfg.imgSelector);
    if (!img) return;
    stripSizeAttrs(img);
    if (!img.dataset.spArHook) {
      img.dataset.spArHook = '1';
      const onLoadOrError = () => scheduleRoot(root);
      img.addEventListener('load', onLoadOrError, { once: false });
      img.addEventListener('error', onLoadOrError, { once: true });
    }
    const ar = getNaturalAR(img);
    const availableWidth = getContentWidth(root);
    if (availableWidth <= 0) return;
    const { minHeight, maxDisplayHeight } = getLayoutTunables(availableWidth);
    let h = ar > 0 ? availableWidth / ar : maxDisplayHeight;
    h = Math.max(minHeight, Math.min(maxDisplayHeight, h));
    const w = Math.max(1, Math.round(h * ar));
    setImportant(img, 'width', w + 'px');
    setImportant(img, 'height', Math.round(h) + 'px');
    setImportant(img, 'object-fit', 'cover');
    setImportant(img, 'max-width', '100%');
    setImportant(img, 'max-height', 'none');
    return;
  }

  const itemEls = Array.from(root.querySelectorAll(cfg.itemSelector));
  if (itemEls.length === 0) return;

  // Strip attributes once before measuring + wire load hooks on every image.
  const allItems = itemEls.map((item) => {
    const img = item.querySelector(cfg.imgSelector);
    if (img) {
      stripSizeAttrs(img);
      if (!img.dataset.spArHook) {
        img.dataset.spArHook = '1';
        const onLoadOrError = () => scheduleRoot(root);
        img.addEventListener('load', onLoadOrError, { once: false });
        img.addEventListener('error', onLoadOrError, { once: true });
      }
    }
    return {
      item,
      container: cfg.containerSelector ? item.querySelector(cfg.containerSelector) : null,
      img,
      ar: getNaturalAR(img),
      parent: item.parentElement,
    };
  });

  if (cfg.mode === 'vertical') {
    // One item per row at full row width; image gets unified_h height and
    // (unified_h * AR_i) width, centered horizontally within the row.
    const rootWidth = getContentWidth(root);
    if (rootWidth <= 0) return;
    const { minHeight, verticalMaxHeight, itemGap } = getLayoutTunables(rootWidth);
    root.style.setProperty('--sp-gallery-gap', `${itemGap}px`);
    // Ranking drag-handle sits beside the image — don't size as if the full row is image.
    const handleGutter = root.classList.contains('sp-image-gallery--with-handle') ? 48 : 0;
    const availableWidth = Math.max(80, rootWidth - handleGutter);
    const maxHeight = verticalMaxHeight;
    let unifiedH = maxHeight;
    for (const it of allItems) {
      const ideal = it.ar > 0 ? availableWidth / it.ar : maxHeight;
      if (ideal < unifiedH) unifiedH = ideal;
    }
    unifiedH = Math.max(minHeight, Math.min(maxHeight, unifiedH));
    applyVerticalLayout(allItems, unifiedH);
    return;
  }

  // Horizontal "justified rows" mode.
  // imagepicker: SurveyJS often wraps each choice in its own column with
  // width 100%, which would force one image per row if we pack per-parent.
  // Always pack against the gallery root width instead.
  const isImagePicker = root.classList.contains('sd-imagepicker');
  const rootWidth = getContentWidth(root);
  const { minHeight, maxHeight, itemGap } = getLayoutTunables(rootWidth || 800);
  root.style.setProperty('--sp-gallery-gap', `${itemGap}px`);

  const allRows = [];
  if (isImagePicker || root.classList.contains('sp-image-gallery')) {
    const availableWidth = rootWidth;
    if (availableWidth <= 0) return;
    const rows = packRows(allItems, availableWidth, minHeight, itemGap);
    for (const r of rows) {
      const sumAR = r.items.reduce((s, it) => s + it.ar, 0);
      const totalGap = itemGap * (r.items.length - 1);
      r.availableWidth = availableWidth;
      r.sumAR = sumAR;
      r.totalGap = totalGap;
      allRows.push(r);
    }
  } else {
    // Other horizontal roots: group by parent (legacy multi-column wrappers).
    const byParent = new Map();
    for (const it of allItems) {
      if (!it.parent) continue;
      if (!byParent.has(it.parent)) byParent.set(it.parent, []);
      byParent.get(it.parent).push(it);
    }
    for (const [parent, items] of byParent.entries()) {
      const availableWidth = getContentWidth(parent);
      if (availableWidth <= 0) continue;
      const tunables = getLayoutTunables(availableWidth);
      const rows = packRows(items, availableWidth, tunables.minHeight, tunables.itemGap);
      for (const r of rows) {
        const sumAR = r.items.reduce((s, it) => s + it.ar, 0);
        const totalGap = tunables.itemGap * (r.items.length - 1);
        r.availableWidth = availableWidth;
        r.sumAR = sumAR;
        r.totalGap = totalGap;
        allRows.push(r);
      }
    }
  }
  if (allRows.length === 0) return;

  // Unify heights across EVERY row in this question — no matter which column
  // wrapper they live in. We pick the smallest ideal height so that no row
  // overflows; rows whose ideal is larger simply stay left-aligned with the
  // remaining space on the right (preferable to having uneven heights).
  let unifiedH = maxHeight;
  for (const r of allRows) {
    const ideal = r.sumAR > 0 ? (r.availableWidth - r.totalGap) / r.sumAR : maxHeight;
    if (ideal < unifiedH) unifiedH = ideal;
  }
  unifiedH = Math.max(minHeight, Math.min(maxHeight, unifiedH));
  for (const r of allRows) r.height = unifiedH;

  applyHorizontalLayout(allRows);
}

function scheduleRoot(root) {
  if (!root) return;
  pendingRoots.add(root);
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const r of roots) layoutRoot(r);
  });
}

function scheduleAll(rootList) {
  for (const r of rootList) scheduleRoot(r);
}

export function installImagePickerLayout() {
  if (installed) return;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  installed = true;

  scheduleAll(findGalleryRoots(document));

  // Selector for any <img> we manage (strip width/height HTML attrs +
  // schedule layout for its enclosing root).
  const MANAGED_IMG_SELECTOR =
    '.sd-imagepicker__image, .sd-image__image, .sp-image-gallery img';
  // The subset of imgs whose width/height HTML attributes SurveyJS
  // re-applies after a render and we want to keep stripped.
  const STRIP_TARGET_SELECTOR = '.sd-imagepicker__image, .sd-image__image';

  const observer = new MutationObserver((mutations) => {
    const affectedRoots = new Set();
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          findGalleryRoots(node).forEach((r) => affectedRoots.add(r));
          const handleImg = (img) => {
            const root = img.closest(ROOT_SELECTOR);
            if (!root) return;
            if (img.matches && img.matches(STRIP_TARGET_SELECTOR)) stripSizeAttrs(img);
            affectedRoots.add(root);
          };
          if (node.matches && node.matches(MANAGED_IMG_SELECTOR)) handleImg(node);
          if (node.querySelectorAll) {
            node.querySelectorAll(MANAGED_IMG_SELECTOR).forEach(handleImg);
          }
        });
      } else if (m.type === 'attributes' && m.target && m.target.matches) {
        if (
          m.target.matches(STRIP_TARGET_SELECTOR) &&
          ATTRS_TO_STRIP.includes(m.attributeName)
        ) {
          if (stripSizeAttrs(m.target)) {
            const root = m.target.closest(ROOT_SELECTOR);
            if (root) affectedRoots.add(root);
          }
        }
      }
    }
    if (affectedRoots.size) scheduleAll(affectedRoots);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ATTRS_TO_STRIP,
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(() => {
      scheduleAll(findGalleryRoots(document));
    });
  });
}

// Backwards-compat alias used by src/index.js — old import name still works.
export const installImagePickerSizeStripper = installImagePickerLayout;
