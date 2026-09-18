import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOperations, postProcessAiConfig } from '../lib/designProtocol';
import { getConversationHistory } from '../lib/conversationHistory';
import { getWorkingMemory } from '../lib/workingMemory';
import { getSessionLearning } from '../lib/sessionLearning';
import { sendChatMessage, validateApiKey as validateChatApiKey, triggerMultiAgentReviewStream } from '../lib/chatApi';

const IMAGE_QUESTION_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox',
  'image', 'imagematrix', 'imageslidergroup', 'imagepointallocation',
];

function processAIGeneratedConfig(surveyConfig) {
  const processedConfig = JSON.parse(JSON.stringify(surveyConfig));
  if (processedConfig.pages && Array.isArray(processedConfig.pages)) {
    processedConfig.pages.forEach((page) => {
      if (!Array.isArray(page.elements)) return;
      page.elements.forEach((element) => {
        if (!IMAGE_QUESTION_TYPES.includes(element.type)) return;
        if (!element.imageSelectionMode || element.imageSelectionMode === 'random') {
          element.imageSelectionMode = 'huggingface_random';
        }
        element.randomImageSelection = true;
        if (element.excludePreviouslyUsedImages === undefined) {
          element.excludePreviouslyUsedImages = true;
        }
        if (!element.choices) element.choices = [];
        if (element.type === 'imagematrix' && !element.imageLinks) {
          element.imageLinks = [];
        }
        delete element.imageSource;
        delete element.huggingFaceConfig;
      });
    });
  }
  return postProcessAiConfig(processedConfig);
}

function applyAssistantResult(result, currentConfig) {
  let nextConfig = currentConfig;
  if (result?.operations) {
    const applied = applyOperations(currentConfig || { pages: [] }, result.operations);
    nextConfig = applied.surveyConfig;
  } else if (result?.surveyConfig) {
    nextConfig = result.surveyConfig;
  } else {
    return null;
  }
  return processAIGeneratedConfig(nextConfig);
}

export function chatPropsFromLocalAssistant(assistant) {
  if (!assistant) return {};
  return {
    messages: assistant.messages,
    userMessage: assistant.userMessage,
    isLoading: assistant.isLoading,
    loadingStatus: assistant.loadingStatus,
    apiKeyValid: assistant.apiKeyValid,
    openaiApiKey: assistant.openaiApiKey,
    contextEnabled: assistant.contextEnabled,
    multiAgentReviewEnabled: assistant.multiAgentReviewEnabled,
    reviewMode: assistant.reviewMode,
    maxReviewRounds: assistant.maxReviewRounds,
    recommendations: assistant.recommendations,
    currentProject: assistant.currentProject,
    conversationHistoryRef: assistant.conversationHistoryRef,
    workingMemoryRef: assistant.workingMemoryRef,
    sessionLearningRef: assistant.sessionLearningRef,
    onMessageChange: assistant.setUserMessage,
    onPromptsChange: assistant.setCustomPrompts,
    onRevertAiChange: assistant.handleRevertAiChange,
    aiUndoAvailable: assistant.aiUndoAvailable,
    onSendMessage: assistant.handleSendMessage,
    onApiKeyChange: assistant.setOpenaiApiKey,
    onValidateApiKey: assistant.handleValidateApiKey,
    onContextToggle: assistant.setContextEnabled,
    onMultiAgentReviewToggle: assistant.setMultiAgentReviewEnabled,
    onReviewModeChange: assistant.setReviewMode,
    onMaxReviewRoundsChange: assistant.setMaxReviewRounds,
    onClearHistory: assistant.handleClearHistory,
    onDownloadHistory: assistant.handleDownloadHistory,
    chatEndRef: assistant.chatEndRef,
  };
}

/**
 * Local BYO-key survey assistant. Uses the user's OpenAI/OpenRouter key only.
 * No hosted runtime, subsidy catalog, or Silicon.
 */
