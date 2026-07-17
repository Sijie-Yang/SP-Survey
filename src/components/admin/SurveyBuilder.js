import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  IconButton,
  Card,
  CardContent,
  CardActions,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  Paper,
  Tooltip,
  Badge,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Collapse
} from '@mui/material';
import {
  ExpandMore,
  Add,
  Delete,
  Edit,
  DragIndicator,
  ContentCopy,
  AutoAwesome,
  Psychology,
  CheckCircle,
  History,
  TipsAndUpdates,
  Clear,
  Download,
  SmartToy,
  PersonOutline,
  Send,
  Settings,
  Close
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PageEditor from './PageEditor';
import ConfirmDialog from '../layout/ConfirmDialog';
import QuestionEditor from './QuestionEditor';
import ChatAssistant from './ChatAssistant';
import SurveyThemePreviewPanel from '../SurveyThemePreviewPanel';
import {
  allocateUniqueName,
  allocateUniquePageName,
  collectUsedQuestionNames,
  findDuplicateQuestionNames,
  repairDuplicateQuestionNames,
} from '../../lib/questionNames';
// Old API functions removed - now using chatApi.js
import { getConversationHistory } from '../../lib/conversationHistory';
import { getWorkingMemory } from '../../lib/workingMemory';
import { getSessionLearning } from '../../lib/sessionLearning';
import { sendChatMessage, validateApiKey as validateChatApiKey, triggerMultiAgentReviewStream } from '../../lib/chatApi';

/** Compact color picker row for Theme Customization */
function ThemeColorField({ label, hint, value, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <TextField
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ width: 60, flexShrink: 0 }}
        InputProps={{ sx: { height: 50 } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
          {label}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
            {hint}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block', mt: 0.25 }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

/** One clearly separated block in the theme color palette. */
function ThemeColorPart({ step, title, description, children }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: description ? 0.5 : 1.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: 'primary.main',
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Part {step}
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Box>
      {description ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.4 }}>
          {description}
        </Typography>
      ) : null}
      <Grid container spacing={2}>
        {children}
      </Grid>
    </Box>
  );
}

