/**
 * Chat API for intelligent survey generation/adjustment
 * Automatically determines user intent and routes to appropriate handler
 */

import { API_BASE_URL } from './apiConfig';
import { sendAgentChat } from './agentApi';

/**
 * Send a chat message and get AI response
 * @param {string} message - User's message
 * @param {Object} currentConfig - Current survey configuration (if any)
 * @param {Array} conversationHistory - Previous messages in OpenAI format
 * @param {string} apiKey - User's OpenAI or OpenRouter API key
 * @param {Object} customPrompts - Custom system prompts (optional)
 * @param {Object} researchContext - Research context (topic, requirements, scenario)
 * @returns {Promise<Object>} - { success, intent, surveyConfig?, message, error? }
 */
export async function sendChatMessage(message, currentConfig, conversationHistory, apiKey, customPrompts = null, researchContext = null, extras = null) {
  try {
    if (extras?.projectId) {
      return await sendAgentChat({
        message,
        currentConfig,
        conversationHistory,
        researchContext,
        customPrompts,
        projectId: extras.projectId,
        sessionId: extras.sessionId || null,
        provider: extras.provider || null,
        model: extras.model || null,
        reasoningEffort: extras.reasoningEffort || extras.reasoning_effort || null,
        assistantMode: extras.assistantMode || 'agent',
        onStarted: extras.onStarted,
        onSnapshot: extras.onSnapshot,
        editorContext: extras.editorContext || null,
        review: extras.review || null,
        language: extras.language || null,
        apiKey,
      });
    }

    const response = await fetch(`${API_BASE_URL}/api/openai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        currentConfig,
        conversationHistory,
        apiKey,
        customPrompts,
        researchContext,
        assistantMode: extras?.assistantMode || 'agent',
      })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to send message'
    };
  }
}

/**
 * Validate OpenAI API key
 */
export async function validateApiKey(apiKey) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to validate API key'
    };
  }
}

export const validateChatApiKey = validateApiKey;