export default function useLocalSurveyAssistant({ config, onChange, currentProject }) {
  const configRef = useRef(config);
  configRef.current = config;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [openaiApiKey, setOpenaiApiKey] = useState(() => localStorage.getItem('openaiApiKey') || '');
  const [apiKeyValid, setApiKeyValid] = useState(() => localStorage.getItem('apiKeyValid') === 'true');
  const [userMessage, setUserMessage] = useState('');
  const aiUndoSnapshotRef = useRef(null);
  const [aiUndoAvailable, setAiUndoAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');

  const conversationHistoryRef = useRef(null);
  const workingMemoryRef = useRef(null);
  const sessionLearningRef = useRef(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [contextEnabled, setContextEnabled] = useState(() => {
    if (!currentProject?.id) return true;
    const stored = localStorage.getItem(`contextEnabled_${currentProject.id}`);
    return stored !== null ? stored === 'true' : true;
  });
  const [multiAgentReviewEnabled, setMultiAgentReviewEnabled] = useState(() => {
    if (!currentProject?.id) return false;
    return localStorage.getItem(`multiAgentReviewEnabled_${currentProject.id}`) === 'true';
  });
  const [reviewMode, setReviewMode] = useState(() => {
    if (!currentProject?.id) return '1v1';
    return localStorage.getItem(`reviewMode_${currentProject.id}`) || '1v1';
  });
  const [maxReviewRounds, setMaxReviewRounds] = useState(() => {
    if (!currentProject?.id) return 3;
    const stored = localStorage.getItem(`maxReviewRounds_${currentProject.id}`);
    return stored ? parseInt(stored, 10) : 3;
  });
  const isLoadingProjectSettings = useRef(false);
  const [customPrompts, setCustomPrompts] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (openaiApiKey) localStorage.setItem('openaiApiKey', openaiApiKey);
  }, [openaiApiKey]);

  useEffect(() => {
    localStorage.setItem('apiKeyValid', apiKeyValid.toString());
  }, [apiKeyValid]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`contextEnabled_${currentProject.id}`, contextEnabled.toString());
    }
  }, [contextEnabled, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`multiAgentReviewEnabled_${currentProject.id}`, multiAgentReviewEnabled.toString());
    }
  }, [multiAgentReviewEnabled, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`reviewMode_${currentProject.id}`, reviewMode);
    }
  }, [reviewMode, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`maxReviewRounds_${currentProject.id}`, maxReviewRounds.toString());
    }
  }, [maxReviewRounds, currentProject?.id]);

  useEffect(() => {
    if (!currentProject?.id) return;
    isLoadingProjectSettings.current = true;
    const storedContext = localStorage.getItem(`contextEnabled_${currentProject.id}`);
    setContextEnabled(storedContext !== null ? storedContext === 'true' : true);
    setMultiAgentReviewEnabled(localStorage.getItem(`multiAgentReviewEnabled_${currentProject.id}`) === 'true');
    setReviewMode(localStorage.getItem(`reviewMode_${currentProject.id}`) || '1v1');
    const storedRounds = localStorage.getItem(`maxReviewRounds_${currentProject.id}`);
    setMaxReviewRounds(storedRounds ? parseInt(storedRounds, 10) : 3);
    const undoRaw = sessionStorage.getItem(`ai_undo_${currentProject.id}`);
    if (undoRaw) {
      try {
        aiUndoSnapshotRef.current = JSON.parse(undoRaw);
        setAiUndoAvailable(true);
      } catch {
        aiUndoSnapshotRef.current = null;
        setAiUndoAvailable(false);
      }
    } else {
      aiUndoSnapshotRef.current = null;
      setAiUndoAvailable(false);
    }
    const timer = setTimeout(() => {
      isLoadingProjectSettings.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && contextEnabled) {
      conversationHistoryRef.current = getConversationHistory(currentProject.id);
      workingMemoryRef.current = getWorkingMemory(currentProject.id);
      sessionLearningRef.current = getSessionLearning();
      const history = conversationHistoryRef.current.getAllMessages();
      setConversationMessages(history);
      const recs = sessionLearningRef.current.getRecommendations(currentProject.category || 'general');
      setRecommendations(recs);
    } else {
      conversationHistoryRef.current = null;
      workingMemoryRef.current = null;
      sessionLearningRef.current = null;
      setConversationMessages([]);
      setRecommendations([]);
    }
  }, [currentProject?.id, contextEnabled]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [conversationMessages]);

  const handleValidateApiKey = useCallback(async () => {
    setIsLoading(true);
    const result = await validateChatApiKey(openaiApiKey);
    setIsLoading(false);
    if (result.success) {
      setApiKeyValid(true);
      sessionStorage.setItem('openai_api_key', openaiApiKey);
      conversationHistoryRef.current?.addMessage(
        'assistant',
        '✅ API key validated! I\'m ready to help you create and modify surveys. Just type what you need!',
        { actionType: 'system' }
      );
    } else {
      setApiKeyValid(false);
      conversationHistoryRef.current?.addMessage(
        'assistant',
        '❌ Invalid API key. Please check and try again in settings.',
        { actionType: 'system', error: true }
      );
    }
    if (conversationHistoryRef.current) {
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }
  }, [openaiApiKey]);

  const handleRevertAiChange = useCallback(() => {
    if (!aiUndoSnapshotRef.current) return;
    onChangeRef.current(JSON.parse(JSON.stringify(aiUndoSnapshotRef.current)));
    aiUndoSnapshotRef.current = null;
    setAiUndoAvailable(false);
    if (currentProject?.id) sessionStorage.removeItem(`ai_undo_${currentProject.id}`);
    conversationHistoryRef.current?.addMessage(
      'assistant',
      '↩️ Reverted to the survey configuration before the last AI change.',
      { actionType: 'system' }
    );
    if (conversationHistoryRef.current) {
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }
  }, [currentProject?.id]);

  const handleClearHistory = useCallback(() => {
    conversationHistoryRef.current?.clear();
    setConversationMessages([]);
  }, []);

  const handleDownloadHistory = useCallback(() => {
    const data = conversationHistoryRef.current?.export();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${currentProject?.id || 'survey'}_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentProject?.id]);

  const handleSendMessage = useCallback(async () => {
    if (!userMessage.trim()) return;
    if (!currentProject?.id) {
      alert('No project selected. Please select or create a project first.');
      return;
    }
    if (!openaiApiKey || !apiKeyValid) {
      conversationHistoryRef.current?.addMessage(
        'assistant',
        '⚠️ Please configure and validate your API key in settings first.',
        { actionType: 'system', error: true }
      );
      if (conversationHistoryRef.current) {
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
      return;
    }

    conversationHistoryRef.current?.addMessage('user', userMessage, {
      actionType: 'chat',
      timestamp: new Date().toISOString(),
    });
    if (conversationHistoryRef.current) {
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }

    const currentUserMessage = userMessage;
    setUserMessage('');
    setIsLoading(true);
    setLoadingStatus('Thinking...');

    try {
      const apiHistory = conversationHistoryRef.current?.getFormattedForOpenAI(10) || [];
      let enrichedHistory = apiHistory;
      if (contextEnabled && workingMemoryRef.current && sessionLearningRef.current) {
        enrichedHistory = [
          { role: 'system', content: sessionLearningRef.current.getContextForAI(currentProject?.category) },
          { role: 'system', content: workingMemoryRef.current.getContextForAI() },
          ...apiHistory,
        ];
      }
      const researchContext = currentProject?.id
        ? JSON.parse(localStorage.getItem(`researchContext_${currentProject.id}`) || '{}')
        : {};

      const result = await sendChatMessage(
        currentUserMessage,
        configRef.current,
        enrichedHistory,
        openaiApiKey,
        multiAgentReviewEnabled,
        reviewMode,
        customPrompts,
        researchContext
      );

      if (result.intent === 'generate') setLoadingStatus('Generating survey...');
      else if (result.intent === 'adjust') setLoadingStatus('Adjusting survey...');
      else setLoadingStatus('Processing...');
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsLoading(false);
      setLoadingStatus('');

      if (!result.success) {
        conversationHistoryRef.current?.addMessage(
          'assistant',
          `❌ Error: ${result.error}`,
          { actionType: 'error', error: true }
        );
        if (conversationHistoryRef.current) {
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }
        return;
      }

      if (result.chainOfThoughts && conversationHistoryRef.current) {
        const step1Key = result.chainOfThoughts.step1_research || result.chainOfThoughts.step1_understanding;
        if (step1Key) {
          conversationHistoryRef.current.addMessage(
            'assistant',
            `**🧠 Step 1: ${result.intent === 'generate' ? 'Research Analysis' : 'Understanding Adjustment Goal'}**\n\n${step1Key}`,
            { type: 'chain-of-thoughts', step: 1, intent: result.intent }
          );
        }
        const step2Key = result.chainOfThoughts.step2_structure || result.chainOfThoughts.step2_planning;
        if (step2Key) {
          conversationHistoryRef.current.addMessage(
            'assistant',
            `**📐 Step 2: ${result.intent === 'generate' ? 'Survey Structure Planning' : 'Adjustment Planning'}**\n\n${step2Key}`,
            { type: 'chain-of-thoughts', step: 2, intent: result.intent }
          );
        }
        const step3Key = result.chainOfThoughts.step3_generation || result.chainOfThoughts.step3_execution;
        if (step3Key) {
          conversationHistoryRef.current.addMessage(
            'assistant',
            `**🔨 Step 3: ${result.intent === 'generate' ? 'Generation' : 'Execution'}**\n\n${step3Key}`,
            { type: 'chain-of-thoughts', step: 3, intent: result.intent }
          );
        }
      }

      conversationHistoryRef.current?.addMessage('assistant', result.message, {
        actionType: result.intent,
        timestamp: new Date().toISOString(),
      });

      if (result.multiAgentReview?.conversationMessages) {
        result.multiAgentReview.conversationMessages.forEach((msg) => {
          if (conversationHistoryRef.current && msg.content) {
            conversationHistoryRef.current.addMessage(msg.role || 'assistant', msg.content, {
              ...(msg.metadata || {}),
              timestamp: msg.timestamp || new Date().toISOString(),
              isMultiAgent: true,
            });
          }
        });
      }

      if (conversationHistoryRef.current) {
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }

      if (result.researchContext && currentProject?.id) {
        localStorage.setItem(`researchContext_${currentProject.id}`, JSON.stringify(result.researchContext));
        window.dispatchEvent(new CustomEvent('researchContextUpdated', { detail: result.researchContext }));
      }

      const processedConfig = applyAssistantResult(result, configRef.current);
      if (!processedConfig) return;

      aiUndoSnapshotRef.current = JSON.parse(JSON.stringify(configRef.current));
      setAiUndoAvailable(true);
      if (currentProject?.id) {
        sessionStorage.setItem(`ai_undo_${currentProject.id}`, JSON.stringify(configRef.current));
      }
      onChangeRef.current(processedConfig);

      if (contextEnabled) {
        if (workingMemoryRef.current) {
          if (result.intent === 'generate') workingMemoryRef.current.setSurveyGoal(currentUserMessage);
          workingMemoryRef.current.addIteration(processedConfig, currentUserMessage);
          if (result.intent === 'adjust') {
            workingMemoryRef.current.addDesignDecision(currentUserMessage, 'User requested adjustment');
          }
        }
        sessionLearningRef.current?.recordProjectInteraction(
          currentProject?.id,
          currentProject?.category || 'general',
          result.intent === 'generate' ? 'generate_survey' : 'adjust_survey'
        );
      }

      if (!multiAgentReviewEnabled || (result.intent !== 'generate' && result.intent !== 'adjust')) {
        return;
      }

      setLoadingStatus('Starting Multi-Agent Review...');
      try {
        const customAgents = currentProject?.id && localStorage.getItem(`customAgents_${currentProject.id}`)
          ? JSON.parse(localStorage.getItem(`customAgents_${currentProject.id}`))
          : null;
        const reviewResearchContext = currentProject?.id
          ? JSON.parse(localStorage.getItem(`researchContext_${currentProject.id}`) || '{}')
          : {};
        await triggerMultiAgentReviewStream(
          processedConfig,
          openaiApiKey,
          reviewMode,
          maxReviewRounds,
          (eventType, data) => {
            if (!conversationHistoryRef.current) return;
            switch (eventType) {
              case 'start':
                conversationHistoryRef.current.addMessage(
                  'system',
                  `\n🔄 **Multi-Agent Review Started**\n\nMode: ${data.mode}\nExperts: ${data.totalAgents}\nMax Rounds: ${data.maxRounds}\n`,
                  { type: 'review-start', isMultiAgent: true }
                );
                break;
              case 'round-start':
                conversationHistoryRef.current.addMessage(
                  'system',
                  `\n📋 **Review Round ${data.round}**\n`,
                  { type: 'round-header', isMultiAgent: true, round: data.round }
                );
                setLoadingStatus(`Review Round ${data.round}...`);
                break;
              case 'agent-start':
                setLoadingStatus(`${data.emoji} ${data.name} reviewing...`);
                break;
              case 'agent-review':
                conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                  type: 'agent-review',
                  isMultiAgent: true,
                  agentId: data.agentId,
                  round: data.round,
                });
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                break;
              case 'round-summary':
                conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                  type: 'round-summary',
                  isMultiAgent: true,
                  round: data.round,
                });
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                break;
              case 'revision-start':
                conversationHistoryRef.current.addMessage(
                  'system',
                  `\n🔧 **Survey Designer**: Addressing feedback and revising survey...\n`,
                  { type: 'revision-start', isMultiAgent: true, round: data.round }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                setLoadingStatus('Revising survey...');
                break;
              case 'revision-thinking': {
                const stepTitle = data.step === 1
                  ? 'Understanding Expert Feedback'
                  : data.step === 2
                    ? 'Planning Changes'
                    : 'Executing Revision';
                conversationHistoryRef.current.addMessage(
                  'assistant',
                  `**${'🧠📐🔨'[data.step - 1]} Revision Step ${data.step}: ${stepTitle}**\n\n${data.content}`,
                  { type: 'revision-thinking', step: data.step, isMultiAgent: true }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                break;
              }
              case 'revision-complete':
                if (data.chainOfThoughts) {
                  if (data.chainOfThoughts.step1_understanding) {
                    conversationHistoryRef.current.addMessage(
                      'assistant',
                      `**🧠 Revision Step 1: Understanding Expert Feedback**\n\n${data.chainOfThoughts.step1_understanding}`,
                      { type: 'revision-cot', step: 1, isMultiAgent: true }
                    );
                  }
                  if (data.chainOfThoughts.step2_planning) {
                    conversationHistoryRef.current.addMessage(
                      'assistant',
                      `**📐 Revision Step 2: Planning Changes**\n\n${data.chainOfThoughts.step2_planning}`,
                      { type: 'revision-cot', step: 2, isMultiAgent: true }
                    );
                  }
                  if (data.chainOfThoughts.step3_execution) {
                    conversationHistoryRef.current.addMessage(
                      'assistant',
                      `**🔨 Revision Step 3: Executing Revision**\n\n${data.chainOfThoughts.step3_execution}`,
                      { type: 'revision-cot', step: 3, isMultiAgent: true }
                    );
                  }
                }
                conversationHistoryRef.current.addMessage(
                  'assistant',
                  `🔧 **Survey Designer**: Survey revised based on expert feedback. Ready for next review round.`,
                  { type: 'revision-complete', isMultiAgent: true, round: data.round }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                if (data.surveyConfig) {
                  onChangeRef.current(processAIGeneratedConfig(data.surveyConfig));
                }
                break;
              case 'complete':
                conversationHistoryRef.current.addMessage(
                  'system',
                  `\n🎯 **Review Complete**\n\n${data.reason}\n\nFinal Rating: ${data.finalRating}/10\nFinal Verdict: ${data.finalVerdict?.toUpperCase()}\n`,
                  { type: 'review-complete', isMultiAgent: true }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                if (data.surveyConfig) {
                  onChangeRef.current(processAIGeneratedConfig(data.surveyConfig));
                }
                break;
              case 'error':
              case 'agent-error':
              case 'revision-error':
                conversationHistoryRef.current.addMessage(
                  'system',
                  `❌ Error: ${data.error || data.message}`,
                  { type: 'error', isMultiAgent: true }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
                break;
              default:
                break;
            }
          },
          customAgents,
          currentUserMessage,
          reviewResearchContext,
          currentProject?.id
        );
      } catch (error) {
        conversationHistoryRef.current?.addMessage(
          'system',
          `❌ Multi-Agent Review failed: ${error.message}`,
          { type: 'error', isMultiAgent: true }
        );
        if (conversationHistoryRef.current) {
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }
      } finally {
        setLoadingStatus('');
      }
    } catch (error) {
      setIsLoading(false);
      setLoadingStatus('');
      conversationHistoryRef.current?.addMessage(
        'assistant',
        `❌ Unexpected error: ${error.message}`,
        { actionType: 'error', error: true }
      );
      if (conversationHistoryRef.current) {
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    }
  }, [
    userMessage,
    currentProject,
    openaiApiKey,
    apiKeyValid,
    contextEnabled,
    multiAgentReviewEnabled,
    reviewMode,
    customPrompts,
    maxReviewRounds,
  ]);

  return {
    messages: conversationMessages,
    userMessage,
    isLoading,
    loadingStatus,
    apiKeyValid,
    openaiApiKey,
    contextEnabled,
    multiAgentReviewEnabled,
    reviewMode,
    maxReviewRounds,
    recommendations,
    currentProject,
    conversationHistoryRef,
    workingMemoryRef,
    sessionLearningRef,
    setUserMessage,
    setCustomPrompts,
    handleRevertAiChange,
    aiUndoAvailable,
    handleSendMessage,
    setOpenaiApiKey,
    handleValidateApiKey,
    setContextEnabled,
    setMultiAgentReviewEnabled,
    setReviewMode,
    setMaxReviewRounds,
    handleClearHistory,
    handleDownloadHistory,
    chatEndRef,
  };
}
