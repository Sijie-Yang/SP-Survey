import { createTheme } from '@mui/material/styles';

/** Preset palettes for Admin theme picker (and default public brand = Sydney Harbour Blue). */
export const themes = {
  default: {
    name: 'Sydney · Harbour Blue',
    icon: '🌊',
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#f5f5f5',
    paper: '#ffffff',
    mode: 'light',
  },
  purple: {
    name: 'London · Royal Purple',
    icon: '👑',
    primary: '#7b1fa2',
    secondary: '#f06292',
    background: '#f3e5f5',
    paper: '#ffffff',
    mode: 'light',
  },
  teal: {
    name: 'Hong Kong · Harbour Jade',
    icon: '⛴️',
    primary: '#00796b',
    secondary: '#ff6f00',
    background: '#e0f2f1',
    paper: '#ffffff',
    mode: 'light',
  },
  dark: {
    name: 'New York · Midnight Blue',
    icon: '🌙',
    primary: '#90caf9',
    secondary: '#f48fb1',
    background: '#121212',
    paper: '#1e1e1e',
    mode: 'dark',
  },
  orange: {
    name: 'Austin · Burnt Orange',
    icon: '🌅',
    primary: '#AF4F19',
    secondary: '#f50057',
    background: '#fff3e0',
    paper: '#ffffff',
    mode: 'light',
  },
  green: {
    name: 'Singapore · Garden Green',
    icon: '🌿',
    primary: '#2e7d32',
    secondary: '#ff6f00',
    background: '#e8f5e9',
    paper: '#ffffff',
    mode: 'light',
  },
  rosegold: {
    name: 'Tokyo · Sakura Pink',
    icon: '🌸',
    primary: '#c2185b',
    secondary: '#ffd54f',
    background: '#fce4ec',
    paper: '#ffffff',
    mode: 'light',
  },
  techblue: {
    name: 'Seoul · Neon Blue',
    icon: '🚀',
    primary: '#0277bd',
    secondary: '#00e676',
    background: '#e1f5fe',
    paper: '#ffffff',
    mode: 'light',
  },
  beijing: {
    name: 'Beijing · Imperial Red',
    icon: '🏯',
    primary: '#A73532',
    secondary: '#B88A36',
    background: '#F9F7F5',
    paper: '#ffffff',
    mode: 'light',
  },
  shanghai: {
    name: 'Shanghai · Bund Bronze',
    icon: '🏙️',
    primary: '#8B633B',
    secondary: '#357A85',
    background: '#F8F7F5',
    paper: '#ffffff',
    mode: 'light',
  },
  shenzhen: {
    name: 'Shenzhen · Circuit Cyan',
    icon: '💠',
    primary: '#007C91',
    secondary: '#8664AD',
    background: '#F5F8FA',
    paper: '#ffffff',
    mode: 'light',
  },
  guangzhou: {
    name: 'Guangzhou · Banyan Olive',
    icon: '🌳',
    primary: '#63752B',
    secondary: '#BC7353',
    background: '#F7F8F4',
    paper: '#ffffff',
    mode: 'light',
  },
  wuhan: {
    name: 'Wuhan · River Blue',
    icon: '🌉',
    primary: '#376A9C',
    secondary: '#BA7540',
    background: '#F5F7FA',
    paper: '#ffffff',
    mode: 'light',
  },
  kyoto: {
    name: 'Kyoto · Temple Moss',
    icon: '🍵',
    primary: '#526B45',
    secondary: '#A65F42',
    background: '#F7F8F4',
    paper: '#ffffff',
    mode: 'light',
  },
  cambridge_ma: {
    name: 'Cambridge, MA · Brick Red',
    icon: '🧱',
    primary: '#974B43',
    secondary: '#60798A',
    background: '#F8F6F5',
    paper: '#ffffff',
    mode: 'light',
  },
  cambridge_uk: {
    name: 'Cambridge, UK · College Green',
    icon: '🎓',
    primary: '#32685C',
    secondary: '#A78042',
    background: '#F5F8F6',
    paper: '#ffffff',
    mode: 'light',
  },
  madison: {
    name: 'Madison · Lake Blue',
    icon: '🛶',
    primary: '#376F8B',
    secondary: '#A95C51',
    background: '#F5F8FA',
    paper: '#ffffff',
    mode: 'light',
  },
  zurich: {
    name: 'Zurich · Alpine Slate',
    icon: '🏔️',
    primary: '#536779',
    secondary: '#977D4F',
    background: '#F6F7F9',
    paper: '#ffffff',
    mode: 'light',
  },
  amsterdam: {
    name: 'Amsterdam · Canal Petrol',
    icon: '🚲',
    primary: '#2A7071',
    secondary: '#AD6144',
    background: '#F4F8F8',
    paper: '#ffffff',
    mode: 'light',
  },
  delft: {
    name: 'Delft · Porcelain Blue',
    icon: '🏺',
    primary: '#3558A0',
    secondary: '#A27E46',
    background: '#F5F7FC',
    paper: '#ffffff',
    mode: 'light',
  },
  utrecht: {
    name: 'Utrecht · Brick Copper',
    icon: '🔔',
    primary: '#9A553B',
    secondary: '#497F75',
    background: '#FAF7F4',
    paper: '#ffffff',
    mode: 'light',
  },
  stockholm: {
    name: 'Stockholm · Nordic Indigo',
    icon: '⛵',
    primary: '#4F5C91',
    secondary: '#A67C42',
    background: '#F6F7FB',
    paper: '#ffffff',
    mode: 'light',
  },
  helsinki: {
    name: 'Helsinki · Granite Grey',
    icon: '🪨',
    primary: '#626A72',
    secondary: '#587956',
    background: '#F6F7F8',
    paper: '#ffffff',
    mode: 'light',
  },
  santiago: {
    name: 'Santiago · Andes Violet',
    icon: '⛰️',
    primary: '#735288',
    secondary: '#A57A3D',
    background: '#F8F6FA',
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
