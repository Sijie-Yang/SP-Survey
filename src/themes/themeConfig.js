import { createTheme } from '@mui/material/styles';

/** Preset palettes for Admin theme picker (and default public brand = Ocean Blue). */
export const themes = {
  default: {
    name: 'Ocean Blue',
    icon: '🌊',
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#f5f5f5',
    paper: '#ffffff',
    mode: 'light',
  },
  purple: {
    name: 'Royal Purple',
    icon: '👑',
    primary: '#7b1fa2',
    secondary: '#f06292',
    background: '#f3e5f5',
    paper: '#ffffff',
    mode: 'light',
  },
  teal: {
    name: 'Modern Teal',
    icon: '🎯',
    primary: '#009688',
    secondary: '#ff6f00',
    background: '#e0f2f1',
    paper: '#ffffff',
    mode: 'light',
  },
  dark: {
    name: 'Midnight Dark',
    icon: '🌙',
    primary: '#90caf9',
    secondary: '#f48fb1',
    background: '#121212',
    paper: '#1e1e1e',
    mode: 'dark',
  },
  orange: {
    name: 'Sunset Orange',
    icon: '🌅',
    primary: '#ff6f00',
    secondary: '#f50057',
    background: '#fff3e0',
    paper: '#ffffff',
    mode: 'light',
  },
  green: {
    name: 'Forest Green',
    icon: '🌲',
    primary: '#2e7d32',
    secondary: '#ff6f00',
    background: '#e8f5e9',
    paper: '#ffffff',
    mode: 'light',
  },
  rosegold: {
    name: 'Rose Gold',
    icon: '💎',
    primary: '#c2185b',
    secondary: '#ffd54f',
    background: '#fce4ec',
    paper: '#ffffff',
    mode: 'light',
  },
  techblue: {
    name: 'Tech Blue',
    icon: '🚀',
    primary: '#0277bd',
    secondary: '#00e676',
    background: '#e1f5fe',
    paper: '#ffffff',
    mode: 'light',
  },
};

export const DEFAULT_THEME_KEY = 'default';

const FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

/**
 * Tokenized MUI theme factory — used by App root + AdminApp picker.
 * @param {string} [themeKey]
 */
export function createCustomTheme(themeKey = DEFAULT_THEME_KEY) {
  const cfg = themes[themeKey] || themes.default;
  const isDark = cfg.mode === 'dark';

  return createTheme({
    palette: {
      mode: cfg.mode,
      primary: { main: cfg.primary },
      secondary: { main: cfg.secondary },
      background: {
        default: cfg.background,
        paper: cfg.paper,
      },
      divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
    },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontWeight: 700 },
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    shadows: [
      'none',
      '0 1px 2px rgba(0,0,0,0.04)',
      '0 1px 3px rgba(0,0,0,0.06)',
      '0 2px 8px rgba(0,0,0,0.08)',
      '0 4px 16px rgba(0,0,0,0.1)',
      ...Array(20).fill('0 4px 16px rgba(0,0,0,0.1)'),
    ],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            transition: 'background-color 0.2s ease',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 8,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          outlined: {
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: 12,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 12 },
        },
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined' },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { fontSize: '0.75rem' },
        },
      },
    },
  });
}

/** Map MUI/admin palette → SurveyJS CSS variables (valid numbers only). */
function hexToRgb(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function paletteToSurveyJsVars({ primary, secondary, mode = 'light' } = {}) {
  const p = primary || themes.default.primary;
  const rgb = hexToRgb(p) || { r: 25, g: 118, b: 210 };
  const isDark = mode === 'dark';
  return {
    '--sjs-primary-backcolor': p,
    '--sjs-primary-backcolor-dark': p,
    '--sjs-primary-backcolor-light': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.15 : 0.1})`,
    '--sjs-primary-forecolor': '#ffffff',
    '--sjs-primary-forecolor-light': 'rgba(255,255,255,0.75)',
    '--sjs-general-backcolor': isDark ? '#1e1e1e' : '#ffffff',
    '--sjs-general-backcolor-dim': isDark ? '#121212' : '#f5f5f5',
    '--sjs-general-forecolor': isDark ? '#f5f5f5' : '#1a1a1a',
    '--sjs-general-forecolor-light': isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
    '--sjs-corner-radius': '8px',
    '--sjs-base-unit': '8px',
    '--sjs-border-default': isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
    '--sjs-border-light': isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    '--sjs-shadow-small': '0 1px 3px rgba(0,0,0,0.08)',
    '--sjs-shadow-medium': '0 2px 8px rgba(0,0,0,0.1)',
    ...(secondary ? { '--sjs-secondary-backcolor': secondary } : {}),
  };
}
