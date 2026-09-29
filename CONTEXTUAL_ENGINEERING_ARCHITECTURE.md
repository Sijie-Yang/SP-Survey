# 🧠 Contextual Engineering Architecture

## 📐 Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE LAYER                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                  ChatAssistant Component                          │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐    │  │
│  │  │   Header   │  │   Settings   │  │  Conversation Display │    │  │
│  │  │ ⚙️ 🔽 ✕   │  │   Dialog     │  │    (Auto-scroll)      │    │  │
│  │  └────────────┘  └──────────────┘  └───────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │            Message Input + Send Button                     │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTEXTUAL ENGINEERING CORE                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    3-Layer Memory System                         │  │
│  │                                                                  │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 1: SESSION LEARNING (localStorage)              ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • User Expertise Level                          │  ┃  │  │
│  │  ┃  │ • Historical Preferences (scales, image counts) │  ┃  │  │
│  │  ┃  │ • Project Statistics (iterations, categories)  │  ┃  │  │
│  │  ┃  │ • Smart Recommendations                         │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Across browser sessions            │  ┃  │  │
│  │  ┃  │ Scope: Cross-project, User-level                │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  │                              ↕                                   │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 2: WORKING MEMORY (sessionStorage)          ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • Current Survey Goal                           │  ┃  │  │
│  │  ┃  │ • Iteration History                             │  ┃  │  │
│  │  ┃  │ • Design Decisions & Rationale                  │  ┃  │  │
│  │  ┃  │ • Active Project Context                        │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Current session only               │  ┃  │  │
│  │  ┃  │ Scope: Project-specific                         │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  │                              ↕                                   │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 3: CONVERSATION HISTORY (sessionStorage)    ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • User Messages                                  │  ┃  │  │
│  │  ┃  │ • AI Responses                                   │  ┃  │  │
│  │  ┃  │ • Message Metadata (timestamp, intent)          │  ┃  │  │
│  │  ┃  │ • System Messages                                │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Current session only               │  ┃  │  │
│  │  ┃  │ Scope: Project-specific                         │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                       INTELLIGENT ROUTING LAYER                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Backend API (/api/openai/chat)                  │  │
│  │                                                                  │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │            Intent Classification (LLM-based)            │   │  │
│  │  │  • Analyze user message + current survey state          │   │  │
│  │  │  • Classify intent: generate / adjust / question        │   │  │
│  │  │  • Include conversation history for context             │   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  │                            ↓                                     │  │
│  │  ┌───────────┬──────────────────┬─────────────────────────┐    │  │
│  │  │ GENERATE  │     ADJUST       │       QUESTION          │    │  │
│  │  │  Intent   │     Intent       │        Intent           │    │  │
│  │  └─────┬─────┴────────┬─────────┴───────────┬─────────────┘    │  │
│  │        ↓              ↓                     ↓                   │  │
│  │  ┌─────────┐   ┌─────────────┐   ┌──────────────────┐         │  │
│  │  │ Create  │   │   Modify    │   │  Answer with     │         │  │
│  │  │ New     │   │  Existing   │   │  Information     │         │  │
│  │  │ Survey  │   │  Survey     │   │  (No changes)    │         │  │
│  │  └─────────┘   └─────────────┘   └──────────────────┘         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                           LLM PROCESSING LAYER                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     OpenAI GPT-4o Integration                    │  │
│  │                                                                  │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │              Dynamic Context Injection                    │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ System Prompt (Base Rules + Question Types)        │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Session Context (User Preferences + Expertise)     │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Working Context (Survey Goal + Design Decisions)   │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Conversation History (Last 10 messages)            │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Current Survey Config (if exists)                  │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ User Message (Current request)                     │  │  │  │
│  │  │  └─────────────────────────────────────────────────────┘  │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  │                              ↓                                   │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │           Response Generation (JSON Mode)                 │  │  │
│  │  │  • Structured output with surveyConfig                    │  │  │
│  │  │  • Natural language explanation                           │  │  │
│  │  │  • Automatic retry on parse errors                        │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Survey Builder Component                      │  │
│  │  • Apply generated/adjusted config to editor                     │  │
│  │  • Update working memory with new iteration                      │  │
│  │  • Record design decisions                                       │  │
│  │  • Update session learning statistics                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Diagram

### **User Input Flow**

