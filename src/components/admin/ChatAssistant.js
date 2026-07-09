import React from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  IconButton,
  Typography,
  Avatar,
  Paper,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  Tooltip,
  InputAdornment,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  ButtonGroup,
  Collapse,
  Snackbar
} from '@mui/material';
import { ExpandMore, Save, RestartAlt } from '@mui/icons-material';
import {
  Send,
  Settings,
  SmartToy,
  PersonOutline,
  Clear,
  Download,
  CheckCircle,
  TipsAndUpdates,
  History,
  Close,
  Code,
  Memory,
  WorkHistory,
  Chat,
  Refresh
} from '@mui/icons-material';
import { PROMPTS } from '../../config/prompts';
import AgentsEditor from './AgentsEditor';

/**
 * ChatAssistant Component
 * A ChatGPT-style interface for survey generation/adjustment
 */
export default function ChatAssistant({
  messages = [],
  userMessage,
  isLoading,
  loadingStatus = '',
  apiKeyValid,
  openaiApiKey,
  contextEnabled,
  multiAgentReviewEnabled = false,
  reviewMode = '1v1',
  maxReviewRounds = 3,
  recommendations = [],
  currentProject,
  conversationHistoryRef,
  workingMemoryRef,
  sessionLearningRef,
  onMessageChange,
  onSendMessage,
  onApiKeyChange,
  onValidateApiKey,
  onContextToggle,
  onMultiAgentReviewToggle,
  onReviewModeChange,
  onMaxReviewRoundsChange,
  onClearHistory,
  onDownloadHistory,
  onPromptsChange,
  chatEndRef,
  aiUndoAvailable = false,
  onRevertAiChange,
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState(0);
  
  // States for viewing/editing data
  const [conversationData, setConversationData] = React.useState(null);
  const [workingMemoryData, setWorkingMemoryData] = React.useState(null);
  const [sessionLearningData, setSessionLearningData] = React.useState(null);
  
  // States for managing prompts (per project)
  const [prompts, setPrompts] = React.useState(() => {
    if (!currentProject?.id) return PROMPTS;
    const stored = localStorage.getItem(`customPrompts_${currentProject.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Validate that stored prompts have all required keys and non-empty values
        if (parsed.generate && parsed.adjust && parsed.question && parsed.intentDetection &&
            parsed.generate.length > 200 && parsed.adjust.length > 200) {
          console.log('✅ Loaded custom prompts for project:', currentProject.id);
          return parsed;
        } else {
          console.log('⚠️ Stored prompts incomplete, using defaults');
          localStorage.removeItem(`customPrompts_${currentProject.id}`);
          return PROMPTS;
        }
      } catch (e) {
        console.log('⚠️ Failed to parse stored prompts, using defaults');
        localStorage.removeItem(`customPrompts_${currentProject.id}`);
        return PROMPTS;
      }
    }
    console.log('✅ Using default prompts for project:', currentProject.id);
    return PROMPTS;
  });
  const [promptsModified, setPromptsModified] = React.useState(false);
  const [promptSnackbar, setPromptSnackbar] = React.useState({ open: false, message: '', severity: 'success' });

  // The AI Assistant is a sizable panel that most users only need
  // occasionally. We start it collapsed and let the user expand it by
  // clicking the header. Persist the open/closed state per project so the
  // panel stays open if they were actively chatting and switch tabs.
  const collapsedKey = currentProject?.id
    ? `chatAssistantCollapsed_${currentProject.id}`
    : 'chatAssistantCollapsed_default';
  const [collapsed, setCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(collapsedKey);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
    return true; // default: collapsed
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(collapsedKey, collapsed ? 'true' : 'false');
  }, [collapsed, collapsedKey]);

  // States for Research Context (per project)
  const [researchContext, setResearchContext] = React.useState(() => {
    if (!currentProject?.id) {
      return {
        topic: '',
        requirements: '',
        scenario: 'street view',
        customScenarios: []
      };
    }
    const stored = localStorage.getItem(`researchContext_${currentProject.id}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        return {
          topic: '',
          requirements: '',
          scenario: 'street view',
          customScenarios: []
        };
      }
    }
    return {
      topic: '',
      requirements: '',
      scenario: 'street view',
      customScenarios: []
    };
  });
  const [newScenario, setNewScenario] = React.useState('');
  
  // Flag to prevent saving during project switch
  const isLoadingProjectData = React.useRef(false);
  
  // Predefined scenario options
  const predefinedScenarios = [
    'general purpose',
    'street view',
    'building facade',
    'window view',
    'aerial view'
  ];

  // Listen for research context updates from AI
  React.useEffect(() => {
    const handleResearchContextUpdate = (event) => {
      console.log('🔬 Research context updated from AI:', event.detail);
      setResearchContext(event.detail);
    };

    window.addEventListener('researchContextUpdated', handleResearchContextUpdate);
    
    return () => {
      window.removeEventListener('researchContextUpdated', handleResearchContextUpdate);
    };
  }, []);
  
  // Notify parent when prompts change
  React.useEffect(() => {
    if (onPromptsChange) {
      onPromptsChange(prompts);
    }
    // Debug: log prompts length
    console.log('📝 Current prompts:', {
      generate: prompts.generate?.length || 0,
      adjust: prompts.adjust?.length || 0,
      question: prompts.question?.length || 0,
      intentDetection: prompts.intentDetection?.length || 0
    });
  }, [prompts, onPromptsChange]);
  
  // Save research context to localStorage when it changes (per project)
  React.useEffect(() => {
    if (currentProject?.id && !isLoadingProjectData.current) {
      localStorage.setItem(`researchContext_${currentProject.id}`, JSON.stringify(researchContext));
      console.log('💾 Research context saved for project:', currentProject.id, researchContext);
    }
  }, [researchContext, currentProject?.id]);

  // Reload settings when project changes
  React.useEffect(() => {
    if (currentProject?.id) {
      isLoadingProjectData.current = true;
      
      // Load prompts for this project
      const storedPrompts = localStorage.getItem(`customPrompts_${currentProject.id}`);
      if (storedPrompts) {
        try {
          const parsed = JSON.parse(storedPrompts);
          if (parsed.generate && parsed.adjust && parsed.question && parsed.intentDetection) {
            setPrompts(parsed);
            console.log('✅ Loaded prompts for project:', currentProject.id);
          } else {
            setPrompts(PROMPTS);
          }
        } catch (e) {
          setPrompts(PROMPTS);
        }
      } else {
        setPrompts(PROMPTS);
      }

      // Load research context for this project
      const storedResearch = localStorage.getItem(`researchContext_${currentProject.id}`);
      if (storedResearch) {
        try {
          setResearchContext(JSON.parse(storedResearch));
          console.log('✅ Loaded research context for project:', currentProject.id);
        } catch (e) {
          setResearchContext({
            topic: '',
            requirements: '',
            scenario: 'street view',
            customScenarios: []
          });
        }
      } else {
        setResearchContext({
          topic: '',
          requirements: '',
          scenario: 'street view',
          customScenarios: []
        });
      }
      
      setPromptsModified(false);
      
      // Re-enable saving after a brief delay to ensure all state updates complete
      setTimeout(() => {
        isLoadingProjectData.current = false;
      }, 100);
    }
  }, [currentProject?.id]);
  
  // Load data when settings dialog opens
  React.useEffect(() => {
    if (settingsOpen) {
      // Load conversation history
      if (conversationHistoryRef?.current) {
        setConversationData(conversationHistoryRef.current.getAllMessages());
      }
      
      // Load working memory
      if (workingMemoryRef?.current) {
        const wmData = workingMemoryRef.current.export ? workingMemoryRef.current.export() : null;
        setWorkingMemoryData(wmData);
      }
      
      // Load session learning
      if (sessionLearningRef?.current) {
        const slData = sessionLearningRef.current.export ? sessionLearningRef.current.export() : null;
        setSessionLearningData(slData);
      }
    }
  }, [settingsOpen, conversationHistoryRef, workingMemoryRef, sessionLearningRef]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };
  
  const handlePromptChange = (key, value) => {
    setPrompts(prev => ({ ...prev, [key]: value }));
    setPromptsModified(true);
  };
  
  const handleSavePrompts = () => {
    if (currentProject?.id) {
      localStorage.setItem(`customPrompts_${currentProject.id}`, JSON.stringify(prompts));
      setPromptsModified(false);
      setPromptSnackbar({ open: true, message: 'Prompts saved successfully for this project!', severity: 'success' });
    } else {
      setPromptSnackbar({ open: true, message: 'No project selected', severity: 'warning' });
    }
  };
  
  const handleResetPrompts = () => {
    if (window.confirm('Are you sure you want to reset all prompts to default values for this project?')) {
      setPrompts(PROMPTS);
      if (currentProject?.id) {
        localStorage.removeItem(`customPrompts_${currentProject.id}`);
      }
      setPromptsModified(false);
      setPromptSnackbar({ open: true, message: 'Prompts reset to defaults!', severity: 'info' });
    }
  };

  return (
    <Card 
      sx={{ 
        mb: 2,
        border: 2,
        borderColor: 'primary.main',
        borderRadius: 2,
        overflow: 'hidden'
      }}
    >
      {/* Header — click anywhere on it (outside the action icons) to
          expand / collapse the panel. */}
      <Box
        onClick={() => setCollapsed((c) => !c)}
        sx={{
          bgcolor: 'primary.main',
          color: 'white',
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': { bgcolor: 'primary.dark' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ExpandMore
            sx={{
              transition: 'transform 0.2s',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
          />
          <SmartToy sx={{ fontSize: 28 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            🤖 AI Assistant
          </Typography>
          {apiKeyValid && (
            <Chip 
              label="Connected" 
              size="small" 
              color="success" 
              icon={<CheckCircle />}
              sx={{ bgcolor: 'success.light', color: 'white' }}
            />
          )}
          {collapsed && messages.length > 0 && (
            <Chip
              label={`${messages.length} message${messages.length === 1 ? '' : 's'}`}
              size="small"
              sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
            />
          )}
        </Box>

        <Box onClick={(e) => e.stopPropagation()}>
          {messages.length > 0 && (
            <>
              <Tooltip title="Download conversation">
                <IconButton 
                  size="small" 
                  onClick={onDownloadHistory}
                  sx={{ color: 'white', mr: 1 }}
                >
                  <Download />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear history">
                <IconButton 
                  size="small" 
                  onClick={onClearHistory}
                  sx={{ color: 'white', mr: 1 }}
                >
                  <Clear />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title="Settings">
            <IconButton 
              size="small" 
              onClick={() => setSettingsOpen(true)}
              sx={{ color: 'white' }}
            >
              <Settings />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Collapse in={!collapsed} timeout="auto" unmountOnExit>
      <CardContent sx={{ p: 0 }}>
        {/* Recommendations */}
        {contextEnabled && recommendations.length > 0 && (
          <Box sx={{ p: 2, bgcolor: '#e8f5e9', borderBottom: '1px solid #ddd' }}>
            <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TipsAndUpdates sx={{ color: '#4caf50', fontSize: 20 }} />
              <strong>Smart Recommendations</strong>
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {recommendations.slice(0, 3).map((rec, index) => (
                <Chip
                  key={index}
                  label={rec.message}
                  size="small"
                  color={
                    rec.priority === 'high' ? 'error' :
                    rec.priority === 'medium' ? 'warning' : 'info'
                  }
                  variant="outlined"
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Chat History */}
        <Box 
          sx={{ 
            height: 400, 
            overflowY: 'auto', 
            p: 2,
            bgcolor: '#fafafa'
          }}
        >
          {messages.length === 0 ? (
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '100%',
              color: 'text.secondary'
            }}>
              <SmartToy sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Welcome to AI Assistant!
              </Typography>
              <Typography variant="body2" textAlign="center" sx={{ maxWidth: 400 }}>
                {apiKeyValid 
                  ? "I can help you create and modify surveys. Just type what you need, and I'll automatically figure out whether to generate a new survey or adjust your existing one!"
                  : "Please configure your API key in settings to get started."}
              </Typography>
            </Box>
          ) : (
            <>
              {messages.map((msg) => (
                <Box 
                  key={msg.id}
                  sx={{ 
                    mb: 2,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5
                  }}
                >
                  <Avatar 
                    sx={{ 
                      width: 32, 
                      height: 32,
                      bgcolor: msg.role === 'user' ? '#1976d2' : '#9c27b0'
                    }}
                  >
                    {msg.role === 'user' ? <PersonOutline /> : <SmartToy />}
                  </Avatar>
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight="bold">
                        {msg.role === 'user' ? 'You' : 'AI Assistant'}
                      </Typography>
                      {msg.metadata?.actionType && (
                        <Chip 
                          label={msg.metadata.actionType} 
                          size="small"
                          sx={{ height: 18, fontSize: '0.7rem' }}
                        />
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </Typography>
                    </Box>
                    
                    <Paper 
                      sx={{ 
                        p: 1.5,
                        bgcolor: msg.role === 'user' ? '#e3f2fd' : '#f3e5f5',
                        border: msg.metadata?.error ? '1px solid #f44336' : 'none'
                      }}
                    >
                      <Typography 
                        variant="body2" 
                        sx={{ whiteSpace: 'pre-wrap' }}
                      >
                        {msg.content}
                      </Typography>
                    </Paper>
                  </Box>
                </Box>
              ))}
              
              {/* Loading Status (like ChatGPT) */}
              {loadingStatus && (
                <Box 
                  sx={{ 
                    mb: 2,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5
                  }}
                >
                  <Avatar 
                    sx={{ 
                      width: 32, 
                      height: 32,
                      bgcolor: '#9c27b0'
                    }}
                  >
                    <SmartToy />
                  </Avatar>
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight="bold">
                        AI Assistant
                      </Typography>
                    </Box>
                    
                    <Paper 
                      sx={{ 
                        p: 1.5,
                        bgcolor: '#f3e5f5',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }}
                    >
                      <CircularProgress size={16} />
                      <Typography 
                        variant="body2" 
                        color="text.secondary"
                        sx={{ fontStyle: 'italic' }}
                      >
                        {loadingStatus}
                      </Typography>
                    </Paper>
                  </Box>
                </Box>
              )}
              
              <div ref={chatEndRef} />
            </>
          )}
        </Box>

        {/* Input Area */}
        <Box sx={{ p: 2, bgcolor: 'white', borderTop: '1px solid #ddd' }}>
          {aiUndoAvailable && (
            <Box sx={{ mb: 1 }}>
              <Button size="small" variant="outlined" color="warning" onClick={onRevertAiChange}>
                ↩️ Undo last AI change
              </Button>
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder={
                apiKeyValid 
                  ? "Type your message... (e.g., 'Create a thermal comfort survey' or 'Add an imagepicker question')"
                  : "Please configure API key in settings first..."
              }
              value={userMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={!apiKeyValid || isLoading}
              variant="outlined"
              InputProps={{
                endAdornment: isLoading && (
                  <InputAdornment position="end">
                    <CircularProgress size={20} />
                  </InputAdornment>
                )
              }}
            />
            <IconButton
              color="primary"
              onClick={onSendMessage}
              disabled={!apiKeyValid || !userMessage.trim() || isLoading}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground' }
              }}
            >
              <Send />
            </IconButton>
          </Box>
          
          {contextEnabled && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              🧠 Contextual Engineering enabled • Project: <strong>{currentProject?.name || 'Unnamed'}</strong> ({currentProject?.id?.slice(0, 8)}...) • Memory is project-specific
            </Typography>
          )}
        </Box>
      </CardContent>
      </Collapse>

      {/* Settings Dialog */}
      <Dialog 
        open={settingsOpen} 
        onClose={() => setSettingsOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">AI Assistant Settings & Data</Typography>
            <IconButton size="small" onClick={() => setSettingsOpen(false)}>
              <Close />
            </IconButton>
          </Box>
          
          <Tabs 
            value={activeTab} 
            onChange={(e, newValue) => setActiveTab(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab icon={<Settings fontSize="small" />} label="Settings" iconPosition="start" />
            <Tab icon={<TipsAndUpdates fontSize="small" />} label="Research" iconPosition="start" />
            <Tab icon={<SmartToy fontSize="small" />} label="Agents" iconPosition="start" />
            <Tab icon={<Code fontSize="small" />} label="Prompts" iconPosition="start" />
            <Tab icon={<Chat fontSize="small" />} label="Conversation" iconPosition="start" />
            <Tab icon={<WorkHistory fontSize="small" />} label="Working Memory" iconPosition="start" />
            <Tab icon={<Memory fontSize="small" />} label="Session Learning" iconPosition="start" />
          </Tabs>
        </DialogTitle>
        
        <DialogContent dividers sx={{ minHeight: 400, maxHeight: '70vh', overflow: 'auto' }}>
          {/* Tab 0: Settings */}
          {activeTab === 0 && (
            <Box>
              {/* API Key Configuration */}
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                🔑 API Key
              </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Use an{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a>
            {' '}or{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a>
            {' '}API key. OpenRouter keys start with <code>sk-or-</code>.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <TextField
              fullWidth
              type="password"
              label="API Key"
              value={openaiApiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-or-... or sk-..."
              InputProps={{
                endAdornment: apiKeyValid && (
                  <InputAdornment position="end">
                    <CheckCircle color="success" />
                  </InputAdornment>
                )
              }}
            />
            <Button
              variant="contained"
              onClick={onValidateApiKey}
              disabled={!openaiApiKey}
              sx={{ minWidth: 100 }}
            >
              Validate
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Contextual Engineering */}
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            🧠 Contextual Engineering
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={contextEnabled}
                onChange={(e) => onContextToggle(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body2">
                  Enable multi-turn conversations and memory
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  AI will remember your preferences and conversation history
                </Typography>
              </Box>
            }
          />

          {contextEnabled && (
            <Box sx={{ mt: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <History fontSize="small" />
                <strong>What's included:</strong>
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemText 
                    primary="Conversation History"
                    secondary="Remembers previous messages in this session"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Working Memory"
                    secondary="Learns your preferences (rating scales, image counts, etc.)"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Session Learning"
                    secondary="Tracks expertise level and provides personalized recommendations"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              </List>
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          {/* Multi-Agent Review */}
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            🤖 Multi-Agent Review
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={multiAgentReviewEnabled}
                onChange={(e) => onMultiAgentReviewToggle && onMultiAgentReviewToggle(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body2">
                  Auto-trigger expert review after generate/adjust
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  5 expert agents will review and help improve your survey
                </Typography>
              </Box>
            }
          />

          {multiAgentReviewEnabled && (
            <Box sx={{ mt: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <SmartToy fontSize="small" />
                <strong>Review Mode:</strong>
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button
                  variant={reviewMode === '1v1' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => onReviewModeChange && onReviewModeChange('1v1')}
                  sx={{ flex: 1 }}
                >
                  1v1 Reviews
                </Button>
                <Button
                  variant={reviewMode === 'group' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => onReviewModeChange && onReviewModeChange('group')}
                  sx={{ flex: 1 }}
                >
                  Group Discussion
                </Button>
              </Box>

              <Box sx={{ mb: 2 }}>
                <TextField
                  label="Maximum Review Rounds"
                  type="number"
                  size="small"
                  fullWidth
                  value={maxReviewRounds}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 1 && value <= 10) {
                      onMaxReviewRoundsChange && onMaxReviewRoundsChange(value);
                    }
                  }}
                  inputProps={{ min: 1, max: 10, step: 1 }}
                  helperText="Number of review rounds before auto-termination (1-10)"
                />
              </Box>

              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <strong>Expert Agents:</strong>
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemText 
                    primary="🔬 Urban Scientist"
                    secondary="Research design, methodology, scientific rigor"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="🏙️ Urban Designer"
                    secondary="Streetscape quality, design elements, placemaking"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="🧠 Perception Psychologist"
                    secondary="Question wording, cognitive load, response bias"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="👤 Test Participant"
                    secondary="User experience, survey usability, engagement"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="📊 Data Analyst"
                    secondary="Data quality, statistical analysis, measurement"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              </List>

              <Divider sx={{ my: 1 }} />

              <Typography variant="caption" color="text.secondary">
                {reviewMode === '1v1' 
                  ? '1v1 Mode: Each agent reviews independently and provides individual feedback'
                  : 'Group Mode: Agents discuss together and build on each other\'s insights'}
              </Typography>
            </Box>
          )}
            </Box>
          )}
          
          {/* Tab 1: Research Context */}
          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <TipsAndUpdates />
                Research Context
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Define your research topic and requirements to keep AI generation aligned with your goals.
              </Typography>
              
              {/* Research Topic */}
              <TextField
                fullWidth
                label="Research Topic"
                placeholder="e.g., Thermal comfort in urban streetscapes"
                value={researchContext.topic}
                onChange={(e) => setResearchContext({ ...researchContext, topic: e.target.value })}
                sx={{ mb: 3 }}
                helperText="A brief description of your main research topic"
              />
              
              {/* Research Requirements */}
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Research Requirements for Survey Design"
                placeholder="e.g., Survey should focus on people's thermal perception of street environments, including subjective thermal comfort ratings, preference assessments, and demographic information."
                value={researchContext.requirements}
                onChange={(e) => setResearchContext({ ...researchContext, requirements: e.target.value })}
                sx={{ mb: 3 }}
                helperText="Detailed requirements and objectives for your survey design"
              />
              
              {/* Survey Scenario */}
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                Survey Scenario Type
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Select the type of visual content your survey will focus on
              </Typography>
              
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {[...predefinedScenarios, ...researchContext.customScenarios].map((scenario) => (
                  <Chip
                    key={scenario}
                    label={scenario}
                    onClick={() => setResearchContext({ ...researchContext, scenario })}
                    color={researchContext.scenario === scenario ? 'primary' : 'default'}
                    variant={researchContext.scenario === scenario ? 'filled' : 'outlined'}
                    onDelete={
                      researchContext.customScenarios.includes(scenario)
                        ? () => setResearchContext({
                            ...researchContext,
                            customScenarios: researchContext.customScenarios.filter(s => s !== scenario),
                            scenario: researchContext.scenario === scenario ? 'street view' : researchContext.scenario
                          })
                        : undefined
                    }
                  />
                ))}
              </Box>
              
              {/* Add Custom Scenario */}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add custom scenario..."
                  value={newScenario}
                  onChange={(e) => setNewScenario(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newScenario.trim()) {
                      if (![...predefinedScenarios, ...researchContext.customScenarios].includes(newScenario.trim().toLowerCase())) {
                        setResearchContext({
                          ...researchContext,
                          customScenarios: [...researchContext.customScenarios, newScenario.trim().toLowerCase()]
                        });
                        setNewScenario('');
                      }
                    }
                  }}
                  sx={{ flexGrow: 1 }}
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    if (newScenario.trim() && ![...predefinedScenarios, ...researchContext.customScenarios].includes(newScenario.trim().toLowerCase())) {
                      setResearchContext({
                        ...researchContext,
                        customScenarios: [...researchContext.customScenarios, newScenario.trim().toLowerCase()]
                      });
                      setNewScenario('');
                    }
                  }}
                  disabled={!newScenario.trim()}
                >
                  Add
                </Button>
              </Box>
              
              <Alert severity="info" sx={{ mt: 3 }}>
                <Typography variant="body2">
                  💡 This information will be included in all AI operations (generate, adjust, revision, and review) to ensure consistency with your research goals.
                </Typography>
              </Alert>
            </Box>
          )}
          
          {/* Tab 2: Agents */}
          {activeTab === 2 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SmartToy />
                Multi-Agent Review Agents
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Customize the AI expert agents that review your surveys. Add, edit, or remove agents to fit your specific needs.
              </Typography>
              <AgentsEditor currentProject={currentProject} />
            </Box>
          )}
          
          {/* Tab 3: Prompts */}
          {activeTab === 3 && (
            <Box>
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                <Alert severity="info" sx={{ flex: 1 }}>
                  <strong>System Prompts</strong> - Edit these prompts to customize AI behavior. Changes are saved locally.
                </Alert>
                <ButtonGroup variant="contained" size="small">
                  <Button 
                    startIcon={<Save />} 
                    onClick={handleSavePrompts}
                    disabled={!promptsModified}
                    color="primary"
                  >
                    Save
                  </Button>
                  <Button 
                    startIcon={<RestartAlt />} 
                    onClick={handleResetPrompts}
                    color="secondary"
                  >
                    Reset
                  </Button>
                </ButtonGroup>
              </Box>
              
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="subtitle2">Generate Survey Prompt</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    fullWidth
                    multiline
                    rows={20}
                    value={prompts.generate}
                    onChange={(e) => handlePromptChange('generate', e.target.value)}
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    📍 Used in: POST /api/openai/chat (intent: generate) | Model: GPT-4o
                  </Typography>
                </AccordionDetails>
              </Accordion>
              
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="subtitle2">Adjust Survey Prompt</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    fullWidth
                    multiline
                    rows={18}
                    value={prompts.adjust}
                    onChange={(e) => handlePromptChange('adjust', e.target.value)}
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    📍 Used in: POST /api/openai/chat (intent: adjust) | Model: GPT-4o | Includes current survey config
                  </Typography>
                </AccordionDetails>
              </Accordion>
              
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="subtitle2">Intent Detection Prompt</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    fullWidth
                    multiline
                    rows={8}
                    value={prompts.intentDetection}
                    onChange={(e) => handlePromptChange('intentDetection', e.target.value)}
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    📍 Used in: POST /api/openai/chat (before intent processing) | Model: GPT-4o-mini
                  </Typography>
                </AccordionDetails>
              </Accordion>
              
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="subtitle2">Question Answering Prompt</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    fullWidth
                    multiline
                    rows={25}
                    value={prompts.question}
                    onChange={(e) => handlePromptChange('question', e.target.value)}
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    📍 Used in: POST /api/openai/chat (intent: question) | Model: GPT-4o
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Box>
          )}
          
          {/* Tab 4: Conversation History */}
          {activeTab === 4 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  💬 Conversation History
                </Typography>
                <Box>
                  <IconButton size="small" onClick={() => {
                    if (conversationHistoryRef?.current) {
                      const data = conversationHistoryRef.current.getAllMessages();
                      setConversationData(data);
                    }
                  }} title="Refresh">
                    <Refresh />
                  </IconButton>
                  <IconButton size="small" onClick={onDownloadHistory} title="Download">
                    <Download />
                  </IconButton>
                  <IconButton size="small" onClick={onClearHistory} title="Clear">
                    <Clear />
                  </IconButton>
                </Box>
              </Box>
              
              {conversationData && conversationData.length > 0 ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <strong>{conversationData.length} messages</strong> in current session
                    {currentProject && ` (Project: ${currentProject.name})`}
                  </Alert>
                  
                  <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto', p: 2, bgcolor: '#f5f5f5' }}>
                    {conversationData.map((msg, idx) => (
                      <Box key={idx} sx={{ mb: 2, pb: 2, borderBottom: idx < conversationData.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary">
                          {msg.role === 'user' ? '👤 User' : '🤖 Assistant'} • {new Date(msg.timestamp).toLocaleString()}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', fontFamily: msg.role === 'system' ? 'monospace' : 'inherit' }}>
                          {msg.content}
                        </Typography>
                        {msg.metadata && (
                          <Chip 
                            label={msg.metadata.actionType || msg.metadata.type || 'message'} 
                            size="small" 
                            sx={{ mt: 1 }}
                          />
                        )}
                      </Box>
                    ))}
                  </Paper>
                </Box>
              ) : (
                <Alert severity="warning">
                  No conversation history available. Start chatting to see messages here.
                </Alert>
              )}
            </Box>
          )}
          
          {/* Tab 5: Working Memory */}
          {activeTab === 5 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  🧠 Working Memory
                </Typography>
                <Box>
                  <IconButton size="small" onClick={() => {
                    if (workingMemoryRef?.current) {
                      const data = workingMemoryRef.current.export ? workingMemoryRef.current.export() : null;
                      setWorkingMemoryData(data);
                    }
                  }} title="Refresh">
                    <Refresh />
                  </IconButton>
                  <IconButton size="small" onClick={() => {
                    if (workingMemoryRef?.current && workingMemoryRef.current.clear) {
                      if (window.confirm('Clear working memory for this project?')) {
                        workingMemoryRef.current.clear();
                        setWorkingMemoryData(null);
                      }
                    }
                  }} title="Clear">
                    <Clear />
                  </IconButton>
                </Box>
              </Box>
              
              {workingMemoryData ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <strong>Project-specific memory</strong> - Resets when session ends
                    {currentProject && ` (Project: ${currentProject.name})`}
                  </Alert>
                  
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5', mb: 2 }}>
                    <pre style={{ margin: 0, fontSize: '0.85rem', overflow: 'auto', maxHeight: 400 }}>
                      {JSON.stringify(workingMemoryData, null, 2)}
                    </pre>
                  </Paper>
                  
                  {workingMemoryData.surveyGoal && (
                    <Alert severity="success">
                      <strong>Survey Goal:</strong> {workingMemoryData.surveyGoal}
                    </Alert>
                  )}
                </Box>
              ) : (
                <Alert severity="warning">
                  No working memory data available. Generate or adjust a survey to populate this.
                </Alert>
              )}
            </Box>
          )}
          
          {/* Tab 6: Session Learning */}
          {activeTab === 6 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  🎓 Session Learning
                </Typography>
                <Box>
                  <IconButton size="small" onClick={() => {
                    if (sessionLearningRef?.current) {
                      const data = sessionLearningRef.current.export ? sessionLearningRef.current.export() : null;
                      setSessionLearningData(data);
                    }
                  }} title="Refresh">
                    <Refresh />
                  </IconButton>
                  <IconButton size="small" onClick={() => {
                    if (sessionLearningRef?.current) {
                      const data = sessionLearningRef.current.export ? sessionLearningRef.current.export() : null;
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `session-learning-${new Date().toISOString()}.json`;
                      a.click();
                    }
                  }} title="Download">
                    <Download />
                  </IconButton>
                </Box>
              </Box>
              
              {sessionLearningData ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <strong>Cross-session learning</strong> - Persists across browser sessions (localStorage)
                  </Alert>
                  
                  {sessionLearningData.userExpertise !== undefined && (
                    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>User Profile</Typography>
                      <Typography variant="body2">
                        <strong>Expertise Level:</strong> {sessionLearningData.userExpertise}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Completed Surveys:</strong> {sessionLearningData.stats?.totalProjects || 0}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Avg Iterations:</strong> {sessionLearningData.stats?.avgIterations?.toFixed(1) || 'N/A'}
                      </Typography>
                    </Paper>
                  )}
                  
                  {sessionLearningData.preferences && Object.keys(sessionLearningData.preferences).length > 0 && (
                    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Learned Preferences</Typography>
                      <List dense>
                        {Object.entries(sessionLearningData.preferences).map(([key, value]) => (
                          <ListItem key={key}>
                            <ListItemText 
                              primary={key}
                              secondary={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>
                  )}
                  
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5' }}>
                    <Typography variant="subtitle2" gutterBottom>Full Data</Typography>
                    <pre style={{ margin: 0, fontSize: '0.85rem', overflow: 'auto', maxHeight: 300 }}>
                      {JSON.stringify(sessionLearningData, null, 2)}
                    </pre>
                  </Paper>
                </Box>
              ) : (
                <Alert severity="warning">
                  No session learning data available. Use the system to populate this.
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={promptSnackbar.open}
        autoHideDuration={4000}
        onClose={() => setPromptSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={promptSnackbar.severity} onClose={() => setPromptSnackbar((s) => ({ ...s, open: false }))}>
          {promptSnackbar.message}
        </Alert>
      </Snackbar>
    </Card>
  );
}

