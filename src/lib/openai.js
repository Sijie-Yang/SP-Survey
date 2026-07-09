// OpenAI integration for AI-powered survey generation and adjustment
import { API_BASE_URL } from './apiConfig';

/**
 * Generate survey structure from natural language description
 * @param {string} description - Natural language description of the survey
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<Object>} Generated survey configuration
 */
export const generateSurveyFromDescription = async (description, apiKey) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/generate-survey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        apiKey
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate survey');
    }

    const data = await response.json();
    return { success: true, surveyConfig: data.surveyConfig };
  } catch (error) {
    console.error('Error generating survey:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Adjust existing survey based on user instructions
 * @param {Object} currentConfig - Current survey configuration
 * @param {string} instruction - Instruction for modifications
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<Object>} Modified survey configuration
 */
export const adjustSurvey = async (currentConfig, instruction, apiKey) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/adjust-survey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentConfig,
        instruction,
        apiKey
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to adjust survey');
    }

    const data = await response.json();
    return { success: true, surveyConfig: data.surveyConfig };
  } catch (error) {
    console.error('Error adjusting survey:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Generate questions for a specific page
 * @param {string} pageDescription - Description of the page and desired questions
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<Object>} Generated questions array
 */
export const generateQuestions = async (pageDescription, apiKey) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/generate-questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pageDescription,
        apiKey
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate questions');
    }

    const data = await response.json();
    return { success: true, questions: data.questions };
  } catch (error) {
    console.error('Error generating questions:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Validate OpenAI API key
 * @param {string} apiKey - OpenAI API key to validate
 * @returns {Promise<Object>} Validation result
 */
export const validateApiKey = async (apiKey) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey })
    });

    if (!response.ok) {
      return { success: false, error: 'Invalid API key' };
    }

    const data = await response.json();
    return { success: data.valid };
  } catch (error) {
    console.error('Error validating API key:', error);
    return { success: false, error: error.message };
  }
};

