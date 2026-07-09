import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RegionProvider } from './contexts/RegionContext';
import RegionSwitcher from './components/admin/RegionSwitcher';
import {
  AppBar,
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
  Divider
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import {
  Preview,
  Menu as MenuIcon,
  FolderOpen,
  Save,
  CleaningServices,
  Star,
  GitHub,
  Palette,
  Check,
  EditNote,
} from '@mui/icons-material';
import { themes, createCustomTheme } from './themes/themeConfig';
import SurveyBuilder from './components/admin/SurveyBuilder';
import SurveyPreview from './components/admin/SurveyPreview';
import SystemStatus from './components/admin/SystemStatus';
import ImageDataset from './components/admin/ImageDataset';
import WebsiteSetup from './components/admin/WebsiteSetup';
import ResultsAnalysis from './components/admin/ResultsAnalysis';
import ProjectSidebar from './components/admin/ProjectSidebar';
import BackendStatus from './components/admin/BackendStatus';
import { isSupabaseConfigured } from './lib/supabase';
import { isLocalSelfHosted } from './lib/appMode';
import { API_ROOT } from './lib/apiConfig';
import { loadSurveyConfig } from './lib/surveyStorage';
import { demoSurveyConfig } from './lib/demoConfig';
import {
  migrateExistingConfig,
  getActiveProject,
  setActiveProject,
  saveProjectFull,
} from './lib/projectManager';
import { useNavigate } from 'react-router-dom';

function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`admin-tabpanel-${index}`}
      aria-labelledby={`admin-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

export default function AdminApp() {
  const navigate = useNavigate();

  // Theme state
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem('sp-survey-theme') || 'default';
  });
  const [themeMenuAnchor, setThemeMenuAnchor] = useState(null);
  const theme = createCustomTheme(currentTheme);
  
  const [tabValue, setTabValue] = useState(0);
  const [surveyConfig, setSurveyConfig] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasUnsavedImageDatasetChanges, setHasUnsavedImageDatasetChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // saved | saving | unsaved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const autoSaveTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const [latestImageDatasetConfig, setLatestImageDatasetConfig] = useState(null);
  const [lastSavedConfig, setLastSavedConfig] = useState(null);
  const [githubStars, setGithubStars] = useState(null);
  
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentProject, setCurrentProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);


  useEffect(() => {
    cleanupDemoImages();
    
    // Load project states
    const savedStates = loadProjectStatesFromStorage();
    setProjectStates(savedStates);
    
    // Initialize project system
    initializeProjectSystem();
  }, []);

  // Fetch GitHub stars count
  useEffect(() => {
    const fetchGithubStars = async () => {
      try {
        const response = await fetch('https://api.github.com/repos/Sijie-Yang/Streetscape-Perception-Survey');
        if (response.ok) {
          const data = await response.json();
          setGithubStars(data.stargazers_count);
        } else {
          setGithubStars(null);
        }
      } catch (error) {
        console.error('Failed to fetch GitHub stars:', error);
        setGithubStars(null);
      }
    };
    
    fetchGithubStars();
    // Refresh every 5 minutes
    const interval = setInterval(fetchGithubStars, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Monitor surveyConfig changes, detect unsaved changes
  useEffect(() => {
    let hasChanges = false;
    
    // Check survey config changes
    if (surveyConfig && lastSavedConfig) {
      const configChanged = JSON.stringify(surveyConfig) !== JSON.stringify(lastSavedConfig);
      console.log('🔍 Checking survey config for changes:', {
        hasConfig: !!surveyConfig,
        hasLastSaved: !!lastSavedConfig,
        configChanged,
        surveyTitle: surveyConfig?.title,
        lastSavedTitle: lastSavedConfig?.title
      });
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

  const initializeProjectSystem = async () => {
    try {
      setProjectLoading(true);
      
      // Try to migrate existing 'default' configuration to a project
      const migratedProject = await migrateExistingConfig();
      
      if (migratedProject) {
        // Load the migrated project
        setCurrentProject(migratedProject);
        
        // Try to restore saved state first
        const stateRestored = restoreProjectState(migratedProject.id);
        
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
        const activeProject = await getActiveProject();
        console.log('🔍 Active project from sessionStorage:', activeProject?.id, activeProject?.name);
        
        if (activeProject) {
          setCurrentProject(activeProject);
          
          // Try to restore saved state first (includes tabValue)
          const stateRestored = restoreProjectState(activeProject.id);
          
          if (!stateRestored) {
            // If no saved state, load from file
            const config = await loadSurveyConfig(activeProject.id);
            setSurveyConfig(config || demoSurveyConfig);
            setTabValue(0); // Default to first tab
          }
          // If state was restored, tabValue is already set by restoreProjectState
        } else {
          // No projects yet - show empty state
          console.log('🔍 No active project, showing null state');
          setSurveyConfig(null);
        }
      }
    } catch (error) {
      console.error('Error initializing project system:', error);
      setSurveyConfig(demoSurveyConfig);
    } finally {
      setProjectLoading(false);
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
        if (!isLocalSelfHosted() && isSupabaseConfigured()) {
          // Platform mode: survey config is inside project._surveyConfig
          const { getProjectById } = await import('./lib/projectManager');
          const latest = await getProjectById(project.id);
          if (latest) {
            fullProject = latest;
            if (!fileSurveyConfig) fileSurveyConfig = latest._surveyConfig;
          }
        } else {
          const response = await fetch(`${API_ROOT}/projects/${project.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              if (data.project) fullProject = data.project;
              if (!fileSurveyConfig && data.surveyConfig) fileSurveyConfig = data.surveyConfig;
            }
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

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    // Also save current project's tab state
    if (currentProject) {
      saveCurrentProjectState({ tabValue: newValue });
    }
  };

  const handleNextStep = () => {
    const nextTab = Math.min(tabValue + 1, 4); // Max to Step 5 (index 4)
    setTabValue(nextTab);
    if (currentProject) {
      saveCurrentProjectState({ tabValue: nextTab });
    }
    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Save current project's state
  const saveCurrentProjectState = (updates = {}) => {
    if (!currentProject) return;
    
    const currentState = {
      surveyConfig,
      lastSavedConfig,
      hasUnsavedChanges,
      tabValue,
      ...updates
    };
    
    const newStates = {
      ...projectStates,
      [currentProject.id]: currentState
    };
    
    setProjectStates(newStates);
    saveProjectStatesToStorage(newStates);
    
    console.log('🔍 Saved project state for:', currentProject.name, currentState);
  };

  // Restore project state
  const restoreProjectState = (projectId, options = {}) => {
    const { onlyWhenUnsaved = false } = options;
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
      setTabValue(savedState.tabValue !== undefined ? savedState.tabValue : 0);
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

  const handleSurveyConfigChange = (newConfig) => {
    console.log('🔍 Survey config changed, updating state...');
    console.log('🔍 New config title:', newConfig?.title);
    console.log('🔍 Pages count:', newConfig?.pages?.length);
    
    setSurveyConfig(newConfig);
    
    // Save current project state immediately (including new configuration)
    if (currentProject) {
      console.log('🔍 Saving updated survey config to project state...');
      // Save immediately, don't use setTimeout, pass new configuration directly
      const newStates = { ...projectStates };
      if (!newStates[currentProject.id]) {
        newStates[currentProject.id] = {
          surveyConfig: newConfig,
          lastSavedConfig: lastSavedConfig,
          hasUnsavedChanges: false,
          tabValue: tabValue
        };
      } else {
        newStates[currentProject.id] = {
          ...newStates[currentProject.id],
          surveyConfig: newConfig,
          tabValue: tabValue
        };
      }
      setProjectStates(newStates);
      saveProjectStatesToStorage(newStates);
      console.log('✅ Survey config saved to project state');
    }
  };

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

  const handleProjectUpdate = async (updatedProject) => {
    console.log('🔄 Updating project:', updatedProject.name);
    console.log('🔄 Current tabValue:', tabValue);
    
    // Save current tab and state before updating (important!)
    const currentTabValue = tabValue;
    if (currentProject && currentProject.id === updatedProject.id) {
      // Immediately save to localStorage synchronously
      const newStates = {
        ...projectStates,
        [updatedProject.id]: {
          surveyConfig,
          lastSavedConfig,
          hasUnsavedChanges,
          tabValue: currentTabValue
        }
      };
      
      console.log('💾 Saving state with tabValue:', currentTabValue);
      saveProjectStatesToStorage(newStates);
      setProjectStates(newStates);
    }
    
    setCurrentProject(updatedProject);

    try {
      await saveProjectFull(updatedProject, surveyConfig);
      console.log('✅ Project configuration saved');
    } catch (error) {
      console.error('Error saving project:', error);
    }
  };

  // ✅ Simplified - only clears sessionStorage editing states
  // Theme handlers
  const handleThemeMenuOpen = (event) => {
    setThemeMenuAnchor(event.currentTarget);
  };

  const handleThemeMenuClose = () => {
    setThemeMenuAnchor(null);
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
    const confirmMessage = 'Clear all temporary editing states?\n\n' +
      'This will:\n' +
      '• Clear all project editing states (sessionStorage)\n' +
      '• Reload the page to start fresh\n\n' +
      'Your saved projects will NOT be affected.\n\n' +
      'Continue?';
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    try {
      // Clear sessionStorage editing states
      sessionStorage.removeItem('project_editing_states');
      console.log('✅ Cleared sessionStorage editing states');
      
      setSnackbar({
        open: true,
        message: 'Session storage cleared. Reloading...',
        severity: 'success'
      });
      
      // Reload page after a short delay
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
  };

  const performSave = useCallback(async ({ silent = false } = {}) => {
    if (!currentProject || saveInFlightRef.current) return { success: false };

    const savedState = projectStates[currentProject.id];
    const latestSurveyConfig = savedState?.surveyConfig || surveyConfig;

    if (!latestSurveyConfig) return { success: false };

    saveInFlightRef.current = true;
    setSaveStatus('saving');

    try {
      const projectToSave = {
        ...currentProject,
        imageDatasetConfig: latestImageDatasetConfig || currentProject.imageDatasetConfig,
      };

      const result = await saveProjectFull(projectToSave, latestSurveyConfig);

      if (result.success) {
        setActiveProject(currentProject.id);
        setCurrentProject(projectToSave);

        const savedConfig = JSON.parse(JSON.stringify(latestSurveyConfig));
        setLastSavedConfig(savedConfig);
        setSurveyConfig(latestSurveyConfig);
        setHasUnsavedChanges(false);
        setHasUnsavedImageDatasetChanges(false);
        setLatestImageDatasetConfig(null);
        setSaveStatus('saved');
        setLastSavedAt(Date.now());

        const newStates = { ...projectStates };
        if (newStates[currentProject.id]) {
          newStates[currentProject.id] = {
            ...newStates[currentProject.id],
            hasUnsavedChanges: false,
            surveyConfig: latestSurveyConfig,
            lastSavedConfig: savedConfig,
          };
          setProjectStates(newStates);
          saveProjectStatesToStorage(newStates);
        }

        if (!silent) {
          setSnackbar({
            open: true,
            message: `Project "${currentProject.name}" saved successfully!`,
            severity: 'success',
          });
        }
        return { success: true };
      }

      setSaveStatus('error');
      if (!silent) {
        setSnackbar({
          open: true,
          message: 'Save failed: ' + (result.error || 'Unknown error'),
          severity: 'error',
        });
      }
      return { success: false, error: result.error };
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
  }, [currentProject, projectStates, surveyConfig, latestImageDatasetConfig]);

  const handleManualSave = async () => {
    await performSave({ silent: false });
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

  const formatSaveStatusLabel = () => {
    if (saveStatus === 'saving') return 'Saving…';
    if (saveStatus === 'error') return 'Save failed — click Save to retry';
    if (saveStatus === 'unsaved') return 'Unsaved changes';
    if (lastSavedAt) {
      const secs = Math.floor((Date.now() - lastSavedAt) / 1000);
      if (secs < 10) return 'Auto-saved just now';
      if (secs < 60) return `Auto-saved ${secs}s ago`;
      return `Auto-saved ${Math.floor(secs / 60)}m ago`;
    }
    return 'All changes saved';
  };



  if (projectLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>Loading project system...</Typography>
      </Box>
    );
  }

  return (
    <RegionProvider>
    <ThemeProvider theme={theme}>
    <Box sx={{ flexGrow: 1 }}>
        <AppBar 
          position="fixed" 
          sx={{ 
            zIndex: (theme) => theme.zIndex.drawer + 1,
            bgcolor: 'primary.main',
            transition: 'background-color 0.3s ease',
            '&:hover': {
              bgcolor: 'primary.dark'
            }
          }}
        >
          <Toolbar>
          <Tooltip title="Toggle Project Sidebar">
            <IconButton
              color="inherit"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          </Tooltip>
          
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
            <Box
              component="img"
              src="/logo-header.png"
              alt="SP-Survey"
              sx={{
                height: '35px',
                objectFit: 'contain'
              }}
            />
            
            {/* Custom GitHub Stars Badge */}
            <Box
              component="a"
              href="https://github.com/Sijie-Yang/Streetscape-Perception-Survey"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                ml: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.1) 100%)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                '&:hover': {
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.2) 100%)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  '& .github-icon': {
                    transform: 'rotate(360deg)'
                  },
                  '& .star-icon': {
                    transform: 'scale(1.2) rotate(72deg)',
                    filter: 'drop-shadow(0 0 6px #ffd700)'
                  }
                }
              }}
            >
              <GitHub 
                className="github-icon"
                sx={{ 
                  fontSize: '1.1rem',
                  transition: 'transform 0.6s ease'
                }} 
              />
              <Star 
                className="star-icon"
                sx={{ 
                  fontSize: '1rem',
                  color: '#ffd700',
                  filter: 'drop-shadow(0 0 3px rgba(255, 215, 0, 0.6))',
                  transition: 'all 0.3s ease'
                }} 
              />
              <Typography 
                variant="body2" 
                sx={{ 
                  fontWeight: 'bold',
                  fontSize: '0.85rem',
                  lineHeight: 1
                }}
              >
                {githubStars !== null ? githubStars : '...'}
              </Typography>
            </Box>
            
            {currentProject && (
              <Box sx={{ ml: 2, display: 'flex', alignItems: 'center' }}>
                <FolderOpen sx={{ mr: 1, fontSize: '1.2rem' }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {currentProject.name}
                </Typography>
              </Box>
            )}
          </Box>
          
          {/* Backend Server Status Monitor — only shown in self-hosted mode */}
          {!process.env.REACT_APP_SUPABASE_URL && (
            <Box sx={{ mr: 2 }}>
              <BackendStatus />
            </Box>
          )}

          {/* Region / Language Switcher */}
          <Box sx={{ mr: 1 }}>
            <RegionSwitcher />
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
            {currentProject && (
              <Typography variant="caption" sx={{ opacity: 0.9, minWidth: 140, textAlign: 'right' }}>
                {formatSaveStatusLabel()}
              </Typography>
            )}
            <Tooltip title={hasUnsavedChanges ? "Save unsaved changes" : "Save project configuration"}>
              <IconButton
                type="button"
                color="inherit"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleManualSave();
                }}
                disabled={!currentProject}
                size="small"
                sx={{ 
                  border: 1,
                  borderColor: hasUnsavedChanges ? 'warning.main' : 'rgba(255, 255, 255, 0.5)',
                  bgcolor: hasUnsavedChanges ? 'warning.main' : 'transparent',
                  color: hasUnsavedChanges ? 'warning.contrastText' : 'inherit',
                  '&:hover': hasUnsavedChanges ? {
                    borderColor: 'warning.dark',
                    bgcolor: 'warning.dark'
                  } : {
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    bgcolor: 'rgba(255, 255, 255, 0.1)'
                  },
                  transition: 'all 0.3s ease',
                  ...(hasUnsavedChanges && {
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
            
            <Tooltip title="Clear session editing states (sessionStorage)">
              <IconButton
                color="inherit"
                onClick={handleCleanLocalStorage}
                size="small"
                sx={{
                  border: 1,
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  '&:hover': {
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    bgcolor: 'rgba(255, 255, 255, 0.1)'
                  }
                }}
              >
                <CleaningServices fontSize="small" />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Change Theme">
              <IconButton
                color="inherit"
                onClick={handleThemeMenuOpen}
                size="small"
                sx={{
                  border: 1,
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  '&:hover': {
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    bgcolor: 'rgba(255, 255, 255, 0.1)'
                  }
                }}
              >
                <Palette fontSize="small" />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Preview Survey">
              <IconButton
                color="inherit"
                onClick={() => setPreviewOpen(true)}
                disabled={!currentProject || !surveyConfig}
                size="small"
                sx={{
                  border: 1,
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  '&:hover': {
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    bgcolor: 'rgba(255, 255, 255, 0.1)'
                  }
                }}
              >
                <Preview fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          
          <Button
            color="inherit"
            onClick={() => {
              if (currentProject) {
                window.open(`/survey?project=${currentProject.id}`, '_blank');
              } else {
                window.open('/survey', '_blank');
              }
            }}
            disabled={!currentProject || !surveyConfig}
            sx={{
              bgcolor: 'rgba(255,255,255,0.1)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
              fontWeight: 'bold',
              px: 2,
              mr: 1,
            }}
          >
            🚀 View Live Survey
          </Button>

          <Tooltip title="我的 Skill 库">
            <IconButton
              color="inherit"
              onClick={() => navigate('/skills')}
              size="small"
              sx={{ mr: 1, border: 1, borderColor: 'rgba(255,255,255,0.4)', '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' } }}
            >
              <EditNote fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

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
            Choose Theme
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
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onProjectSelect={handleProjectSelect}
        onProjectUpdate={handleProjectUpdate}
        currentProject={currentProject}
        surveyConfig={surveyConfig}
        projectStates={projectStates}
        width={400}
      />

      <Container 
        maxWidth="xl" 
        sx={{ 
          mt: 10, // Increase top spacing to accommodate fixed AppBar
          ml: sidebarOpen ? '400px' : 0,
          transition: 'margin-left 0.3s ease',
          width: sidebarOpen ? 'calc(100% - 400px)' : '100%'
        }}
      >
        {!currentProject ? (
          // Empty state - no project selected
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <FolderOpen sx={{ fontSize: '4rem', color: 'text.secondary', mb: 2 }} />
            <Typography variant="h5" sx={{ mb: 2 }}>
              No Project Selected
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Create a new project or select an existing one from the sidebar to get started.
            </Typography>
            <Button
              variant="contained"
              startIcon={<MenuIcon />}
              onClick={() => setSidebarOpen(true)}
              size="large"
            >
              Open Project Sidebar
            </Button>
          </Paper>
        ) : (
          // Project content
          <Paper sx={{ width: '100%' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs value={tabValue} onChange={handleTabChange} aria-label="admin tabs" variant="scrollable" scrollButtons="auto">
                <Tab label="Step 1 - Image Dataset" />
                <Tab label="Step 2 - Survey Builder" />
                <Tab label="Step 3 - Server Setup" />
                <Tab label="Step 4 - Website Deployment" />
                <Tab label="Step 5 - Results Analysis" />
              </Tabs>
            </Box>

            <TabPanel value={tabValue} index={0}>
              <ImageDataset 
                currentProject={currentProject}
                onProjectUpdate={handleProjectUpdate}
                onConfigChange={(hasChanges, latestConfig) => {
                  console.log('🔍 ImageDataset config changed, hasChanges:', hasChanges);
                  setHasUnsavedImageDatasetChanges(hasChanges);
                  // Store the latest config so we can save it when user clicks top Save button
                  if (latestConfig) {
                    setLatestImageDatasetConfig(latestConfig);
                  }
                }}
                onNextStep={handleNextStep}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
              {surveyConfig ? (
                <SurveyBuilder 
                  key={currentProject?.id || 'no-project'}
                  config={surveyConfig} 
                  onChange={handleSurveyConfigChange}
                  currentProject={currentProject}
                  onNextStep={handleNextStep}
                />
              ) : (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography>Loading survey configuration...</Typography>
                </Box>
              )}
            </TabPanel>

            <TabPanel value={tabValue} index={2}>
              <SystemStatus
                surveyConfig={surveyConfig}
                currentProject={currentProject}
                onProjectUpdate={handleProjectUpdate}
                onNextStep={handleNextStep}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={3}>
              <WebsiteSetup
                currentProject={currentProject}
                surveyConfig={surveyConfig}
              />
            </TabPanel>

            <TabPanel value={tabValue} index={4}>
              <ResultsAnalysis
                currentProject={currentProject}
                surveyConfig={surveyConfig}
                onSurveyConfigChange={handleResultsConfigSync}
              />
            </TabPanel>
          </Paper>
        )}
      </Container>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          📋 Survey Preview - Exact Live Survey Replica
        </DialogTitle>
        <DialogContent>
          {surveyConfig ? (
            <SurveyPreview config={surveyConfig} currentProject={currentProject} />
          ) : (
            <Typography>No survey configuration available</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>


      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
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
    </Box>
    </ThemeProvider>
    </RegionProvider>
  );
}