```
┌─────────────┐
│    USER     │
│  Types msg  │
└──────┬──────┘
       │
       ↓
┌──────────────────────────────────────────────────────┐
│  handleSendMessage (SurveyBuilder.js)                │
│  • Validate API key                                  │
│  • Add user message to conversation history          │
│  • Build API history (last 10 messages)              │
│  • Enrich with Session + Working context            │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  sendChatMessage (chatApi.js)                        │
│  POST /api/openai/chat                               │
│  {                                                    │
│    message: "Create thermal survey",                 │
│    currentConfig: {...},                             │
│    conversationHistory: [...],                       │
│    apiKey: "sk-..."                                  │
│  }                                                    │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  Backend Intent Router (server.js)                   │
│  • Build intentPrompt with message + config state    │
│  • Call OpenAI to classify: generate/adjust/question │
│  • Route to appropriate LLM handler                  │
└────────────────────┬─────────────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Generate │  │  Adjust  │  │ Question │
│  Survey  │  │  Survey  │  │  Answer  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   ↓
┌──────────────────────────────────────────────────────┐
│  OpenAI API Call (with full context)                 │
│  • System prompt (rules + examples)                  │
│  • Session context (preferences)                     │
│  • Working context (project goals)                   │
│  • Conversation history                              │
│  • Current message                                   │
│  → Response with surveyConfig (if generate/adjust)   │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  Response Processing (SurveyBuilder.js)              │
│  • Add AI response to conversation history           │
│  • If surveyConfig present:                          │
│    - Apply to editor (onChange)                      │
│    - Update working memory (goal, iteration)         │
│    - Record design decisions                         │
│    - Update session learning stats                   │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  UI Update                                           │
│  • Show AI message in chat                           │
│  • Update survey preview                             │
│  • Auto-scroll to bottom                             │
│  • Enable input for next message                     │
└──────────────────────────────────────────────────────┘
```

---

