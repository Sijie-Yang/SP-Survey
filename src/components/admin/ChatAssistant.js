import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useRegion } from '../../contexts/RegionContext';
import {
  Box,
  Card,
  TextField,
  IconButton,
  Typography,
  CircularProgress,
  Button,
  Chip,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  ButtonGroup,
  Snackbar,
  Stack,
  MenuItem,
  Select,
} from '@mui/material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  ExpandMore,
} from '@mui/icons-material';
import {
  Send,
  StopCircle,
  Settings,
  SmartToy,
  Clear,
  Download,
  TipsAndUpdates,
  ContentCopy,
} from '@mui/icons-material';
import { PROMPTS } from '../../config/prompts';
import { listMcpConnections } from '../../lib/agentApi';
import AssistantSettingsDialog from './AssistantSettingsDialog';
import {
  assistantStageLabel,
  collapseRepeatedToolErrors,
  formatToolDiagnostics,
  processHeadline,
  processTranscriptKey,
  readProcessExpanded,
  shouldShowToolDiagnostics,
  saveStatusFromRun,
  writeProcessExpanded,
  writeResultFromTools,
} from '../../hooks/surveyAssistantUtils';
import ChatMarkdown from './ChatMarkdown';
import { ReviewCard, ReviewComposerOptions } from './ReviewPanel';
import { reviewRoleEmoji, reviewRoleLabel } from '../../lib/reviewMode';

function messageTools(msg) {
  const tools = msg?.tools || msg?.metadata?.tools;
  return Array.isArray(tools) ? tools : [];
}

function toolStatusLabel(status, t) {
  if (status === 'running') return t.aiSidebarToolRunning || 'running';
  if (status === 'error') return t.aiSidebarToolError || 'failed';
  if (status === 'unknown') return t.aiSidebarToolUnknown || 'unknown';
  return t.aiSidebarToolDone || 'done';
}

function toolSummary(tool) {
  const result = tool?.result;
  if (typeof result === 'string' && result.trim()) return result.trim();
  if (result && typeof result === 'object' && typeof result.summary === 'string') {
    return result.summary;
  }
  return '';
}

function approvalPreview(approval) {
  return approval?.arguments_preview || approval?.argumentsPreview || approval?.args || {};
}

function approvalTargetText(approval, t) {
  const preview = approvalPreview(approval);
  const projectId = preview.projectId || preview.project_id || approval?.projectId;
  if (!projectId) return '';
  return (t.aiSidebarApprovalProject || 'Project: {project}').replace('{project}', projectId);
}

function approvalPreviewText(approval) {
  const preview = approvalPreview(approval);
  const keys = ['confirm', 'versionLabel', 'publishedVersion', 'name', 'skillId', 'path'];
  const parts = keys
    .filter((key) => preview[key] != null && preview[key] !== '')
    .map((key) => `${key}=${typeof preview[key] === 'object' ? JSON.stringify(preview[key]) : preview[key]}`);
  const count = Array.isArray(preview.ids) ? preview.ids.length : (preview.count ?? preview.deleteCount);
  if (count != null && count !== '') parts.push(`count=${count}`);
  return parts.join(' · ');
}

function localizeLoadingStatus(status, t) {
  if (!status) return '';
  const using = String(status).match(/^Using (.+)[.…]$/);
  if (using) return (t.aiSidebarStatusUsingTool || 'Using {tool}…').replace('{tool}', using[1]);
  const reviewRevising = String(status).match(/^Review round (\d+): revising…$/);
  if (reviewRevising) return (t.aiReviewStatusRevising || status).replace('{round}', reviewRevising[1]);
  const reviewRole = String(status).match(/^Review round (\d+): ([a-z]+)…$/);
  if (reviewRole) {
    return (t.aiReviewStatusRound || status)
      .replace('{round}', reviewRole[1])
      .replace('{role}', reviewRoleLabel(reviewRole[2], t));
  }
  const step = String(status).match(/^Working on step (\d+)[.…]$/);
  if (step) return (t.aiSidebarStatusStep || 'Working on step {step}…').replace('{step}', step[1]);
  const map = {
    'Thinking…': t.aiSidebarStatusThinking,
    'Thinking...': t.aiSidebarStatusThinking,
    'Queued…': t.aiSidebarStatusQueued,
    'Continuing survey generation…': t.aiSidebarStatusRunning,
    'Looking up the current settings…': t.aiSidebarStatusLookup || '正在查看相关设置…',
    'Preparing the edit…': t.aiSidebarStatusAdjust || '正在准备修改…',
    'Designing the survey…': t.aiSidebarStatusGenerate || '正在设计问卷…',
    'Working on your request…': t.aiSidebarStatusAgent || '正在处理请求…',
    'Current mode is read-only…': t.aiSidebarStatusReadOnly || '当前模式只读',
    'Waiting for your approval…': t.aiSidebarStatusApproval,
    'Retrying model request…': t.aiSidebarStatusRetrying,
    'Compacting context and continuing…': t.aiSidebarStatusCompacting,
    'Verifying saved draft…': t.aiSidebarStatusVerifying,
  };
  if (/^Repairing configuration/.test(status)) return status;
  return map[status] || status;
}

