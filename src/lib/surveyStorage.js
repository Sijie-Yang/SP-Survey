// Survey configuration storage using file system API
// No localStorage dependency - all data saved to server
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
    // ✅ Load surveyConfig from project file via API
    console.log(`📂 loadSurveyConfig called for ${projectId} (loading from file system)`);
    
    const response = await fetch(`${API_ROOT}/projects/${projectId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.surveyConfig) {
        console.log(`✅ Loaded surveyConfig for project ${projectId}:`, data.surveyConfig.title);
        
        // Fix boolean values that should be strings for SurveyJS
        const config = data.surveyConfig;
        if (typeof config.showQuestionNumbers === 'boolean') {
          config.showQuestionNumbers = config.showQuestionNumbers ? 'on' : 'off';
          console.log('🔧 Fixed showQuestionNumbers boolean to string');
        }
        if (typeof config.showProgressBar === 'boolean') {
          config.showProgressBar = config.showProgressBar ? 'top' : 'off';
          console.log('🔧 Fixed showProgressBar boolean to string');
        }
        
        return config;
      }
    }
    
    console.warn(`⚠️ No surveyConfig found for project ${projectId}`);
    return null;
  } catch (error) {
    console.error('Error loading survey config:', error);
    return null;
  }
};

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
  return {
    ...surveyJson,
    pages: surveyJson.pages.map((page) => ({
      ...page,
      elements: (page.elements || []).map(normalizeBuilderQuestion),
    })),
  };
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
          question.imageFit = "cover";
          question.multiSelect = element.multiSelect || false;
        }
        
        // Handle image display
        if (element.type === 'image' && element.imageLinks && element.imageLinks.length > 0) {
          // Randomly select one image
          const randomIndex = Math.floor(Math.random() * element.imageLinks.length);
          question.imageLink = element.imageLinks[randomIndex];
          question.imageFit = "cover";
          question.imageHeight = "300px";
          question.imageWidth = "100%";
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
  // Ensure it starts with # for hex colors or is a valid CSS color
  if (!trimmed.startsWith('#') && !trimmed.startsWith('rgb') && !trimmed.startsWith('hsl')) {
    return defaultColor;
  }
  return trimmed;
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
        
        // Primary colors
        "--sjs-primary-backcolor": safeTheme.primaryColor,
        "--sjs-primary-backcolor-light": safeTheme.primaryLight,
        "--sjs-primary-backcolor-dark": safeTheme.primaryDark,
        "--sjs-primary-forecolor": "#ffffff",
        
        // Secondary colors
        "--sjs-secondary-backcolor": safeTheme.secondaryColor,
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
        
        // Progress bar
        "--sjs-progressbar-color": safeTheme.primaryColor,
        
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
