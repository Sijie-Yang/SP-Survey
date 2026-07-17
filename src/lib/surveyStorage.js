// Survey configuration storage using file system API
// No localStorage dependency - all data saved to server

import { paletteToSurveyJsVars } from '../themes/themeConfig';
import { themeJson } from '../theme';
import { API_ROOT } from './apiConfig';

const STORAGE_PREFIX = 'survey_config_';

export const saveSurveyConfig = async (name, config, options = {}) => {
  try {
    // surveyConfig is now saved through the main project save API
    // This function is kept for compatibility but doesn't use localStorage
    console.log(`📝 saveSurveyConfig called for ${name} (saved through project API)`);
    
    return { success: true };
  } catch (error) {
    console.error('Error saving survey config:', error);
    return { success: false, error: error.message };
  }
};

export const loadSurveyConfig = async (projectId) => {
  try {
    // SP-Survey stores project and survey JSON in its local Express server.
    // Supabase is optional and is used only for media and survey responses.
    const response = await fetch(`${API_ROOT}/projects/${projectId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.surveyConfig) {
        const config = data.surveyConfig;
        fixBooleanFields(config);
        return config;
      }
    }

    return null;
  } catch (error) {
    console.error('Error loading survey config:', error);
    return null;
  }
};

function fixBooleanFields(config) {
  if (typeof config.showQuestionNumbers === 'boolean') {
    config.showQuestionNumbers = config.showQuestionNumbers ? 'on' : 'off';
  }
  if (typeof config.showProgressBar === 'boolean') {
    config.showProgressBar = config.showProgressBar ? 'top' : 'off';
  }
}

export const deleteSurveyConfig = async (name) => {
  try {
    // Projects are now deleted through the main project API
    console.log(`🗑️ deleteSurveyConfig called for ${name} (deleted through project API)`);
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting survey config:', error);
    return { success: false, error: error.message };
  }
};

export const getSavedConfigList = () => {
  try {
    // Project list is now fetched from the server API
    console.log(`📋 getSavedConfigList called (fetched through project API)`);
    return [];
  } catch (error) {
    console.error('Error getting saved config list:', error);
    return [];
  }
};

export const exportSurveyConfig = (config) => {
  const dataStr = JSON.stringify(config, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `survey-config-${new Date().toISOString().split('T')[0]}.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
};

/** Map builder-only types onto SurveyJS-native types before Model creation. */
export function normalizeBuilderQuestion(element) {
  if (!element || typeof element !== 'object') return element;
  const question = { ...element };
  if (question.type === 'number') {
    question.type = 'text';
    question.inputType = 'number';
    if (question.min != null && question.min !== '') question.min = Number(question.min);
    if (question.max != null && question.max !== '') question.max = Number(question.max);
  } else if (question.type === 'consent') {
    question.type = 'boolean';
    question.isRequired = true;
    question.labelTrue = question.labelTrue || 'I agree / I consent';
    question.labelFalse = question.labelFalse || 'I do not agree';
  }
  return question;
}

export function normalizeBuilderSurveyJson(surveyJson) {
  if (!surveyJson?.pages) return surveyJson;
  const copy = { ...surveyJson, pages: surveyJson.pages.map((page) => ({
    ...page,
    elements: (page.elements || []).map(normalizeBuilderQuestion),
  })) };
  return copy;
}

// Convert admin config to SurveyJS format for actual survey use
export const convertToSurveyJS = (adminConfig) => {
  return {
    title: adminConfig.title,
    description: adminConfig.description,
    logo: adminConfig.logo,
    logoPosition: adminConfig.logoPosition,
    pages: adminConfig.pages?.map(page => {
      const mappedElements = page.elements?.map(element => {
        const question = normalizeBuilderQuestion(element);
        
        // Handle image questions
        if (element.type === 'imagepicker' && element.imageLinks) {
          // Randomly select images for the survey
          const shuffled = [...element.imageLinks].sort(() => 0.5 - Math.random());
          const selectedImages = shuffled.slice(0, element.imageCount || 4);
          
          question.choices = selectedImages.map((url, index) => ({
            value: `image_${index}`,
            imageLink: url
          }));
          // "contain" keeps the image's natural aspect ratio; the global CSS in
          // src/index.css further removes fixed sizing so each image is shown
          // at its source's natural ratio.
          question.imageFit = "contain";
          question.multiSelect = element.multiSelect || false;
        }
        
        // Handle image display
        if (element.type === 'image' && element.imageLinks && element.imageLinks.length > 0) {
          // Randomly select one image
          const randomIndex = Math.floor(Math.random() * element.imageLinks.length);
          question.imageLink = element.imageLinks[randomIndex];
          question.imageFit = "contain";
        }
        
        return question;
      }) || [];
      
      // ✅ FIX: If page has no questions, add a dummy HTML element so the page displays
      // This ensures pages with only title/description are visible in the survey
      // Note: SurveyJS will display page.description automatically, so we just need a minimal placeholder
      const finalElements = mappedElements.length === 0
        ? [{
            type: 'html',
            name: `${page.name}_placeholder`,
            html: '<div style="height: 1px;"></div>' // Minimal placeholder to make page visible
          }]
        : mappedElements;
      
      return {
        name: page.name,
        title: page.title,
        description: page.description,
        elements: finalElements
      };
    }) || [],
    ...adminConfig.settings
  };
};

// Helper function to ensure color value is a valid string
const ensureColorString = (color, defaultColor) => {
  if (!color || typeof color !== 'string') {
    return defaultColor;
  }
  const trimmed = String(color).trim();
  if (/NaN/i.test(trimmed)) {
    return defaultColor;
  }
  // Ensure it starts with # for hex colors or is a valid CSS color
  if (!trimmed.startsWith('#') && !trimmed.startsWith('rgb') && !trimmed.startsWith('hsl')) {
    return defaultColor;
  }
  return trimmed;
};

const isInvalidSurveyColor = (color) => {
  if (!color || typeof color !== 'string') return true;
  const trimmed = String(color).trim();
  return /NaN/i.test(trimmed) || trimmed.length === 0;
};

// Generate custom theme based on admin config
export const generateCustomTheme = (adminConfig) => {
  try {
    if (!adminConfig || !adminConfig.theme || typeof adminConfig.theme !== 'object') {
      console.log('⚠️ No valid theme config found, using default theme');
      return null; // Use default theme
    }

    const theme = adminConfig.theme;
    
    // Ensure all color values are valid strings
    const safeTheme = {
      backgroundColor: ensureColorString(theme.backgroundColor, "#ffffff"),
      cardBackground: ensureColorString(theme.cardBackground, "#f8f9fa"),
      headerBackground: ensureColorString(theme.headerBackground, "#fafafa"),
      textColor: ensureColorString(theme.textColor, "#212121"),
      secondaryText: ensureColorString(theme.secondaryText, "#757575"),
      disabledText: ensureColorString(theme.disabledText, "#bdbdbd"),
      primaryColor: ensureColorString(theme.primaryColor, "#1976d2"),
      primaryLight: ensureColorString(theme.primaryLight, "#42a5f5"),
      primaryDark: ensureColorString(theme.primaryDark, "#1565c0"),
      secondaryColor: ensureColorString(theme.secondaryColor, "#dc004e"),
      accentColor: ensureColorString(theme.accentColor, "#ff9800"),
      successColor: ensureColorString(theme.successColor, "#4caf50"),
      borderColor: ensureColorString(theme.borderColor, "#e0e0e0"),
      focusBorder: ensureColorString(theme.focusBorder, "#1976d2")
    };
    
    const paletteVars = paletteToSurveyJsVars({
      primary: safeTheme.primaryColor,
      secondary: safeTheme.secondaryColor,
      mode: 'light',
    });

    const primaryLight = isInvalidSurveyColor(safeTheme.primaryLight)
      ? paletteVars['--sjs-primary-backcolor-light']
      : safeTheme.primaryLight;
    const primaryDark = isInvalidSurveyColor(safeTheme.primaryDark)
      ? paletteVars['--sjs-primary-backcolor-dark']
      : safeTheme.primaryDark;

    console.log('✅ Generated safe theme:', safeTheme);
    
    return {
      "cssVariables": {
        // General background colors
        "--sjs-general-backcolor": safeTheme.backgroundColor,
        "--sjs-general-backcolor-dark": safeTheme.cardBackground,
        "--sjs-general-backcolor-dim": safeTheme.headerBackground,
        
        // Text colors
        "--sjs-general-forecolor": safeTheme.textColor,
        "--sjs-general-forecolor-light": safeTheme.secondaryText,
        "--sjs-general-dim-forecolor": safeTheme.disabledText,
        
        // Primary colors (paletteToSurveyJsVars ensures valid light/dark variants)
        "--sjs-primary-backcolor": paletteVars['--sjs-primary-backcolor'],
        "--sjs-primary-backcolor-light": primaryLight,
        "--sjs-primary-backcolor-dark": primaryDark,
        "--sjs-primary-forecolor": paletteVars['--sjs-primary-forecolor'],
        
        // Secondary colors
        "--sjs-secondary-backcolor": paletteVars['--sjs-secondary-backcolor'] || safeTheme.secondaryColor,
        "--sjs-secondary-backcolor-light": safeTheme.accentColor,
        "--sjs-secondary-backcolor-semi-light": safeTheme.successColor,
        "--sjs-secondary-forecolor": "#ffffff",
        
        // Border colors
        "--sjs-border-light": safeTheme.borderColor,
        "--sjs-border-default": safeTheme.borderColor,
        "--sjs-border-inside": safeTheme.borderColor,
        
        // Focus and active states
        "--sjs-special-red": safeTheme.accentColor,
        "--sjs-special-green": safeTheme.successColor,
        "--sjs-special-blue": safeTheme.focusBorder,
        
        // Shadows and effects
        "--sjs-shadow-small": "0px 1px 2px 0px rgba(0, 0, 0, 0.15)",
        "--sjs-shadow-medium": "0px 2px 6px 0px rgba(0, 0, 0, 0.1)",
        "--sjs-shadow-large": "0px 8px 16px 0px rgba(0, 0, 0, 0.1)",
        "--sjs-shadow-inner": "inset 0px 1px 2px 0px rgba(0, 0, 0, 0.15)",
        
        // Additional customizations for better appearance
        "--sjs-header-backcolor": safeTheme.headerBackground,
        "--sjs-corner-radius": "8px",
        "--sjs-base-unit": "8px",
        
        // Input and form elements
        "--sjs-editor-backcolor": safeTheme.backgroundColor,
        "--sjs-editorpanel-backcolor": safeTheme.cardBackground,
        "--sjs-editorpanel-hovercolor": safeTheme.primaryLight,
        
        // Progress bar (native SurveyJS — live app uses ProgressChrome instead)
        "--sjs-progressbar-color": safeTheme.primaryColor,

        // ProgressChrome (page / question / trial) — applied on host via buildProgressChromeCssVars
        ...buildProgressChromeCssVars(safeTheme),
        
        // Question panel
        "--sjs-questionpanel-backcolor": safeTheme.cardBackground,
        "--sjs-questionpanel-hovercolor": safeTheme.headerBackground,
        "--sjs-questionpanel-cornerradius": "8px"
      },
      "themeName": "custom",
      "colorPalette": "light",
      "isPanelless": false
    };
  } catch (error) {
    console.error('❌ Error generating custom theme:', error);
    return null; // Fall back to default theme
  }
};

/**
 * CSS variables for ProgressChrome (participant bar + theme preview).
 * Primary = current / overall bar; Success = completed questions; track/muted for remaining chrome.
 */
export function buildProgressChromeCssVars(theme = {}) {
  const primary = ensureColorString(theme?.primaryColor, '#1976d2');
  const primaryLight = ensureColorString(theme?.primaryLight, '#42a5f5');
  const success = ensureColorString(theme?.successColor, '#4caf50');
  const border = ensureColorString(theme?.borderColor, '#e0e0e0');
  const surface = ensureColorString(theme?.cardBackground || theme?.backgroundColor, '#ffffff');
  const bg = ensureColorString(theme?.backgroundColor, '#ffffff');
  const label = ensureColorString(theme?.secondaryText, '#757575');
  const muted = ensureColorString(theme?.disabledText, '#bdbdbd');
  return {
    '--sp-progress-primary': primary,
    '--sp-progress-primary-light': primaryLight,
    '--sp-progress-success': success,
    '--sp-progress-success-light': success,
    '--sp-progress-track': border,
    '--sp-progress-muted': muted,
    '--sp-progress-surface': surface,
    '--sp-progress-border': border,
    '--sp-progress-label': label,
    '--sp-progress-bg': bg,
  };
}

/**
 * Theme the canvas around SurveyJS as well as SurveyJS itself.
 * SurveyJS only paints its own root, so previews/live pages otherwise expose the
 * admin application's white background around a custom (especially dark) theme.
 */
export function buildSurveyHostStyle(theme = {}) {
  const background = ensureColorString(theme?.backgroundColor, '#ffffff');
  const text = ensureColorString(theme?.textColor, '#212121');
  const border = ensureColorString(theme?.borderColor, '#e0e0e0');

  return {
    ...buildProgressChromeCssVars(theme),
    '--sp-survey-background': background,
    '--sp-survey-text': text,
    '--sp-survey-border': border,
    backgroundColor: background,
    color: text,
  };
}

/** Apply project survey skin to a SurveyJS model (custom theme, else default themeJson). */
export function applyAdminThemeToSurveyModel(model, adminConfig) {
  if (!model) return;
  try {
    // A project created before theme persistence may have no `theme` field even
    // though Theme Settings displays the custom defaults. Treat any project
    // config as custom-theme capable so those displayed defaults are real.
    const themeConfig = adminConfig && typeof adminConfig === 'object'
      ? { ...adminConfig, theme: adminConfig.theme || {} }
      : null;
    const customTheme = generateCustomTheme(themeConfig);
    if (customTheme) {
      model.applyTheme(customTheme);
      return;
    }
  } catch (err) {
    console.warn('applyAdminThemeToSurveyModel: custom theme failed', err);
  }
  try {
    if (themeJson) model.applyTheme(themeJson);
  } catch (err) {
    console.warn('applyAdminThemeToSurveyModel: default theme failed', err);
  }
}