// Sortable Page Item Component
function SortablePageItem({ page, pageIndex, onEdit, onDelete, onDuplicate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `page-${pageIndex}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 2,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'grab',
          mr: 2,
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator color="action" />
      </Box>
      
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="h6">
              {page.title || `Page ${pageIndex + 1}`}
            </Typography>
            <Chip
              label={`${page.elements?.length || 0} questions`}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
        }
        secondary={
          <Typography variant="body2" color="text.secondary">
            {page.description || 'No description provided'}
          </Typography>
        }
      />
      
      <ListItemSecondaryAction>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            color="primary"
            onClick={() => onEdit({ page, index: pageIndex })}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <Edit fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            onClick={() => onDuplicate(pageIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <ContentCopy fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={() => onDelete(pageIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'error.main',
              '&:hover': { bgcolor: 'error.light', borderColor: 'error.dark' }
            }}
          >
            <Delete fontSize="small" />
          </IconButton>
        </Box>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export default function SurveyBuilder({ config, onChange, currentProject, onNextStep, onRepairComplete }) {
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);

  // Collapsed-state for the rarely-used sub-sections of the Survey Settings
  // panel. We default both to collapsed and persist the user's choice per
  // project in localStorage so the sections stay open if they were actively
  // editing them.
  const displaySettingsKey = currentProject?.id
    ? `displaySettingsCollapsed_${currentProject.id}`
    : 'displaySettingsCollapsed_default';
  const themeCustomizationKey = currentProject?.id
    ? `themeCustomizationCollapsed_${currentProject.id}`
    : 'themeCustomizationCollapsed_default';
  const [displaySettingsCollapsed, setDisplaySettingsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(displaySettingsKey);
    return stored === 'false' ? false : true;
  });
  const [themeCustomizationCollapsed, setThemeCustomizationCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(themeCustomizationKey);
    return stored === 'false' ? false : true;
  });
  const [themeSnackbar, setThemeSnackbar] = useState({ open: false, message: '', severity: 'success' });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(displaySettingsKey, displaySettingsCollapsed ? 'true' : 'false');
    }
  }, [displaySettingsCollapsed, displaySettingsKey]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(themeCustomizationKey, themeCustomizationCollapsed ? 'true' : 'false');
    }
  }, [themeCustomizationCollapsed, themeCustomizationKey]);
  
  // Chat Assistant states - with localStorage persistence
  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    return localStorage.getItem('openaiApiKey') || '';
  });
  const [apiKeyValid, setApiKeyValid] = useState(() => {
    return localStorage.getItem('apiKeyValid') === 'true';
  });
  const [userMessage, setUserMessage] = useState('');
  const aiUndoSnapshotRef = useRef(null);
  const [aiUndoAvailable, setAiUndoAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(''); // e.g., "Thinking...", "Generating survey..."
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Contextual Engineering states
  const conversationHistoryRef = useRef(null);
  const workingMemoryRef = useRef(null);
  const sessionLearningRef = useRef(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  // Context enabled state (per project)
  const [contextEnabled, setContextEnabled] = useState(() => {
    if (!currentProject?.id) return true;
    const stored = localStorage.getItem(`contextEnabled_${currentProject.id}`);
    return stored !== null ? stored === 'true' : true;
  });
  
  // Multi-Agent Review states (per project)
  const [multiAgentReviewEnabled, setMultiAgentReviewEnabled] = useState(() => {
    if (!currentProject?.id) return false;
    const stored = localStorage.getItem(`multiAgentReviewEnabled_${currentProject.id}`);
    return stored === 'true';
  });
  
  const [reviewMode, setReviewMode] = useState(() => {
    if (!currentProject?.id) return '1v1';
    const stored = localStorage.getItem(`reviewMode_${currentProject.id}`);
    return stored || '1v1';
  });
  
  const [maxReviewRounds, setMaxReviewRounds] = useState(() => {
    if (!currentProject?.id) return 3;
    const stored = localStorage.getItem(`maxReviewRounds_${currentProject.id}`);
    return stored ? parseInt(stored, 10) : 3;
  });
  
  // Flag to prevent saving during project switch
  const isLoadingProjectSettings = useRef(false);
  
  // Custom prompts state
  const [customPrompts, setCustomPrompts] = useState(null);
  
  // Chat scroll reference
  const chatEndRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    if (openaiApiKey) {
      localStorage.setItem('openaiApiKey', openaiApiKey);
      console.log('💾 Saved API key to localStorage');
    }
  }, [openaiApiKey]);

  useEffect(() => {
    localStorage.setItem('apiKeyValid', apiKeyValid.toString());
  }, [apiKeyValid]);

  // Save settings to localStorage when they change (per project)
  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`contextEnabled_${currentProject.id}`, contextEnabled.toString());
      console.log('💾 Saved contextEnabled for project:', currentProject.id, contextEnabled);
    }
  }, [contextEnabled, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`multiAgentReviewEnabled_${currentProject.id}`, multiAgentReviewEnabled.toString());
      console.log('💾 Saved multiAgentReviewEnabled for project:', currentProject.id, multiAgentReviewEnabled);
    }
  }, [multiAgentReviewEnabled, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`reviewMode_${currentProject.id}`, reviewMode);
      console.log('💾 Saved reviewMode for project:', currentProject.id, reviewMode);
    }
  }, [reviewMode, currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && !isLoadingProjectSettings.current) {
      localStorage.setItem(`maxReviewRounds_${currentProject.id}`, maxReviewRounds.toString());
      console.log('💾 Saved maxReviewRounds for project:', currentProject.id, maxReviewRounds);
    }
  }, [maxReviewRounds, currentProject?.id]);

  // Load settings when project changes
  useEffect(() => {
    if (currentProject?.id) {
      isLoadingProjectSettings.current = true;
      
      // Load context enabled
      const storedContext = localStorage.getItem(`contextEnabled_${currentProject.id}`);
      setContextEnabled(storedContext !== null ? storedContext === 'true' : true);
      
      // Load multi-agent review settings
      const storedReview = localStorage.getItem(`multiAgentReviewEnabled_${currentProject.id}`);
      setMultiAgentReviewEnabled(storedReview === 'true');
      
      const storedMode = localStorage.getItem(`reviewMode_${currentProject.id}`);
      setReviewMode(storedMode || '1v1');
      
      const storedRounds = localStorage.getItem(`maxReviewRounds_${currentProject.id}`);
      setMaxReviewRounds(storedRounds ? parseInt(storedRounds, 10) : 3);
      
      console.log('✅ Loaded settings for project:', currentProject.id);
      
      // Re-enable saving after a brief delay to ensure all state updates complete
      setTimeout(() => {
        isLoadingProjectSettings.current = false;
      }, 100);
    }
  }, [currentProject?.id]);

  // Initialize Contextual Engineering modules (per-project)
  useEffect(() => {
    if (currentProject?.id && contextEnabled) {
      console.log('🧠 Initializing Contextual Engineering for project:', currentProject.id);
      
      // Initialize modules with current project ID
      conversationHistoryRef.current = getConversationHistory(currentProject.id);
      workingMemoryRef.current = getWorkingMemory(currentProject.id);
      sessionLearningRef.current = getSessionLearning();
      
      // Load conversation history for THIS project
      const history = conversationHistoryRef.current.getAllMessages();
      setConversationMessages(history);
      
      // Get recommendations
      const surveyType = currentProject.category || 'general';
      const recs = sessionLearningRef.current.getRecommendations(surveyType);
      setRecommendations(recs);
      
      console.log('✅ Contextual Engineering ready:', {
        projectId: currentProject.id,
        projectName: currentProject.name,
        historyMessages: history.length,
        recommendations: recs.length
      });
    } else {
      // Clear refs when project changes or CE disabled
      conversationHistoryRef.current = null;
      workingMemoryRef.current = null;
      sessionLearningRef.current = null;
      setConversationMessages([]);
      setRecommendations([]);
    }
  }, [currentProject?.id, contextEnabled]);

  // Auto-scroll chat to bottom (only within chat container, not whole page)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ 
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    });
  }, [conversationMessages]);

  const handleBasicInfoChange = (field, value) => {
    // Convert boolean values to SurveyJS expected string format
    let finalValue = value;
    if (field === 'showQuestionNumbers') {
      finalValue = value ? 'on' : 'off';
    } else if (field === 'showProgressBar') {
      // Participant runtime uses ProgressChrome; 'top' means enabled
      finalValue = value ? 'top' : 'off';
    }
    
    onChange({
      ...config,
      [field]: finalValue
    });
  };

  const handleSettingsChange = (field, value) => {
    // Set SurveyJS standard properties directly at root level
    onChange({
      ...config,
      [field]: value
    });
  };

  const handleThemeChange = (field, value) => {
    onChange({
      ...config,
      theme: {
        ...config.theme,
        [field]: value
      }
    });
  };

  const handleThemeReset = () => {
    onChange({
      ...config,
      theme: {
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
      }
    });
  };

  const handleThemePreset = (presetName) => {
    const presets = {
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

    if (presets[presetName]) {
      onChange({
        ...config,
        theme: presets[presetName]
      });
    }
  };

  // Export theme configuration
  const handleExportTheme = () => {
    const themeData = {
      theme: config.theme,
      exportDate: new Date().toISOString(),
      projectName: currentProject?.name || 'survey'
    };
    const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `theme_${currentProject?.id || 'default'}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import theme configuration
  const handleImportTheme = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const themeData = JSON.parse(e.target.result);
          if (themeData.theme) {
            onChange({
              ...config,
              theme: themeData.theme
            });
            setThemeSnackbar({ open: true, message: 'Theme imported successfully!', severity: 'success' });
          } else {
            setThemeSnackbar({ open: true, message: 'Invalid theme file format.', severity: 'error' });
          }
        } catch (error) {
          console.error('Error importing theme:', error);
          setThemeSnackbar({ open: true, message: 'Error importing theme file.', severity: 'error' });
        }
      };
      reader.readAsText(file);
    }
  };

  const addNewPage = () => {
    const newPage = {
      name: `page_${Date.now()}`,
      title: "New Page",
      description: "Page description",
      elements: []
    };
    
    onChange({
      ...config,
      pages: [...config.pages, newPage]
    });
  };

  const deletePage = (pageIndex) => {
    const page = config.pages[pageIndex];
    const questionCount = page?.elements?.length || 0;
    const pageTitle = page?.title || `Page ${pageIndex + 1}`;
    const message = questionCount > 0
      ? `Delete "${pageTitle}" and its ${questionCount} question(s)? This cannot be undone.`
      : `Delete "${pageTitle}"? This cannot be undone.`;
    setConfirmDialog({
      title: 'Delete page',
      message,
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        const newPages = config.pages.filter((_, index) => index !== pageIndex);
        onChange({
          ...config,
          pages: newPages
        });
        setSelectedPage(null);
      },
    });
  };

  const duplicatePage = (pageIndex) => {
    const pageToDuplicate = config.pages[pageIndex];
    const duplicatedPage = JSON.parse(JSON.stringify(pageToDuplicate));

    duplicatedPage.name = allocateUniquePageName(
      pageToDuplicate.name || `page_${pageIndex + 1}`,
      config,
    );

    const originalTitle = pageToDuplicate.title || `Page ${pageIndex + 1}`;
    const titleUsed = new Set(
      (config.pages || []).map((p) => p?.title).filter(Boolean),
    );
    duplicatedPage.title = allocateUniqueName(originalTitle, titleUsed);

    const usedNames = collectUsedQuestionNames(config);
    if (duplicatedPage.elements) {
      duplicatedPage.elements = duplicatedPage.elements.map((element) => {
        if (element?.type === 'panel' && Array.isArray(element.elements)) {
          return {
            ...element,
            elements: element.elements.map((child) => ({
              ...child,
              name: allocateUniqueName(child.name || 'question', usedNames),
            })),
          };
        }
        return {
          ...element,
          name: allocateUniqueName(element.name || 'question', usedNames),
        };
      });
    }

    const newPages = [
      ...config.pages.slice(0, pageIndex + 1),
      duplicatedPage,
      ...config.pages.slice(pageIndex + 1),
    ];

    onChange({
      ...config,
      pages: newPages,
    });
  };

  const updatePage = (pageIndex, updatedPage) => {
    const newPages = [...config.pages];
    newPages[pageIndex] = updatedPage;
    onChange({
      ...config,
      pages: newPages
    });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = parseInt(active.id.split('-')[1]);
      const newIndex = parseInt(over.id.split('-')[1]);

      const newPages = arrayMove(config.pages, oldIndex, newIndex);
      onChange({
        ...config,
        pages: newPages
      });
    }
  };

  // ✅ Post-process AI-generated config to ensure all image questions have correct settings
  const processAIGeneratedConfig = (surveyConfig) => {
    const imageQuestionTypes = ['imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageslidergroup', 'imagepointallocation'];
    
    const processedConfig = JSON.parse(JSON.stringify(surveyConfig)); // Deep clone
    
    if (processedConfig.pages && Array.isArray(processedConfig.pages)) {
      processedConfig.pages.forEach(page => {
        if (page.elements && Array.isArray(page.elements)) {
          page.elements.forEach(element => {
            if (imageQuestionTypes.includes(element.type)) {
              // Ensure image questions have correct default settings
              if (!element.imageSelectionMode || element.imageSelectionMode === 'random') {
                element.imageSelectionMode = 'huggingface_random';
              }
              element.randomImageSelection = true;
              if (element.excludePreviouslyUsedImages === undefined) {
                element.excludePreviouslyUsedImages = true;
              }
              if (!element.choices) {
                element.choices = [];
              }
              if (element.type === 'imagematrix' && !element.imageLinks) {
                element.imageLinks = [];
              }
              
              // ✅ Remove unnecessary global config fields that should not be saved per question
              delete element.imageSource;
              delete element.huggingFaceConfig;
              
              console.log(`✅ Post-processed ${element.type} question: ${element.name}`);
            }
          });
        }
      });
    }
    
    return processedConfig;
  };

  // AI Assistant handlers
  // Validate API Key
  const handleValidateApiKey = async () => {
    setIsLoading(true);
    
    const result = await validateChatApiKey(openaiApiKey);
    
    setIsLoading(false);
    
    if (result.success) {
      setApiKeyValid(true);
      sessionStorage.setItem('openai_api_key', openaiApiKey);
      
      // Add system message
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '✅ API key validated! I\'m ready to help you create and modify surveys. Just type what you need!',
          { actionType: 'system' }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    } else {
      setApiKeyValid(false);
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '❌ Invalid API key. Please check and try again in settings.',
          { actionType: 'system', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    }
  };

  const handleRevertAiChange = () => {
    if (!aiUndoSnapshotRef.current) return;
    onChange(JSON.parse(JSON.stringify(aiUndoSnapshotRef.current)));
    aiUndoSnapshotRef.current = null;
    setAiUndoAvailable(false);
    if (currentProject?.id) {
      sessionStorage.removeItem(`ai_undo_${currentProject.id}`);
    }
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.addMessage('assistant',
        '↩️ Reverted to the survey configuration before the last AI change.',
        { actionType: 'system' }
      );
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }
  };

  const handleSendMessage = async () => {
    if (!userMessage.trim()) return;
    
    // Safety check: Ensure we have a valid project
    if (!currentProject?.id) {
      alert('No project selected. Please select or create a project first.');
      return;
    }
    
    if (!openaiApiKey || !apiKeyValid) {
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '⚠️ Please configure and validate your API key in settings first.',
          { actionType: 'system', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
      return;
    }
    
    console.log('💬 Sending message for project:', currentProject.id, currentProject.name);

    // Add user message to UI immediately
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.addMessage('user', userMessage, {
        actionType: 'chat',
        timestamp: new Date().toISOString()
      });
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }

    const currentUserMessage = userMessage;
    setUserMessage(''); // Clear input
    setIsLoading(true);
    setLoadingStatus('Thinking...');

    try {
      // Build conversation history for API (last 10 messages)
      const apiHistory = conversationHistoryRef.current
        ?.getFormattedForOpenAI(10) || [];

      // Enrich with contextual engineering context if enabled
      let enrichedHistory = apiHistory;
      if (contextEnabled && workingMemoryRef.current && sessionLearningRef.current) {
        const workingContext = workingMemoryRef.current.getContextForAI();
        const sessionContext = sessionLearningRef.current.getContextForAI(currentProject?.category);
        
        // Prepend context as system messages
        enrichedHistory = [
          { role: 'system', content: sessionContext },
          { role: 'system', content: workingContext },
          ...apiHistory
        ];
        
        console.log('🧠 Using contextual prompt with memory');
      }

      // Load research context from localStorage (per project)
      const researchContext = currentProject?.id 
        ? JSON.parse(localStorage.getItem(`researchContext_${currentProject.id}`) || '{}')
        : {};
      console.log('🔬 Research context loaded for project:', currentProject?.id, researchContext);

      // Call intelligent chat API
      const result = await sendChatMessage(
        currentUserMessage,
        config,
        enrichedHistory,
        openaiApiKey,
        multiAgentReviewEnabled,
        reviewMode,
        customPrompts,
        researchContext
      );

      // Update status based on intent
      if (result.intent === 'generate') {
        setLoadingStatus('Generating survey...');
      } else if (result.intent === 'adjust') {
        setLoadingStatus('Adjusting survey...');
      } else {
        setLoadingStatus('Processing...');
      }

      // Small delay to show the specific status
      await new Promise(resolve => setTimeout(resolve, 500));

      setIsLoading(false);
      setLoadingStatus('');

      if (result.success) {
        // Add Chain of Thoughts to conversation if available
        if (result.chainOfThoughts && conversationHistoryRef.current) {
          console.log('🧠 Displaying Chain of Thoughts...');
          
          // Step 1: Research/Understanding
          const step1Key = result.chainOfThoughts.step1_research || result.chainOfThoughts.step1_understanding;
          if (step1Key) {
            conversationHistoryRef.current.addMessage('assistant', 
              `**🧠 Step 1: ${result.intent === 'generate' ? 'Research Analysis' : 'Understanding Adjustment Goal'}**\n\n${step1Key}`,
              { type: 'chain-of-thoughts', step: 1, intent: result.intent }
            );
          }
          
          // Step 2: Structure/Planning
          const step2Key = result.chainOfThoughts.step2_structure || result.chainOfThoughts.step2_planning;
          if (step2Key) {
            conversationHistoryRef.current.addMessage('assistant', 
              `**📐 Step 2: ${result.intent === 'generate' ? 'Survey Structure Planning' : 'Adjustment Planning'}**\n\n${step2Key}`,
              { type: 'chain-of-thoughts', step: 2, intent: result.intent }
            );
          }
          
          // Step 3: Generation/Execution
          const step3Key = result.chainOfThoughts.step3_generation || result.chainOfThoughts.step3_execution;
          if (step3Key) {
            conversationHistoryRef.current.addMessage('assistant', 
              `**🔨 Step 3: ${result.intent === 'generate' ? 'Generation' : 'Execution'}**\n\n${step3Key}`,
              { type: 'chain-of-thoughts', step: 3, intent: result.intent }
            );
          }
        }
        
        // Add AI response to conversation
        if (conversationHistoryRef.current) {
          conversationHistoryRef.current.addMessage('assistant', result.message, {
            actionType: result.intent,
            timestamp: new Date().toISOString()
          });
        }

        // If multi-agent review was conducted, add all agent messages to conversation
        if (result.multiAgentReview && result.multiAgentReview.conversationMessages) {
          console.log('🤖 Adding multi-agent review conversations to history...');
          
          // Add all agent conversations to the history
          result.multiAgentReview.conversationMessages.forEach(msg => {
            if (conversationHistoryRef.current && msg.content) {
              conversationHistoryRef.current.addMessage(msg.role || 'assistant', msg.content, {
                ...(msg.metadata || {}),
                timestamp: msg.timestamp || new Date().toISOString(),
                isMultiAgent: true
              });
            }
          });
          
          console.log(`  ✓ Added ${result.multiAgentReview.conversationMessages.length} agent messages`);
          console.log(`  ✓ Final verdict: ${result.multiAgentReview.finalVerdict}`);
          console.log(`  ✓ Final rating: ${result.multiAgentReview.finalRating}/10`);
        }

        // Update conversation display
        if (conversationHistoryRef.current) {
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }

        // Update research context if provided by AI (per project)
        if (result.researchContext && currentProject?.id) {
          console.log('🔬 Updating research context from AI for project:', currentProject.id, result.researchContext);
          localStorage.setItem(`researchContext_${currentProject.id}`, JSON.stringify(result.researchContext));
          // Dispatch custom event to notify ChatAssistant
          window.dispatchEvent(new CustomEvent('researchContextUpdated', { 
            detail: result.researchContext 
          }));
        }

        // If survey config was generated/adjusted, apply it
        if (result.surveyConfig) {
          aiUndoSnapshotRef.current = JSON.parse(JSON.stringify(config));
          setAiUndoAvailable(true);
          if (currentProject?.id) {
            sessionStorage.setItem(`ai_undo_${currentProject.id}`, JSON.stringify(config));
          }
          const processedConfig = processAIGeneratedConfig(result.surveyConfig);
          onChange(processedConfig);

          // Update contextual engineering memories for THIS project
          if (contextEnabled) {
            console.log('📝 Updating memories for project:', currentProject?.id, currentProject?.name);
            
            if (workingMemoryRef.current) {
              if (result.intent === 'generate') {
                workingMemoryRef.current.setSurveyGoal(currentUserMessage);
                console.log('  ✓ Set survey goal for project:', currentProject?.id);
              }
              workingMemoryRef.current.addIteration(processedConfig, currentUserMessage);
              console.log('  ✓ Added iteration to working memory (project:', currentProject?.id, ')');
              if (result.intent === 'adjust') {
                workingMemoryRef.current.addDesignDecision(currentUserMessage, 'User requested adjustment');
                console.log('  ✓ Recorded design decision (project:', currentProject?.id, ')');
              }
            }

            if (sessionLearningRef.current) {
              sessionLearningRef.current.recordProjectInteraction(
                currentProject?.id,
                currentProject?.category || 'general',
                result.intent === 'generate' ? 'generate_survey' : 'adjust_survey'
              );
              console.log('  ✓ Recorded interaction in session learning');
            }
          }

          // Trigger Multi-Agent Review if enabled (streaming version)
          if (multiAgentReviewEnabled && (result.intent === 'generate' || result.intent === 'adjust')) {
            console.log('🤖 Triggering Multi-Agent Review (streaming)...');
            setLoadingStatus('Starting Multi-Agent Review...');
            
            try {
              // Load custom agents if available (per project)
              const customAgents = currentProject?.id && localStorage.getItem(`customAgents_${currentProject.id}`) 
                ? JSON.parse(localStorage.getItem(`customAgents_${currentProject.id}`)) 
                : null;
              
              // Load research context for review alignment (per project)
              const reviewResearchContext = currentProject?.id 
                ? JSON.parse(localStorage.getItem(`researchContext_${currentProject.id}`) || '{}')
                : {};
              
              await triggerMultiAgentReviewStream(
                processedConfig,
                openaiApiKey,
                reviewMode,
                maxReviewRounds,
                (eventType, data) => {
                  // Handle each SSE event in real-time
                  console.log(`📡 SSE Event: ${eventType}`, data);
                  
                  if (conversationHistoryRef.current) {
                    switch (eventType) {
                      case 'start':
                        conversationHistoryRef.current.addMessage('system',
                          `\n🔄 **Multi-Agent Review Started**\n\nMode: ${data.mode}\nExperts: ${data.totalAgents}\nMax Rounds: ${data.maxRounds}\n`,
                          { type: 'review-start', isMultiAgent: true }
                        );
                        break;
                      
                      case 'round-start':
                        conversationHistoryRef.current.addMessage('system',
                          `\n📋 **Review Round ${data.round}**\n`,
                          { type: 'round-header', isMultiAgent: true, round: data.round }
                        );
                        setLoadingStatus(`Review Round ${data.round}...`);
                        break;
                      
                      case 'agent-start':
                        setLoadingStatus(`${data.emoji} ${data.name} reviewing...`);
                        break;
                      
                      case 'agent-review':
                        conversationHistoryRef.current.addMessage('assistant',
                          data.formatted,
                          { 
                            type: 'agent-review', 
                            isMultiAgent: true, 
                            agentId: data.agentId,
                            round: data.round
                          }
                        );
                        // Update UI immediately
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        break;
                      
                      case 'round-summary':
                        conversationHistoryRef.current.addMessage('assistant',
                          data.formatted,
                          { type: 'round-summary', isMultiAgent: true, round: data.round }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        break;
                      
                      case 'revision-start':
                        conversationHistoryRef.current.addMessage('system',
                          `\n🔧 **Survey Designer**: Addressing feedback and revising survey...\n`,
                          { type: 'revision-start', isMultiAgent: true, round: data.round }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        setLoadingStatus('Revising survey...');
                        break;
                      
                      case 'revision-thinking':
                        // Display Chain of Thoughts during revision
                        const stepTitle = data.step === 1 ? 'Understanding Expert Feedback' : 
                                         data.step === 2 ? 'Planning Changes' : 'Executing Revision';
                        conversationHistoryRef.current.addMessage('assistant',
                          `**${'🧠📐🔨'[data.step - 1]} Revision Step ${data.step}: ${stepTitle}**\n\n${data.content}`,
                          { type: 'revision-thinking', step: data.step, isMultiAgent: true }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        break;
                      
                      case 'revision-complete':
                        // Display Chain of Thoughts if available
                        if (data.chainOfThoughts) {
                          if (data.chainOfThoughts.step1_understanding) {
                            conversationHistoryRef.current.addMessage('assistant',
                              `**🧠 Revision Step 1: Understanding Expert Feedback**\n\n${data.chainOfThoughts.step1_understanding}`,
                              { type: 'revision-cot', step: 1, isMultiAgent: true }
                            );
                          }
                          if (data.chainOfThoughts.step2_planning) {
                            conversationHistoryRef.current.addMessage('assistant',
                              `**📐 Revision Step 2: Planning Changes**\n\n${data.chainOfThoughts.step2_planning}`,
                              { type: 'revision-cot', step: 2, isMultiAgent: true }
                            );
                          }
                          if (data.chainOfThoughts.step3_execution) {
                            conversationHistoryRef.current.addMessage('assistant',
                              `**🔨 Revision Step 3: Executing Revision**\n\n${data.chainOfThoughts.step3_execution}`,
                              { type: 'revision-cot', step: 3, isMultiAgent: true }
                            );
                          }
                        }
                        
                        conversationHistoryRef.current.addMessage('assistant',
                          `🔧 **Survey Designer**: Survey revised based on expert feedback. Ready for next review round.`,
                          { type: 'revision-complete', isMultiAgent: true, round: data.round }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        // Update survey config with revised version
                        if (data.surveyConfig) {
                          const revisedConfig = processAIGeneratedConfig(data.surveyConfig);
                          onChange(revisedConfig);
                        }
                        break;
                      
                      case 'complete':
                        conversationHistoryRef.current.addMessage('system',
                          `\n🎯 **Review Complete**\n\n${data.reason}\n\nFinal Rating: ${data.finalRating}/10\nFinal Verdict: ${data.finalVerdict?.toUpperCase()}\n`,
                          { type: 'review-complete', isMultiAgent: true }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        // Apply final survey config
                        if (data.surveyConfig) {
                          const finalConfig = processAIGeneratedConfig(data.surveyConfig);
                          onChange(finalConfig);
                        }
                        break;
                      
                      case 'error':
                      case 'agent-error':
                      case 'revision-error':
                        conversationHistoryRef.current.addMessage('system',
                          `❌ Error: ${data.error || data.message}`,
                          { type: 'error', isMultiAgent: true }
                        );
                        setConversationMessages(conversationHistoryRef.current.getAllMessages());
                        break;
                    }
                  }
                },
                customAgents,
                userMessage,  // Pass user's original request to keep review aligned with their needs
                reviewResearchContext,  // Pass research context for alignment
                currentProject?.id  // Pass project ID for per-project agent configuration
              );
              
              console.log('✅ Multi-Agent Review completed');
              
            } catch (error) {
              console.error('❌ Multi-Agent Review error:', error);
              if (conversationHistoryRef.current) {
                conversationHistoryRef.current.addMessage('system',
                  `❌ Multi-Agent Review failed: ${error.message}`,
                  { type: 'error', isMultiAgent: true }
                );
                setConversationMessages(conversationHistoryRef.current.getAllMessages());
              }
            } finally {
              setLoadingStatus('');
            }
          }
        }
      } else {
        // Error handling
        if (conversationHistoryRef.current) {
          conversationHistoryRef.current.addMessage('assistant', 
            `❌ Error: ${result.error}`,
            { actionType: 'error', error: true }
          );
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }
      }
    } catch (error) {
      setIsLoading(false);
      setLoadingStatus('');
      console.error('Error sending message:', error);
      
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          `❌ Unexpected error: ${error.message}`,
          { actionType: 'error', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    }
  };

  // Old handlers removed - now using unified handleSendMessage

  const getSurveyValidationWarnings = (cfg) => {
    if (!cfg?.pages) return [];
    const warnings = [];
    const imageTypes = [
      'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagematrix', 'image',
      'imageannotation', 'skillquestion', 'imageslidergroup', 'imagepointallocation',
      'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean',
      'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
    ];

    findDuplicateQuestionNames(cfg).forEach((dup) => {
      warnings.push(
        `Duplicate question id "${dup.name}" appears ${dup.count} times — answers will overwrite each other.`,
      );
    });

    cfg.pages.forEach((page, pi) => {
      const pageTitle = page.title || `Page ${pi + 1}`;
      if (!page.elements?.length) {
        warnings.push(`Page "${pageTitle}" has no questions.`);
      }
      (page.elements || []).forEach((el) => {
        if (imageTypes.includes(el.type)) {
          const hasManual = el.selectedImageUrls?.length || el.choices?.length || el.imageLinks?.length || el.annotationImageUrl;
          const hasRandom = el.randomImageSelection !== false || el.imageSelectionMode === 'huggingface_random';
          if (!hasManual && !hasRandom && el.type !== 'skillquestion') {
            warnings.push(`"${el.title || el.name}" may have no images configured.`);
          }
        }
        if ((el.type === 'slidergroup' || el.type === 'imageslidergroup' || el.type === 'mediaslidergroup') && !el.dimensions?.length) {
          warnings.push(`Slider group "${el.title || el.name}" has no dimensions configured.`);
        }
        if ((el.type === 'pointallocation' || el.type === 'imagepointallocation') && !el.choices?.length) {
          warnings.push(`Point allocation "${el.title || el.name}" has no choices configured.`);
        }
      });
    });
    return warnings;
  };

  const validationWarnings = getSurveyValidationWarnings(config);
  const duplicateQuestionIssues = findDuplicateQuestionNames(config);

  const handleRepairDuplicateQuestionNames = async () => {
    const { config: fixed, renames, remainingDuplicates } = repairDuplicateQuestionNames(config);
    if (!renames.length && remainingDuplicates?.length) {
      setThemeSnackbar({
        open: true,
        message: 'Could not repair duplicate ids automatically. Please rename them manually.',
        severity: 'error',
      });
      return;
    }
    if (!renames.length) {
      setThemeSnackbar({
        open: true,
        message: 'No duplicate ids to fix.',
        severity: 'info',
      });
      return;
    }
    onChange(fixed);
    if (remainingDuplicates?.length) {
      setThemeSnackbar({
        open: true,
        message: `Renamed ${renames.length} id(s), but ${remainingDuplicates.length} duplicate(s) remain. Rename manually.`,
        severity: 'warning',
      });
      return;
    }
    try {
      if (typeof onRepairComplete === 'function') {
        await onRepairComplete(fixed, renames);
        setThemeSnackbar({
          open: true,
          message: `Fixed and saved ${renames.length} duplicate question id(s).`,
          severity: 'success',
        });
      } else {
        setThemeSnackbar({
          open: true,
          message: `Fixed ${renames.length} duplicate id(s) in the editor. Click Save to write to the database.`,
          severity: 'success',
        });
      }
    } catch (err) {
      setThemeSnackbar({
        open: true,
        message: err.message || 'Repair saved locally but failed to persist.',
        severity: 'error',
      });
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
        🛠️ Survey Builder
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Build your survey with pages, questions, and theme. Use the AI assistant
        below to draft and refine questions, then preview the result before sharing.
      </Typography>

      {validationWarnings.length > 0 && (
        <Alert
          severity={duplicateQuestionIssues.length ? 'error' : 'warning'}
          sx={{ mb: 2 }}
          action={duplicateQuestionIssues.length ? (
            <Button color="inherit" size="small" onClick={handleRepairDuplicateQuestionNames}>
              Fix duplicate ids
            </Button>
          ) : null}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {duplicateQuestionIssues.length
              ? 'Duplicate question ids detected (data risk)'
              : 'Survey checks (non-blocking)'}
          </Typography>
          {validationWarnings.slice(0, 5).map((w, i) => (
            <Typography key={i} variant="body2">• {w}</Typography>
          ))}
          {validationWarnings.length > 5 && (
            <Typography variant="caption">+ {validationWarnings.length - 5} more</Typography>
          )}
          {duplicateQuestionIssues.length > 0 && (
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              Fix renames later copies only. Already-collected answers under a shared id cannot be split automatically.
            </Typography>
          )}
        </Alert>
      )}

      {/* AI Chat Assistant */}
      <ChatAssistant
        key={currentProject?.id || 'no-project'}
        messages={conversationMessages}
        userMessage={userMessage}
        isLoading={isLoading}
        loadingStatus={loadingStatus}
        apiKeyValid={apiKeyValid}
        openaiApiKey={openaiApiKey}
        contextEnabled={contextEnabled}
        multiAgentReviewEnabled={multiAgentReviewEnabled}
        reviewMode={reviewMode}
        maxReviewRounds={maxReviewRounds}
        recommendations={recommendations}
        currentProject={currentProject}
        conversationHistoryRef={conversationHistoryRef}
        workingMemoryRef={workingMemoryRef}
        sessionLearningRef={sessionLearningRef}
        onMessageChange={setUserMessage}
        onPromptsChange={setCustomPrompts}
        onRevertAiChange={handleRevertAiChange}
        aiUndoAvailable={aiUndoAvailable}
        onSendMessage={handleSendMessage}
        onApiKeyChange={setOpenaiApiKey}
        onValidateApiKey={handleValidateApiKey}
        onContextToggle={setContextEnabled}
        onMultiAgentReviewToggle={setMultiAgentReviewEnabled}
        onReviewModeChange={setReviewMode}
        onMaxReviewRoundsChange={setMaxReviewRounds}
        onClearHistory={() => {
          setConfirmDialog({
            title: 'Clear conversation',
            message: 'Clear conversation history?',
            confirmLabel: 'Clear',
            confirmColor: 'error',
            onConfirm: () => {
              setConfirmDialog(null);
              conversationHistoryRef.current?.clear();
              setConversationMessages([]);
            },
          });
        }}
        onDownloadHistory={() => {
          const data = conversationHistoryRef.current?.export();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `conversation_${currentProject?.id}_${new Date().toISOString()}.json`;
          a.click();
        }}
        chatEndRef={chatEndRef}
      />

      {/* Survey Settings - Unified Panel */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Survey Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Basic Information */}
            <Box>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
                📝 Basic Information
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  fullWidth
                  variant="outlined"
                  label="Survey Title"
                  value={config.title || ''}
                  onChange={(e) => handleBasicInfoChange('title', e.target.value)}
                  helperText="The main title that appears at the top of your survey"
                />
                
                <TextField
                  fullWidth
                  variant="outlined"
                  multiline
                  rows={3}
                  label="Survey Description"
                  value={config.description || ''}
                  onChange={(e) => handleBasicInfoChange('description', e.target.value)}
                  helperText="A brief description explaining the purpose of your survey"
                />

                <TextField
                  fullWidth
                  variant="outlined"
                  multiline
                  rows={2}
                  label="Completion Message (optional)"
                  value={config.completionMessage || ''}
                  onChange={(e) => handleBasicInfoChange('completionMessage', e.target.value)}
                  helperText="Shown to participants after they submit the survey"
                />

                <TextField
                  fullWidth
                  variant="outlined"
                  type="number"
                  label="Response Quota (optional)"
                  value={config.responseQuota ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    handleBasicInfoChange('responseQuota', v === '' ? null : Math.max(1, parseInt(v, 10) || 1));
                  }}
                  helperText="Close the survey automatically after this many responses (leave empty for unlimited)"
                  inputProps={{ min: 1 }}
                />
              </Box>
            </Box>

            <Divider />

            {/* Logo Settings */}
            <Box>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
                🖼️ Logo Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  fullWidth
                  label="Logo URL"
                  value={config.logo || ''}
                  onChange={(e) => handleBasicInfoChange('logo', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  helperText="URL of your organization's logo"
                />
                
                <FormControl fullWidth>
                  <InputLabel>Logo Position</InputLabel>
                  <Select
                    value={config.logoPosition || 'top'}
                    label="Logo Position"
                    onChange={(e) => handleBasicInfoChange('logoPosition', e.target.value)}
                  >
                    <MenuItem value="top">Top</MenuItem>
                    <MenuItem value="left">Left</MenuItem>
                    <MenuItem value="right">Right</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            <Divider />

            {/* Display Settings — collapsed by default since most users
                rarely need to toggle question numbers / progress bar. */}
            <Box>
              <Box
                onClick={() => setDisplaySettingsCollapsed((c) => !c)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  cursor: 'pointer',
                  userSelect: 'none',
                  mb: displaySettingsCollapsed ? 0 : 2,
                  '&:hover': { color: 'primary.main' },
                }}
              >
                <ExpandMore
                  sx={{
                    transition: 'transform 0.2s',
                    transform: displaySettingsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }}
                />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  ⚙️ Display Settings
                </Typography>
              </Box>
              <Collapse in={!displaySettingsCollapsed} timeout="auto" unmountOnExit>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.showQuestionNumbers !== 'off' && config.showQuestionNumbers !== false}
                        onChange={(e) => handleBasicInfoChange('showQuestionNumbers', e.target.checked)}
                      />
                    }
                    label="Show Question Numbers"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.showProgressBar !== 'off' && config.showProgressBar !== false}
                        onChange={(e) => handleBasicInfoChange('showProgressBar', e.target.checked)}
                      />
                    }
                    label="Show Progress Bar (page · question · trial)"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5, mt: -0.5, mb: 0.5 }}>
                    Uses Primary / Success colors from Theme Customization. Preview it under Theme Preview.
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">Research Annotation Mode</Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!config.repeatConfig?.enabled}
                        onChange={(e) => onChange({
                          ...config,
                          repeatConfig: { ...(config.repeatConfig || {}), enabled: e.target.checked, total: config.repeatConfig?.total || 10 },
                        })}
                      />
                    }
                    label="Enable repeat annotation (researcher answers N times)"
                  />
                  {config.repeatConfig?.enabled && (
                    <TextField
                      label="Repeat count"
                      type="number"
                      size="small"
                      value={config.repeatConfig?.total || 10}
                      onChange={(e) => onChange({
                        ...config,
                        repeatConfig: { ...config.repeatConfig, enabled: true, total: Math.max(1, parseInt(e.target.value, 10) || 1) },
                      })}
                      inputProps={{ min: 2, max: 500 }}
                      helperText="Also overridable via survey URL: ?repeat=20"
                      sx={{ maxWidth: 200 }}
                    />
                  )}
                </Box>
              </Collapse>
            </Box>

            <Divider />

            {/* Theme Customization — collapsed by default. The action
                buttons (Import / Export / Reset) only matter once the
                section is expanded, so we move them inside the Collapse. */}
            <Box>
              <Box
                onClick={() => setThemeCustomizationCollapsed((c) => !c)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  cursor: 'pointer',
                  userSelect: 'none',
                  mb: themeCustomizationCollapsed ? 0 : 2,
                  '&:hover': { color: 'primary.main' },
                }}
              >
                <ExpandMore
                  sx={{
                    transition: 'transform 0.2s',
                    transform: themeCustomizationCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }}
                />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  🎨 Theme Customization
                </Typography>
              </Box>
              <Collapse in={!themeCustomizationCollapsed} timeout="auto" unmountOnExit>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportTheme}
                  style={{ display: 'none' }}
                  id="theme-import-input"
                />
                <label htmlFor="theme-import-input">
                  <Button
                    variant="outlined"
                    size="small"
                    component="span"
                    startIcon={<Download sx={{ transform: 'rotate(180deg)' }} />}
                  >
                    Import
                  </Button>
                </label>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleExportTheme}
                  startIcon={<Download />}
                >
                  Export
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleThemeReset}
                  startIcon={<Clear />}
                >
                  Reset
                </Button>
              </Box>

              {/* Theme Presets */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1.5, color: 'text.secondary' }}>
                  Quick Presets
                </Typography>
                <Grid container spacing={1.5}>
                  {[
                    { name: 'Default', emoji: '🔷', primaryColor: '#1976d2', secondaryColor: '#dc004e', bg: '#ffffff' },
                    { name: 'Research', emoji: '🔬', primaryColor: '#474747', secondaryColor: '#ff9814', bg: '#f8f8f8' },
                    { name: 'Professional', emoji: '💼', primaryColor: '#1976d2', secondaryColor: '#f57c00', bg: '#f8f9fa' },
                    { name: 'Nature', emoji: '🌿', primaryColor: '#4caf50', secondaryColor: '#ff9800', bg: '#f1f8e9' },
                    { name: 'Elegant', emoji: '💎', primaryColor: '#673ab7', secondaryColor: '#e91e63', bg: '#f3e5f5' },
                    { name: 'Ocean', emoji: '🌊', primaryColor: '#00acc1', secondaryColor: '#0288d1', bg: '#e0f7fa' },
                    { name: 'Warm', emoji: '🔥', primaryColor: '#ff5722', secondaryColor: '#ffc107', bg: '#fff8f0' },
                    { name: 'Dark', emoji: '🌙', primaryColor: '#90caf9', secondaryColor: '#f48fb1', bg: '#121212' },
                    { name: 'Minimal', emoji: '⚪', primaryColor: '#333333', secondaryColor: '#888888', bg: '#ffffff' }
                  ].map((theme) => (
                    <Grid item xs={6} sm={4} md={3} key={theme.name}>
                      <Paper
                        onClick={() => handleThemePreset(theme.name.toLowerCase())}
                        sx={{
                          cursor: 'pointer',
                          border: 2,
                          borderColor: config.theme?.primaryColor === theme.primaryColor ? 'primary.main' : 'divider',
                          borderRadius: 1.5,
                          p: 1.5,
                          textAlign: 'center',
                          transition: 'all 0.3s',
                          '&:hover': { 
                            borderColor: 'primary.main',
                            transform: 'translateY(-4px)',
                            boxShadow: 4
                          }
                        }}
                      >
                        <Box sx={{ 
                          display: 'flex',
                          height: 50,
                          borderRadius: 1,
                          overflow: 'hidden',
                          mb: 1
                        }}>
                          <Box sx={{ flex: 1, bgcolor: theme.primaryColor }} />
                          <Box sx={{ flex: 1, bgcolor: theme.secondaryColor }} />
                          <Box sx={{ flex: 1, bgcolor: theme.bg }} />
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                          {theme.emoji} {theme.name}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Custom Colors — four clear parts + preview */}
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5, color: 'text.secondary' }}>
                  Custom Color Palette
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Split into parts so you can tune what participants see most often first.
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <ThemeColorPart
                    step={1}
                    title="Brand"
                    description="Most visible: Next / Complete, selected answers, progress current state."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary"
                        hint="Buttons, selection, progress current"
                        value={config.theme?.primaryColor || '#1976d2'}
                        onChange={(v) => handleThemeChange('primaryColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary light"
                        hint="Hover / soft highlight"
                        value={config.theme?.primaryLight || '#42a5f5'}
                        onChange={(v) => handleThemeChange('primaryLight', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary dark"
                        hint="Pressed / darker hover"
                        value={config.theme?.primaryDark || '#1565c0'}
                        onChange={(v) => handleThemeChange('primaryDark', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={2}
                    title="Surfaces & text"
                    description="Page canvas, question panels, and readable text colors."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Page background"
                        hint="Overall page behind questions"
                        value={config.theme?.backgroundColor || '#ffffff'}
                        onChange={(v) => handleThemeChange('backgroundColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Question panel"
                        hint="Background of each question card"
                        value={config.theme?.cardBackground || '#f8f9fa'}
                        onChange={(v) => handleThemeChange('cardBackground', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Header / footer strip"
                        hint="Dim areas around navigation"
                        value={config.theme?.headerBackground || '#ffffff'}
                        onChange={(v) => handleThemeChange('headerBackground', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Body text"
                        hint="Question titles and main copy"
                        value={config.theme?.textColor || '#212121'}
                        onChange={(v) => handleThemeChange('textColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Muted text"
                        hint="Descriptions, progress labels"
                        value={config.theme?.secondaryText || '#757575'}
                        onChange={(v) => handleThemeChange('secondaryText', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Disabled text"
                        hint="Unavailable controls / grey"
                        value={config.theme?.disabledText || '#bdbdbd'}
                        onChange={(v) => handleThemeChange('disabledText', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={3}
                    title="Lines & status"
                    description="Borders, focus outlines, and completed-progress green."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Borders"
                        hint="Card edges, inputs, progress track"
                        value={config.theme?.borderColor || '#e0e0e0'}
                        onChange={(v) => handleThemeChange('borderColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Focus ring"
                        hint="Keyboard / click focus outline"
                        value={config.theme?.focusBorder || '#1976d2'}
                        onChange={(v) => handleThemeChange('focusBorder', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Success (green)"
                        hint="Completed questions on progress"
                        value={config.theme?.successColor || '#4caf50'}
                        onChange={(v) => handleThemeChange('successColor', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={4}
                    title="Rarely seen (optional)"
                    description="SurveyJS internal tokens — usually not big buttons in a typical questionnaire."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Secondary"
                        hint="Almost unused — leave default unless needed"
                        value={config.theme?.secondaryColor || '#dc004e'}
                        onChange={(v) => handleThemeChange('secondaryColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Accent (error / alert)"
                        hint="Validation errors & required markers"
                        value={config.theme?.accentColor || '#ff9800'}
                        onChange={(v) => handleThemeChange('accentColor', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      bgcolor: 'background.paper',
                      p: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          letterSpacing: 0.3,
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        Part 5
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Preview
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.4 }}>
                      How participants will see your colors (SurveyJS + progress chrome).
                    </Typography>
                    <SurveyThemePreviewPanel
                      theme={config.theme}
                      showProgress={config.showProgressBar !== 'off' && config.showProgressBar !== false}
                    />
                  </Box>
                </Box>
              </Box>
              </Collapse>
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Pages and Questions */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Pages & Questions</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Organize your survey into pages. Drag pages to reorder them.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={addNewPage}
                size="large"
              >
                Add New Page
              </Button>
            </Box>
          </Box>

          {config.pages && config.pages.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={config.pages.map((_, index) => `page-${index}`)}
                strategy={verticalListSortingStrategy}
              >
                <List sx={{ width: '100%' }}>
                  {config.pages.map((page, pageIndex) => (
                    <SortablePageItem
                      key={`page-${pageIndex}`}
                      page={page}
                      pageIndex={pageIndex}
                      onEdit={setSelectedPage}
                      onDuplicate={duplicatePage}
                      onDelete={deletePage}
                    />
                  ))}
                </List>
              </SortableContext>
            </DndContext>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No pages created yet. Click "Add New Page" to get started.
              </Typography>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Page Editor Dialog */}
      {selectedPage && (
        <PageEditor
          page={selectedPage.page}
          pageIndex={selectedPage.index}
          onSave={(updatedPage) => {
            updatePage(selectedPage.index, updatedPage);
            setSelectedPage(null);
          }}
          onCancel={() => setSelectedPage(null)}
          images={config.images || []}
          currentProject={currentProject}
          surveyConfig={config}
        />
      )}

      {/* Next Step Button */}
      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={onNextStep}
            sx={{
              px: 4,
              py: 1.5,
              fontWeight: 600
            }}
          >
            Next: Share Survey →
          </Button>
        </Box>
      )}
      <Snackbar
        open={themeSnackbar.open}
        autoHideDuration={4000}
        onClose={() => setThemeSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert severity={themeSnackbar.severity} onClose={() => setThemeSnackbar((s) => ({ ...s, open: false }))}>
          {themeSnackbar.message}
        </Alert>
      </Snackbar>
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
  );
}
