/**
 * Conversation History Management for Contextual Engineering
 * 
 * Manages multi-turn conversation history for AI-assisted survey design
 * Enables the AI to remember previous interactions and maintain context
 */

export class ConversationHistory {
  constructor(projectId) {
    this.projectId = projectId;
    this.history = [];
    this.loadFromStorage();
  }

  /**
   * Add a new message to conversation history
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   * @param {Object} metadata - Additional metadata (config snapshot, action type, etc.)
   */
  addMessage(role, content, metadata = {}) {
    const message = {
      id: this.generateId(),
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata
    };
    
    this.history.push(message);
    this.saveToStorage();
    
    return message;
  }

  /**
   * Get all messages
   */
  getAllMessages() {
    return [...this.history];
  }

  /**
   * Get messages formatted for OpenAI API
   * @param {number} maxMessages - Maximum number of recent messages to include (default: all)
   * @param {boolean} includeSystemContext - Whether to prepend system context
   */
  getFormattedForOpenAI(maxMessages = null, includeSystemContext = true) {
    let messages = [...this.history];
    
    // Limit to recent messages if specified
    if (maxMessages && messages.length > maxMessages) {
      messages = messages.slice(-maxMessages);
    }
    
    // Format for OpenAI API (only role and content)
    const formatted = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    return formatted;
  }

  /**
   * Get conversation summary for display
   */
  getSummary() {
    const totalMessages = this.history.length;
    const userMessages = this.history.filter(m => m.role === 'user').length;
    const assistantMessages = this.history.filter(m => m.role === 'assistant').length;
    
    const firstMessage = this.history[0];
    const lastMessage = this.history[this.history.length - 1];
    
    return {
      totalMessages,
      userMessages,
      assistantMessages,
      firstTimestamp: firstMessage?.timestamp,
      lastTimestamp: lastMessage?.timestamp,
      isEmpty: totalMessages === 0
    };
  }

  /**
   * Clear conversation history
   */
  clear() {
    this.history = [];
    this.saveToStorage();
  }

  /**
   * Replace local display history with the authoritative hosted Agent session.
   */
  replaceMessages(messages = []) {
    this.history = messages.map((message, index) => {
      const tools = Array.isArray(message.tools) && message.tools.length
        ? message.tools
        : (Array.isArray(message.metadata?.tools) ? message.metadata.tools : []);
      return {
        id: message.id || `server_${index}_${message.createdAt || Date.now()}`,
        role: message.role || 'assistant',
        content: message.content || '',
        timestamp: message.timestamp || message.createdAt || new Date().toISOString(),
        ...(tools.length ? { tools } : {}),
        metadata: {
          ...(message.metadata || {}),
          ...(tools.length ? { tools } : {}),
          recovered: true,
        },
      };
    });
    this.saveToStorage();
    return this.getAllMessages();
  }

  /**
   * Remove a specific message
   */
  removeMessage(messageId) {
    this.history = this.history.filter(m => m.id !== messageId);
    this.saveToStorage();
  }

  /**
   * Get conversation statistics
   */
  getStats() {
    const actions = this.history
      .filter(m => m.metadata?.actionType)
      .map(m => m.metadata.actionType);
    
    return {
      totalInteractions: this.history.length / 2, // User + Assistant pairs
      generateCount: actions.filter(a => a === 'generate').length,
      adjustCount: actions.filter(a => a === 'adjust').length,
      iterations: Math.ceil(this.history.length / 2)
    };
  }

  /**
   * Export conversation history
   */
  export() {
    return {
      projectId: this.projectId,
      exportTime: new Date().toISOString(),
      history: this.history,
      stats: this.getStats(),
      summary: this.getSummary()
    };
  }

  /**
   * Import conversation history
   */
  import(data) {
    if (data.projectId === this.projectId) {
      this.history = data.history || [];
      this.saveToStorage();
    }
  }

  // Private methods
  
  generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  saveToStorage() {
    const key = `conversation_history_${this.projectId}`;
    try {
      sessionStorage.setItem(key, JSON.stringify(this.history));
    } catch (error) {
      console.warn('Failed to save conversation history:', error);
    }
  }

  loadFromStorage() {
    const key = `conversation_history_${this.projectId}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        this.history = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load conversation history:', error);
      this.history = [];
    }
  }
}

/**
 * Create or retrieve conversation history for a project
 */
export function getConversationHistory(projectId) {
  return new ConversationHistory(projectId);
}