## 🧩 Component Interaction Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React)                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  SurveyBuilder.js                                          │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  State Management                                     │ │ │
│  │  │  • conversationMessages                               │ │ │
│  │  │  • userMessage, isLoading, apiKeyValid               │ │ │
│  │  │  • recommendations, contextEnabled                   │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Refs (Persistent Objects)                           │ │ │
│  │  │  • conversationHistoryRef → conversationHistory.js   │ │ │
│  │  │  • workingMemoryRef → workingMemory.js              │ │ │
│  │  │  • sessionLearningRef → sessionLearning.js          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Event Handlers                                       │ │ │
│  │  │  • handleSendMessage()                               │ │ │
│  │  │  • handleValidateApiKey()                            │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                          ↓ renders                        │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  ChatAssistant.js                                    │ │ │
│  │  │  • Header (status, download, clear, settings)       │ │ │
│  │  │  • Recommendations display                           │ │ │
│  │  │  • Message list (scrollable)                         │ │ │
│  │  │  • Input + Send button                               │ │ │
│  │  │  • Settings Dialog (API key, CE toggle)             │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Context Modules (src/lib/)                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  conversationHistory.js (sessionStorage)             │ │ │
│  │  │  • addMessage(role, content, metadata)               │ │ │
│  │  │  • getAllMessages()                                   │ │ │
│  │  │  • getFormattedForOpenAI(limit)                      │ │ │
│  │  │  • clear(), export()                                 │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  workingMemory.js (sessionStorage)                   │ │ │
│  │  │  • setSurveyGoal(goal)                               │ │ │
│  │  │  • addIteration(config, instruction)                 │ │ │
│  │  │  • addDesignDecision(decision, rationale)            │ │ │
│  │  │  • getContextForAI()                                 │ │ │
│  │  │  • clear()                                           │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  sessionLearning.js (localStorage)                   │ │ │
│  │  │  • recordProjectInteraction(id, category, action)    │ │ │
│  │  │  • updateUserExpertise(level)                        │ │ │
│  │  │  • recordUserPreference(key, value)                  │ │ │
│  │  │  • getRecommendations(category)                      │ │ │
│  │  │  • getContextForAI(category)                         │ │ │
│  │  │  • export()                                          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  chatApi.js                                                │ │
│  │  • sendChatMessage(msg, config, history, key)             │ │
│  │  • validateApiKey(key)                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                ↕ HTTP
┌──────────────────────────────────────────────────────────────────┐
│                       BACKEND (Node.js/Express)                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  server.js                                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  POST /api/openai/chat                               │ │ │
│  │  │  1. Receive: message, currentConfig, history, key    │ │ │
│  │  │  2. Build intentPrompt                               │ │ │
│  │  │  3. Call OpenAI to classify intent                   │ │ │
│  │  │  4. Route to handler:                                │ │ │
│  │  │     • generate → Full survey creation                │ │ │
│  │  │     • adjust → Modify existing survey                │ │ │
│  │  │     • question → Answer without changes              │ │ │
│  │  │  5. Build enriched messages array                    │ │ │
│  │  │  6. Call OpenAI with full context                    │ │ │
│  │  │  7. Parse response (with retry)                      │ │ │
│  │  │  8. Return surveyConfig + message                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  POST /api/openai/validate-key                       │ │ │
│  │  │  • Test API key with simple completion               │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                ↕ API
┌──────────────────────────────────────────────────────────────────┐
│                       OPENAI API                                 │
│  • GPT-4o model                                                  │
│  • JSON mode enabled                                             │
│  • Structured output with retry                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 💾 Storage Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      BROWSER STORAGE                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  localStorage (Persistent, Cross-Session)              │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_session_learning             │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    userExpertise: "intermediate",               │ │ │
│  │  │    preferences: {                                │ │ │
│  │  │      ratingScale: "1-7",                        │ │ │
│  │  │      imageCount: 4,                             │ │ │
│  │  │      includeNeutral: true                       │ │ │
│  │  │    },                                           │ │ │
│  │  │    projectHistory: [                            │ │ │
│  │  │      {                                          │ │ │
│  │  │        projectId: "abc123",                    │ │ │
│  │  │        category: "thermal",                    │ │ │
│  │  │        iterations: 5,                          │ │ │
│  │  │        timestamp: "2025-10-23T..."             │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    stats: {                                     │ │ │
│  │  │      totalProjects: 8,                         │ │ │
│  │  │      avgIterations: 4.3,                       │ │ │
│  │  │      categoryBreakdown: {                      │ │ │
│  │  │        thermal: 3,                             │ │ │
│  │  │        safety: 2,                              │ │ │
│  │  │        aesthetics: 3                           │ │ │
│  │  │      }                                          │ │ │
│  │  │    }                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  sessionStorage (Temporary, Session-Only)              │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_conversation_[projectId]     │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    projectId: "abc123",                         │ │ │
│  │  │    messages: [                                   │ │ │
│  │  │      {                                          │ │ │
│  │  │        role: "user",                           │ │ │
│  │  │        content: "Create thermal survey",       │ │ │
│  │  │        timestamp: "2025-10-23T10:30:00",       │ │ │
│  │  │        metadata: { intent: "generate" }        │ │ │
│  │  │      },                                         │ │ │
│  │  │      {                                          │ │ │
│  │  │        role: "assistant",                      │ │ │
│  │  │        content: "Generated survey...",         │ │ │
│  │  │        timestamp: "2025-10-23T10:30:05",       │ │ │
│  │  │        metadata: { surveyGenerated: true }     │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    metadata: {                                  │ │ │
│  │  │      totalMessages: 10,                        │ │ │
│  │  │      startTime: "2025-10-23T10:00:00"          │ │ │
│  │  │    }                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_working_memory_[projectId]   │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    projectId: "abc123",                         │ │ │
│  │  │    surveyGoal: "Assess thermal comfort...",     │ │ │
│  │  │    iterations: [                                 │ │ │
│  │  │      {                                          │ │ │
│  │  │        timestamp: "2025-10-23T10:30:05",       │ │ │
│  │  │        instruction: "Create initial survey",   │ │ │
│  │  │        configSnapshot: {...}                   │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    designDecisions: [                           │ │ │
│  │  │      {                                          │ │ │
│  │  │        decision: "Use 1-7 scale",              │ │ │
│  │  │        rationale: "User preference",           │ │ │
│  │  │        timestamp: "2025-10-23T10:35:00"        │ │ │
│  │  │      }                                          │ │ │
│  │  │    ]                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 Context Injection Strategy

```
┌─────────────────────────────────────────────────────────────┐
│             LLM PROMPT CONSTRUCTION                         │
│                                                             │
│  messages = [                                               │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Base Instructions                           │ │
│    │ • Available question types (text + image)           │ │
│    │ • Decision tree (demographics vs visual)            │ │
│    │ • Image configuration rules                         │ │
│    │ • JSON structure requirements                       │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Session Context (if contextEnabled)        │ │
│    │ • User expertise: "intermediate"                    │ │
│    │ • Preferences: 1-7 scales, 4 images, neutral option│ │
│    │ • History: 3 thermal surveys, avg 4.3 iterations   │ │
│    │ • Patterns: Prefers demographics first, images 2nd │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Working Context (if contextEnabled)        │ │
│    │ • Goal: "Assess thermal comfort in urban spaces"   │ │
│    │ • Iterations: 2 previous versions                   │ │
│    │ • Decisions: "Use 1-7 scale per user preference"   │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: (from conversation history[0])                │ │
│    │ "Create a thermal comfort survey"                   │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ ASSISTANT: (from conversation history[1])           │ │
│    │ "Generated survey with 3 pages..."                  │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: (from conversation history[2])                │ │
│    │ "Add more imagerating questions"                    │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ ASSISTANT: (from conversation history[3])           │ │
│    │ "Added 3 imagerating questions..."                  │ │
│    └─────────────────────────────────────────────────────┘ │
│    ...  (up to last 10 messages)                          │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: Current Message                               │ │
│    │ "Change all scales to 1-9"                          │ │
│    └─────────────────────────────────────────────────────┘ │
│  ]                                                          │
│                                                             │
│  → OpenAI API Call                                          │
│  → Response with full context awareness                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔀 Intent Classification Flow

```
┌──────────────────────────────────────────────────────┐
│  User Message: "Add an imagepicker question"        │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Build Intent Prompt                                 │
│  {                                                    │
│    message: "Add an imagepicker question",           │
│    currentSurveyExists: true,                        │
│    pageCount: 3,                                     │
│    questionCount: 12                                 │
│  }                                                    │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  OpenAI Classification (GPT-4o)                      │
│  Prompt: "Classify this user intent..."             │
│  Response must be: generate / adjust / question      │
└────────────────────┬─────────────────────────────────┘
                     ↓
             ┌───────┴───────┐
             │    "adjust"   │
             └───────┬───────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Route to Adjust Handler                             │
│  • Include current survey config                     │
│  • Include conversation history                      │
│  • Include enriched context                          │
│  • Call OpenAI: "Modify this survey..."             │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Return Modified Survey Config                       │
│  {                                                    │
│    message: "Added imagepicker to Page 3",          │
│    surveyConfig: { ... },                           │
│    intent: "adjust"                                  │
│  }                                                    │
└──────────────────────────────────────────────────────┘
```

---

## 📈 Learning & Adaptation Flow

```
┌─────────────────────────────────────────────────────┐
│  User creates thermal survey                        │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Session Learning Records:                          │
│  • Category: "thermal"                              │
│  • Preferences detected:                            │
│    - Rating scale: 1-7                              │
│    - Image count: 4 per question                    │
│    - Structure: Demographics → Images → Text        │
│  • Iterations: 5                                    │
│  • Completion time: 15 minutes                      │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  localStorage Updated                               │
│  projectHistory.push({...})                         │
│  stats.avgIterations = recalculate()                │
│  preferences.update(detectedPreferences)            │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Next Time: User starts another thermal survey     │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Session Learning Provides Context:                 │
│  "User has created 3 thermal surveys before.        │
│   Typical preferences:                              │
│   - 1-7 rating scales                               │
│   - 4 images per question                           │
│   - Average 4.3 iterations to finalize              │
│   Recommendation: Start with similar structure"     │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  AI generates survey pre-configured with            │
│  user's learned preferences                         │
│  → Fewer iterations needed                          │
│  → Faster survey creation                           │
│  → Better user experience                           │
└─────────────────────────────────────────────────────┘
```

---

## 🎨 Visual Summary

### **Key Innovation: Multi-Layer Memory**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Traditional AI Assistant                         ┃
┃  • Stateless (no memory between sessions)         ┃
┃  • No user preference learning                    ┃
┃  • Same response for same prompt every time       ┃
┃  • High iteration count to get desired result     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                         VS
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Contextual Engineering                           ┃
┃  ✓ 3-layer persistent memory                      ┃
┃  ✓ Learns user preferences automatically          ┃
┃  ✓ Adapts responses based on history              ┃
┃  ✓ Reduces iterations through smart defaults      ┃
┃  ✓ Context-aware multi-turn conversations         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## 🚀 Benefits

1. **Personalization**: AI learns and adapts to each user's preferences
2. **Efficiency**: Fewer iterations needed to achieve desired survey
3. **Context Awareness**: Multi-turn conversations with full memory
4. **Smart Recommendations**: Data-driven suggestions based on past behavior
5. **Progressive Enhancement**: System gets better the more you use it

---

## 📚 File Structure

```
src/
├── components/admin/
│   ├── SurveyBuilder.js       # Main container with CE integration
│   └── ChatAssistant.js       # Chat UI component
├── lib/
│   ├── conversationHistory.js # Layer 3: Session conversation
│   ├── workingMemory.js       # Layer 2: Project context
│   ├── sessionLearning.js     # Layer 1: Cross-session learning
│   └── chatApi.js             # Frontend API client
server.js                      # Backend with intelligent routing
```

---

**This architecture demonstrates a novel approach to AI-assisted survey design, moving beyond simple prompt-response to a truly context-aware, learning system.**

---

## 💡 What is Contextual Engineering?

**Contextual Engineering** is a systematic approach to managing AI interactions that goes beyond traditional prompt engineering:

### Key Difference from Prompt Engineering

| Feature | Prompt Engineering | Contextual Engineering |
|---------|-------------------|------------------------|
| **Memory** | ❌ Stateless | ✅ Stateful (session + long-term) |
| **Multi-turn** | ❌ Single interactions | ✅ Continuous conversations |
| **Learning** | ❌ No adaptation | ✅ Learns preferences & patterns |
| **Context** | ❌ Static prompt | ✅ Dynamic context injection |
| **Personalization** | ❌ Generic | ✅ User-specific recommendations |

---

## 🚨 Critical Survey Design Rules

### Rule: No Standalone Text Questions About Streetscapes

**ALL non-socioeconomic text questions MUST have "image" display before them.**

Only demographic/socioeconomic questions (age, gender, education, occupation, income) can be pure text.

### Question Type Categories

**Text-Based Questions (10 types)** - For demographics/socioeconomic:
- `text`, `comment`, `radiogroup`, `checkbox`, `dropdown`, `ranking`, `rating`, `boolean`, `expression`, `matrix`

**Image Display (1 type)** - For reference:
- `image` - Must be followed by text questions

**Image-Based Questions (5 types)** - For visual perception:
- `imagepicker`, `imageranking`, `imagerating`, `imageboolean`, `imagematrix`
- All require: `imageSelectionMode: "huggingface_random"`, `imageCount`, `randomImageSelection: true`, `choices: []`

### Page Composition Rules

**Type 1: Socioeconomic Questions** (Multiple allowed per page)
```json
{"type": "radiogroup", "name": "age", ...}
{"type": "dropdown", "name": "education", ...}
```

**Type 2: Image-Based Questions** (Multiple allowed per page)
```json
{"type": "imagerating", "name": "comfort", "imageCount": 1, ...}
{"type": "imagepicker", "name": "preference", "imageCount": 4, ...}
```

**Type 3: Image Display + Text Questions** (Multiple groups allowed, can mix with Type 2)
```json
{"type": "image", "name": "street_1", "imageCount": 1, ...}
{"type": "comment", "name": "description", "title": "Describe what you see"}
{"type": "text", "name": "impression", "title": "First impression?"}
```

**Decision Tree:**
- Demographic question? → Text-based, NO image
- Visual assessment? → Image-based type (imagepicker, imagerating, imageranking)
- Text about streetscape? → "image" display + text questions (SAME page!)

---

## 🤖 Chat UI User Guide

### Quick Start

1. **Configure API Key**: Click ⚙️ Settings → Paste OpenAI API Key → Validate
2. **Start Chatting**: Type naturally - AI auto-detects intent

### Key Features

**1. Intelligent Intent Detection**
- "Create/Generate/Build..." → Generates new survey
- "Add/Change/Remove/Modify..." → Adjusts existing survey
- "What/How/Why..." → Answers questions

**2. Multi-Turn Conversations**
- AI remembers everything in the session
- No need to repeat context

**3. Contextual Engineering** (Optional, default ON)
- Learns preferences (rating scales, image counts)
- Remembers past projects
- Provides personalized recommendations

**4. Smart Recommendations**
- Based on history and expertise level
- Example: "You've created 3 thermal surveys before. Avg iterations: 4.3"

### Keyboard Shortcuts
- **Enter**: Send message
- **Shift + Enter**: New line
- **Cmd/Ctrl + Shift + R**: Hard refresh

### Pro Tips

✅ **Good examples:**
- "Create a thermal comfort survey"
- "Add an imagepicker"
- "Change all scales to 1-7"

❌ **Avoid:**
- JSON syntax or technical terms

**Iterative Design:**
1. Start simple: "Create a basic streetscape survey"
2. Refine: "Add more image questions"
3. Adjust: "Change the rating scales"
4. Polish: "Add a demographics page at the start"

---

## 📊 Implementation Details

### Module Structure

**conversationHistory.js** (sessionStorage)
- Tracks multi-turn conversations
- Stores user messages and AI responses
- Metadata: action types, timestamps, config snapshots
- Export/import functionality

**workingMemory.js** (sessionStorage)
- Records design decisions with reasoning
- Learns user preferences (rating scales, image counts)
- Tracks survey iterations
- Analyzes patterns from feedback

**sessionLearning.js** (localStorage)
- Tracks user expertise level (beginner → experienced)
- Records global preferences across all projects
- Identifies common patterns
- Project type statistics (success rate, average iterations)
- Provides context-aware recommendations

### User Experience Flow

**First-Time User (Beginner):**
1. Opens AI Assistant → Sees recommendation: "Pro tip: Start with a template..."
2. Generates first survey → AI uses beginner-friendly language
3. Adjusts survey 3 times → System learns: prefers 1-7 scales, likes 4 images per question
4. Completes survey → expertise level increases

**Experienced User (3+ Surveys):**
1. Opens new project → Sees: "You've created 5 thermal comfort surveys before"
2. Creates new survey → AI automatically uses learned preferences (1-7 scales, 4 images)
3. Makes adjustments → AI remembers conversation context
4. Full conversation history shows interaction chain

---

## 🧪 Testing Scenarios

### Test Scenario 1: First Survey
```javascript
User: "Create a streetscape perception survey with demographics and image ratings"
Expected:
- Beginner recommendation appears
- AI generates survey
- Conversation history: 2 messages
- Working memory: surveyGoal set
- Session learning: expertise = 0, interactions = 1
```

### Test Scenario 2: Iterative Refinement
```javascript
User: "Add an imagepicker question for street preference"
Expected:
- AI remembers previous generation
- Adds to existing survey (not from scratch)
- Conversation history: 4 messages
- Working memory: new iteration recorded
```

### Test Scenario 3: Cross-Session Learning
```javascript
// Close browser, reopen, create new project
User: "Create another streetscape survey"
Expected:
- Recommendation shows previous project stats
- AI uses learned preferences
- Session learning: expertise level maintained
```

---

## 📈 Evaluation Metrics

### Quantitative Metrics

1. **Learning Effectiveness**
   - Preference accuracy over time
   - Reduction in iterations (1st vs 5th survey)
   - Recommendation relevance score

2. **Context Utilization**
   - % of AI responses using learned preferences
   - Context length vs generation quality
   - Memory hit rate

3. **User Efficiency**
   - Time to complete survey (session 1 vs session 5)
   - Number of adjustments needed
   - User satisfaction scores

### Qualitative Analysis

1. **AI Response Quality**
   - Context maintenance across turns
   - Personalization of recommendations
   - Adaptation to user style

2. **User Experience**
   - Interview feedback
   - Conversation history analysis
   - Feature usage statistics

---

## 🔬 Academic Positioning

### This is NOT:
- ❌ Simple prompt engineering
- ❌ Basic few-shot learning
- ❌ RAG (retrieval-augmented generation)

### This IS:
- ✅ Multi-layer memory architecture
- ✅ Dynamic context management
- ✅ User modeling & personalization
- ✅ Iterative learning system
- ✅ Context-aware AI interaction

### Paper Title Suggestions

1. "Contextual Engineering for Personalized AI-Assisted Survey Design: A Multi-Layer Memory Architecture"
2. "Beyond Prompts: Implementing Contextual Engineering with Multi-Turn Memory and Adaptive Learning"
3. "From Stateless to Stateful: A Contextual Engineering Framework for Iterative Survey Design with LLMs"

---

## 🚀 Prompt Optimization History

### Initial Issues (Feature Branch)
- ❌ Too many decorative elements: ═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️
- ❌ Over-complicated SCENARIO 1/2/3 sections
- ❌ ASCII tree diagrams
- ❌ Redundant explanations

### Optimization (Main Branch Style)
- ✅ **No decorative symbols**: Pure text, no emoji, no separators
- ✅ **Numbered lists**: Simple 1, 2, 3, 4 rules
- ✅ **Concise decision trees**: Simple bullet points with "→" symbols
- ✅ **Direct instructions**: "Return ONLY valid JSON, no markdown"

### Results
- Removed ~500+ lines of redundant code across all endpoints
- Improved LLM comprehension
- Maintained all critical information
- Consistent style across all API endpoints

### Updated Endpoints
| Endpoint | Status | Optimization |
|----------|--------|-------------|
| `/api/openai/generate-survey` | ✅ Complete | 213 lines removed |
| `/api/openai/adjust-survey` | ✅ Complete | Simplified |
| `/api/openai/generate-questions` | ✅ Complete | Simplified |
| `/api/openai/chat` (generate) | ✅ Complete | No emoji |
| `/api/openai/chat` (adjust) | ✅ Complete | No emoji |
| `/api/openai/chat` (question) | ✅ Complete | No emoji |

---

## 🔗 Related Research

### Memory-Augmented LLMs
- Packer et al. (2024) "MemGPT: Towards LLMs as Operating Systems"
- Wu et al. (2023) "Reasoning with Language Model is Planning with World Model"

### Personalization
- Salinas et al. (2023) "Personalization of Large Language Models: A Survey"
- Jang et al. (2023) "Personalized Soups: Personalized Large Language Model Alignment"

### Contextual AI
- Anthropic (2024) "Constitutional AI: Harmlessness from AI Feedback"
- OpenAI (2023) "GPT-4 Technical Report" (Section on Context Management)

---

## 🎯 Next Steps & Potential Enhancements

### Advanced Pattern Recognition
- NLP analysis of conversation patterns
- Automatic preference inference
- Anomaly detection (user deviating from patterns)

### Collaborative Learning
- Cross-user pattern sharing (anonymized)
- Best practices from successful surveys
- Community-driven recommendations

### Explainable AI
- Show why AI made specific decisions
- Highlight which memories influenced output
- Confidence scores for recommendations

### Multi-Modal Context
- Image analysis of uploaded datasets
- Question quality prediction
- Automatic A/B test generation

---

## ✅ Project Status

**All components implemented and tested:**
- ✅ Conversation History Management
- ✅ Working Memory System
- ✅ Session Learning Module
- ✅ UI Integration
- ✅ Context Enrichment
- ✅ Recommendations System
- ✅ Rule Enforcement
- ✅ Prompt Optimization
- ✅ Testing & Validation

**Ready for:**
- 🎯 User testing
- 📝 Paper writing
- 🚀 Production deployment
- 📊 Evaluation studies

---

---

## 🤖 Multi-Agent Review (Review mode)

Multi-agent review is the **Review** mode in the Assistant composer, next to
Agent / Generate / Adjust / Question. Those four modes are single-agent; only
Review is multi-agent. The legacy post-generate review stream
(`/api/openai/multi-agent-review-stream`, `src/lib/multiAgentReview.js`) has
been removed.

- Roles: Scientist, Participant, Planner, Psychologist, Analyst (all on by
  default, individually toggleable, with a reviewer cap).
- Methods: Linear individual review, or Group discussion (round-robin; each
  role sees the earlier turns).
- Each round, every role returns a rating and comments. If the average meets
  the accept threshold, the review stops. Otherwise a revision step writes a
  Summary, a Planning list, and design-protocol operations (Revise). The
  revised survey is reviewed again, up to the maximum number of rounds.
- Revisions are either applied each round through `survey_apply_operations`
  with `expectedDraftUpdatedAt`, or proposed only ("review only") and applied
  later from the chat card via `POST /api/agent/runs/:id/review/apply`.
- Reviewers are read-only sub-runs of the local tool loop in
  `src/server/agentChatRuntime.js`; orchestration is in
  `src/server/agentReview.js`. Everything runs on loopback with the
  researcher's own API key; free/shared model ids are refused, and survey
  credentials are stripped before anything reaches a reviewer.
- `POST /api/agent/review/estimate` returns model-call, token, and cost bounds
  before a run. Review results persist in the session event log
  (`data/agent-sessions.json`).

## 🧠 Chain of Thoughts (CoT) Three-Step Generation

### Overview

Every Generate, Adjust, and Revise operation follows a three-step Chain of Thoughts process. Instead of directly generating survey configurations, the AI first thinks, plans, and then executes - improving quality and transparency.

### Three-Step Process

#### **Step 1: Research Analysis / Understanding Goal**

**For Generate:**
- What is the core research topic?
- What are the main research questions to answer?
- What is the target audience?

**For Adjust:**
- What is the user trying to achieve with this adjustment?
- What aspects of the survey need to change?
- What should be preserved from the current survey?

**For Revise (Multi-Agent):**
- What are the critical issues multiple experts identified?
- What are the priorities for revision?
- What should be the revision strategy?

#### **Step 2: Structure Planning / Specific Changes**

**For Generate:**
- How many pages should the survey have?
- What is the purpose of each page?
- What types of questions should be on each page?
- How many questions per page?

**For Adjust:**
- Which pages need to be modified, added, or removed?
- Which questions need to be changed, added, or removed?
- What is the new structure after adjustments?
- How many pages and questions in the final version?

**For Revise (Multi-Agent):**
- Which pages/questions need modification?
- What specific changes to make?
- What is the priority order?

#### **Step 3: Generation / Execution**

- Generate the complete survey configuration based on previous analysis and planning
- Apply all rules and maintain consistency
- Return valid JSON structure

### Implementation Flow

```
User Request: "Create a thermal comfort survey"
    ↓
┌──────────────────────────────────────────────────┐
│ 📋 Step 1: Analyzing Research Topic              │
│                                                   │
│ AI Response:                                      │
│ "Core research topic: Thermal comfort perception │
│  Research questions: Visual assessment of thermal│
│  Target audience: Urban residents..."            │
└─────────────────┬────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────────┐
│ 📐 Step 2: Planning Survey Structure             │
│                                                   │
│ AI Response:                                      │
│ "3 pages recommended:                             │
│  Page 1: Demographics (3 questions)              │
│  Page 2: Visual Assessment (5 imagerating)       │
│  Page 3: Preferences (imagepicker + ranking)..." │
└─────────────────┬────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────────┐
│ 🔨 Step 3: Generating Survey Configuration       │
│                                                   │
│ AI Response:                                      │
│ "Survey configuration generated"                  │
│ { "pages": [...], "title": "...", ... }         │
└──────────────────────────────────────────────────┘
```

### Benefits

1. **Transparency**: Users can see AI's thinking process
2. **Quality**: Three-step thinking ensures comprehensive consideration
3. **Traceability**: Each decision has clear reasoning
4. **Educational**: Users learn survey design best practices
5. **Debugging**: Easy to identify which step went wrong

### UI Integration

All three steps are displayed in the conversation history:

```
🧠 Step 1: Research Analysis
[AI's analysis of the research topic and questions]

📐 Step 2: Survey Structure Planning
[AI's planning of pages and questions]

🔨 Step 3: Generation
Survey configuration generated

✅ Generated new survey with 3 pages
```

### Code Location

- Backend: `server.js` lines 1426-1662
  - Generate operation with CoT
  - Adjust operation with CoT
  - Revise operation with CoT (in Multi-Agent Review)

- Frontend: `src/components/admin/SurveyBuilder.js` lines 726-756
  - Display CoT steps in conversation

---

## 📝 Unified Prompt Management System

### Overview

All system prompts are now managed through a centralized, editable configuration system.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  prompts.config.js (Root Directory)              │
│  - CommonJS export for Node.js backend          │
│  - Shared source of truth                       │
└────────────────┬────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ↓                 ↓
┌──────────────┐  ┌──────────────────────┐
│  server.js   │  │ src/config/prompts.js│
│  (Backend)   │  │ (Frontend)           │
└──────────────┘  └──────────┬───────────┘
                             ↓
                  ┌──────────────────────┐
                  │  ChatAssistant.js    │
                  │  (UI Display & Edit) │
                  └──────────────────────┘
```

### Available Prompts

1. **intentDetection**: Classify user intent (generate/adjust/question)
2. **generate**: Create new surveys with full examples
3. **adjust**: Modify existing surveys
4. **question**: Answer user questions
5. **revision**: Multi-agent feedback revision

### UI Features

**AI Assistant Settings → Prompts Tab:**

- ✅ View all system prompts
- ✅ Edit prompts in-place with syntax highlighting
- ✅ Save button (persists to `localStorage`)
- ✅ Reset button (restore defaults)
- ✅ Real-time validation
- ✅ Cross-session persistence

### Customization Workflow

```
1. Open AI Assistant Settings
   ↓
2. Navigate to "Prompts" tab
   ↓
3. Edit any prompt (2000+ lines of detailed instructions)
   ↓
4. Click "Save" → Stored in localStorage
   ↓
5. All future Generate/Adjust operations use custom prompts
   ↓
6. Click "Reset" anytime to restore defaults
```

### Benefits

1. **Flexibility**: Researchers can customize AI behavior
2. **Experimentation**: Test different prompt strategies
3. **Transparency**: Full visibility into system instructions
4. **Portability**: Export/import custom prompt configurations
5. **Version Control**: Track prompt iterations

### Code Location

- Shared Config: `prompts.config.js` (root)
- Frontend Config: `src/config/prompts.js`
- Backend Usage: `server.js` lines 1397-1400
- UI Component: `src/components/admin/ChatAssistant.js` lines 705-793
- State Management: `src/components/admin/SurveyBuilder.js` lines 239-240

---

## 🌟 GitHub Stars Dynamic Display

### Real-Time Star Count

The admin panel header now displays live GitHub star count:

- ✅ Fetches from GitHub API on load
- ✅ Auto-refreshes every 5 minutes
- ✅ Graceful fallback if API unavailable
- ✅ Hover animation with star effect

### Implementation

```javascript
// src/AdminApp.js lines 154-175
useEffect(() => {
  const fetchGithubStars = async () => {
    const response = await fetch(
      'https://api.github.com/repos/Sijie-Yang/Streetscape-Perception-Survey'
    );
    if (response.ok) {
      const data = await response.json();
      setGithubStars(data.stargazers_count);
    }
  };
  
  fetchGithubStars();
  const interval = setInterval(fetchGithubStars, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

---

**Last Updated:** October 26, 2025  
**Branch:** `feature/contextual-engineering`  
**Status:** ✅ Complete (including CoT, Configurable Review, Prompt Management)

