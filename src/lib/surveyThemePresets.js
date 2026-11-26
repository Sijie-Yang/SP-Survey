// Shared palette definitions for Builder and Layout Studio. Apply a preset as a complete theme.
export const SURVEY_THEME_PRESETS = {
  default: {
    primaryColor: '#1976d2',
    primaryLight: '#42a5f5',
    primaryDark: '#1565c0',
    secondaryColor: '#dc004e',
    accentColor: '#ff9800',
    successColor: '#4caf50',
    backgroundColor: '#ffffff',
    cardBackground: '#f8f9fa',
    headerBackground: '#ffffff',
    textColor: '#212121',
    secondaryText: '#757575',
    disabledText: '#bdbdbd',
    borderColor: '#e0e0e0',
    focusBorder: '#1976d2'
  },
  research: {
    // Fully copy theme configuration from original research survey
    primaryColor: '#474747',
    primaryLight: '#6a6a6a',
    primaryDark: '#2e2e2e',
    secondaryColor: '#ff9814', // rgba(255, 152, 20, 1)
    accentColor: '#e50a3e', // rgba(229, 10, 62, 1) - special red
    successColor: '#19b394', // rgba(25, 179, 148, 1) - special green
    backgroundColor: '#ffffff', // rgba(255, 255, 255, 1)
    cardBackground: '#f8f8f8', // rgba(248, 248, 248, 1)
    headerBackground: '#f3f3f3', // rgba(243, 243, 243, 1)
    textColor: '#000000', // rgba(0, 0, 0, 0.91)
    secondaryText: '#737373', // rgba(0, 0, 0, 0.45)
    disabledText: '#737373', // rgba(0, 0, 0, 0.45)
    borderColor: '#292929', // rgba(0, 0, 0, 0.16)
    focusBorder: '#437fd9' // rgba(67, 127, 217, 1) - special blue
  },
  professional: {
    primaryColor: '#1976d2',
    primaryLight: '#42a5f5',
    primaryDark: '#1565c0',
    secondaryColor: '#f57c00',
    accentColor: '#ff9800',
    successColor: '#4caf50',
    backgroundColor: '#ffffff',
    cardBackground: '#f8f9fa',
    headerBackground: '#fafafa',
    textColor: '#212121',
    secondaryText: '#616161',
    disabledText: '#bdbdbd',
    borderColor: '#e0e0e0',
    focusBorder: '#1976d2'
  },
  nature: {
    primaryColor: '#4caf50',
    primaryLight: '#81c784',
    primaryDark: '#388e3c',
    secondaryColor: '#ff9800',
    accentColor: '#ffc107',
    successColor: '#8bc34a',
    backgroundColor: '#f1f8e9',
    cardBackground: '#ffffff',
    headerBackground: '#e8f5e8',
    textColor: '#1b5e20',
    secondaryText: '#4caf50',
    disabledText: '#a5d6a7',
    borderColor: '#c8e6c9',
    focusBorder: '#4caf50'
  },
  elegant: {
    primaryColor: '#673ab7',
    primaryLight: '#9575cd',
    primaryDark: '#512da8',
    secondaryColor: '#e91e63',
    accentColor: '#f06292',
    successColor: '#66bb6a',
    backgroundColor: '#fafafa',
    cardBackground: '#ffffff',
    headerBackground: '#f3e5f5',
    textColor: '#4a148c',
    secondaryText: '#7b1fa2',
    disabledText: '#ce93d8',
    borderColor: '#e1bee7',
    focusBorder: '#673ab7'
  },
  ocean: {
    primaryColor: '#00acc1',
    primaryLight: '#4dd0e1',
    primaryDark: '#00838f',
    secondaryColor: '#0288d1',
    accentColor: '#29b6f6',
    successColor: '#26a69a',
    backgroundColor: '#e0f7fa',
    cardBackground: '#ffffff',
    headerBackground: '#b2ebf2',
    textColor: '#006064',
    secondaryText: '#00838f',
    disabledText: '#80deea',
    borderColor: '#b2ebf2',
    focusBorder: '#00acc1'
  },
  warm: {
    primaryColor: '#ff5722',
    primaryLight: '#ff8a65',
    primaryDark: '#d84315',
    secondaryColor: '#ffc107',
    accentColor: '#ff9800',
    successColor: '#4caf50',
    backgroundColor: '#fff8f0',
    cardBackground: '#ffffff',
    headerBackground: '#ffe0b2',
    textColor: '#3e2723',
    secondaryText: '#6d4c41',
    disabledText: '#bcaaa4',
    borderColor: '#d7ccc8',
    focusBorder: '#ff5722'
  },
  dark: {
    primaryColor: '#90caf9',
    primaryLight: '#bbdefb',
    primaryDark: '#64b5f6',
    secondaryColor: '#f48fb1',
    accentColor: '#ce93d8',
    successColor: '#81c784',
    backgroundColor: '#121212',
    cardBackground: '#1e1e1e',
    headerBackground: '#2c2c2c',
    textColor: '#e0e0e0',
    secondaryText: '#b0b0b0',
    disabledText: '#757575',
    borderColor: '#424242',
    focusBorder: '#90caf9'
  },
  minimal: {
    primaryColor: '#333333',
    primaryLight: '#555555',
    primaryDark: '#111111',
    secondaryColor: '#888888',
    accentColor: '#aaaaaa',
    successColor: '#4caf50',
    backgroundColor: '#ffffff',
    cardBackground: '#fafafa',
    headerBackground: '#f5f5f5',
    textColor: '#1a1a1a',
    secondaryText: '#666666',
    disabledText: '#cccccc',
    borderColor: '#e0e0e0',
    focusBorder: '#333333'
  }
};

export const DEFAULT_SURVEY_THEME = SURVEY_THEME_PRESETS.default;

export const SURVEY_THEME_OPTIONS = [
  { id: 'default', name: 'Default', zh: '默认', emoji: '🔷' },
  { id: 'research', name: 'Research', zh: '研究', emoji: '🔬' },
  { id: 'professional', name: 'Professional', zh: '专业', emoji: '💼' },
  { id: 'nature', name: 'Nature', zh: '自然', emoji: '🌿' },
  { id: 'elegant', name: 'Elegant', zh: '典雅', emoji: '💎' },
  { id: 'ocean', name: 'Ocean', zh: '海洋', emoji: '🌊' },
  { id: 'warm', name: 'Warm', zh: '暖色', emoji: '🔥' },
  { id: 'dark', name: 'Dark', zh: '深色', emoji: '🌙' },
  { id: 'minimal', name: 'Minimal', zh: '极简', emoji: '⚪' },
];

export function applySurveyThemePreset(config, id) {
  const palette = SURVEY_THEME_PRESETS[id];
  return palette ? { ...config, theme: { ...palette } } : config;
}

export function matchesSurveyThemePreset(theme, id) {
  const palette = SURVEY_THEME_PRESETS[id];
  return !!palette && Object.entries(palette).every(([key, value]) => theme?.[key] === value);
}