/**
 * ChatAssistant Component
 * A ChatGPT-style interface for survey generation/adjustment
 */
export default function ChatAssistant({
  messages = [],
  userMessage,
  isLoading,
  loadingStatus = '',
  pendingApproval = null,
  apiKeyValid,
  openaiApiKey,
  credentialHint = '',
  isPlatformMode = false,
  assistantMode = 'agent',
  onAssistantModeChange,
  contextEnabled,
  recommendations = [],
  currentProject,
  conversationHistoryRef,
  workingMemoryRef,
  sessionLearningRef,
  onMessageChange,
  onSendMessage,
  onCancelRun,
  onApprovalDecision,
  onSteerMessage,
  onApiKeyChange,
  onValidateApiKey,
  onContextToggle,
  onClearHistory,
  onDownloadHistory,
  onPromptsChange,
  onCredentialsChange,
  chatEndRef,
  aiUndoAvailable = false,
  writeConflict = null,
  inboxItems = [],
  runDiffs = {},
  onRevertAiChange,
  onResolveWriteConflict,
  onDiscardInbox,
  onRunQualityChecks,
  modelOptions = [],
  selectedRoute = '',
  selectedEffort = '',
  effortOptions = [],
  onRouteChange,
  onEffortChange,
  routeUnavailable = '',
  blockReason = '',
  variant = 'content',
  onOpenSilicon,
  fillHeight = false,
  settingsOpen: settingsOpenProp,
  onSettingsOpenChange,
  editorSelection = null,
  onClearEditorFocus,
  steerTarget = 'next-step',
  onSteerTargetChange,
  reviewOptions = null,
  reviewEstimate = null,
  reviewApplying = '',
  onReviewOptionsChange,
  onApplyReview,
}) {
  const { t } = useRegion();
  const navigate = useNavigate();
  const [internalSettingsOpen, setInternalSettingsOpen] = React.useState(false);
  const settingsOpen = settingsOpenProp ?? internalSettingsOpen;
  const setSettingsOpen = onSettingsOpenChange || setInternalSettingsOpen;
  const [codexConnected, setCodexConnected] = React.useState(false);
  const [codexStatusLoading, setCodexStatusLoading] = React.useState(Boolean(isPlatformMode));

  React.useEffect(() => {
    let cancelled = false;
    if (!isPlatformMode) {
      setCodexConnected(false);
      setCodexStatusLoading(false);
      return undefined;
    }
    setCodexStatusLoading(true);
    Promise.resolve()
      .then(() => (typeof listMcpConnections === 'function' ? listMcpConnections() : { connections: [] }))
      .then((result) => {
        if (cancelled) return;
        setCodexConnected(Boolean(result?.connections?.length));
      })
      .catch(() => {
        if (!cancelled) setCodexConnected(false);
      })
      .finally(() => {
        if (!cancelled) setCodexStatusLoading(false);
      });
    return () => { cancelled = true; };
  }, [isPlatformMode, apiKeyValid]);
  
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
  const [confirmDialog, setConfirmDialog] = React.useState(null);
  const sendBlocked = Boolean(blockReason || (!apiKeyValid && !openaiApiKey) || routeUnavailable || isLoading);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!isLoading) {
      setElapsedSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

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
  const [processOpen, setProcessOpen] = React.useState({});
  const [diffOpen, setDiffOpen] = React.useState({});
  const [hasNewMessages, setHasNewMessages] = React.useState(false);
  const stickToBottomRef = React.useRef(true);
  const scrollBoxRef = React.useRef(null);
  
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

  React.useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box) return undefined;
    const onScroll = () => {
      const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
      stickToBottomRef.current = distance < 48;
      if (stickToBottomRef.current) setHasNewMessages(false);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box) return;
    if (stickToBottomRef.current) {
      if (typeof chatEndRef?.current?.scrollIntoView === 'function') {
        chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [messages, isLoading, loadingStatus, chatEndRef]);

  React.useEffect(() => {
    const box = scrollBoxRef.current;
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!box || !viewport) return undefined;
    let lastHeight = viewport.height;
    const onResize = () => {
      const next = viewport.height;
      if (Math.abs(next - lastHeight) < 24) return;
      lastHeight = next;
      if (stickToBottomRef.current) return;
      const saved = box.scrollTop;
      requestAnimationFrame(() => {
        box.scrollTop = saved;
      });
    };
    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
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
  
  const reviewActive = assistantMode === 'review';
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoading && userMessage.trim()) onSteerMessage?.();
      else if (!sendBlocked && (userMessage.trim() || reviewActive)) onSendMessage();
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
  
  const handleClearClick = () => {
    setConfirmDialog({
      title: t.aiClearHistoryTitle,
      message: t.aiClearHistoryMessage,
      confirmLabel: t.aiClearHistoryConfirm,
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        onClearHistory?.();
      },
    });
  };

  const composerPlaceholder = isLoading
    ? (t.aiSidebarSteerPlaceholder || 'Add an instruction to the running Agent…')
    : blockReason === 'no-project'
    ? t.aiSidebarSelectProject
    : (apiKeyValid && !routeUnavailable
      ? (reviewActive ? (t.aiReviewPlaceholder || t.aiSidebarComposerPlaceholder) : t.aiSidebarComposerPlaceholder)
      : t.aiSidebarComposerDisabled);

  const emptyTitle = t.aiSidebarEmptyTitle;
  const emptyBody = blockReason === 'no-project'
    ? t.aiSidebarNoProject
    : (apiKeyValid ? t.aiSidebarEmptyReady : t.aiSidebarEmptyConnect);

  const handleResetPrompts = () => {
    setConfirmDialog({
      title: 'Reset prompts',
      message: 'Are you sure you want to reset all prompts to default values for this project?',
      confirmLabel: 'Reset',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        setPrompts(PROMPTS);
        if (currentProject?.id) {
          localStorage.removeItem(`customPrompts_${currentProject.id}`);
        }
        setPromptsModified(false);
        setPromptSnackbar({ open: true, message: 'Prompts reset to defaults!', severity: 'info' });
      },
    });
  };

  const addCustomScenario = () => {
    const scenario = newScenario.trim().toLowerCase();
    if (!scenario || [...predefinedScenarios, ...researchContext.customScenarios].includes(scenario)) return;
    setResearchContext({
      ...researchContext,
      scenario,
      customScenarios: [...researchContext.customScenarios, scenario],
    });
    setNewScenario('');
  };

  const chatBody = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: fillHeight ? 1 : undefined,
        minHeight: 0,
        height: fillHeight ? '100%' : undefined,
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: fillHeight ? 0 : 280,
          height: fillHeight ? undefined : 400,
          overflowY: 'auto',
          px: { xs: 2, sm: 2.5 },
          py: 2.5,
        }}
        ref={scrollBoxRef}
      >
        {editorSelection?.questionName || editorSelection?.pageName ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={[
                editorSelection.pageName ? `页 ${editorSelection.pageName}` : null,
                editorSelection.questionName ? `题 ${editorSelection.questionName}` : null,
                editorSelection.dirty ? '尚未保存' : null,
              ].filter(Boolean).join(' · ')}
              onDelete={onClearEditorFocus}
            />
          </Stack>
        ) : null}
        {messages.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100%',
              px: 2,
              textAlign: 'center',
            }}
          >
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 44,
                mb: 2,
                borderRadius: 3,
                color: 'primary.main',
                bgcolor: 'action.hover',
              }}
            >
              <SmartToy sx={{ fontSize: 24 }} />
            </Box>
            <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 600 }}>
              {emptyTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340, lineHeight: 1.6 }}>
              {emptyBody}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2.5}>
            {writeConflict ? (
              <Box sx={{ p: 1.25, border: '1px solid', borderColor: 'warning.light', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 0.75 }}>
                  {t.aiWriteConflict || 'Editor has unsaved changes. Save before executing this request, or return to the editor.'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {writeConflict.message}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="contained" onClick={() => onResolveWriteConflict?.('save')}>
                    {t.aiSaveThenRun || 'Save then execute'}
                  </Button>
                  <Button size="small" onClick={() => onResolveWriteConflict?.('dismiss')}>
                    {t.aiReturnToEditor || 'Return to settings'}
                  </Button>
                </Stack>
              </Box>
            ) : null}
            {inboxItems.length > 0 ? (
              <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{t.aiQueueTitle || 'Queued tasks'}</Typography>
                {inboxItems.map((item) => (
                  <Stack key={item.id} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                    <Chip size="small" label={item.target === 'after-run' ? (t.aiQueueAfter || 'After this task') : (t.aiQueueNow || 'Steer current')} />
                    <Typography variant="caption" sx={{ flex: 1 }} noWrap>{item.content}</Typography>
                    <Button size="small" onClick={() => onDiscardInbox?.(item.id)}>{t.aiQueueCancel || 'Cancel'}</Button>
                  </Stack>
                ))}
              </Box>
            ) : null}
            {contextEnabled && recommendations.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {recommendations.slice(0, 3).map((rec, index) => (
                  <Chip
                    key={index}
                    label={rec.message}
                    size="small"
                    variant="outlined"
                    icon={<TipsAndUpdates sx={{ fontSize: 14 }} />}
                    sx={{ maxWidth: '100%', borderRadius: 2 }}
                  />
                ))}
              </Box>
            )}
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';
              return (
                <Box
                  key={msg.id}
                  sx={{
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  {isSystem ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        width: '100%',
                        px: 1.25,
                        py: 1,
                        borderRadius: 2,
                        bgcolor: msg.metadata?.error ? 'rgba(211, 47, 47, 0.08)' : 'action.hover',
                        color: msg.metadata?.error ? 'error.main' : 'text.secondary',
                      }}
                    >
                      <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {msg.content}
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ maxWidth: isUser ? '88%' : '100%', minWidth: 0 }}>
                      {!isUser && (
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                            {t.aiSidebarAssistantName}
                          </Typography>
                          {msg.metadata?.actionType && (
                            <Chip
                              label={msg.metadata.actionType}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.68rem' }}
                            />
                          )}
                        </Stack>
                      )}
                      <Box
                        sx={{
                          px: isUser ? 1.5 : 0,
                          py: isUser ? 1.1 : 0,
                          borderRadius: 3,
                          bgcolor: isUser ? 'action.selected' : 'transparent',
                          border: msg.metadata?.error ? '1px solid' : 0,
                          borderColor: 'error.main',
                        }}
                      >
                        {(() => {
                          const tools = collapseRepeatedToolErrors(messageTools(msg));
                          const running = tools.some((tool) => tool.status === 'running') || Boolean(isLoading && index === messages.length - 1);
                          const failed = tools.some((tool) => tool.status === 'error');
                          const writeDone = writeResultFromTools(tools);
                          const processKey = processTranscriptKey(msg);
                          const storedOpen = readProcessExpanded(
                            typeof window !== 'undefined' ? window.sessionStorage : null,
                            processKey,
                          );
                          const open = processOpen[processKey] ?? storedOpen ?? running;
                          const staleStage = !running && ['save', 'build_survey'].includes(msg.metadata?.stage);
                          const showDiagnostics = (tool) => shouldShowToolDiagnostics(tool.name, tool.diagnostics);
                          return (
                            <>
                              {!isUser && tools.length > 0 && (
                                <Accordion
                                  disableGutters
                                  expanded={open}
                                  onChange={(_, next) => {
                                    setProcessOpen((current) => ({ ...current, [processKey]: next }));
                                    writeProcessExpanded(
                                      typeof window !== 'undefined' ? window.sessionStorage : null,
                                      processKey,
                                      next,
                                    );
                                  }}
                                  sx={{
                                    mt: 0,
                                    mb: 1,
                                    boxShadow: 'none',
                                    border: '1px solid',
                                    borderColor: failed ? 'error.light' : 'divider',
                                    '&:before': { display: 'none' },
                                  }}
                                >
                                  <AccordionSummary expandIcon={<ExpandMore />}>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                      {failed && !running ? '' : (running ? '' : '✓ ')}
                                      {processHeadline(tools, { running })}
                                    </Typography>
                                  </AccordionSummary>
                                  <AccordionDetails sx={{ pt: 0, display: 'grid', gap: 0.6 }}>
                                    {msg.metadata?.stage && !staleStage ? (
                                      <Typography variant="caption" color="text.secondary">
                                        {assistantStageLabel(msg.metadata.stage, msg.metadata)}
                                      </Typography>
                                    ) : null}
                                    {tools.map((tool, toolIndex) => {
                                      const summary = toolSummary(tool);
                                      const diagnostics = tool.diagnostics;
                                      const current = running && tool.status === 'running';
                                      return (
                                        <Box
                                          key={`${msg.id || index}-tool-${tool.id || tool.name || toolIndex}`}
                                          sx={{
                                            px: 1,
                                            py: 0.6,
                                            borderRadius: 1,
                                            border: '1px solid',
                                            borderColor: tool.status === 'error' ? 'error.light' : 'divider',
                                            bgcolor: current ? 'action.hover' : 'background.paper',
                                            opacity: running && !current && tool.status !== 'error' ? 0.7 : 1,
                                          }}
                                        >
                                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                              {tool.review?.role ? `${reviewRoleEmoji(tool.review.role)} ${reviewRoleLabel(tool.review.role, t)} · ` : ''}
                                              {tool.name || t.aiSidebarToolUnknown}
                                              {tool.repeatCount > 1 ? ` ×${tool.repeatCount}` : ''}
                                            </Typography>
                                            <Typography
                                              variant="caption"
                                              sx={{
                                                color: tool.status === 'error'
                                                  ? 'error.main'
                                                  : tool.status === 'running'
                                                    ? 'primary.main'
                                                    : 'text.secondary',
                                              }}
                                            >
                                              {toolStatusLabel(tool.status, t)}
                                            </Typography>
                                          </Box>
                                          {summary ? (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                              {summary}
                                              {tool.result?.target ? ` · ${tool.result.target}` : ''}
                                              {tool.result?.pageCount != null ? ` · ${tool.result.pageCount} pages` : ''}
                                            </Typography>
                                          ) : null}
                                          {showDiagnostics(tool) ? (
                                            <Accordion disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
                                              <AccordionSummary sx={{ minHeight: 28, px: 0 }}>
                                                <Typography variant="caption" color="text.secondary">诊断详情</Typography>
                                              </AccordionSummary>
                                              <AccordionDetails sx={{ px: 0, pt: 0 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                                  {formatToolDiagnostics(diagnostics)}
                                                </Typography>
                                                <Tooltip title={t.aiSidebarCopyDiagnostics || 'Copy diagnostics'}>
                                                  <IconButton
                                                    size="small"
                                                    aria-label={t.aiSidebarCopyDiagnostics || 'Copy diagnostics'}
                                                    onClick={() => {
                                                      const text = formatToolDiagnostics(diagnostics);
                                                      if (text) navigator.clipboard?.writeText(text);
                                                    }}
                                                  >
                                                    <ContentCopy sx={{ fontSize: 12 }} />
                                                  </IconButton>
                                                </Tooltip>
                                              </AccordionDetails>
                                            </Accordion>
                                          ) : null}
                                        </Box>
                                      );
                                    })}
                                  </AccordionDetails>
                                </Accordion>
                              )}
                              {!isUser && msg.metadata?.review ? (
                                <ReviewCard
                                  review={msg.metadata.review}
                                  runId={msg.runId || msg.metadata.review.runId}
                                  t={t}
                                  isLoading={isLoading}
                                  applying={reviewApplying}
                                  onApply={onApplyReview}
                                />
                              ) : null}
                              {!isUser && msg.metadata?.questionModeWriteRefused && msg.metadata?.pendingWrite ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  sx={{ mb: 1 }}
                                  onClick={() => onSendMessage?.({
                                    message: msg.metadata.pendingWrite,
                                    assistantMode: 'adjust',
                                  })}
                                >
                                  切换到调整并执行本条
                                </Button>
                              ) : null}
                              {!isUser && writeDone && !running && !msg.metadata?.questionModeWriteRefused ? (
                                <Box sx={{ mb: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                                    {t.aiChangeCardTitle || '修改结果'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                    {(() => {
                                      const status = saveStatusFromRun(msg, writeDone);
                                      if (status === 'saved_verified') return t.aiChangeVerified || '已保存并核对';
                                      if (status === 'saved') return t.aiChangeSaved || '已保存';
                                      if (status === 'save_failed') return t.aiChangeSaveFailed || '保存失败';
                                      return t.aiChangeVerifyIncomplete || '核对未完成';
                                    })()}
                                  </Typography>
                                  {diffOpen[msg.runId] ? (
                                    (runDiffs[msg.runId] || []).length
                                      ? (runDiffs[msg.runId] || []).slice(0, 16).map((change, index) => (
                                        <Typography key={`${msg.runId}-diff-${index}`} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                          {change.target}.{change.field}
                                          {change.from != null ? ` ${String(change.from).slice(0, 40)} →` : ''}
                                          {change.to != null ? ` ${String(change.to).slice(0, 40)}` : ''}
                                        </Typography>
                                      ))
                                      : (
                                        <Typography variant="caption" color="text.secondary">
                                          {t.aiChangeNoDiff || '没有可展示的字段变化'}
                                        </Typography>
                                      )
                                  ) : null}
                                <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                                  <Button size="small" onClick={() => window.dispatchEvent(new CustomEvent('sp-assistant-open-preview'))}>
                                    打开预览
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      setDiffOpen((current) => ({ ...current, [msg.runId]: !current[msg.runId] }));
                                    }}
                                  >
                                    查看修改
                                  </Button>
                                  {aiUndoAvailable && (
                                    <Button size="small" color="warning" onClick={() => onRevertAiChange?.(msg.runId)}>
                                      撤销本次修改
                                    </Button>
                                  )}
                                </Stack>
                                </Box>
                              ) : null}
                              {isUser ? (
                                msg.content ? (
                                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                                    {msg.content}
                                  </Typography>
                                ) : null
                              ) : (msg.metadata?.review ? null : (
                                <ChatMarkdown>{msg.content}</ChatMarkdown>
                              ))}
                            </>
                          );
                        })()}
                      </Box>
                    </Box>
                  )}
                </Box>
              );
            })}
            {hasNewMessages && (
              <Button
                size="small"
                onClick={() => {
                  stickToBottomRef.current = true;
                  setHasNewMessages(false);
                  chatEndRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
              >
                有新消息
              </Button>
            )}
            {isLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} thickness={5} />
                <Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 500,
                      background: 'linear-gradient(90deg, currentColor 20%, primary.light 50%, currentColor 80%)',
                      backgroundSize: '200% 100%',
                      backgroundClip: 'text',
                      color: 'transparent',
                    }}
                  >
                    {localizeLoadingStatus(loadingStatus, t) || t.aiSidebarStatusThinking || loadingStatus}
                  </Typography>
                  {isLoading && elapsedSeconds > 0 && (
                    <Typography variant="caption" color="text.disabled">
                      {(t.aiSidebarElapsed || '{seconds}s').replace('{seconds}', String(elapsedSeconds))}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
            <div ref={chatEndRef} />
          </Stack>
        )}
      </Box>

      <Box
        sx={{
          flexShrink: 0,
          px: { xs: 1.5, sm: 2 },
          pb: { xs: 'max(12px, env(safe-area-inset-bottom, 0px))', sm: 1.5 },
          pt: 3,
          background: (theme) => `linear-gradient(180deg, transparent 0%, ${theme.palette.background.default} 28%)`,
        }}
      >
        {routeUnavailable && (
          <Alert severity="warning" sx={{ mb: 1, borderRadius: 2 }}>{t.aiSidebarModelUnavailable}</Alert>
        )}
        {blockReason === 'no-project' && (
          <Alert severity="info" sx={{ mb: 1, borderRadius: 2 }}>{t.aiSidebarSelectProject}</Alert>
        )}
        {pendingApproval && (
          <Alert
            severity="warning"
            sx={{ mb: 1, borderRadius: 2 }}
            action={(
              <ButtonGroup size="small">
                <Button color="inherit" onClick={() => onApprovalDecision?.(false)}>
                  {t.aiSidebarApprovalDeny || 'Deny'}
                </Button>
                <Button color="warning" variant="contained" onClick={() => onApprovalDecision?.(true)}>
                  {t.aiSidebarApprovalApprove || 'Approve'}
                </Button>
              </ButtonGroup>
            )}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t.aiSidebarApprovalPrompt || 'Approval required'}: {pendingApproval.tool_name || pendingApproval.toolName}
            </Typography>
            {pendingApproval.risk && (
              <Typography variant="caption" display="block">
                {(t.aiSidebarApprovalRisk || 'Risk: {risk}').replace('{risk}', pendingApproval.risk)}
              </Typography>
            )}
            {approvalTargetText(pendingApproval, t) && (
              <Typography variant="caption" display="block">
                {approvalTargetText(pendingApproval, t)}
              </Typography>
            )}
            {approvalPreviewText(pendingApproval) && (
              <Typography variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap' }}>
                {approvalPreviewText(pendingApproval)}
              </Typography>
            )}
          </Alert>
        )}
        {(aiUndoAvailable || onRunQualityChecks) && (
          <Stack direction="row" spacing={1} sx={{ mb: 0.75 }}>
            {aiUndoAvailable && (
              <Button
                size="small"
                variant="text"
                color="warning"
                onClick={() => onRevertAiChange?.()}
                sx={{ borderRadius: 999, textTransform: 'none' }}
              >
                {t.aiSidebarUndo}
              </Button>
            )}
            {onRunQualityChecks && (
              <Button
                size="small"
                variant="text"
                onClick={onRunQualityChecks}
                sx={{ borderRadius: 999, textTransform: 'none' }}
              >
                {t.qualityChecks}
              </Button>
            )}
          </Stack>
        )}
        <Box
          sx={{
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3.5,
            bgcolor: 'background.paper',
            boxShadow: '0 8px 28px rgba(15, 23, 42, 0.08)',
            transition: 'border-color 120ms ease, box-shadow 120ms ease',
            '&:focus-within': {
              borderColor: 'primary.main',
              boxShadow: '0 10px 32px rgba(37, 99, 235, 0.12)',
            },
          }}
        >
          {reviewActive ? (
            <ReviewComposerOptions
              t={t}
              options={reviewOptions}
              estimate={reviewEstimate}
              onChange={onReviewOptionsChange}
              disabled={isLoading}
            />
          ) : null}
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={8}
            placeholder={composerPlaceholder}
            value={userMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={Boolean(blockReason || (!apiKeyValid && !openaiApiKey) || routeUnavailable)}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                px: 1.5,
                pt: 1.25,
                pb: 0.5,
                alignItems: 'flex-start',
                fontSize: '0.9rem',
                lineHeight: 1.6,
              },
            }}
          />
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ px: 1, pb: 0.75 }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0, overflow: 'hidden' }}>
              <Select
                variant="standard"
                disableUnderline
                size="small"
                value={assistantMode}
                onChange={(event) => onAssistantModeChange?.(event.target.value)}
                disabled={isLoading}
                inputProps={{ 'aria-label': t.aiSidebarMode }}
                sx={{
                  maxWidth: 104,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  '& .MuiSelect-select': { py: 0.5, pl: 0.75, pr: 2.5 },
                }}
              >
                <MenuItem value="agent">{t.aiSidebarModeAgent}</MenuItem>
                <MenuItem value="generate">{t.aiSidebarModeGenerate}</MenuItem>
                <MenuItem value="adjust">{t.aiSidebarModeAdjust}</MenuItem>
                <MenuItem value="question">{t.aiSidebarModeQuestion}</MenuItem>
                <MenuItem value="review">{t.aiSidebarModeReview || 'Review'}</MenuItem>
              </Select>
              {modelOptions.length > 0 ? (
                <Select
                  variant="standard"
                  disableUnderline
                  size="small"
                  value={modelOptions.some((route) => route.value === selectedRoute) ? selectedRoute : ''}
                  onChange={(event) => onRouteChange?.(event.target.value)}
                  disabled={isLoading}
                  aria-label={t.aiSidebarModel}
                  sx={{
                    maxWidth: effortOptions.length > 0 ? 205 : 260,
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    '& .MuiSelect-select': { py: 0.5, pl: 0.75, pr: 2.5 },
                  }}
                >
                  {modelOptions.map((route) => (
                    <MenuItem key={route.value} value={route.value}>{route.label}</MenuItem>
                  ))}
                </Select>
              ) : (
                <Button
                  size="small"
                  onClick={() => setSettingsOpen(true)}
                  sx={{ borderRadius: 999, textTransform: 'none', fontSize: '0.75rem' }}
                >
                  {t.aiSidebarConfigureModel}
                </Button>
              )}
              {effortOptions.length > 0 && (
                <Select
                  variant="standard"
                  disableUnderline
                  size="small"
                  value={effortOptions.includes(selectedEffort) ? selectedEffort : (effortOptions[0] || '')}
                  onChange={(event) => onEffortChange?.(event.target.value)}
                  disabled={isLoading}
                  aria-label={t.aiSidebarReasoning}
                  sx={{
                    maxWidth: 92,
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    '& .MuiSelect-select': { py: 0.5, pl: 0.5, pr: 2.25 },
                  }}
                >
                  {effortOptions.map((effort) => (
                    <MenuItem key={effort} value={effort}>{effort}</MenuItem>
                  ))}
                </Select>
              )}
              {credentialHint && apiKeyValid && !isPlatformMode && (
                <Typography variant="caption" color="text.secondary" noWrap>{credentialHint}</Typography>
              )}
            </Stack>
            {isLoading && (
              <Select
                variant="standard"
                disableUnderline
                size="small"
                value={steerTarget}
                onChange={(event) => onSteerTargetChange?.(event.target.value)}
                sx={{ maxWidth: 148, fontSize: '0.75rem', '& .MuiSelect-select': { py: 0.5, pl: 0.5, pr: 2.25 } }}
              >
                <MenuItem value="next-step">补充当前任务</MenuItem>
                <MenuItem value="after-run">完成后执行</MenuItem>
              </Select>
            )}
            {isLoading && userMessage.trim() && (
              <Button
                size="small"
                variant="outlined"
                onClick={onSteerMessage}
                sx={{ minWidth: 0, borderRadius: 999, textTransform: 'none' }}
              >
                {steerTarget === 'after-run' ? '完成后执行' : (t.aiSidebarSteer || 'Steer')}
              </Button>
            )}
            <Tooltip title={isLoading ? (t.aiSidebarStop || 'Stop') : t.aiSidebarSend}>
              <span>
                <IconButton
                  color={isLoading ? 'error' : 'primary'}
                  onClick={isLoading ? onCancelRun : onSendMessage}
                  disabled={isLoading ? !onCancelRun : (sendBlocked || (!userMessage.trim() && !reviewActive))}
                  aria-label={isLoading ? (t.aiSidebarStop || 'Stop') : t.aiSidebarSend}
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' },
                    '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                  }}
                >
                  {isLoading ? <StopCircle sx={{ fontSize: 19 }} /> : <Send sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Box>
      </Box>
    </Box>
    );

  const headerActions = (
    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {messages.length > 0 && (
        <>
          <Tooltip title={t.aiSidebarDownload}>
            <IconButton size="small" onClick={onDownloadHistory} sx={{ color: 'inherit' }}>
              <Download />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.aiSidebarClear}>
            <IconButton size="small" onClick={handleClearClick} sx={{ color: 'inherit' }}>
              <Clear />
            </IconButton>
          </Tooltip>
        </>
      )}
      {onOpenSilicon && (
        <Tooltip title={t.aiSidebarSilicon}>
          <Button
            size="small"
            sx={{ color: 'inherit', textTransform: 'none' }}
            onClick={onOpenSilicon}
          >
            Silicon
          </Button>
        </Tooltip>
      )}
      <Tooltip title={t.aiSidebarSettings}>
        <IconButton size="small" onClick={() => setSettingsOpen(true)} sx={{ color: 'inherit' }}>
          <Settings />
        </IconButton>
      </Tooltip>
    </Box>
  );

  return (
    <>
      {variant === 'embedded' ? (
        <Card
          sx={{
            mb: 2,
            border: 2,
            borderColor: 'primary.main',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              bgcolor: 'primary.main',
              color: 'white',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <SmartToy sx={{ fontSize: 24, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                  {t.aiSidebarTitle}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.9, display: 'block' }}>
                  {t.aiSidebarSubtitle}
                </Typography>
              </Box>
            </Box>
            {headerActions}
          </Box>
          {chatBody}
        </Card>
      ) : (
        chatBody
      )}

      <AssistantSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        t={t}
        isPlatformMode={isPlatformMode}
        assistantMode={assistantMode}
        onAssistantModeChange={onAssistantModeChange}
        onCredentialsChange={onCredentialsChange}
        codexConnected={codexConnected}
        codexStatusLoading={codexStatusLoading}
        onOpenIntegrations={() => navigate('/admin/integrations')}
        apiKeyValid={apiKeyValid}
        openaiApiKey={openaiApiKey}
        onApiKeyChange={onApiKeyChange}
        onValidateApiKey={onValidateApiKey}
        contextEnabled={contextEnabled}
        onContextToggle={onContextToggle}
        researchContext={researchContext}
        setResearchContext={setResearchContext}
        predefinedScenarios={predefinedScenarios}
        newScenario={newScenario}
        setNewScenario={setNewScenario}
        onAddCustomScenario={addCustomScenario}
        currentProject={currentProject}
        prompts={prompts}
        promptsModified={promptsModified}
        onPromptChange={handlePromptChange}
        onSavePrompts={handleSavePrompts}
        onResetPrompts={handleResetPrompts}
        onDownloadHistory={onDownloadHistory}
        onClearHistory={handleClearClick}
      />

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
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </>
  );
}

