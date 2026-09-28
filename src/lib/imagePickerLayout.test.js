import {
  getLayoutTunables,
  layoutImageGallery,
  MOBILE_WIDTH,
  shouldStackGalleryOnMobile,
} from './imagePickerLayout';

describe('imagePickerLayout mobile stacking', () => {
  test('stacks 1–2 images on a phone-width gallery', () => {
    expect(shouldStackGalleryOnMobile(2, 390)).toBe(true);
    expect(shouldStackGalleryOnMobile(1, 360)).toBe(true);
    expect(shouldStackGalleryOnMobile(2, MOBILE_WIDTH - 1)).toBe(true);
  });

  test('does not stack 3+ images or desktop widths', () => {
    expect(shouldStackGalleryOnMobile(3, 390)).toBe(false);
    expect(shouldStackGalleryOnMobile(2, MOBILE_WIDTH)).toBe(false);
    expect(shouldStackGalleryOnMobile(2, 960)).toBe(false);
    expect(shouldStackGalleryOnMobile(0, 390)).toBe(false);
    expect(shouldStackGalleryOnMobile(2, 560, 1920)).toBe(false);
  });

  test('phone tunables keep a readable minimum height', () => {
    const phone = getLayoutTunables(390);
    const desk = getLayoutTunables(960);
    expect(phone.minHeight).toBeGreaterThanOrEqual(140);
    expect(phone.maxDisplayHeight).toBeGreaterThanOrEqual(280);
    expect(desk.minHeight).toBeLessThan(phone.minHeight);
  });
});

describe('rendered gallery sizing', () => {
  const originalWidth = window.innerWidth;
  afterEach(() => {
    document.body.innerHTML = '';
    window.innerWidth = originalWidth;
  });

  function gallery({ count = 3, aspect = 4, ranking = false, display = false } = {}) {
    window.innerWidth = 390;
    const root = document.createElement('div');
    root.className = display ? 'sd-image' : ranking
      ? 'sp-image-gallery sp-image-gallery--vertical sp-image-gallery--with-handle'
      : 'sd-imagepicker';
    let width = 320;
    Object.defineProperty(root, 'clientWidth', { get: () => width });
    root.innerHTML = display ? '<img class="sd-image__image" />'
      : Array.from({ length: count }, () => ranking
        ? '<div class="sp-image-gallery__item"><div class="sp-image-gallery__image-container"><img /></div></div>'
        : '<div class="sd-imagepicker__item"><div class="sd-imagepicker__image-container"><img class="sd-imagepicker__image" /></div></div>'
      ).join('');
    root.querySelectorAll('img').forEach(img => {
      Object.defineProperty(img, 'naturalWidth', { value: aspect * 100 });
      Object.defineProperty(img, 'naturalHeight', { value: 100 });
    });
    document.body.appendChild(root);
    return { root, resize: (nextWidth) => { width = nextWidth; } };
  }

  test('three panoramic choices fit the mobile width without forcing stacked mode', () => {
    const { root } = gallery();
    layoutImageGallery(root);
    expect(root.classList.contains('sp-gallery-stack')).toBe(false);
    root.querySelectorAll('img').forEach(img => {
      expect(parseFloat(img.style.width)).toBeLessThanOrEqual(320);
      expect(parseFloat(img.style.width) / parseFloat(img.style.height)).toBe(4);
    });
  });

  test('ranking images fit alongside the handle and respect the mobile height cap', () => {
    const { root } = gallery({ ranking: true });
    layoutImageGallery(root);
    root.querySelectorAll('img').forEach(img => {
      expect(parseFloat(img.style.width)).toBeLessThanOrEqual(320 - 48);
      expect(parseFloat(img.style.height)).toBeLessThanOrEqual(120);
    });
  });

  test('standalone panoramas retain their aspect ratio within the phone width', () => {
    const { root } = gallery({ display: true });
    layoutImageGallery(root);
    const img = root.querySelector('img');
    expect(parseFloat(img.style.width)).toBe(320);
    expect(parseFloat(img.style.height)).toBe(80);
  });

  test('two choices switch from full mobile rows back to desktop sizing', () => {
    const { root, resize } = gallery({ count: 2, aspect: 1 });
    layoutImageGallery(root);
    expect(root.classList.contains('sp-gallery-stack')).toBe(true);
    expect(root.firstChild.style.width).toBe('100%');
    window.innerWidth = 1200;
    resize(960);
    layoutImageGallery(root);
    expect(root.classList.contains('sp-gallery-stack')).toBe(false);
    expect(root.firstChild.style.width).toBe('200px');
  });
});
