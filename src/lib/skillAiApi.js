import { API_BASE_URL } from './apiConfig';

/**
 * Generate or revise a custom skill via AI.
 * @returns {Promise<{ success, skill?, message?, error? }>}
 */
export async function generateSkillWithAi({
  message,
  apiKey,
  currentSkill = null,
  conversationHistory = [],
}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/generate-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        apiKey,
        currentSkill,
        conversationHistory,
      }),
    });
    return await response.json();
  } catch (err) {
    return { success: false, error: err.message || 'Failed to reach AI service' };
  }
}
