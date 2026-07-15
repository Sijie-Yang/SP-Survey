/** Emotion-color helpers: palettes, intensity derivation, binning. */

/**
 * Map HSL saturation/lightness → intensity 0–100.
 * Vivid mid-lightness colors score highest; gray / near-black / near-white score low.
 * intensity ≈ s × (1 − |l − 50| / 50)
 */
export function intensityFromHsl(s, l) {
  const sat = Number(s);
  const lit = Number(l);
  if (Number.isNaN(sat) || Number.isNaN(lit)) return null;
  const vivid = 1 - Math.abs(lit - 50) / 50;
  return Math.round(Math.max(0, Math.min(100, sat * Math.max(0, vivid))));
}

/**
 * Resolve intensity for analysis.
 * Palette-chip answers intentionally have no intensity (category ≠ vividness).
 * Wheel / image picks: derive from s×mid-lightness; legacy slider as fallback.
 */
export function resolveEmotionIntensity(color) {
  if (!color || typeof color !== 'object') return null;
  const fromPalette = color.source === 'palette'
    || (color.optionId && color.source !== 'wheel' && color.source !== 'image');
  if (fromPalette) return null;

  if (color.source === 'wheel' || color.source === 'image') {
    const derived = intensityFromHsl(color.s, color.l);
    if (derived != null) return derived;
  }

  // Legacy manual slider (pre–auto-intensity) or unspecified continuous picks
  if (color.s != null && color.l != null && !color.optionId) {
    const derived = intensityFromHsl(color.s, color.l);
    if (derived != null) return derived;
  }
  const legacy = Number(color.intensity);
  if (!Number.isNaN(legacy)) return legacy;
  return null;
}

/** Equal-interval 12-bin hue quantization (engineering default — not a psych standard). */
export function hueToBin12(h) {
  return Math.min(11, Math.floor((((h % 360) + 360) % 360 + 15) / 30) % 12);
}

