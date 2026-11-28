import { reportFromAnalysisResult } from './lib/resultsReportStore';
import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useRegion } from './contexts/RegionContext';
import { UI_LANGUAGES, uiPair } from './lib/uiLanguages';
import { tf } from './contexts/adminI18n';
import RegionSwitcher from './components/admin/RegionSwitcher';
import {
  AppBar,
  useMediaQuery,
  Toolbar,
  Typography,
  Container,
  Box,
  Tab,
  Tabs,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import {
  Preview,
  Menu as MenuIcon,
  FolderOpen,
  Save,
  CleaningServices,
  Palette,
  Check,
  EditNote,
  AutoAwesome,
  OpenInNew,
  MoreVert,
  GitHub,
  CollectionsBookmark,
  SpaceDashboardOutlined,
} from '@mui/icons-material';
import { themes, createCustomTheme } from './themes/themeConfig';
import ConfirmDialog from './components/layout/ConfirmDialog';
import AdminIntroduction from './components/admin/AdminIntroduction';
import ProjectSidebar from './components/admin/ProjectSidebar';
import BackendStatus from './components/admin/BackendStatus';
import { AdminEmptyState, AdminLoadingState } from './components/admin/AdminPageLayout';
import OpenProjectHeader from './components/admin/ProjectSurveyAge';
import { loadSurveyConfig } from './lib/surveyStorage';
import { demoSurveyConfig } from './lib/demoConfig';
import {
  migrateExistingConfig,
  getActiveProject,
  setActiveProject,
  clearActiveProject,
  saveProjectDraftOptimistic,
  saveProjectFull,
} from './lib/projectManager';
import { useAuth } from './contexts/AuthContext';
import { isLocalSelfHosted } from './lib/appMode';
import { API_ROOT } from './lib/apiConfig';
import { isUsableSurveyConfig } from './lib/designProtocol/validate';
import { useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_TAB_HISTORY_MAX, useAdminTabHistory } from './lib/adminTabHistory';
import {
  parseAdminDeepLink,
  savedAdminTab,
  stripAdminDeepLink,
  studioPathForProject,
} from './lib/adminDeepLink';
import useSurveyAssistant from './hooks/useSurveyAssistant';
import { useSiliconTasks } from './hooks/useSiliconTasks';
import { useCollectingSurveyCount } from './hooks/useCollectingSurveyCount';
import CollectingSurveysChip from './components/admin/CollectingSurveysChip';
import AiAssistantSidebar from './components/admin/AiAssistantSidebar';
import { isAssistantEnabled, isSiliconExperimentalEnabled } from './lib/featureFlags';
import { persistSliderAliases } from './lib/sliderScale';
import { nextEditorSelectionState } from './lib/editorSelection';
import {
  AI_SIDEBAR_ID,
  AI_SIDEBAR_WIDTH,
  PROJECT_SIDEBAR_WIDTH,
  readSidebarOpen,
  writeSidebarOpen,
} from './hooks/surveyAssistantUtils';

const ImageDataset = lazy(() => import('./components/admin/ImageDataset'));
const SurveyBuilder = lazy(() => import('./components/admin/SurveyBuilder'));
const SurveyPreview = lazy(() => import('./components/admin/SurveyPreview'));
const FullSurveyPreview = lazy(() => import('./components/admin/FullSurveyPreview'));
const ResultsAnalysis = lazy(() => import('./components/admin/ResultsAnalysis'));
const ResearcherPractice = lazy(() => import('./components/admin/ResearcherPractice'));
const SiliconSamples = lazy(() => import('./components/admin/SiliconSamples'));
const HostSetup = lazy(() => import('./components/admin/HostSetup'));
const ShareSurvey = lazy(() => import('./components/admin/ShareSurvey'));

function mergeEditorWorkingCopy(surveyConfig = {}, selection = {}) {
  const pages = (surveyConfig.pages || []).map((page) => ({
    ...page,
    elements: [...(page.elements || [])],
  }));
  const pageName = selection.pageName;
  let pageIndex = pages.findIndex((page) => page.name === pageName);
  let page = pageIndex >= 0
    ? { ...pages[pageIndex], elements: [...(pages[pageIndex].elements || [])] }
    : null;
  if (selection.pageDirty && selection.pageWorkingCopy) {
    page = {
      ...selection.pageWorkingCopy,
      elements: [...(selection.pageWorkingCopy.elements || [])],
    };
    if (pageIndex < 0) {
      pages.push(page);
      pageIndex = pages.length - 1;
    }
  }
  if (page && selection.workingCopy && selection.questionName) {
    const questionIndex = (page.elements || []).findIndex((item) => item.name === selection.questionName);
    if (questionIndex >= 0) page.elements[questionIndex] = selection.workingCopy;
    else page.elements = [...(page.elements || []), selection.workingCopy];
  }
  if (page && pageIndex >= 0) pages[pageIndex] = page;
  return { ...surveyConfig, pages };
}

function TabPanel({ children, value, index, keepMounted = false, ...other }) {
  const active = value === index;
  return (
    <div
      role="tabpanel"
      hidden={!active}
      id={`admin-tabpanel-${index}`}
      aria-labelledby={`admin-tab-${index}`}
      {...other}
    >
      {(active || keepMounted) && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: active ? 'block' : 'none' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function AdminWorkspaceTabs({ value, onChange, siliconEnabled = true }) {
  const { t } = useRegion();
  const tabsRef = useRef(null);
  useEffect(() => {
    const selected = tabsRef.current?.querySelector('.Mui-selected');
    selected?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [value]);
  const tabSx = {
    minHeight: 40,
    minWidth: 0,
    px: 1.25,
    py: 0.5,
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
  };
  return (
    <Box ref={tabsRef} sx={{ minWidth: 0 }} data-tour="tabs">
    <Tabs
      value={value}
      onChange={onChange}
      aria-label="admin tabs"
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{
        minHeight: 40,
        '& .MuiTabs-flexContainer': { gap: 0.25 },
        '& .MuiTab-root': tabSx,
      }}
    >
      <Tab label={t.tabIntro} />
      <Tab label={t.tabMedia} />
      <Tab label={t.tabBuilder} />
      <Tab label={t.tabHost} />
      <Tab label={t.tabShare} />
      <Tab label={t.tabResults} />
      <Tab label={t.tabPractice} />
      {siliconEnabled && <Tab label={t.tabSilicon} />}
    </Tabs>
    </Box>
  );
}

// Top bar controls follow the public header: neutral outline on the paper bar,
// theme tokens only so every theme (including dark) keeps its contrast.
const toolbarOutlineSx = {
  border: '1px solid',
  borderColor: 'divider',
  color: 'text.primary',
  bgcolor: 'transparent',
  '&:hover': {
    borderColor: 'text.secondary',
    bgcolor: 'action.hover',
  },
};

const toolbarButtonSx = {
  ...toolbarOutlineSx,
  px: 1.25,
  py: 0.35,
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontWeight: 700,
  textTransform: 'none',
};

// Below 1200px the text buttons show only their icon (the tooltip names them),
// which leaves room for the project name.
const toolbarIconUntilWideSx = {
  '& .MuiButton-startIcon': { mr: { xs: 0, lg: 1 }, ml: { xs: 0, lg: -0.5 } },
};

function ToolbarLabel({ children }) {
  return <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>{children}</Box>;
}

function formatSaveStatusLabel(t, saveStatus, lastSavedAt) {
  if (saveStatus === 'saving') return t.saveStatusSaving;
  if (saveStatus === 'error') return t.saveStatusError;
  if (saveStatus === 'unsaved') return t.saveStatusUnsaved;
  if (lastSavedAt) {
    const secs = Math.floor((Date.now() - lastSavedAt) / 1000);
    if (secs < 10) return t.saveStatusJustNow;
    if (secs < 60) return tf(t.saveStatusSecsAgo, { n: secs });
    return tf(t.saveStatusMinsAgo, { n: Math.floor(secs / 60) });
  }
  return t.saveStatusAllSaved;
}

function AdminLoadingLabel() {
  const { t } = useRegion();
  return <Typography>{t.loadingProjectSystem}</Typography>;
}

export default function AdminApp() {
  const { t, language, setLanguage } = useRegion();
  const compactToolbar = useMediaQuery('(max-width:899px)');
  // The Studio button hides below 600px; the More menu offers it there.
  const phoneToolbar = useMediaQuery('(max-width:599px)');
  // Self-hosted: one local user, no sign-in.
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  // Theme state
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem('sp-survey-theme') || 'default';
  });
  const [themeMenuAnchor, setThemeMenuAnchor] = useState(null);
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState(null);
  const theme = createCustomTheme(currentTheme);
  
  const {
    tab: tabValue,
    overlay: adminOverlay,
    openTab: setTabValue,
    openOverlay,
    closeOverlay,
  } = useAdminTabHistory();
  const previewOpen = adminOverlay === 'preview';
  const layoutStudioOpen = adminOverlay === 'layout';
  const [assistantEnabled, setAssistantEnabled] = useState(() => isAssistantEnabled());
  const [siliconEnabled, setSiliconEnabled] = useState(() => isSiliconExperimentalEnabled());
  const [analysisMediaFocus, setAnalysisMediaFocus] = useState(null);
  // Keep Practice mounted after first visit so free-pick selection + list scroll survive tab switches.
  const [practiceKeepAlive, setPracticeKeepAlive] = useState(false);
  const [builderKeepAlive, setBuilderKeepAlive] = useState(false);
  const [siliconKeepAlive, setSiliconKeepAlive] = useState(false);
  const handlePracticeSessionActive = useCallback((active) => {
    if (active) setPracticeKeepAlive(true);
  }, []);
  useEffect(() => {
    if (tabValue === 2) setBuilderKeepAlive(true);
    if (tabValue === 6) setPracticeKeepAlive(true);
    if (tabValue === 7) setSiliconKeepAlive(true);
  }, [tabValue]);
  useEffect(() => {
    const openSilicon = () => {
      if (isSiliconExperimentalEnabled()) setTabValue(7);
    };
    window.addEventListener('sp-open-silicon-tab', openSilicon);
    return () => window.removeEventListener('sp-open-silicon-tab', openSilicon);
  }, [setTabValue]);
  useEffect(() => {
    if (!siliconEnabled && tabValue === 7) setTabValue(0, { replace: true });
  }, [siliconEnabled, tabValue, setTabValue]);
  useEffect(() => {
    const syncFlags = () => {
      setAssistantEnabled(isAssistantEnabled());
      setSiliconEnabled(isSiliconExperimentalEnabled());
    };
    window.addEventListener('sp-feature-flags', syncFlags);
    return () => window.removeEventListener('sp-feature-flags', syncFlags);
  }, []);
  useEffect(() => {
    const openPreview = () => openOverlay('preview');
    window.addEventListener('sp-assistant-open-preview', openPreview);
    return () => window.removeEventListener('sp-assistant-open-preview', openPreview);
  }, [openOverlay]);
  const [surveyConfig, setSurveyConfig] = useState(null);
  // Latest config for async code (e.g. to notice edits made while a save is in flight).
  const surveyConfigRef = useRef(null);
  surveyConfigRef.current = surveyConfig;
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasUnsavedImageDatasetChanges, setHasUnsavedImageDatasetChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // saved | saving | unsaved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const autoSaveTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);
  // The save that is running now, so leaving the editor can wait for it.
  const savePromiseRef = useRef(null);
  const [latestImageDatasetConfig, setLatestImageDatasetConfig] = useState(null);
  const [lastSavedConfig, setLastSavedConfig] = useState(null);
  
  // Project state management - save each project's editing state
  // ✅ Now using sessionStorage (session-only, no quota issues!)
  const [projectStates, setProjectStates] = useState({});
  // projectStates structure: { projectId: { surveyConfig, lastSavedConfig, hasUnsavedChanges, tabValue } }
  
  // Load project states from sessionStorage (session-level, cleared when tab closes)
  const loadProjectStatesFromStorage = () => {
    try {
      const saved = sessionStorage.getItem('project_editing_states');
      if (saved) {
        const parsed = JSON.parse(saved);
        
        // ✅ Filter out invalid keys (undefined, null, empty string)
        const validStates = {};
        Object.keys(parsed).forEach(projectId => {
          if (projectId && projectId !== 'undefined' && projectId !== 'null') {
            validStates[projectId] = parsed[projectId];
          } else {
            console.warn(`🔍 Skipping invalid project state with key: "${projectId}"`);
          }
        });
        
        console.log('🔍 Loaded project states from sessionStorage:', Object.keys(validStates));
        // Log tabValue for each project
        Object.keys(validStates).forEach(projectId => {
          console.log(`  - ${projectId}: tabValue = ${validStates[projectId].tabValue}`);
        });
        return validStates;
      }
    } catch (error) {
      console.error('Error loading project states:', error);
    }
    console.log('🔍 No project states found in sessionStorage');
    return {};
  };

  // Save project states to sessionStorage (session-level, no quota limit issues)
  const saveProjectStatesToStorage = (states) => {
    try {
      sessionStorage.setItem('project_editing_states', JSON.stringify(states));
      console.log('🔍 Saved project states to sessionStorage:', Object.keys(states));
    } catch (error) {
      console.error('Error saving project states:', error);
    }
  };
  
  // Project management states
  const [sidebarOpen, setSidebarOpen] = useState(!compactToolbar);
  const wideLayout = useMediaQuery('(min-width:1200px)');
  const [aiSidebarOpen, setAiSidebarOpen] = useState(() => (
    typeof window !== 'undefined' ? readSidebarOpen(window.localStorage) : false
  ));
  const [aiSidebarPanel, setAiSidebarPanel] = useState('assistant');
  useEffect(() => {
    // A persistent desktop sidebar becomes a modal drawer on phones. Close it
    // at the breakpoint so it cannot cover an already open question editor.
    if (compactToolbar) setSidebarOpen(false);
  }, [compactToolbar]);
  useEffect(() => {
    writeSidebarOpen(typeof window !== 'undefined' ? window.localStorage : null, aiSidebarOpen);
  }, [aiSidebarOpen]);
  const toggleProjectSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      if (next && !wideLayout) setAiSidebarOpen(false);
      return next;
    });
  }, [wideLayout]);
  const toggleAiSidebar = useCallback((panel) => {
    setAiSidebarOpen((open) => {
      const next = !open;
      if (next && !wideLayout) setSidebarOpen(false);
      return next;
    });
    if (panel === 'tasks' || panel === 'assistant') setAiSidebarPanel(panel);
  }, [wideLayout]);
  const openAiSidebar = useCallback((panel = 'assistant') => {
    if (panel === 'tasks' || panel === 'assistant') setAiSidebarPanel(panel);
    setAiSidebarOpen(true);
    if (!wideLayout) setSidebarOpen(false);
  }, [wideLayout]);
  const [currentProject, setCurrentProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Restore keep-alive after refresh when a practice session (or UI selection) was persisted.
  useEffect(() => {
    if (!currentProject?.id) return;
    try {
      const all = JSON.parse(sessionStorage.getItem('researcher_practice_sessions') || '{}') || {};
      const row = all[currentProject.id];
      if (row?.active && row?.sessionId) setPracticeKeepAlive(true);
      const ui = JSON.parse(sessionStorage.getItem('researcher_practice_ui') || '{}') || {};
      if (ui[currentProject.id]?.selectedName) setPracticeKeepAlive(true);
    } catch {
      /* ignore */
    }
  }, [currentProject?.id]);


  useEffect(() => {
    // Clean up any old demo images from saved configurations
    cleanupDemoImages();
    
    // Load project states
    const savedStates = loadProjectStatesFromStorage();
    setProjectStates(savedStates);

    // /admin?project=<id>&tab=<name> (links from Studio): make that project the
    // active one before the project system reads it.
    const deepLink = parseAdminDeepLink(locationRef.current.search);
    if (deepLink.projectId) setActiveProject(deepLink.projectId);

    // Initialize project system
    initializeProjectSystem({ deepLink });
  }, []);

  // Monitor surveyConfig changes, detect unsaved changes
  useEffect(() => {
    let hasChanges = false;
    
    // Check survey config changes
    if (surveyConfig && lastSavedConfig) {
      const configChanged = surveyConfig !== lastSavedConfig
        && JSON.stringify(surveyConfig) !== JSON.stringify(lastSavedConfig);
      hasChanges = hasChanges || configChanged;
    }
    
    // Include image dataset changes
    hasChanges = hasChanges || hasUnsavedImageDatasetChanges;
    
    setHasUnsavedChanges(hasChanges);
    if (hasChanges && saveStatus !== 'saving' && saveStatus !== 'error') {
      setSaveStatus('unsaved');
    }
    
    // Also update project state
    if (currentProject) {
      saveCurrentProjectState({ hasUnsavedChanges: hasChanges });
    }
  }, [surveyConfig, lastSavedConfig, hasUnsavedImageDatasetChanges]);

  // When surveyConfig first loads, if there's no lastSavedConfig yet, set it
  useEffect(() => {
    if (surveyConfig && !lastSavedConfig) {
      console.log('🔍 Setting initial lastSavedConfig');
      setLastSavedConfig(JSON.parse(JSON.stringify(surveyConfig)));
    }
  }, [surveyConfig, lastSavedConfig]);

  // When switching projects, reset ImageDataset unsaved state
  useEffect(() => {
    if (currentProject) {
      setHasUnsavedImageDatasetChanges(false);
      setLatestImageDatasetConfig(null); // Clear cached config when switching projects
    }
  }, [currentProject?.id]);

  // Sync Admin UI when a local agent (Codex, Claude Code) updates the draft while this project stays open.
  const remoteSyncInFlightRef = useRef(false);
  const remoteConflictWarnedAtRef = useRef(null);
  const draftUpdatedAtRef = useRef(null);
  const hasUnsavedChangesRef = useRef(false);
  const performSaveRef = useRef(null);
  const [editorSelection, setEditorSelection] = useState(null);
  const editorSelectionRef = useRef(null);
  const [resultsScope, setResultsScope] = useState(null);
  const [resultsAnalyzeBusy, setResultsAnalyzeBusy] = useState(false);
  const [editorCommitKey, setEditorCommitKey] = useState(0);
  const currentProjectIdRef = useRef(null);

  const commitEditorSelection = useCallback((nextOrUpdater) => {
    const prev = editorSelectionRef.current;
    const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
    editorSelectionRef.current = next;
    setEditorSelection((current) => nextEditorSelectionState(current, next));
  }, []);

  useEffect(() => {
    draftUpdatedAtRef.current = currentProject?.draftUpdatedAt || currentProject?.savedAt || null;
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    currentProjectIdRef.current = currentProject?.id || null;
  }, [currentProject?.draftUpdatedAt, currentProject?.savedAt, currentProject?.id, hasUnsavedChanges]);

  // A session restored without a usable config falls back to the stored draft.
  useEffect(() => {
    if (!currentProject?.id || isUsableSurveyConfig(surveyConfig)) return undefined;
    const fallback = currentProject._surveyConfig;
    if (isUsableSurveyConfig(fallback)) {
      setSurveyConfig(fallback);
      return undefined;
    }
    let cancelled = false;
    loadSurveyConfig(currentProject.id).then((config) => {
      if (!cancelled && isUsableSurveyConfig(config)) setSurveyConfig(config);
    });
    return () => { cancelled = true; };
  }, [currentProject?.id, currentProject?._surveyConfig, surveyConfig]);

  useEffect(() => {
    if (!currentProject?.id) return undefined;

    const applyRemoteDraft = (latest) => {
      const config = latest?._surveyConfig;
      if (!config) return;
      const projectId = latest.id;
      const remoteAt = latest.draftUpdatedAt || latest.savedAt || null;
      setCurrentProject(latest);
      setSurveyConfig(config);
      const savedCopy = JSON.parse(JSON.stringify(config));
      setLastSavedConfig(savedCopy);
      setHasUnsavedChanges(false);
      draftUpdatedAtRef.current = remoteAt;
      setProjectStates((prev) => {
        const next = {
          ...prev,
          [projectId]: {
            ...(prev[projectId] || {}),
            surveyConfig: config,
            lastSavedConfig: savedCopy,
            hasUnsavedChanges: false,
          },
        };
        saveProjectStatesToStorage(next);
        return next;
      });
      setSnackbar({
        open: true,
        message: 'Loaded latest edits from the local agent API.',
        severity: 'info',
      });
    };

    const syncRemoteDraft = async () => {
      const projectId = currentProjectIdRef.current;
      if (!projectId || remoteSyncInFlightRef.current || saveInFlightRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      // The open page/question editor keeps its edits in local state, so
      // hasUnsavedChanges is still false while typing there. Don't swap the
      // config underneath it (that's what made fields "change on their own").
      const selection = editorSelectionRef.current;
      if (selection?.dirty || selection?.pageDirty) return;

      remoteSyncInFlightRef.current = true;
      try {
        const { getProjectById, getProjectDraftStamp } = await import('./lib/projectManager');
        // Poll just the timestamp; only download the whole project when it moved.
        const stamp = await getProjectDraftStamp(projectId);
        if (stamp !== undefined && (!stamp || stamp === draftUpdatedAtRef.current)) return;
        const latest = await getProjectById(projectId);
        if (!latest || currentProjectIdRef.current !== projectId) return;

        const remoteAt = latest.draftUpdatedAt || latest.savedAt || null;
        const localAt = draftUpdatedAtRef.current;
        if (!remoteAt || remoteAt === localAt) return;

        if (hasUnsavedChangesRef.current) {
          if (remoteConflictWarnedAtRef.current !== remoteAt) {
            remoteConflictWarnedAtRef.current = remoteAt;
            setSnackbar({
              open: true,
              message: 'The local agent updated this project. Save or discard your local edits to load the latest.',
              severity: 'warning',
            });
          }
          return;
        }

        applyRemoteDraft(latest);
      } catch (err) {
        console.warn('Remote draft sync failed:', err);
      } finally {
        remoteSyncInFlightRef.current = false;
      }
    };

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') syncRemoteDraft();
    };
    const onAgentRunComplete = (event) => {
      if (event?.detail?.projectId !== currentProjectIdRef.current) return;
      setTabValue(2);
      syncRemoteDraft();
    };

    window.addEventListener('focus', onFocusOrVisible);
    window.addEventListener('sp-agent-run-complete', onAgentRunComplete);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const intervalId = window.setInterval(syncRemoteDraft, 4000);
    syncRemoteDraft();

    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      window.removeEventListener('sp-agent-run-complete', onAgentRunComplete);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.clearInterval(intervalId);
    };
  }, [currentProject?.id, setTabValue]);

  // Monitor projectStates changes, ensure persistence
  useEffect(() => {
    if (Object.keys(projectStates).length > 0) {
      saveProjectStatesToStorage(projectStates);
    }
  }, [projectStates]);

  // ✅ No longer needed - demo images are not stored in localStorage
  const cleanupDemoImages = () => {
    console.log('📝 Demo images cleanup skipped (no longer using localStorage)');
  };

  // Show the start tab and drop any deep-link parameters in one history
  // replace, so the address bar ends on plain /admin.
  const settleStartupLocation = (tab = null) => {
    const loc = locationRef.current;
    const search = stripAdminDeepLink(loc.search);
    const shownTab = typeof loc.state?.adminTab === 'number' ? loc.state.adminTab : 0;
    const sameTab = tab == null || (shownTab === tab && !loc.state?.adminOverlay);
    if (search === loc.search && sameTab) return;
    navigate(
      { pathname: loc.pathname, search, hash: loc.hash },
      {
        replace: true,
        preventScrollReset: true,
        state: tab == null ? loc.state : { ...(loc.state || {}), adminTab: tab, adminOverlay: null },
      },
    );
  };

  // Tab to open a project on: the link's tab, else the one remembered for it.
  const startupTab = (projectId, deepLink) => {
    if (deepLink?.tab != null) return deepLink.tab;
    const savedState = loadProjectStatesFromStorage()[projectId];
    return savedState
      ? savedAdminTab(savedState, { tabsVersion: ADMIN_TABS_VERSION, maxTab: ADMIN_TAB_HISTORY_MAX })
      : 0;
  };

  const initializeProjectSystem = async ({ deepLink = null } = {}) => {
    const slowTimer = setTimeout(() => {
      setProjectLoading(false);
      setSnackbar({ open: true, message: t.projectSystemTimeout, severity: 'warning' });
    }, 15000);
    let openTab = null;
    try {
      setProjectLoading(true);
      
      // Try to migrate existing 'default' configuration to a project
      const migratedProject = await migrateExistingConfig();
      
      if (migratedProject) {
        // Load the migrated project
        setCurrentProject(migratedProject);
        
        // Restore the cached copy only when it holds unsaved edits (see below).
        const stateRestored = restoreProjectState(migratedProject.id, { onlyWhenUnsaved: true, restoreTab: false });
        openTab = startupTab(migratedProject.id, deepLink);
        
        if (!stateRestored) {
          // If no saved state, load from file
          const config = await loadSurveyConfig(migratedProject.id);
          setSurveyConfig(config || demoSurveyConfig);
        }
        
        setSnackbar({ 
          open: true, 
          message: 'Existing configuration migrated to project system!', 
          severity: 'success' 
        });
      } else {
        // Check if there's an active project
        // On the platform a project read without an owner came through the
        // participant view: it is someone else's, so it does not open here.
        const loadedProject = await getActiveProject();
        const activeProject = loadedProject;
        if (loadedProject && !activeProject) clearActiveProject();
        console.log('🔍 Active project from sessionStorage:', activeProject?.id, activeProject?.name);
        
        if (activeProject) {
          setCurrentProject(activeProject);
          
          // Restore the cached copy only when it holds unsaved edits. A clean
          // copy can be older than the stored draft (Studio or an agent may
          // have saved since), and the next autosave would write it back.
          const stateRestored = restoreProjectState(activeProject.id, { onlyWhenUnsaved: true, restoreTab: false });
          openTab = startupTab(activeProject.id, deepLink);
          
          if (!stateRestored) {
            // No unsaved edits: load the stored draft
            const config = await loadSurveyConfig(activeProject.id);
            setSurveyConfig(config || demoSurveyConfig);
          }
        } else {
          // No projects yet - show empty state
          console.log('🔍 No active project, showing null state');
          setSurveyConfig(null);
          if (deepLink?.projectId) {
            setSnackbar({
              open: true,
              message: uiPair(
                language,
                'This project could not be opened. It may have been deleted, or your account may not have access.',
                '打不开这个项目。它可能已被删除，或者你的账号没有权限。',
              ),
              severity: 'warning',
            });
          }
        }
      }
    } catch (error) {
      console.error('Error initializing project system:', error);
      setSurveyConfig(demoSurveyConfig);
    } finally {
      clearTimeout(slowTimer);
      setProjectLoading(false);
      settleStartupLocation(openTab);
    }
  };

  const handleProjectSelect = async (project, preloadedConfig = null) => {
    if (!project) {
      if (currentProject) saveCurrentProjectState();
      setCurrentProject(null);
      setSurveyConfig(null);
      return;
    }

    try {
      if (currentProject && currentProject.id !== project.id) {
        saveCurrentProjectState();
      }

      let fullProject = project;
      let fileSurveyConfig = preloadedConfig;
      try {
        // Try to load latest project data
        const response = await fetch(`${API_ROOT}/projects/${project.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            if (data.project) {
              fullProject = {
                ...data.project,
                savedAt: data.savedAt || data.project.savedAt || null,
                draftUpdatedAt: data.draftUpdatedAt || data.savedAt || data.project.draftUpdatedAt || null,
                _surveyConfig: data.surveyConfig,
              };
            }
            if (!fileSurveyConfig && data.surveyConfig) fileSurveyConfig = data.surveyConfig;
          }
        }
      } catch (error) {
        console.warn('Could not load latest project data:', error);
      }

      // 3. Set new project
      setCurrentProject(fullProject);
      
      // 3. Restore cached editing state only when there are unsaved edits.
      // Otherwise prefer latest file-system state to avoid stale cross-project UI state.
      const stateRestored = restoreProjectState(project.id, { onlyWhenUnsaved: true });
      
      if (stateRestored) {
        console.log('🔍 Restored saved project state');
        setSnackbar({ 
          open: true, 
          message: `Restored project: ${project.name} (with unsaved changes)`, 
          severity: 'info' 
        });
      } else {
        // 4. If no saved state, load from file or preloaded config
        console.log('🔍 Loading fresh project state');
        
        if (fileSurveyConfig) {
          setSurveyConfig(fileSurveyConfig);
          setLastSavedConfig(JSON.parse(JSON.stringify(fileSurveyConfig)));
        } else {
          const config = await loadSurveyConfig(project.id);
          const finalConfig = config || createDefaultConfig();
          setSurveyConfig(finalConfig);
          setLastSavedConfig(JSON.parse(JSON.stringify(finalConfig)));
        }
        
        // Reset unsaved state, but keep current tab (don't jump)
        setHasUnsavedChanges(false);
        // No longer force tabValue to 0, keep user's current tab
        
        // Initialize project state, save current tab
        saveCurrentProjectState({ 
          hasUnsavedChanges: false,
          tabValue: tabValue // Keep current tab
        });
        
        setSnackbar({ 
          open: true, 
          message: `Switched to project: ${project.name}`, 
          severity: 'success' 
        });
      }
    } catch (error) {
      console.error('Error loading project:', error);
      setSnackbar({ 
        open: true, 
        message: 'Error loading project', 
        severity: 'error' 
      });
    }
  };

  const createDefaultConfig = () => ({
    // Standard SurveyJS format
    title: "Urban Streetscape Perception Survey",
    description: "This survey helps us understand how people perceive different street environments.",
    logo: "",
    logoPosition: "right",
    
    // SurveyJS standard settings (directly at root level)
    showQuestionNumbers: "off",
    showProgressBar: "aboveheader", 
    progressBarType: "questions",
    autoGrowComment: true,
    showPreviewBeforeComplete: "showAllQuestions",
    
    // SurveyJS standard page structure
    pages: [
      {
        name: "demographics",
        title: "Part 1: Background Information (Optional)",
        description: "Please tell us a bit about yourself. All questions are optional and can be skipped.",
        elements: []
      }
    ],
    
    // Custom theme configuration (kept for theme generation)
    theme: {
      primaryColor: "#1976d2",
      primaryLight: "#42a5f5", 
      primaryDark: "#1565c0",
      secondaryColor: "#dc004e",
      accentColor: "#ff9800",
      successColor: "#4caf50",
      backgroundColor: "#ffffff",
      cardBackground: "#f8f9fa",
      headerBackground: "#ffffff",
      textColor: "#212121",
      secondaryText: "#757575",
      disabledText: "#bdbdbd",
      borderColor: "#e0e0e0",
      focusBorder: "#1976d2"
    }
  });

  // Tab indices: 0 Intro, 1 Media, 2 Builder, 3 Host, 4 Share, 5 Results, 6 Practice, 7 Silicon
  const ADMIN_TABS_VERSION = 3;
  const ADMIN_TAB_MAX = 7;

  // Stable: SupabaseStorageConfig reports from an effect that depends on this
  // callback, so a new function on every render would report in a loop.
  const handleImageDatasetConfigChange = useCallback((hasChanges, latestConfig) => {
    setHasUnsavedImageDatasetChanges(hasChanges);
    // Store the latest config so we can save it when user clicks top Save button
    if (latestConfig) {
      setLatestImageDatasetConfig(latestConfig);
    }
  }, []);

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    // Also save current project's tab state
    if (currentProject) {
      saveCurrentProjectState({ tabValue: newValue, tabsVersion: ADMIN_TABS_VERSION });
    }
  };

  const handleNextStep = () => {
    const nextTab = Math.min(tabValue + 1, 5); // Through Results (index 5); Practice is optional
    setTabValue(nextTab);
    if (currentProject) {
      saveCurrentProjectState({ tabValue: nextTab, tabsVersion: ADMIN_TABS_VERSION });
    }
    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToAdminTab = (index) => {
    const next = Math.max(0, Math.min(Number(index) || 0, ADMIN_TAB_MAX));
    setTabValue(next);
    if (currentProject) {
      saveCurrentProjectState({ tabValue: next, tabsVersion: ADMIN_TABS_VERSION });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Save current project's state
  const saveCurrentProjectState = (updates = {}) => {
    if (!currentProject) return;
    // Never overwrite a good cached config with an empty one (a session that
    // loaded before the local API answered would otherwise poison the cache).
    const previous = loadProjectStatesFromStorage()[currentProject.id] || projectStates[currentProject.id] || {};
    const nextConfig = isUsableSurveyConfig(updates.surveyConfig)
      ? updates.surveyConfig
      : (isUsableSurveyConfig(surveyConfig) ? surveyConfig : previous.surveyConfig);
    const nextSaved = isUsableSurveyConfig(updates.lastSavedConfig)
      ? updates.lastSavedConfig
      : (isUsableSurveyConfig(lastSavedConfig) ? lastSavedConfig : previous.lastSavedConfig);
    if (!isUsableSurveyConfig(nextConfig) && !isUsableSurveyConfig(previous.surveyConfig)) return;

    const currentState = {
      ...previous,
      hasUnsavedChanges,
      tabValue,
      tabsVersion: ADMIN_TABS_VERSION,
      ...updates,
      surveyConfig: nextConfig,
      lastSavedConfig: nextSaved,
    };
    
    const newStates = {
      ...projectStates,
      [currentProject.id]: currentState
    };
    
    setProjectStates(newStates);
    saveProjectStatesToStorage(newStates);
    
    console.log('🔍 Saved project state for:', currentProject.name, currentState);
  };

  const saveProjectStateRef = useRef(saveCurrentProjectState);
  saveProjectStateRef.current = saveCurrentProjectState;
  const historyTabRef = useRef(tabValue);
  useEffect(() => {
    if (historyTabRef.current === tabValue) return;
    historyTabRef.current = tabValue;
    saveProjectStateRef.current({ tabValue, tabsVersion: ADMIN_TABS_VERSION });
  }, [tabValue]);

  // Restore project state
  const restoreProjectState = (projectId, options = {}) => {
    const { onlyWhenUnsaved = false, restoreTab = true } = options;
    // Always read from localStorage directly to avoid stale state issues
    const allStates = loadProjectStatesFromStorage();
    const savedState = allStates[projectId];
    
    if (savedState) {
      if (onlyWhenUnsaved && !savedState.hasUnsavedChanges) {
        console.log('🔍 Skip restore for clean state, load fresh from file:', projectId);
        return false;
      }
      console.log('🔍 Restoring project state for:', projectId, savedState);
      console.log('🔍 Restoring tabValue:', savedState.tabValue);
      
      setSurveyConfig(savedState.surveyConfig);
      setLastSavedConfig(savedState.lastSavedConfig);
      setHasUnsavedChanges(savedState.hasUnsavedChanges);
      if (restoreTab) {
        // v1 tabs had no Introduction (0=Media…4=Practice); savedAdminTab shifts them once.
        setTabValue(
          savedAdminTab(savedState, { tabsVersion: ADMIN_TABS_VERSION, maxTab: ADMIN_TAB_HISTORY_MAX }),
          { replace: true },
        );
      }
      return true;
    }
    
    console.log('🔍 No saved state found for:', projectId);
    return false;
  };

  // Clean up project state (after project is saved)
  const clearProjectUnsavedState = (projectId) => {
    const newStates = { ...projectStates };
    if (newStates[projectId]) {
      // Keep configuration but clear unsaved state
      newStates[projectId] = {
        ...newStates[projectId],
        hasUnsavedChanges: false,
        lastSavedConfig: newStates[projectId].surveyConfig
      };
      setProjectStates(newStates);
      saveProjectStatesToStorage(newStates);
      console.log('🔍 Cleared unsaved state for project:', projectId);
    }
    // Also clear ImageDataset unsaved changes
    setHasUnsavedImageDatasetChanges(false);
  };

  // Completely delete project state (when project is deleted)
  const removeProjectState = (projectId) => {
    const newStates = { ...projectStates };
    delete newStates[projectId];
    setProjectStates(newStates);
    saveProjectStatesToStorage(newStates);
    console.log('🔍 Removed project state for:', projectId);
  };

  const handleSurveyConfigChange = useCallback((newConfig, metadata = {}) => {
    console.log('🔍 Survey config changed, updating state...');
    console.log('🔍 New config title:', newConfig?.title);
    console.log('🔍 Pages count:', newConfig?.pages?.length);
    const persisted = metadata.persisted === true;
    const savedCopy = persisted ? JSON.parse(JSON.stringify(newConfig)) : null;
    const nextTabValue = metadata.source === 'assistant' ? 2 : tabValue;

    setSurveyConfig(newConfig);
    if (metadata.source === 'assistant') setTabValue(2);
    if (persisted) {
      setLastSavedConfig(savedCopy);
      setHasUnsavedChanges(false);
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      if (metadata.draftUpdatedAt) {
        draftUpdatedAtRef.current = metadata.draftUpdatedAt;
        setCurrentProject((prev) => prev?.id === currentProject?.id
          ? { ...prev, draftUpdatedAt: metadata.draftUpdatedAt }
          : prev);
      }
    }

    // Save current project state immediately (including new configuration)
    if (currentProject) {
      console.log('🔍 Saving updated survey config to project state...');
      setProjectStates((prev) => {
        const next = {
          ...prev,
          [currentProject.id]: {
            ...(prev[currentProject.id] || {}),
          surveyConfig: newConfig,
            tabValue: nextTabValue,
            ...(persisted ? {
              lastSavedConfig: savedCopy,
              hasUnsavedChanges: false,
            } : {}),
          },
        };
        saveProjectStatesToStorage(next);
        return next;
      });
      console.log('✅ Survey config saved to project state');
    }
  }, [currentProject, tabValue, setTabValue]);

  const assistant = useSurveyAssistant({
    currentProject,
    surveyConfig,
    onSurveyConfigChange: handleSurveyConfigChange,
    editorSelection: {
      ...(editorSelection || {}),
      panel: tabValue,
      resultsScope: tabValue === 5 ? resultsScope : null,
    },
    editorSelectionSourceRef: editorSelectionRef,
    hasUnsavedChanges,
    lastSavedConfig,
    onPrepareWrite: async (opts = {}) => {
      if (opts.surveyConfig) {
        const result = await performSaveRef.current?.({
          silent: true,
          surveyConfig: opts.surveyConfig,
          expectedDraftUpdatedAt: opts.expectedDraftUpdatedAt,
        });
        if (result && result.success === false) {
          return { ok: false, message: result.error || 'The editor draft could not be saved before the Assistant edit.' };
        }
        return { ok: true, draftUpdatedAt: result?.draftUpdatedAt };
      }
      const selection = editorSelectionRef.current || {};
      if (opts.commitWorkingCopy || selection.dirty || selection.pageDirty) {
        const merged = mergeEditorWorkingCopy(surveyConfig, selection);
        const result = await performSaveRef.current?.({
          silent: true,
          surveyConfig: merged,
        });
        if (result && result.success === false) {
          return { ok: false, message: result.error || 'The editor working copy could not be saved.' };
        }
        setEditorCommitKey((current) => current + 1);
        commitEditorSelection((current) => current ? { ...current, dirty: false, pageDirty: false } : current);
        return { ok: true, draftUpdatedAt: result?.draftUpdatedAt, committedWorkingCopy: true };
      }
      if (!hasUnsavedChangesRef.current) return { ok: true };
      const result = await performSaveRef.current?.({ silent: true });
      if (result && result.success === false) {
        return { ok: false, message: result.error || 'The editor draft could not be saved before the Assistant edit.' };
      }
      return { ok: true, draftUpdatedAt: result?.draftUpdatedAt };
    },
  });

  const openSiliconTab = useCallback(() => {
    if (!siliconEnabled) return;
    setTabValue(7);
    if (!wideLayout) setAiSidebarOpen(false);
  }, [siliconEnabled, wideLayout, setTabValue]);

  const siliconWatching = siliconEnabled && (
    tabValue === 7
    || (aiSidebarOpen && aiSidebarPanel === 'tasks')
  );
  const siliconTasks = useSiliconTasks({
    enabled: siliconEnabled,
    watch: siliconWatching,
    onTerminal: (run) => {
      setSnackbar({
        open: true,
        severity: run.status === 'completed' ? 'success' : 'info',
        message: tf(t.siliconTaskFinished, {
          project: run.project_name || run.project_id || '',
          status: run.status,
        }),
      });
    },
  });
  const collectingSurveyCount = useCollectingSurveyCount({
    userId: user?.id || null,
    refreshKey: [
      currentProject?.id || '',
      currentProject?.publishedVersion || 0,
      currentProject?.publishedAt || '',
      currentProject?.accessRole || '',
    ].join(':'),
  });

  const openTaskProject = useCallback(async (projectId) => {
    if (!projectId) return;
    const { getProjectById } = await import('./lib/projectManager');
    const project = await getProjectById(projectId);
    if (project) handleProjectSelect(project);
  }, []);

  const handleResultsConfigSync = (nextConfig) => {
    const savedCopy = JSON.parse(JSON.stringify(nextConfig));
    setSurveyConfig(nextConfig);
    setLastSavedConfig(savedCopy);
    if (currentProject) {
      setProjectStates((prev) => {
        const next = {
          ...prev,
          [currentProject.id]: {
            ...(prev[currentProject.id] || {}),
            surveyConfig: nextConfig,
            lastSavedConfig: savedCopy,
          },
        };
        saveProjectStatesToStorage(next);
        return next;
      });
    }
  };

  const handleProjectUpdate = async (updatedProject, opts = {}) => {
    console.log('🔄 Updating project:', updatedProject.name);
    console.log('🔄 Current tabValue:', tabValue);
    
    // Save current tab and state before updating (important!)
    const currentTabValue = tabValue;
    const targetIsActive = currentProjectIdRef.current === updatedProject.id;
    if (targetIsActive && currentProject && currentProject.id === updatedProject.id) {
      // Immediately save to localStorage synchronously
      const newStates = {
        ...projectStates,
        [updatedProject.id]: {
          surveyConfig,
          lastSavedConfig,
          hasUnsavedChanges,
          tabValue: currentTabValue,
          tabsVersion: ADMIN_TABS_VERSION,
        }
      };
      
      console.log('💾 Saving state with tabValue:', currentTabValue);
      saveProjectStatesToStorage(newStates);
      setProjectStates(newStates);
    }
    
    if (targetIsActive) setCurrentProject(updatedProject);

    // Batch feature jobs (L0/Seg) may pass skipSave to avoid full project write every image
    if (opts?.skipSave) return;

    try {
      const result = await saveProjectFull(updatedProject, surveyConfig);
      if (!result.success) throw new Error(result.error || 'Project save failed');
      if (currentProjectIdRef.current === updatedProject.id && result.draftUpdatedAt) {
        draftUpdatedAtRef.current = result.draftUpdatedAt;
        setCurrentProject((prev) => prev?.id === updatedProject.id
          ? { ...prev, draftUpdatedAt: result.draftUpdatedAt } : prev);
      }
      console.log('✅ Project configuration saved');
    } catch (error) {
      console.error('Error saving project:', error);
      if (opts?.throwOnError) throw error;
      setSnackbar({ open: true, severity: 'error', message: error.message || 'Project save failed' });
    }
  };

  // ✅ Simplified - only clears sessionStorage editing states
  // Theme handlers
  const handleThemeMenuClose = () => {
    setThemeMenuAnchor(null);
  };

  const handleToolsMenuOpen = (event) => {
    setToolsMenuAnchor(event.currentTarget);
  };

  const handleToolsMenuClose = () => {
    setToolsMenuAnchor(null);
  };

  const handleThemeFromTools = () => {
    setThemeMenuAnchor(toolsMenuAnchor);
    setToolsMenuAnchor(null);
  };

  const handleThemeChange = (themeKey) => {
    setCurrentTheme(themeKey);
    localStorage.setItem('sp-survey-theme', themeKey);
    handleThemeMenuClose();
    setSnackbar({
      open: true,
      message: `Theme changed to ${themes[themeKey].name} ${themes[themeKey].icon}`,
      severity: 'success'
    });
  };

  const handleCleanLocalStorage = () => {
    setConfirmDialog({
      title: 'Clear editing state',
      message:
        'Clear all temporary editing states?\n\n' +
        'This will:\n' +
        '• Clear all project editing states (sessionStorage)\n' +
        '• Reload the page to start fresh\n\n' +
        'Your saved projects will NOT be affected.',
      confirmLabel: 'Clear & reload',
      confirmColor: 'warning',
      onConfirm: () => {
        setConfirmDialog(null);
        try {
          sessionStorage.removeItem('project_editing_states');
          console.log('✅ Cleared sessionStorage editing states');

          setSnackbar({
            open: true,
            message: 'Session storage cleared. Reloading...',
            severity: 'success'
          });

          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } catch (error) {
          console.error('❌ Error cleaning session storage:', error);
          setSnackbar({
            open: true,
            message: 'Error clearing session storage: ' + error.message,
            severity: 'error'
          });
        }
      },
    });
  };

  const performSave = useCallback(async ({ silent = false, surveyConfig: overrideConfig, expectedDraftUpdatedAt } = {}) => {
    if (!currentProject || saveInFlightRef.current) return { success: false };

    const savedState = projectStates[currentProject.id];
    const latestSurveyConfig = persistSliderAliases(overrideConfig || savedState?.surveyConfig || surveyConfig);

    if (!latestSurveyConfig) return { success: false };

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    const configAtStart = surveyConfigRef.current;
    const run = (async () => {
    try {
      const projectToSave = {
        ...currentProject,
        imageDatasetConfig: latestImageDatasetConfig || currentProject.imageDatasetConfig,
      };

      const result = overrideConfig
        ? await saveProjectDraftOptimistic(currentProject.id, latestSurveyConfig, {
          expectedDraftUpdatedAt: expectedDraftUpdatedAt || currentProject.draftUpdatedAt || null,
          writer: { source: 'assistant-undo' },
        })
        : await saveProjectFull(projectToSave, latestSurveyConfig);

      if (result.success) {
        setActiveProject(currentProject.id);
        const savedProject = {
          ...projectToSave,
          draftUpdatedAt: result.draftUpdatedAt || projectToSave.draftUpdatedAt,
        };
        setCurrentProject(savedProject);
        draftUpdatedAtRef.current = savedProject.draftUpdatedAt || null;

        const savedConfig = JSON.parse(JSON.stringify(latestSurveyConfig));
        // If the researcher kept editing during the network round trip, keep
        // their newer config instead of rolling it back to the saved snapshot;
        // the dirty check then schedules another autosave for those edits.
        const editedDuringSave = !overrideConfig && surveyConfigRef.current !== configAtStart;
        setLastSavedConfig(savedConfig);
        if (!editedDuringSave) {
          setSurveyConfig(latestSurveyConfig);
          setHasUnsavedChanges(false);
        }
        setHasUnsavedImageDatasetChanges(false);
        setLatestImageDatasetConfig(null);
        setSaveStatus(editedDuringSave ? 'unsaved' : 'saved');
        setLastSavedAt(Date.now());

        const projectId = currentProject.id;
        setProjectStates((prev) => {
          if (!prev[projectId]) return prev;
          const next = {
            ...prev,
            [projectId]: editedDuringSave
              ? { ...prev[projectId], lastSavedConfig: savedConfig }
              : {
                ...prev[projectId],
                hasUnsavedChanges: false,
                surveyConfig: latestSurveyConfig,
                lastSavedConfig: savedConfig,
              },
          };
          saveProjectStatesToStorage(next);
          return next;
        });

        if (!silent) {
          setSnackbar({
            open: true,
            message: `Project "${currentProject.name}" saved successfully!`,
            severity: 'success',
          });
        }
        return { success: true, draftUpdatedAt: savedProject.draftUpdatedAt, editedDuringSave };
      }

      setSaveStatus('error');
      if (!silent) {
        const saveMessage = result.code === 'DRAFT_SAVE_RPC_MISSING'
          ? t.draftSaveRpcMissing
          : ('Save failed: ' + (result.error || 'Unknown error'));
        setSnackbar({
          open: true,
          message: saveMessage,
          severity: 'error',
        });
      }
      return { success: false, error: result.error, code: result.code };
    } catch (error) {
      console.error('❌ Save failed:', error);
      setSaveStatus('error');
      if (!silent) {
        setSnackbar({
          open: true,
          message: 'Save failed: ' + error.message,
          severity: 'error',
        });
      }
      return { success: false, error: error.message };
    } finally {
      saveInFlightRef.current = false;
    }
    })();
    savePromiseRef.current = run;
    return run;
  }, [currentProject, projectStates, surveyConfig, latestImageDatasetConfig]);

  performSaveRef.current = performSave;

  const handleManualSave = async () => {
    await performSave({ silent: false });
  };

  // True once nothing is left unsaved: waits for a save that is already
  // running, then saves the edits made since (or retries a failed save).
  const saveBeforeLeaving = async () => {
    if (!currentProject) return true;
    if (saveInFlightRef.current && savePromiseRef.current) {
      const running = await savePromiseRef.current.catch(() => null);
      if (running?.success && !running.editedDuringSave) return true;
    } else if (!hasUnsavedChangesRef.current) {
      return true;
    }
    const result = await performSaveRef.current?.({ silent: true });
    return Boolean(result?.success);
  };

  // Studio reads the stored draft, so pending edits are saved first.
  const openStudio = async () => {
    if (!(await saveBeforeLeaving())) {
      setSnackbar({ open: true, message: uiPair(language, 'Your latest changes are not saved yet. Save them, then open Studio again.', '最新的修改还没保存。请先保存，再打开工作台。'), severity: 'warning' });
      return;
    }
    navigate(studioPathForProject(currentProject?.id));
  };






  // Debounced auto-save to Supabase / file server
  useEffect(() => {
    if (!hasUnsavedChanges || !currentProject || !surveyConfig) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      performSave({ silent: true });
    }, 3000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, surveyConfig, currentProject?.id, hasUnsavedImageDatasetChanges, performSave]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges && saveStatus !== 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, saveStatus]);

  if (projectLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <AdminLoadingLabel />
      </Box>
    );
  }

  return (
    <ThemeProvider theme={theme}>
    <Box sx={{ flexGrow: 1, minHeight: '100vh', display: 'flow-root', bgcolor: 'background.default', color: 'text.primary' }}>
        <AppBar
          position="fixed"
          color="inherit"
          sx={{
            zIndex: (theme) => theme.zIndex.drawer + 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
          }}
        >
          <Toolbar sx={{ gap: { xs: 0.5, sm: 1 }, px: { xs: 1, sm: 2 }, minWidth: 0 }}>
          <Tooltip title={t.toggleSidebar}>
            <IconButton
              color="inherit"
              onClick={toggleProjectSidebar}
              data-tour="projects"
              aria-expanded={sidebarOpen}
              aria-controls="admin-project-sidebar"
              sx={{ mr: { xs: 0, sm: 1 } }}
            >
              <MenuIcon />
            </IconButton>
          </Tooltip>
          
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
            <Box>
              <Box
                data-testid="admin-logo-home"
                sx={{ display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 0, borderRadius: 1 }}
              >
                <Box
                  component="img"
                  src={theme.palette.mode === 'dark' ? '/logo-header.png' : '/logo-web-header.png'}
                  alt="SP-Survey"
                  sx={{
                    height: { xs: 26, sm: 32 },
                    width: { xs: 112, sm: 138 },
                    maxWidth: '100%',
                    objectFit: 'contain',
                    objectPosition: 'left center',
                    display: 'block',
                  }}
                />
              </Box>
            </Box>
            
            {currentProject && (
              <Box sx={{ ml: { xs: 1, sm: 1.5 }, pl: { xs: 1, sm: 1.5 }, borderLeft: 1, borderColor: 'divider', display: 'flex', minWidth: 0, flex: '1 1 140px', alignItems: 'center', overflow: 'hidden' }}>
                <FolderOpen sx={{ mr: 1, fontSize: '1.2rem', color: 'text.secondary', display: { xs: 'none', sm: 'inline-flex' }, flexShrink: 0 }} />
                <OpenProjectHeader project={currentProject} />
              </Box>
            )}
          </Box>
          
          {/* Backend Server Status Monitor — only shown in self-hosted mode */}
          {isLocalSelfHosted() && (
            <Box sx={{ mr: { xs: 0, sm: 1 } }}>
              <BackendStatus />
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: { xs: 0, sm: 1 }, flexShrink: 0 }}>
            {currentProject && (
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', lg: 'block' }, minWidth: 88, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {formatSaveStatusLabel(t, saveStatus, lastSavedAt)}
              </Typography>
            )}
            <Tooltip title={hasUnsavedChanges ? t.saveTooltipDirty : t.saveTooltip}>
              <IconButton
                type="button"
                color="inherit"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleManualSave();
                }}
                data-tour="save"
                disabled={!currentProject}
                size="small"
                sx={{
                  ...toolbarOutlineSx,
                  transition: 'all 0.3s ease',
                  ...(hasUnsavedChanges && {
                    borderColor: 'warning.main',
                    bgcolor: 'warning.main',
                    color: 'warning.contrastText',
                    '&:hover': {
                      borderColor: 'warning.dark',
                      bgcolor: 'warning.dark',
                    },
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                      '0%': { opacity: 1 },
                      '50%': { opacity: 0.8 },
                      '100%': { opacity: 1 }
                    }
                  })
                }}
              >
                <Save fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={t.previewSurvey}>
              <IconButton
                color="inherit"
                onClick={() => openOverlay('preview')}
                data-tour="preview"
                disabled={!currentProject || !surveyConfig}
                size="small"
                sx={toolbarOutlineSx}
              >
                <Preview fontSize="small" />
              </IconButton>
            </Tooltip>


            {assistantEnabled && (
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <Tooltip title={aiSidebarOpen ? t.toggleAiSidebarOpen : t.toggleAiSidebarClosed}>
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<AutoAwesome />}
                    onClick={toggleAiSidebar}
                    data-tour="ai"
                    aria-expanded={aiSidebarOpen}
                    aria-controls={AI_SIDEBAR_ID}
                    sx={{
                      ...toolbarButtonSx,
                      ml: 0.5,
                      letterSpacing: 0.4,
                      ...(aiSidebarOpen && {
                        borderColor: 'primary.main',
                        color: 'primary.main',
                        bgcolor: 'action.selected',
                      }),
                    }}
                  >
                    {t.aiLabel}
                  </Button>
                </Tooltip>
              </Box>
            )}
            {siliconEnabled && (
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <Tooltip title={t.siliconTasksTitle}>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => openAiSidebar('tasks')}
                    sx={{ ...toolbarButtonSx, ml: 0.5 }}
                  >
                    {tf(t.siliconTasksBadge, { count: siliconTasks.activeCount })}
                  </Button>
                </Tooltip>
              </Box>
            )}
            <CollectingSurveysChip
              count={collectingSurveyCount}
              onClick={() => { if (!sidebarOpen) toggleProjectSidebar(); }}
            />
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <RegionSwitcher variant="public" />
            </Box>
          </Box>

          <Tooltip title={currentProject
            ? uiPair(language, 'Open this study in Studio', '在工作台打开这个研究')
            : uiPair(language, 'Open Studio', '打开工作台')}
          >
            <Button
              color="inherit"
              size="small"
              startIcon={<SpaceDashboardOutlined />}
              onClick={openStudio}
              data-testid="admin-studio"
              sx={{
                ...toolbarButtonSx,
                ...toolbarIconUntilWideSx,
                display: { xs: 'none', sm: 'inline-flex' },
                mr: 0.5,
              }}
            >
              <ToolbarLabel>{uiPair(language, 'Studio', '工作台')}</ToolbarLabel>
            </Button>
          </Tooltip>
          

          <Tooltip title={t.viewLive}>
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline-flex' }, mr: 1, flexShrink: 0 }}>
              <Button
                color="inherit"
                size="small"
                startIcon={<OpenInNew />}
                onClick={() => {
                  if (currentProject) {
                    window.open(`/survey?project=${currentProject.id}`, '_blank');
                  } else {
                    window.open('/survey', '_blank');
                  }
                }}
                disabled={!currentProject || !surveyConfig}
                data-tour="live"
                aria-label={t.viewLive}
                sx={{
                  ...toolbarButtonSx,
                  ...toolbarIconUntilWideSx,
                  letterSpacing: 0.2,
                }}
              >
                <ToolbarLabel>{t.viewLive}</ToolbarLabel>
              </Button>
            </Box>
          </Tooltip>

          <Tooltip title={t.moreTools}>
            <IconButton
              color="inherit"
              onClick={handleToolsMenuOpen}
              data-tour="more"
              size="small"
              aria-label={t.moreTools}
              aria-controls={toolsMenuAnchor ? 'workspace-tools-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={toolsMenuAnchor ? 'true' : undefined}
              sx={toolbarOutlineSx}
            >
              <MoreVert fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Menu
        id="workspace-tools-menu"
        anchorEl={toolsMenuAnchor}
        open={Boolean(toolsMenuAnchor)}
        onClose={handleToolsMenuClose}
        PaperProps={{ sx: { mt: 1, minWidth: 240 } }}
      >
        {phoneToolbar && (
          <MenuItem onClick={() => { handleToolsMenuClose(); openStudio(); }}>
            <ListItemIcon><SpaceDashboardOutlined fontSize="small" /></ListItemIcon>
            <ListItemText primary={uiPair(language, 'Studio', '工作台')} />
          </MenuItem>
        )}
        {compactToolbar && assistantEnabled && <MenuItem onClick={() => { handleToolsMenuClose(); openAiSidebar('assistant'); }}>{t.aiLabel}</MenuItem>}
        {compactToolbar && siliconEnabled && (
          <MenuItem onClick={() => { handleToolsMenuClose(); openAiSidebar('tasks'); }}>
            {tf(t.siliconTasksBadge, { count: siliconTasks.activeCount })}
          </MenuItem>
        )}
        {compactToolbar && (
          <MenuItem onClick={() => { handleToolsMenuClose(); if (!sidebarOpen) toggleProjectSidebar(); }}>
            {tf(t.collectingSurveysBadge, { count: collectingSurveyCount })}
          </MenuItem>
        )}
        {compactToolbar && <MenuItem disabled={!currentProject || !surveyConfig} onClick={() => {
          handleToolsMenuClose();
          window.open('/survey?project=' + encodeURIComponent(currentProject.id), '_blank', 'noopener,noreferrer');
        }}>{t.viewLive}</MenuItem>}
        {compactToolbar && UI_LANGUAGES.map((item) => (
          <MenuItem key={item.id} selected={language === item.id} onClick={() => { setLanguage(item.id); handleToolsMenuClose(); }}>
            {item.nativeName}
          </MenuItem>
        ))}
        {compactToolbar && <MenuItem disabled>{formatSaveStatusLabel(t, saveStatus, lastSavedAt)}</MenuItem>}
        {compactToolbar && <Divider />}
        <MenuItem component="a" href="https://github.com/Sijie-Yang/SP-Survey" target="_blank" rel="noopener noreferrer" onClick={handleToolsMenuClose}>
          <ListItemIcon><GitHub fontSize="small" /></ListItemIcon>
          <ListItemText primary="GitHub" />
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleThemeFromTools}>
          <ListItemIcon><Palette fontSize="small" /></ListItemIcon>
          <ListItemText primary={t.changeTheme} />
        </MenuItem>
        <MenuItem onClick={() => { handleToolsMenuClose(); navigate('/templates'); }}>
          <ListItemIcon><CollectionsBookmark fontSize="small" /></ListItemIcon>
          <ListItemText primary="Template Library" />
        </MenuItem>
        <MenuItem onClick={() => { handleToolsMenuClose(); navigate('/skills'); }}>
          <ListItemIcon><EditNote fontSize="small" /></ListItemIcon>
          <ListItemText primary={t.skillsLibrary} />
        </MenuItem>
        <MenuItem onClick={() => { handleToolsMenuClose(); handleCleanLocalStorage(); }}>
          <ListItemIcon><CleaningServices fontSize="small" /></ListItemIcon>
          <ListItemText primary={t.clearEditingState} />
        </MenuItem>
      </Menu>

      {/* Theme Selector Menu */}
      <Menu
        anchorEl={themeMenuAnchor}
        open={Boolean(themeMenuAnchor)}
        onClose={handleThemeMenuClose}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 220,
            maxHeight: 400,
            '& .MuiMenuItem-root': {
              borderRadius: 1,
              mx: 0.5,
              my: 0.25,
              transition: 'all 0.2s'
            }
          }
        }}
      >
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Palette fontSize="small" />
            {t.chooseTheme}
          </Typography>
        </Box>
        {Object.entries(themes).map(([key, themeData]) => (
          <MenuItem 
            key={key}
            onClick={() => handleThemeChange(key)}
            selected={currentTheme === key}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              '&.Mui-selected': {
                bgcolor: 'primary.light',
                color: 'primary.contrastText',
                '&:hover': {
                  bgcolor: 'primary.main'
                }
              }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ fontSize: '1.2rem' }}>{themeData.icon}</Typography>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: currentTheme === key ? 'bold' : 'normal' }}>
                  {themeData.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
                  <Box 
                    sx={{ 
                      width: 16, 
                      height: 16, 
                      borderRadius: '50%', 
                      bgcolor: themeData.primary,
                      border: 1,
                      borderColor: 'divider'
                    }} 
                  />
                  <Box 
                    sx={{ 
                      width: 16, 
                      height: 16, 
                      borderRadius: '50%', 
                      bgcolor: themeData.secondary,
                      border: 1,
                      borderColor: 'divider'
                    }} 
                  />
                </Box>
              </Box>
            </Box>
            {currentTheme === key && (
              <Check fontSize="small" sx={{ ml: 1 }} />
            )}
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.5 }} />
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Theme preference is saved locally
          </Typography>
        </Box>
      </Menu>

      {/* Project Sidebar */}
      <ProjectSidebar
        id="admin-project-sidebar"
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onProjectSelect={handleProjectSelect}
        onProjectUpdate={handleProjectUpdate}
        currentProject={currentProject}
        surveyConfig={surveyConfig}
        projectStates={projectStates}
        runningProjectIds={siliconTasks.active.map((run) => run.project_id).filter(Boolean)}
        width={PROJECT_SIDEBAR_WIDTH}
      />

      {(assistantEnabled || siliconEnabled) && (
        <AiAssistantSidebar
          open={aiSidebarOpen}
          onClose={() => setAiSidebarOpen(false)}
          assistant={{
            ...assistant,
            onClearEditorFocus: () => commitEditorSelection((prev) => (
              prev ? { ...prev, pageName: null, questionName: null } : null
            )),
          }}
          onOpenSilicon={siliconEnabled ? openSiliconTab : undefined}
          variant={wideLayout ? 'persistent' : 'temporary'}
          width={AI_SIDEBAR_WIDTH}
          panel={aiSidebarPanel}
          onPanelChange={setAiSidebarPanel}
          siliconTasks={siliconEnabled ? siliconTasks : null}
          siliconEnabled={siliconEnabled}
          hideAssistant={!assistantEnabled}
          currentProjectId={currentProject?.id}
          onOpenTaskProject={openTaskProject}
        />
      )}

      <Container 
        maxWidth="xl" 
        sx={{ 
          mt: 10, // Increase top spacing to accommodate fixed AppBar
          ml: { xs: 0, md: sidebarOpen ? `${PROJECT_SIDEBAR_WIDTH}px` : 0 },
          mr: wideLayout && aiSidebarOpen ? `${AI_SIDEBAR_WIDTH}px` : 0,
          transition: 'margin 0.3s ease, width 0.3s ease',
          width: {
            xs: '100%',
            md: `calc(100% - ${(sidebarOpen ? PROJECT_SIDEBAR_WIDTH : 0) + (wideLayout && aiSidebarOpen ? AI_SIDEBAR_WIDTH : 0)}px)`,
          },
          minWidth: 0
        }}
      >
        {!currentProject ? (
          // Empty state - no project selected
          <AdminEmptyState
            icon={<FolderOpen sx={{ fontSize: '4rem' }} />}
            title={t.noProjectTitle}
            description={t.noProjectBody}
            actionLabel={t.openProjectSidebar}
            onAction={() => {
              if (!wideLayout) setAiSidebarOpen(false);
              setSidebarOpen(true);
            }}
          />
        ) : (
          // Project content
          <Paper sx={{ width: '100%' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <AdminWorkspaceTabs value={tabValue} onChange={handleTabChange} siliconEnabled={siliconEnabled} />
            </Box>

            <Suspense fallback={<AdminLoadingState label={t.loadingWorkspace} />}>
            <TabPanel value={tabValue} index={0}>
              <AdminIntroduction
                onGoToTab={goToAdminTab}
                currentProject={currentProject}
                surveyConfig={surveyConfig}
                assistantEnabled={assistantEnabled}
                siliconEnabled={siliconEnabled}
                onOpenAssistant={() => openAiSidebar('assistant')}
                onOpenProjects={() => { if (!wideLayout) setAiSidebarOpen(false); setSidebarOpen(true); }}
                onOpenPreview={surveyConfig ? () => openOverlay('preview') : undefined}
                onOpenSilicon={openSiliconTab}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
              <ImageDataset key={currentProject?.id}
                focusRequest={analysisMediaFocus?.projectId === currentProject?.id ? analysisMediaFocus : null}
                currentProject={currentProject}
                onProjectUpdate={handleProjectUpdate}
                onConfigChange={handleImageDatasetConfigChange}
                onNextStep={handleNextStep}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={2} keepMounted={builderKeepAlive}>
              {surveyConfig ? (
                <SurveyBuilder 
                  key={currentProject?.id || 'no-project'}
                  config={surveyConfig} 
                  onChange={handleSurveyConfigChange}
                  currentProject={currentProject}
                  onProjectUpdate={handleProjectUpdate}
                  onNextStep={handleNextStep}
                  hideAssistant
                  onEditorSelectionChange={commitEditorSelection}
                  onOpenAssistant={() => setAiSidebarOpen(true)}
                  onOpenLayoutStudio={() => openOverlay('layout')}
                  onOpenPreview={() => openOverlay('preview')}
                  editorCommitKey={editorCommitKey}
                />
              ) : (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography>Loading survey configuration...</Typography>
                </Box>
              )}
            </TabPanel>

            <TabPanel value={tabValue} index={3}>
              <HostSetup
                surveyConfig={surveyConfig}
                currentProject={currentProject}
                hasUnsavedChanges={hasUnsavedChanges}
                onProjectUpdate={handleProjectUpdate}
                onOpenMediaStorage={() => {
                  setAnalysisMediaFocus({ projectId: currentProject.id, scrollTo: 'supabase-storage', token: Date.now() });
                  goToAdminTab(1);
                }}
                onReleased={() => {
                  handleProjectSelect(currentProject);
                  setSnackbar({ open: true, message: uiPair(language, 'Participant snapshot released. Deploy the participant site when you are ready.', '已发布参与者快照。请继续部署参与者站点。'), severity: 'success' });
                }}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={4}>
              <ShareSurvey
                currentProject={currentProject}
                surveyConfig={surveyConfig}
                hasUnsavedChanges={hasUnsavedChanges}
                onGoToHost={() => goToAdminTab(3)}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={5}>
              <ResultsAnalysis
                onOpenMedia={(mediaId) => { setAnalysisMediaFocus({ projectId: currentProject.id, mediaId, token: Date.now() }); goToAdminTab(1); }}
                currentProject={currentProject}
                surveyConfig={surveyConfig}
                onSurveyConfigChange={handleResultsConfigSync}
                onProjectUpdated={(patch) => setCurrentProject((prev) => (prev ? { ...prev, ...patch } : prev))}
                analysisBusy={resultsAnalyzeBusy}
                onScopeChange={(scope) => setResultsScope(scope)}
                onAnalyzeCurrent={async ({ scope, overview, onSaved }) => {
                  setResultsScope(scope);
                  setResultsAnalyzeBusy(true);
                  openAiSidebar('assistant');
                  try {
                    const result = await assistant.handleSendMessage({
                      assistantMode: 'question',
                      message: [
                        'Analyze the current Results scope. Call survey_results_summary with view=overview using the provided analysisScope.',
                        'Then read any comparison or slider questions with view=question.',
                        'Write a short report: data included/excluded, quality, main findings with evidence, methods and limits.',
                        'Do not invent statistics, significance, or causal claims. Do not save or delete anything.',
                        `Scope JSON: ${JSON.stringify(scope)}`,
                        overview?.counts ? `Known counts: ${JSON.stringify(overview.counts)}` : '',
                      ].filter(Boolean).join('\n'),
                    });
                    const report = reportFromAnalysisResult(result, { scope, overview });
                    if (report) onSaved?.(report);
                  } finally {
                    setResultsAnalyzeBusy(false);
                  }
                }}
                onExplainQuestion={async ({ scope, question }) => {
                  setResultsScope(scope);
                  openAiSidebar('assistant');
                  await assistant.handleSendMessage({
                    assistantMode: 'question',
                    message: [
                      `Explain question ${question?.name || scope.questionName} in the current Results scope.`,
                      'Call survey_results_summary view=question with this questionName.',
                      'If the method is TrueSkill, explain μ, σ, ties, coverage, and why rank is not significance.',
                      'If it is a slider, explain each dimension separately.',
                      `Scope JSON: ${JSON.stringify(scope)}`,
                    ].join('\n'),
                  });
                }}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={6} keepMounted={practiceKeepAlive}>
              <ResearcherPractice
                currentProject={currentProject}
                surveyConfig={surveyConfig}
                onSurveyConfigChange={handleSurveyConfigChange}
                onSessionActiveChange={handlePracticeSessionActive}
              />
            </TabPanel>
            {siliconEnabled && (
              <TabPanel value={tabValue} index={7} keepMounted={siliconKeepAlive}>
                <SiliconSamples currentProject={currentProject} surveyConfig={surveyConfig} />
              </TabPanel>
            )}
            </Suspense>
          </Paper>
        )}
      </Container>

      {/* Original survey preview, shared by the toolbar and builder. */}
      <Dialog open={previewOpen} onClose={closeOverlay} maxWidth="lg" fullWidth>
        <DialogTitle>{t.previewSurvey}</DialogTitle>
        <DialogContent>
          <Suspense fallback={<AdminLoadingState label="Loading preview…" />}>
            {surveyConfig ? (
              <SurveyPreview config={surveyConfig} currentProject={currentProject} />
            ) : (
              <Typography>No survey configuration available</Typography>
            )}
          </Suspense>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeOverlay}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      {/* Layout Studio */}
      <Dialog open={layoutStudioOpen} onClose={closeOverlay} className="sp-studio-dialog" maxWidth={false} fullWidth PaperProps={{ sx: { maxWidth: 'none', m: 1.5, width: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)' } }}>
        <DialogTitle>{t.builderLayoutStudio}</DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <Suspense fallback={<AdminLoadingState label="Loading preview…" />}>
            {surveyConfig ? (
              <FullSurveyPreview
                config={surveyConfig}
                currentProject={currentProject}
                onConfigChange={handleSurveyConfigChange}
                onSave={() => performSave({ silent: false })}
                saveStatus={saveStatus}
                onOpenRelease={() => setTabValue(3)}
              />
            ) : (
              <Typography>No survey configuration available</Typography>
            )}
          </Suspense>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeOverlay}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>


      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'primary'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
    </ThemeProvider>
  );
}