function circularHueDist(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/**
 * Built-in palettes for Emotion Color Mapping.
 * Notes for methods text:
 * - hue12: equal 30° HSL slices (convenient, not a validated emotion scale)
 * - basic: approximate basic color-term set (Berlin–Kay inspired labels; hexes are UI choices)
 * - emotion: Plutchik-inspired primary emotion colors (simplified; not the full wheel model)
 */
export const EMOTION_PALETTES = {
  hue12: {
    id: 'hue12',
    label: '12 equal hue bins (30°)',
    note: 'Equal-interval HSL hue quantization — analysis convenience, not a psych standard.',
    options: Array.from({ length: 12 }, (_, i) => {
      const hue = i * 30;
      const s = 72;
      const l = 48;
      return {
        id: `hue_${hue}`,
        label: `${hue}°`,
        hue,
        s,
        l,
        hex: hslToHex(hue, s, l),
      };
    }),
  },
  basic: {
    id: 'basic',
    label: 'Basic color terms',
    note: 'Berlin–Kay–inspired basic color labels with fixed display swatches.',
    options: [
      { id: 'red', label: 'Red', hue: 0, s: 78, l: 48, hex: '#c62828' },
      { id: 'orange', label: 'Orange', hue: 30, s: 90, l: 50, hex: '#ef6c00' },
      { id: 'yellow', label: 'Yellow', hue: 52, s: 90, l: 52, hex: '#f9a825' },
      { id: 'green', label: 'Green', hue: 120, s: 55, l: 40, hex: '#2e7d32' },
      { id: 'blue', label: 'Blue', hue: 210, s: 70, l: 45, hex: '#1565c0' },
      { id: 'purple', label: 'Purple', hue: 280, s: 55, l: 42, hex: '#6a1b9a' },
      { id: 'pink', label: 'Pink', hue: 330, s: 65, l: 62, hex: '#ec407a' },
      { id: 'brown', label: 'Brown', hue: 25, s: 45, l: 32, hex: '#6d4c41' },
      { id: 'white', label: 'White', hue: 0, s: 0, l: 96, hex: '#f5f5f5' },
      { id: 'gray', label: 'Gray', hue: 0, s: 0, l: 55, hex: '#9e9e9e' },
      { id: 'black', label: 'Black', hue: 0, s: 0, l: 12, hex: '#212121' },
    ],
  },
  emotion: {
    id: 'emotion',
    label: 'Emotion colors (Plutchik-inspired)',
    note: 'Simplified Plutchik-inspired primary emotion colors for response categories.',
    options: [
      { id: 'joy', label: 'Joy', hue: 52, s: 90, l: 52, hex: '#f9a825' },
      { id: 'trust', label: 'Trust', hue: 140, s: 50, l: 42, hex: '#43a047' },
      { id: 'fear', hue: 160, s: 45, l: 28, hex: '#1b5e20', label: 'Fear' },
      { id: 'surprise', label: 'Surprise', hue: 190, s: 70, l: 45, hex: '#00acc1' },
      { id: 'sadness', label: 'Sadness', hue: 220, s: 65, l: 42, hex: '#1e88e5' },
      { id: 'disgust', label: 'Disgust', hue: 290, s: 40, l: 38, hex: '#8e24aa' },
      { id: 'anger', label: 'Anger', hue: 0, s: 78, l: 45, hex: '#e53935' },
      { id: 'anticipation', label: 'Anticipation', hue: 28, s: 85, l: 48, hex: '#fb8c00' },
    ],
  },
};

export function getEmotionPalette(paletteId) {
  return EMOTION_PALETTES[paletteId] || EMOTION_PALETTES.hue12;
}

export function listEmotionPalettes() {
  return Object.values(EMOTION_PALETTES).map((p) => ({
    id: p.id,
    label: p.label,
    note: p.note,
    optionCount: p.options.length,
  }));
}

/** Nearest palette option by circular hue distance (achromatic colors match by lightness). */
export function nearestPaletteOption(paletteId, hue, s = 50, l = 50) {
  const palette = getEmotionPalette(paletteId);
  const options = palette.options || [];
  if (!options.length) return null;
  const sat = Number(s);
  const lit = Number(l);
  const achromatic = !Number.isNaN(sat) && sat < 12;

  if (achromatic && !Number.isNaN(lit)) {
    const neutrals = options.filter((o) => (o.s ?? 0) < 12);
    if (neutrals.length) {
      let best = neutrals[0];
      let bestD = Infinity;
      neutrals.forEach((o) => {
        const d = Math.abs((o.l ?? 50) - lit);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      });
      return best;
    }
  }

  const h = Number(hue);
  if (Number.isNaN(h)) return options[0];
  let best = options[0];
  let bestD = Infinity;
  options.forEach((o) => {
    if ((o.s ?? 0) < 12 && options.some((x) => (x.s ?? 0) >= 12)) return;
    const d = circularHueDist(o.hue ?? 0, h);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  });
  return best;
}

export function enrichEmotionColorConfig(skillConfig = {}) {
  const paletteId = skillConfig.palette || 'hue12';
  const responseMode = skillConfig.responseMode || 'palette';
  const palette = getEmotionPalette(paletteId);
  return {
    ...skillConfig,
    palette: paletteId,
    responseMode,
    paletteColors: palette.options,
    paletteLabel: palette.label,
    paletteNote: palette.note,
  };
}

function hslToHex(h, s, l) {
  let ss = s / 100;
  let ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c; g = x;
  } else if (h < 120) {
    r = x; g = c;
  } else if (h < 180) {
    g = c; b = x;
  } else if (h < 240) {
    g = x; b = c;
  } else if (h < 300) {
    r = x; b = c;
  } else {
    r = c; b = x;
  }
  const toHex = (n) => {
    const v = Math.round((n + m) * 255).toString(16);
    return v.length === 1 ? `0${v}` : v;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
