import ParticipantSurveySurface from './components/ParticipantSurveySurface';
import { submitWithRecovery } from './lib/recoverableSubmission';
import { handleSurveyMediaError } from './lib/mediaRecovery';
import { surveyRevision } from './lib/surveyRevision';
import React, { useState, useEffect, useRef } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography } from '@mui/material';
import { saveSurveyResponse, isSupabaseConfigured } from './lib/supabase';
import {
  findDraftForProject, saveDraft, clearDraft, clearDraftByKey, clearAllDraftsForProject,
  findPendingSubmission, clearPendingSubmission, clearPendingByKey,
  restoreDraftSurveyJson,
} from './lib/surveyDraft';
import { surveyJson, displayedImages } from './config/questions';
import { surveyConfig } from './config/surveyConfig';
import { themeJson } from "./theme";
import { loadSurveyConfig, convertToSurveyJS, generateCustomTheme, normalizeBuilderSurveyJson } from './lib/surveyStorage';
import {
  deploymentConfig,
  getPreloadedImages,
  isDeployedParticipant,
} from './config/deploymentConfig';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget,
  registerAllExtendedWidgets, captureSkillPreviewAnswers,
} from './components/SurveyCustomComponents';
import { getBrowserId, generateCompletionCode } from './lib/browserId';
import { countProjectResponses, fetchPairStats } from './lib/surveyPublicApi';
import {
  isRandomMediaQuestion, defaultMediaCount, filterPoolForQuestion, applyMediaToElement, resolveSkillQuestions,
  ensureSkillDemoMedia, pickMediaForQuestion, trackMediaAssignment, getImageKey, usesSetMediaAssignment,
  applyMediaAssignmentToElement, hasMediaSlots,
  usesCategoryMediaAssignment, buildMediaAssignmentLogEntry, shouldInjectMedia, applyCuratedMediaIfNeeded,
  resolveMediaFolderTags, pickTrialMediaSetsForQuestion, syncInjectedMediaOntoSurveyModel,
  clearInjectedMediaStore,
} from './lib/surveyMediaInjection';
import { getSkillMediaUrls } from './lib/skillMediaUtils';
import { enrichSurveyResponses } from './lib/enrichSurveyResponses';
import {
  clearTrialsAnswerStore,
  collectSurveyDataWithTrials,
  getTrialCount,
  rehydrateTrialsAnswerStoreFromSurvey,
} from './lib/trialNavigation';
import { SurveyTrialNavProvider } from './contexts/SurveyTrialNavContext';
import { applySurveyLocale, surveyUiStrings, resolveSurveyJsLocale, completionMessageForLocale } from './lib/surveyLocale';
import { tf } from './contexts/adminI18n';
import SurveyProgressBridge, {
  normalizeShowProgressBar,
} from './components/SurveyProgressBridge';

/** Fail-open if Supabase / network stalls (keeps Live Survey from hanging on one RPC). */
function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

export default function SurveyApp() {
  const [surveyModel, setSurveyModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading survey…');
  const [error, setError] = useState(null);
  const [useAdminConfig, setUseAdminConfig] = useState(true); // Use admin config by default
  const [adminConfigExists, setAdminConfigExists] = useState(false);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [displayedImagesMap, setDisplayedImagesMap] = useState({}); // Track displayed images for each question
  const [currentProjectId, setCurrentProjectId] = useState(null); // Track current project ID
  const [repeatProgress, setRepeatProgress] = useState(null);
  const [surveyPhase, setSurveyPhase] = useState('loading'); // loading | active | submitting | completed | submit-error | closed
  const [completionInfo, setCompletionInfo] = useState(null);
  const [quotaClosed, setQuotaClosed] = useState(false);
  const [liveClosedMessage, setLiveClosedMessage] = useState(null);
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const [recoverySaved, setRecoverySaved] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const submissionInFlight = useRef(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [resumeDialog, setResumeDialog] = useState(null);
  const [completionMessage, setCompletionMessage] = useState('');
  const repeatSessionRef = useRef(null);
  const repeatParticipantRef = useRef(null);
  const repeatAttemptRef = useRef(1);
  const participantIdRef = useRef(null);
  const draftSaveTimerRef = useRef(null);
  const draftSavingEnabledRef = useRef(true);
  const resumeChoiceRef = useRef(null);
  const projectIdRef = useRef(null);
  const displayedImagesRef = useRef({}); // Use ref to ensure onComplete has access to latest value
  const displayedMediaGroupsRef = useRef({});
  const displayedMediaSlotsRef = useRef({});
  const displayedMediaCategoriesRef = useRef({});
  const surveyStartedAtRef = useRef(null);
  const pageEnteredAtRef = useRef(null);
  const pageTimingRef = useRef({});
  const pairStatsRef = useRef(null);
  const lastPageNameRef = useRef(null);
  const submissionGuardRef = useRef(false);
  const progressChromeEnabledRef = useRef(true);
  const surveyThemeRef = useRef(null);
  const surveyPhaseRef = useRef('loading');
  const finalSurveyJsonRef = useRef(null);
  const imageTrackerRef = useRef({});
  const participantLocale = surveyModel || resumeDialog?.model || finalSurveyJsonRef.current || pendingSubmission?.survey_metadata?.survey_response_contract;
  const participantText = surveyUiStrings(participantLocale);

  useEffect(() => {
    surveyPhaseRef.current = surveyPhase;
  }, [surveyPhase]);

  // Monitor URL changes and reinitialize when project ID changes
  useEffect(() => {
    const checkUrlChange = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || 'default';
      
      if (currentProjectId !== projectId && currentProjectId !== null) {
        console.log(`🔄 Project ID changed from ${currentProjectId} to ${projectId}, reloading...`);
        setCurrentProjectId(projectId);
        initializeSurvey();
      } else if (currentProjectId === null) {
        setCurrentProjectId(projectId);
      }
    };

    // Check immediately
    checkUrlChange();

    // Also listen for popstate (browser back/forward) and hashchange
    window.addEventListener('popstate', checkUrlChange);
    
    // Check periodically as a fallback (every 10 seconds to avoid rate limits)
    const interval = setInterval(checkUrlChange, 10000);

    return () => {
      window.removeEventListener('popstate', checkUrlChange);
      clearInterval(interval);
    };
  }, [currentProjectId]);

  useEffect(() => {
    console.log('🔄 SurveyApp mounted or useAdminConfig changed, initializing survey...');
    initializeSurvey();
  }, [useAdminConfig]);

  // Flush draft on hide; never blind-reinitialize an active / submit-error session.
  useEffect(() => {
    const flushDraftNow = () => {
      if (!draftSavingEnabledRef.current) return;
      if (!projectIdRef.current || !participantIdRef.current || !surveyModel) return;
      if (!finalSurveyJsonRef.current) return;
      cancelPendingDraftSave();
      try {
        saveDraft(projectIdRef.current, participantIdRef.current, {
          surveyData: collectSurveyDataWithTrials(surveyModel),
          currentPageNo: surveyModel.currentPageNo,
          displayedImages: { ...(displayedImagesRef.current || {}) },
          displayedMediaGroups: { ...(displayedMediaGroupsRef.current || {}) },
          displayedMediaCategories: { ...(displayedMediaCategoriesRef.current || {}) },
          finalSurveyJson: JSON.parse(JSON.stringify(finalSurveyJsonRef.current)),
        });
      } catch (err) {
        console.warn('flushDraftNow failed:', err?.message || err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushDraftNow();
        return;
      }
      if (document.visibilityState !== 'visible' || !surveyModel) return;
      const phase = surveyPhaseRef.current;
      // Active answering / retry must keep the same stimulus set.
      if (phase === 'active' || phase === 'submit-error' || phase === 'submitting') {
        flushDraftNow();
        return;
      }
      const timeSinceLastLoad = Date.now() - (window.lastSurveyLoadTime || 0);
      if (timeSinceLastLoad > 30 * 60 * 1000) {
        console.log('⏰ Survey data is stale (>30min) and not in an active session, reloading...');
        flushDraftNow();
        initializeSurvey();
      }
    };

    const handlePageHide = () => { flushDraftNow(); };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [surveyModel]);

  // ✅ No longer monitoring localStorage (using sessionStorage now)
  useEffect(() => {
    const handleStorageChange = (e) => {
      // Get current project ID
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || 'default';
      
      if (e.key === `survey_config_${projectId}` && useAdminConfig) {
        if (['active', 'submitting', 'submit-error'].includes(surveyPhaseRef.current)) {
          return;
        }
        console.log(`Project ${projectId} configuration updated, reloading survey...`);
        initializeSurvey();
      }
    };

    // Listen to storage events
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [useAdminConfig]);

  const submitSurveyResponse = async (completeData, { isRepeatMode, repeatTotal, attemptIndex }) => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    const result = await submitWithRecovery(projectIdRef.current, completeData, {
      isRepeatMode: !!isRepeatMode, repeatTotal: repeatTotal || 1, attemptIndex: attemptIndex || 1,
    }, saveSurveyResponse);
    submissionInFlight.current = false;
    setRecoverySaved(result.recoverySaved);
    if (result.success) {
      // Only clear drafts AFTER a successful save (including idempotent dedupe).
      discardDraftForProject(projectIdRef.current, completeData.participant_id);
      clearPendingSubmission(projectIdRef.current, completeData.participant_id);
      if (isRepeatMode && attemptIndex < repeatTotal) {
        submissionGuardRef.current = false;
        draftSavingEnabledRef.current = true;
        repeatAttemptRef.current = attemptIndex + 1;
        setRepeatProgress({ current: repeatAttemptRef.current, total: repeatTotal });
        setSurveyModel(null);
        setSurveyPhase('loading');
        setLoading(true);
        resumeChoiceRef.current = 'fresh';
        setTimeout(() => initializeSurvey({ skipDraftCheck: true }), 300);
        return;
      }
      participantIdRef.current = null;
      setSurveyPhase('completed');
      setCompletionInfo({
        participantId: completeData.participant_id,
        completionCode: completeData.survey_metadata?.completion_code,
        storage: result.storage,
        isRepeatMode,
        repeatTotal,
      });
      setPendingSubmission(null);
      if (isRepeatMode) setRepeatProgress(null);
      return;
    }
    submissionGuardRef.current = false;
    setPendingSubmission(completeData);
    setSurveyPhase('submit-error');
  };

  const cancelPendingDraftSave = () => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  };

  const discardDraftForProject = (projectId, participantId) => {
    if (participantId) clearDraft(projectId, participantId);
    clearAllDraftsForProject(projectId);
  };

  const scheduleDraftSave = (model, imageTracker, finalSurveyJson) => {
    if (!draftSavingEnabledRef.current) return;
    if (!projectIdRef.current || !participantIdRef.current) return;
    cancelPendingDraftSave();
    draftSaveTimerRef.current = setTimeout(() => {
      if (!draftSavingEnabledRef.current) return;
      saveDraft(projectIdRef.current, participantIdRef.current, {
        surveyData: collectSurveyDataWithTrials(model),
        currentPageNo: model.currentPageNo,
        displayedImages: { ...imageTracker },
        displayedMediaGroups: { ...(displayedMediaGroupsRef.current || {}) },
        displayedMediaCategories: { ...(displayedMediaCategoriesRef.current || {}) },
        finalSurveyJson: JSON.parse(JSON.stringify(finalSurveyJson)),
      });
    }, 800);
  };

  const initializeSurvey = async (options = {}) => {
    try {
      submissionGuardRef.current = false;
      draftSavingEnabledRef.current = true;
      cancelPendingDraftSave();
      clearTrialsAnswerStore();
      clearInjectedMediaStore();
      setLoading(true);
      setLoadingMessage('Loading survey…');
      
      // Register custom components
      registerImageRankingWidget();
      registerImageRatingWidget();
      registerImageBooleanWidget();
      registerImageMatrixWidget();
      registerAllExtendedWidgets();
      setLoadingMessage('Preparing questions and media…');
      let finalSurveyJson;
      let finalDisplayedImages = displayedImages;
      const imageTracker = {}; // Track displayed images for each question
      const mediaGroupTracker = {}; // questionName -> groupId (for paired assignment)
      const mediaCategoryTracker = {}; // questionName -> category[] (one-per-category mode)
      const mediaSlotTracker = {}; // questionName -> shown_media slots[]
      const globallyUsedImageKeys = new Set();
      const globallyUsedGroupKeys = new Set();
      const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
      const finalizeMediaSelection = (element, pool, preselected) => {
        const folderTags = resolveMediaFolderTags(projectData, projectData?.config);
        if (
          preselected?.length
          && !hasMediaSlots(element)
          && !usesSetMediaAssignment(element)
          && !usesCategoryMediaAssignment(element)
        ) {
          const imageCount = element.imageCount || defaultMediaCount(element);
          const excludeUsed = shouldExcludePreviouslyUsedImages(element);
          let selected = preselected;
          if (excludeUsed) {
            selected = preselected.filter((image) => {
              const key = getImageKey(image);
              return key && !globallyUsedImageKeys.has(key);
            }).slice(0, imageCount);
          } else {
            selected = preselected.slice(0, imageCount);
          }
          const assignment = {
            images: selected, flatMedia: selected, slots: selected.map((img, i) => ({
              slotId: `legacy_${i}`, role: 'stimulus',
              type: img.type, url: img.url, name: img.name,
              media_id: img.media_id || img.key || img.name,
            })),
            groupKey: null, groupId: null, setKey: null, setId: null,
          };
          trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
          return assignment;
        }
        const assignment = pickMediaForQuestion(
          pool,
          element,
          globallyUsedImageKeys,
          globallyUsedGroupKeys,
          pairStatsRef.current,
          folderTags,
        );
        // Slot path already tracks keys; legacy still needs trackMediaAssignment
        if (!hasMediaSlots(element)) {
          trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
        }
        return assignment;
      };

      // Get project ID from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || 'default';
      projectIdRef.current = projectId;
      
      if (!participantIdRef.current) {
        participantIdRef.current = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      }
      
      // Failed submission recovery (refresh after submit-error)
      const pendingFound = !options.skipDraftCheck ? findPendingSubmission(projectId) : null;
      if (pendingFound?.pending?.completeData && !options.resumeDraft) {
        participantIdRef.current = pendingFound.pending.participantId
          || pendingFound.pending.completeData.participant_id
          || participantIdRef.current;
        setPendingSubmission(pendingFound.pending.completeData);
        setSurveyPhase('submit-error');
        setLoading(false);
        resumeChoiceRef.current = null;
        return;
      }

      console.log('📂 Loading survey for project:', projectId);

      const deployed = typeof isDeployedParticipant === 'function'
        ? isDeployedParticipant()
        : !!deploymentConfig;

      // Load project object (including Supabase configuration)
      let projectData = null;
      let adminConfig = null;
      if (deployed && deploymentConfig) {
        const snapshot = JSON.parse(JSON.stringify(deploymentConfig));
        if (snapshot.id && projectId === 'default') {
          projectIdRef.current = snapshot.id;
        }
        adminConfig = snapshot;
        projectData = {
          id: snapshot.id || projectIdRef.current,
          name: snapshot.name || snapshot.title,
          preloadedImages: Array.isArray(snapshot.preloadedImages) && snapshot.preloadedImages.length
            ? snapshot.preloadedImages
            : getPreloadedImages(),
          mediaFolderTags: snapshot.mediaFolderTags || {},
          imageDatasetConfig: { mediaFolderTags: snapshot.mediaFolderTags || {} },
          _surveyConfig: snapshot,
          publishedVersion: snapshot.publishedVersion || 0,
        };
      } else {
        try {
          const { getParticipantProject } = await import('./lib/projectManager');
          projectData = await getParticipantProject(projectId);
        } catch (error) {
          console.error('❌ Error loading project data:', error);
          if (isSupabaseConfigured()) throw error;
        }
        adminConfig = projectData?._surveyConfig || await loadSurveyConfig(projectId, { live: true });
      }
      setCompletionMessage(adminConfig?.completionMessage || '');

      setLiveClosedMessage(null);

      // Response quota gate
      const responseQuota = Number(adminConfig?.responseQuota) || 0;
      if (responseQuota > 0) {
        setLoadingMessage('Checking response quota…');
        const currentCount = await withTimeout(countProjectResponses(projectId), 8000, null);
        if (currentCount != null && currentCount >= responseQuota) {
          setQuotaClosed(true);
          setSurveyPhase('closed');
          setLoading(false);
          return;
        }
      }
      setQuotaClosed(false);

      // Pair stats for adaptive/balanced pairing (best-effort)
      setLoadingMessage('Preparing questions and media…');
      pairStatsRef.current = await withTimeout(fetchPairStats(projectId), 8000, null);
      
      // Build runtime Supabase config from project sources on the local researcher machine only.
      // The deployed participant site uses REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY.
      const runtimeSupabaseConfig = deployed ? null : (() => {
        if (projectData?.supabaseConfig?.enabled && projectData?.supabaseConfig?.url && projectData?.supabaseConfig?.secretKey) {
          return {
            enabled: true,
            url: projectData.supabaseConfig.url,
            secretKey: projectData.supabaseConfig.secretKey
          };
        }
        if (projectData?.imageDatasetConfig?.supabaseUrl && projectData?.imageDatasetConfig?.supabaseKey) {
          return {
            enabled: true,
            url: projectData.imageDatasetConfig.supabaseUrl,
            secretKey: projectData.imageDatasetConfig.supabaseKey
          };
        }
        return null;
      })();

      // If runtime config exists, set it to global supabase_config
      if (runtimeSupabaseConfig) {
        console.log('🔗 Loading Supabase config for project:', projectId);
        console.log('📍 Supabase URL:', runtimeSupabaseConfig.url);
        console.log('🔑 Has Secret Key:', !!runtimeSupabaseConfig.secretKey);
        try {
          // ✅ Save to sessionStorage (session-only)
          sessionStorage.setItem('supabase_config', JSON.stringify(runtimeSupabaseConfig));
          console.log('✅ Supabase config saved to sessionStorage');
          
          // Re-initialize Supabase client
          const { reinitializeSupabase } = await import('./lib/supabase');
          const client = reinitializeSupabase();
          if (client) {
            console.log('✅ Supabase client reinitialized successfully for project:', projectId);
          } else {
            console.warn('⚠️ Supabase client initialization returned null');
          }
        } catch (error) {
          console.error('❌ Error setting up Supabase for survey:', error);
        }
      } else {
        console.warn('⚠️ No Supabase config found or not enabled for project:', projectId);
        if (projectData) {
          console.log('📊 Project exists but no usable Supabase settings in supabaseConfig/imageDatasetConfig');
        } else {
          console.log('❌ Project data is null - project may not exist');
        }
      }
      
      // Resume path: rebuild from the exact survey JSON that was answered (same stimuli).
      const resumeDraft = options.resumeDraft || null;
      if (resumeDraft?.finalSurveyJson) {
        finalSurveyJson = restoreDraftSurveyJson(resumeDraft, adminConfig);
        setAdminConfigExists(true);
        setLoadingMessage('Restoring previous session…');
        if (resumeDraft.participantId) {
          participantIdRef.current = resumeDraft.participantId;
        }
      } else if (useAdminConfig && adminConfig) {
        // Directly use admin configuration (already in standard SurveyJS format)
        // Use deep copy to avoid modifying the original config
        finalSurveyJson = JSON.parse(JSON.stringify(adminConfig));
        setLoadingMessage('Resolving interactive skills…');
        await resolveSkillQuestions(finalSurveyJson);

        // Self-hosted Live Survey uses the project's Media Dataset only.
        let mediaPool = Array.isArray(projectData?.preloadedImages)
          ? projectData.preloadedImages.filter(Boolean)
          : [];
        setLoadingMessage(
          mediaPool.length ? 'Assigning project media…' : 'Preparing survey…',
        );
        
        // Process image questions and convert imageranking to ranking for SurveyJS
        if (finalSurveyJson.pages) {
          for (const page of finalSurveyJson.pages) {
            if (page.elements) {
              for (const element of page.elements) {
                // Keep imageranking as is - it will be handled by our custom component
                if (element.type === 'imageranking') {
                  // Default to "contain" so images keep their natural aspect ratio
                  element.imageFit = element.imageFit || "contain";
                  
                  // Clean up any unwanted description text that might have been added
                  if (element.description && element.description.includes('Please select all images in your preferred order')) {
                    element.description = element.description.replace(/\n\nPlease select all images in your preferred order.*$/g, '').trim();
                    if (!element.description) {
                      delete element.description;
                    }
                  }
                }

                // Keep imagerating as is - it will be handled by our custom component
                if (element.type === 'imagerating') {
                  element.imageFit = element.imageFit || "contain";
                }

                // Keep imageboolean as is - it will be handled by our custom component
                if (element.type === 'imageboolean') {
                  element.imageFit = element.imageFit || "contain";
                }

                // Handle image display questions
                if (element.type === 'image') {
                  element.imageFit = element.imageFit || "contain";
                }
                
                // Handle imagematrix questions
                if (element.type === 'imagematrix') {
                  element.imageFit = element.imageFit || "contain";
                  
                  console.log('📊 ImageMatrix loaded:', element.name, '- rows:', element.rows?.length || 0, 'columns:', element.columns?.length || 0, 'imageMode:', element.imageSelectionMode);
                }
                
                // Process random image selection for imagepicker, imageranking, imagerating, imageboolean, imagematrix, and image questions
                // ✅ Skip if manual selection mode - use existing choices
                const isImageQuestion = isRandomMediaQuestion(element);
                const isManualMode = (element.imageSelectionMode === 'huggingface_manual' || element.imageSelectionMode === 'manual');
                
                if (isImageQuestion && isManualMode && element.choices && element.choices.length > 0) {
                  console.log(`✅ Skipping image loading for ${element.type} question "${element.name}" - using manually selected images (${element.choices.length} images)`);
                }

                if (isManualMode && applyCuratedMediaIfNeeded(element, mediaPool)) {
                  console.log(`✅ Applied curated media for ${element.type} question "${element.name}"`);
                }
                
                if (shouldInjectMedia(element)) {
                  console.log(`🔄 Loading random images for ${element.type} question: ${element.name}`);
                  try {
                    let result;
                    const elementTrialCount = getTrialCount(element);
                    
                    // Self-hosted Live Survey uses the project's Media Dataset only.
                    if (mediaPool.length > 0) {
                      console.log(
                        `📦 Using project media pool (${mediaPool.length} available)`,
                      );
                      const pool = filterPoolForQuestion(mediaPool, element);
                      const folderTags = resolveMediaFolderTags(projectData, projectData?.config);

                      if (elementTrialCount > 1) {
                        const { trialMediaSets, trialAssignments } = pickTrialMediaSetsForQuestion(
                          pool,
                          element,
                          elementTrialCount,
                          globallyUsedImageKeys,
                          globallyUsedGroupKeys,
                          pairStatsRef.current,
                          folderTags,
                        );
                        element.trialMediaSets = trialMediaSets;
                        element.trialMediaContexts = trialAssignments.map((a) => ({
                          shown_media_set: a.setId || a.groupId || null,
                          shown_media_categories: a.categories || [],
                          shown_media: a.slots || [],
                        }));
                        element.trialCount = elementTrialCount;
                        const assignment = trialAssignments[0] || { images: [] };
                        let selectedImages = assignment.flatMedia || assignment.images || [];
                        if (!selectedImages.length && pool.length > 0 && element.type === 'skillquestion' && !usesSetMediaAssignment(element)) {
                          const imageCount = element.imageCount || defaultMediaCount(element);
                          selectedImages = [...pool].sort(() => 0.5 - Math.random()).slice(0, imageCount);
                        }
                        result = {
                          success: selectedImages.length > 0 || trialMediaSets.some((s) => s?.length),
                          images: selectedImages,
                          groupId: assignment.setId || assignment.groupId,
                          categories: assignment.categories,
                          slots: assignment.slots,
                          assignment,
                          _assigned: true,
                          trialMediaSets,
                        };
                        console.log(`✅ Pre-sampled ${trialMediaSets.length} trial media set(s) for ${element.name}`);
                      } else {
                      let assignment = finalizeMediaSelection(element, pool);
                      let selectedImages = assignment.images;
                      // Skill questions: reuse pool images rather than falling back to demo media
                      if (!selectedImages.length && pool.length > 0 && element.type === 'skillquestion' && !usesSetMediaAssignment(element)) {
                        const imageCount = element.imageCount || defaultMediaCount(element);
                        selectedImages = [...pool].sort(() => 0.5 - Math.random()).slice(0, imageCount);
                        assignment = { images: selectedImages, groupKey: null, groupId: null };
                        trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
                        console.log(`♻️ Pool exhausted, reusing ${selectedImages.length} images for skill question`);
                      }
                      
                      result = {
                        success: true,
                        images: selectedImages,
                        groupId: assignment.setId || assignment.groupId,
                        categories: assignment.categories,
                        slots: assignment.slots,
                        assignment,
                        _assigned: true,
                      };
                      
                      console.log(`✅ Selected ${selectedImages.length} media file(s) from preloaded pool${assignment.groupId ? ` (group: ${assignment.groupId})` : ''}${assignment.categories?.length ? ` (categories: ${assignment.categories.join(', ')})` : ''}`);
                      }
                    }
                    // PRIORITY 2: Hugging Face dataset (optional; never block survey forever)
                    else if (!deployed && projectData?.imageDatasetConfig?.enabled && projectData.imageDatasetConfig.datasetName) {
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'imagecheckbox' || element.type === 'image' || element.type === 'imageslidergroup' || element.type === 'imagepointallocation') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Fetching ${imageCount} images from Hugging Face dataset (global config): ${projectData.imageDatasetConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('./lib/huggingface');
                      const { huggingFaceToken, datasetName } = projectData.imageDatasetConfig;
                      
                      if (datasetName) {
                        result = await withTimeout(
                          getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount),
                          12000,
                          { success: false, images: [] },
                        );
                        console.log(`✅ Hugging Face returned ${result?.images?.length || 0} image(s)`);
                      } else {
                        console.warn(`Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    }
                    // PRIORITY 3: Legacy - element-specific config (kept for backward compatibility)
                    else if (!deployed && element.imageSource === 'huggingface' && element.huggingFaceConfig) {
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'imagecheckbox' || element.type === 'image' || element.type === 'imageslidergroup' || element.type === 'imagepointallocation') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 [Legacy] Fetching ${imageCount} images from element config: ${element.huggingFaceConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('./lib/huggingface');
                      const { huggingFaceToken, datasetName } = element.huggingFaceConfig;
                      
                      if (datasetName) {
                        result = await withTimeout(
                          getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount),
                          12000,
                          { success: false, images: [] },
                        );
                        console.log(`✅ Hugging Face returned ${result?.images?.length || 0} image(s)`);
                      } else {
                        console.warn(`Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    } else if (!deployed && element.supabaseConfig) {
                      // Load from Supabase (default/legacy behavior)
                      const { getAllImagesFromSupabase } = await import('./lib/supabase');
                      const { createClient } = await import('@supabase/supabase-js');
                      
                      // Create project-specific Supabase client
                      const projectSupabase = createClient(element.supabaseConfig.url, element.supabaseConfig.secretKey);
                      
                      // Get all available images
                      const supabaseResult = await getAllImagesFromSupabase(element.bucketPath, projectSupabase);
                      
                      if (supabaseResult.success && supabaseResult.images.length > 0) {
                        const pool = filterPoolForQuestion(supabaseResult.images, element);
                        const assignment = finalizeMediaSelection(element, pool);
                        result = {
                          success: true,
                          images: assignment.images,
                          groupId: assignment.groupId,
                          categories: assignment.categories,
                          assignment,
                          _assigned: true,
                        };
                      } else {
                        result = supabaseResult;
                      }
                    } else {
                      if (element.type === 'skillquestion') {
                        ensureSkillDemoMedia(element);
                        console.log(`Using demo media for skill question: ${element.name}`);
                      } else {
                        console.warn(`No image source configured for question: ${element.name}`);
                        continue;
                      }
                    }
                    
                    if (result?.success && (result.images?.length > 0 || result.trialMediaSets?.length)) {
                      let assignment = result.assignment;
                      if (!result._assigned || !assignment) {
                        assignment = finalizeMediaSelection(
                          element,
                          filterPoolForQuestion(result.images, element),
                          usesSetMediaAssignment(element) ? null : result.images,
                        );
                      }
                      if (result.trialMediaSets?.length) {
                        element.trialMediaSets = result.trialMediaSets;
                      }
                      const selectedImages = assignment.images || assignment.flatMedia || [];
                      const groupId = assignment.setId || assignment.groupId || null;
                      const categories = assignment.categories || null;
                      if (groupId) {
                        mediaGroupTracker[element.name] = groupId;
                      }
                      if (categories?.length) {
                        mediaCategoryTracker[element.name] = categories;
                      }
                      if (assignment.slots?.length) {
                        mediaSlotTracker[element.name] = assignment.slots.map((s) => ({
                          slotId: s.slotId,
                          role: s.role,
                          type: s.type,
                          name: s.name,
                          media_id: s.media_id || s.key || s.name,
                          url: s.url,
                          setId: s.setId || groupId || null,
                        }));
                      }

                      const imageUrls = applyMediaAssignmentToElement(element, assignment);
                      imageTracker[element.name] = imageUrls.length
                        ? imageUrls
                        : selectedImages.map((img) => img.url);
                      if (element.trialMediaSets?.length) {
                        imageTracker[element.name + '__trials'] = element.trialMediaSets.map(
                          (set) => (set || []).map((img) => img.url).filter(Boolean),
                        );
                      }
                      console.log(`✅ Tracked ${imageTracker[element.name].length} media URLs for question: ${element.name}`, imageTracker[element.name]);
                      if (groupId) console.log(`🔗 Assigned media group "${groupId}" → ${selectedImages.map((i) => i.name).join(', ')}`);
                      if (categories?.length) console.log(`🏷️ Categories [${categories.join(', ')}] → ${selectedImages.map((i) => i.name).join(', ')}`);
                      if (assignment.slots?.length) console.log(`🎚️ Slots for ${element.name}:`, assignment.slots.map((s) => `${s.slotId}=${s.name}`).join(', '));
                      console.log(`Loaded ${selectedImages.length} random media for question: ${element.name}`);
                    } else if (element.type === 'skillquestion') {
                      ensureSkillDemoMedia(element);
                      const skillUrls = getSkillMediaUrls(element);
                      if (skillUrls.length && !imageTracker[element.name]) {
                        imageTracker[element.name] = skillUrls;
                      }
                      console.log(`Fallback demo media for skill: ${element.name}`);
                    } else {
                      console.warn(`No images found for random selection in question: ${element.name}`);
                    }
                  } catch (error) {
                    console.error(`Error loading random images for question ${element.name}:`, error);
                  }
                }

                if (element.type === 'imageannotation') {
                  // SAM assist is intentionally disabled for live respondents —
                  // annotation stays point / line / polygon / bbox only.
                  element.enableSamAssist = false;
                }
              }
            }
          }
        }
        
        // Post-process: Convert imageboolean questions to panels with HTML + boolean
        if (finalSurveyJson.pages) {
          for (const page of finalSurveyJson.pages) {
            if (page.elements) {
              const newElements = [];
              for (const element of page.elements) {
                // Prefer URLs over names for results display (fallback chain)
                if (element.imageUrls?.length && !imageTracker[element.name]) {
                  imageTracker[element.name] = element.imageUrls;
                  console.log(`✅ Tracked ${element.imageUrls.length} image URLs from imageUrls for question: ${element.name}`);
                } else if (element.imageLinks?.length && !imageTracker[element.name]) {
                  imageTracker[element.name] = element.imageLinks;
                  console.log(`✅ Tracked ${element.imageLinks.length} image URLs from imageLinks for question: ${element.name}`);
                } else if (element.imageHtml && !imageTracker[element.name]) {
                  // Try URL attribute first, then name
                  const urlRegex = /data-image-url="([^"]+)"/g;
                  const urls = [];
                  let m;
                  while ((m = urlRegex.exec(element.imageHtml)) !== null) urls.push(m[1]);
                  if (urls.length > 0) {
                    imageTracker[element.name] = urls;
                    console.log(`✅ Tracked ${urls.length} image URLs from imageHtml for question: ${element.name}`);
                  } else {
                    const nameRegex = /data-image-name="([^"]+)"/g;
                    const names = [];
                    while ((m = nameRegex.exec(element.imageHtml)) !== null) names.push(m[1]);
                    if (names.length > 0) {
                      imageTracker[element.name] = names;
                      console.log(`✅ Tracked ${names.length} image names from imageHtml for question: ${element.name}`);
                    }
                  }
                } else if (element.choices?.length && !imageTracker[element.name]) {
                  // Manually configured choices: extract imageLink URLs
                  const urls = element.choices.map(c =>
                    c.imageLink || c.getPropertyValue?.('imageLink') || c.propertyHash?.imageLink || ''
                  ).filter(Boolean);
                  if (urls.length > 0) {
                    imageTracker[element.name] = urls;
                    console.log(`✅ Tracked ${urls.length} image URLs from choices for question: ${element.name}`);
                  }
                } else if (element.imageNames?.length && !imageTracker[element.name]) {
                  imageTracker[element.name] = element.imageNames;
                  console.log(`✅ Tracked ${element.imageNames.length} image names (fallback) for question: ${element.name}`);
                } else if (element.imageName && !imageTracker[element.name]) {
                  imageTracker[element.name] = [element.imageName];
                  console.log(`✅ Tracked 1 image name from imageName for question: ${element.name}`);
                } else if (element.type === 'skillquestion' && !imageTracker[element.name]) {
                  const skillUrls = getSkillMediaUrls(element);
                  if (skillUrls.length) {
                    imageTracker[element.name] = skillUrls;
                    console.log(`✅ Tracked ${skillUrls.length} skill media URLs for question: ${element.name}`);
                  }
                }
                
                // Keep custom image/media widgets as-is (no "See below images:" panel split).
                // trial=1 and trial>1 both use the same React question components.
                newElements.push(element);
              }
              page.elements = newElements;
              
              // ✅ FIX: If page has no questions, add a dummy HTML element so the page displays
              // This ensures pages with only title/description are visible in the survey
              // Note: SurveyJS will display page.description automatically, so we just need a minimal placeholder
              if (page.elements.length === 0) {
                page.elements = [{
                  type: 'html',
                  name: `${page.name}_placeholder`,
                  html: '<div style="height: 1px;"></div>' // Minimal placeholder to make page visible
                }];
              }
            }
          }
        }
        
        setAdminConfigExists(true);
        console.log('Using admin configuration:', adminConfig.title);
      } else {
        // Use original configuration
        finalSurveyJson = surveyJson;
        setAdminConfigExists(!!adminConfig);
        console.log('Using original configuration');
      }

      // Fix any boolean values before creating model (double-check)
      if (typeof finalSurveyJson.showQuestionNumbers === 'boolean') {
        finalSurveyJson.showQuestionNumbers = finalSurveyJson.showQuestionNumbers ? 'on' : 'off';
        console.log('🔧 Survey: Fixed showQuestionNumbers boolean to string');
      }
      {
        const normalizedProgress = normalizeShowProgressBar(finalSurveyJson.showProgressBar);
        progressChromeEnabledRef.current = finalSurveyJson._spProgressEnabled ?? (normalizedProgress !== 'off');
        finalSurveyJson._spProgressEnabled = progressChromeEnabledRef.current;
        // ProgressChrome replaces the native SurveyJS bar
        finalSurveyJson.showProgressBar = 'off';
      }
      
      // Create survey model (map builder-only types like number/consent)
      finalSurveyJson = normalizeBuilderSurveyJson(finalSurveyJson);
      const revision = finalSurveyJson._spRevision || await surveyRevision(resumeDraft?.finalSurveyJson ? finalSurveyJson : (adminConfig || finalSurveyJson), finalSurveyJson);
      finalSurveyJson._spRevision = revision;
      const model = new Model(finalSurveyJson);
      applySurveyLocale(model, finalSurveyJson);
      // Re-apply media fields SurveyJS may have stripped (esp. media* + trialMediaSets)
      syncInjectedMediaOntoSurveyModel(model, finalSurveyJson);
      
      // Apply theme - with error handling
      try {
        surveyThemeRef.current = (useAdminConfig && adminConfig?.theme) ? adminConfig.theme : null;
        if (useAdminConfig && adminConfig && adminConfig.theme) {
          // Use custom theme from admin config
          const customTheme = generateCustomTheme(adminConfig);
          if (customTheme) {
            console.log('Survey: Applying custom theme...');
            model.applyTheme(customTheme);
            console.log('✅ Survey applied custom theme successfully');
          }
        } else if (themeJson) {
          // Use default theme
          console.log('Survey: Applying default theme...');
          model.applyTheme(themeJson);
        }
      } catch (themeError) {
        console.error('⚠️ Error applying theme, using default styling:', themeError);
        // Continue without theme - SurveyJS will use default styling
      }
      
      // Apply survey configuration based on which config we're using
      if (useAdminConfig && adminConfig) {
        // Use admin configuration settings
        model.title = adminConfig.title || finalSurveyJson.title;
        model.description = adminConfig.description || finalSurveyJson.description;
        model.logo = adminConfig.logo || '';
        model.logoPosition = adminConfig.logoPosition || 'right';
        
        console.log('Applying admin config:', {
          title: model.title,
          description: model.description,
          logo: model.logo,
          logoPosition: model.logoPosition
        });
        
        // Settings already applied to model directly via finalSurveyJson
        console.log('Admin settings applied via SurveyJS format');
      } else {
        // Use original survey configuration
        model.title = surveyConfig.title;
        model.description = surveyConfig.description;
        model.logo = surveyConfig.logo;
        model.logoPosition = surveyConfig.logoPosition;
        
        // Apply original settings (if they exist in nested format)
        if (surveyConfig.settings) {
          Object.keys(surveyConfig.settings).forEach(key => {
            model[key] = surveyConfig.settings[key];
          });
        }
      }

      // Repeat annotation mode setup
      const urlRepeat = parseInt(urlParams.get('repeat') || '0', 10);
      const repeatCfg = finalSurveyJson?.repeatConfig || {};
      const repeatTotal = urlRepeat > 0 ? urlRepeat : (repeatCfg.enabled ? (repeatCfg.total || 1) : 1);
      const isRepeatMode = repeatTotal > 1;

      if (isRepeatMode && !repeatSessionRef.current) {
        repeatSessionRef.current = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        repeatParticipantRef.current = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        repeatAttemptRef.current = 1;
        setRepeatProgress({ current: 1, total: repeatTotal });
      } else if (isRepeatMode) {
        setRepeatProgress({ current: repeatAttemptRef.current, total: repeatTotal });
      }

      // Handle survey completion
      model.showCompletedPage = false;

      // Freeze Skill answers before SurveyJS rearranges/clones pages for Preview.
      // Preview components read this snapshot and never re-run the interactive iframe.
      model.onShowingPreview.add((survey) => {
        captureSkillPreviewAnswers(survey);
      });

      // Unified synchronous final flush. Normally question.value and data are
      // already identical; this also covers restored historical Skill answers.
      model.onCompleting.add((survey) => {
        survey.getAllQuestions().forEach((question) => {
          if (question.getType() !== 'skillquestion' || !question.name) return;
          const value = question.skillAnswerSnapshot
            ?? survey.__skillPreviewAnswers?.[question.name]
            ?? question.value;
          if (value !== undefined) survey.setValue(question.name, value);
        });
      });

      model.onComplete.add(async (survey) => {
        if (submissionGuardRef.current) return;
        submissionGuardRef.current = true;
        draftSavingEnabledRef.current = false;
        cancelPendingDraftSave();
        // Keep draft until save succeeds — see submitSurveyResponse.
        setSurveyPhase('submitting');

        console.log("=== SURVEY COMPLETION STARTED ===");
        const responses = collectSurveyDataWithTrials(survey);
        const displayedImages = displayedImagesRef.current || {};
        const displayedMediaGroups = displayedMediaGroupsRef.current || {};
        const displayedMediaCategories = displayedMediaCategoriesRef.current || {};
        const displayedMediaSlots = displayedMediaSlotsRef.current || {};
        const surveyQuestionTypeMap = {};
        survey.getAllQuestions().forEach((question) => {
          surveyQuestionTypeMap[question.name] = question.getType();
        });

        const {
          enrichedResponses,
          displayed_images,
          displayed_media_groups,
          displayed_media_categories,
        } = enrichSurveyResponses({
          responses,
          questionTypeMap: surveyQuestionTypeMap,
          displayedImages,
          displayedMediaGroups,
          displayedMediaCategories,
          displayedMediaSlots,
          preloadedImages: projectData?.preloadedImages || [],
        });
        
        // Check Supabase configuration before saving

        
        // Combine user responses with displayed images information
        const attemptIndex = isRepeatMode ? repeatAttemptRef.current : 1;
        const participantId = isRepeatMode ? repeatParticipantRef.current : participantIdRef.current;
        if (lastPageNameRef.current) {
          const elapsed = Math.round((Date.now() - (pageEnteredAtRef.current || Date.now())) / 1000);
          pageTimingRef.current[lastPageNameRef.current] =
            (pageTimingRef.current[lastPageNameRef.current] || 0) + elapsed;
        }
        const completionCode = generateCompletionCode(participantId);
        const now = Date.now();
        const totalSeconds = surveyStartedAtRef.current
          ? Math.round((now - surveyStartedAtRef.current) / 1000)
          : null;
        const completeData = {
          project_id: projectId,
          participant_id: participantId,
          responses: enrichedResponses,
          raw_responses: responses,
          displayed_images,
          displayed_media_groups,
          displayed_media_categories,
          survey_metadata: {
            completion_time: new Date().toISOString(),
            completion_code: completionCode,
            browser_id: getBrowserId(),
            user_agent: navigator.userAgent,
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            survey_version: useAdminConfig ? `2.0-admin-${projectId}` : "1.0-original",
            project_id: projectId,
            survey_revision: revision.id,
            survey_response_contract: revision.contract,
            published_version: finalSurveyJson._spPublishedVersion || null,
            survey_draft_updated_at: resumeDraft?.finalSurveyJson ? null : projectData?.draftUpdatedAt || null,
            timing: {
              total_seconds: totalSeconds,
              page_seconds: { ...pageTimingRef.current },
            },
            ...(isRepeatMode ? {
              session_id: repeatSessionRef.current,
              attempt_index: attemptIndex,
              repeat_total: repeatTotal,
              researcher_mode: true,
            } : {}),
          }
        };
        
        console.log("Survey completed with complete data:", completeData);
        console.log("📸 Displayed images in response:", displayedImages);
        Object.entries(responses || {}).forEach(([qn, val]) => {
          if (val && typeof val === 'object' && Array.isArray(val.trials)) {
            console.log(`🔁 Multi-trial raw answer for ${qn}: ${val.trials.length} trials`, val.trials.map((t) => t?.value));
          }
        });
        console.log("Attempting to save to Supabase...");

        await submitSurveyResponse(completeData, { isRepeatMode, repeatTotal, attemptIndex });
      });

      model.onValueChanged.add(() => {
        scheduleDraftSave(model, imageTracker, finalSurveyJson);
      });

      surveyStartedAtRef.current = Date.now();
      pageEnteredAtRef.current = Date.now();
      pageTimingRef.current = {};
      lastPageNameRef.current = model.currentPage?.name || null;

      const recordPageTiming = (pageName) => {
        if (!pageName || pageEnteredAtRef.current == null) return;
        const elapsed = Math.round((Date.now() - pageEnteredAtRef.current) / 1000);
        pageTimingRef.current[pageName] = (pageTimingRef.current[pageName] || 0) + elapsed;
        pageEnteredAtRef.current = Date.now();
      };

      model.onCurrentPageChanged.add((sender) => {
        const newPageName = sender.currentPage?.name;
        if (lastPageNameRef.current) recordPageTiming(lastPageNameRef.current);
        lastPageNameRef.current = newPageName;
        scheduleDraftSave(model, imageTracker, finalSurveyJson);
      });

      finalSurveyJsonRef.current = finalSurveyJson;
      imageTrackerRef.current = imageTracker;

      const existingDraft = !options.skipDraftCheck ? findDraftForProject(projectId) : null;
      if (existingDraft && !resumeChoiceRef.current && !options.resumeDraft) {
        setResumeDialog({
          draft: existingDraft.draft,
          draftKey: existingDraft.key,
          model,
          imageTracker,
          finalSurveyJson,
        });
        setLoading(false);
        setSurveyPhase('loading');
        return;
      }

      // Apply restored answers onto the (draft-stimulus) model.
      const draftToApply = options.resumeDraft
        || (resumeChoiceRef.current === 'resume' ? existingDraft?.draft : null);
      if (draftToApply) {
        model.data = draftToApply.surveyData || {};
        rehydrateTrialsAnswerStoreFromSurvey(model);
        if (typeof draftToApply.currentPageNo === 'number') {
          model.currentPageNo = draftToApply.currentPageNo;
        }
        if (draftToApply.displayedImages) {
          Object.keys(imageTracker).forEach((k) => delete imageTracker[k]);
          Object.assign(imageTracker, draftToApply.displayedImages);
          displayedImagesRef.current = draftToApply.displayedImages;
        }
        if (draftToApply.displayedMediaGroups) {
          Object.keys(mediaGroupTracker).forEach((k) => delete mediaGroupTracker[k]);
          Object.assign(mediaGroupTracker, draftToApply.displayedMediaGroups);
        }
        if (draftToApply.displayedMediaCategories) {
          Object.keys(mediaCategoryTracker).forEach((k) => delete mediaCategoryTracker[k]);
          Object.assign(mediaCategoryTracker, draftToApply.displayedMediaCategories);
        }
        if (draftToApply.participantId) {
          participantIdRef.current = draftToApply.participantId;
        }
      }
      resumeChoiceRef.current = null;

      // Save displayed images mapping (both state and ref)
      setDisplayedImagesMap(imageTracker);
      displayedImagesRef.current = imageTracker; // Save to ref for onComplete callback
      displayedMediaGroupsRef.current = mediaGroupTracker;
      displayedMediaCategoriesRef.current = mediaCategoryTracker;
      displayedMediaSlotsRef.current = mediaSlotTracker;
      console.log('📸 Displayed images tracker:', imageTracker);
      console.log('🔗 Media group assignments:', mediaGroupTracker);
      console.log('🏷️ Media category assignments:', mediaCategoryTracker);
      console.log('🎚️ Media slot assignments:', mediaSlotTracker);
      console.log('📸 Number of questions with images:', Object.keys(imageTracker).length);
      
      // Record load time for staleness detection
      window.lastSurveyLoadTime = Date.now();
      console.log('✅ Survey initialized successfully at:', new Date(window.lastSurveyLoadTime).toISOString());
      
      setSurveyModel(model);
      setSurveyPhase('active');
      setError(null);
    } catch (err) {
      console.error('Error initializing survey:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !resumeDialog) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">{loadingMessage}</Typography>
      </Box>
    );
  }

  if (surveyPhase === 'submitting') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">{participantText.participantSaving}</Typography>
      </Box>
    );
  }

  if (surveyPhase === 'closed' || quotaClosed) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Survey closed</Typography>
        <Typography variant="body1" color="text.secondary">
          {liveClosedMessage
            || 'This survey is no longer accepting responses. Thank you for your interest.'}
        </Typography>
      </Box>
    );
  }

  if (surveyPhase === 'completed' && completionInfo) {
    const defaultMsg = completionInfo.isRepeatMode
      ? tf(participantText.participantRoundsCompleted, { n: completionInfo.repeatTotal })
      : participantText.participantCompleted;
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>{participantText.participantThanks}</Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {completionMessageForLocale(completionMessage, participantLocale) || defaultMsg}
        </Typography>
        {completionInfo.completionCode && (
          <Typography variant="body1" sx={{ mb: 2, fontWeight: 600, letterSpacing: 1 }}>
            {participantText.participantCompletionCode} <strong>{completionInfo.completionCode}</strong>
          </Typography>
        )}
        {completionInfo.participantId && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {participantText.participantIdLabel} <strong>{completionInfo.participantId}</strong>
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {isDeployedParticipant()
            ? participantText.participantSubmitted
            : completionInfo.storage === 'file'
              ? participantText.participantSavedLocally
              : participantText.participantSaved}
        </Typography>
      </Box>
    );
  }

  if (surveyPhase === 'submit-error' && pendingSubmission) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
          {participantText.participantSaveError}
        </Alert>
        {!online && <Alert severity="warning" sx={{ mb: 2 }}>{resolveSurveyJsLocale(participantLocale) === 'zh-cn' ? '网络已断开。连接恢复后，请点击重试提交。' : 'You are offline. Reconnect, then retry the submission.'}</Alert>}
        {!recoverySaved && <Alert severity="warning" sx={{ mb: 2 }}>{resolveSurveyJsLocale(participantLocale) === 'zh-cn' ? '浏览器无法保存恢复副本，请保持此页面打开，或下载答卷备份。' : 'This browser could not save a recovery copy. Keep this page open or download your answers.'}</Alert>}
        <Button sx={{ mb: 2 }} onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(pendingSubmission, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = 'survey-response-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>{resolveSurveyJsLocale(participantLocale) === 'zh-cn' ? '下载答卷备份' : 'Download answer backup'}</Button>
        <Button
          variant="contained"
          size="large"
          onClick={() => {
            if (submissionInFlight.current) return;
            submissionGuardRef.current = true;
            setSurveyPhase('submitting');
            submitSurveyResponse(pendingSubmission, {
              isRepeatMode: !!pendingSubmission.survey_metadata?.researcher_mode,
              repeatTotal: pendingSubmission.survey_metadata?.repeat_total || 1,
              attemptIndex: pendingSubmission.survey_metadata?.attempt_index || 1,
            });
          }}
        >
          {participantText.participantRetrySubmission}
        </Button>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Error loading survey: {error}
        </Alert>
        <Button variant="contained" onClick={initializeSurvey}>
          Retry
        </Button>
      </Box>
    );
  }

  // Hide the researcher switcher for participant links and the deployed package.
  const urlParams = new URLSearchParams(window.location.search);
  const isParticipantView = !!urlParams.get('project')
    || (typeof isDeployedParticipant === 'function' ? isDeployedParticipant() : !!deploymentConfig);

  return (
    <Box>
      {!isParticipantView && (
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant={!useAdminConfig ? "contained" : "outlined"}
            onClick={() => setUseAdminConfig(false)}
            sx={{ mr: 1 }}
            title="The original research survey from the published paper"
          >
            Yang et al., 2025
          </Button>
          <Button
            variant={useAdminConfig ? "contained" : "outlined"}
            onClick={() => setUseAdminConfig(true)}
            disabled={!adminConfigExists}
            title="Survey created in the Admin Panel"
          >
            Custom Survey {!adminConfigExists && '(Not Available)'}
          </Button>
          
          {!useAdminConfig && (
            <Alert severity="info" sx={{ py: 0 }}>
              Using the original research survey from the published paper
            </Alert>
          )}
          
          {useAdminConfig && adminConfigExists && (
            <Alert severity="success" sx={{ py: 0 }}>
              Survey loaded from the participant link
            </Alert>
          )}
          
          {!adminConfigExists && (
            <Alert severity="warning" sx={{ py: 0 }}>
              No custom survey found. Create one in the Admin Panel.
            </Alert>
          )}
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {!isSupabaseConfigured() && (
            <Alert severity="info" sx={{ py: 0 }}>
              Using local storage (Supabase not configured)
            </Alert>
          )}
          <Button
            variant="outlined"
            onClick={() => setInfoDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Survey Types Info
          </Button>
          <Button
            variant="contained"
            onClick={() => window.location.href = '/admin'}
          >
            Go to Admin Panel
          </Button>
        </Box>
      </Box>
      )}
      
      {surveyModel && surveyPhase === 'active' && (
        <SurveyTrialNavProvider>
          <ParticipantSurveySurface
            onErrorCapture={(e) => handleSurveyMediaError(e, participantLocale)}
          >
            <SurveyProgressBridge
              surveyModel={surveyModel}
              progressEnabled={progressChromeEnabledRef.current}
              theme={surveyThemeRef.current}
            />
            {repeatProgress && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Research annotation mode: Round {repeatProgress.current} of {repeatProgress.total}
              </Alert>
            )}
            <Survey model={surveyModel} />
          </ParticipantSurveySurface>
        </SurveyTrialNavProvider>
      )}

      <Dialog open={!!resumeDialog} onClose={() => {}}>
        <DialogTitle>{participantText.participantResumeTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {tf(participantText.participantResumeBody, {
              date: resumeDialog?.draft?.savedAt
                ? new Date(resumeDialog.draft.savedAt).toLocaleString(resolveSurveyJsLocale(participantLocale))
                : participantText.participantPreviousVisit,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              clearDraftByKey(resumeDialog.draftKey);
              clearAllDraftsForProject(projectIdRef.current);
              if (resumeDialog.draft?.participantId) {
                clearPendingSubmission(projectIdRef.current, resumeDialog.draft.participantId);
              }
              participantIdRef.current = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              const { model, imageTracker } = resumeDialog;
              setResumeDialog(null);
              resumeChoiceRef.current = 'fresh';
              draftSavingEnabledRef.current = true;
              model.data = {};
              model.currentPageNo = 0;
              Object.keys(imageTracker).forEach((k) => delete imageTracker[k]);
              displayedImagesRef.current = imageTracker;
              displayedMediaGroupsRef.current = {};
              displayedMediaCategoriesRef.current = {};
              setDisplayedImagesMap(imageTracker);
              setSurveyModel(model);
              setSurveyPhase('active');
              setLoading(false);
            }}
          >
            {participantText.participantStartFresh}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const { draft } = resumeDialog;
              setResumeDialog(null);
              setSurveyModel(null);
              setLoading(true);
              setSurveyPhase('loading');
              resumeChoiceRef.current = 'resume';
              // Rebuild Model from the saved stimulus JSON so shown media matches answers.
              initializeSurvey({
                resumeDraft: draft,
                skipDraftCheck: true,
              });
            }}
          >
            {participantText.participantResume}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Survey Types Info Dialog */}
      <Dialog open={infoDialogOpen} onClose={() => setInfoDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Survey Types Explanation</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
                🔬 Yang et al., 2025
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                This is the original survey from the published research paper:
              </Typography>
              <Typography variant="caption" sx={{ fontStyle: 'italic', mb: 2, display: 'block' }}>
                "Yang, S., Chong, A., Liu, P., & Biljecki, F. (2025). Thermal comfort in sight: 
                Thermal affordance and its visual assessment for sustainable streetscape design. 
                Building and Environment, 112569. Elsevier."
              </Typography>
              <Typography variant="body2">
                • Fixed survey structure designed for streetscape thermal comfort research<br/>
                • Pre-defined questions and street view images<br/>
                • Academically validated survey design<br/>
                • Cannot be modified through the interface
              </Typography>
            </Box>

            <Box>
              <Typography variant="h6" sx={{ mb: 1, color: 'secondary.main' }}>
                🎨 Custom Survey (Admin Panel)
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                This is a survey you can create and customize through the Admin Panel:
              </Typography>
              <Typography variant="body2">
                • Fully customizable survey structure<br/>
                • Upload your own images and create custom questions<br/>
                • Real-time editing and preview<br/>
                • Auto-saves changes automatically<br/>
                • Perfect for new research projects or different study designs
              </Typography>
            </Box>

            <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                💡 Quick Guide:
              </Typography>
              <Typography variant="body2">
                • <strong>For academic replication:</strong> Use "Yang et al., 2025"<br/>
                • <strong>For new research:</strong> Create a "Custom Survey" in the Admin Panel<br/>
                • <strong>For testing:</strong> Try the demo survey by clicking "Load Demo" in Admin Panel
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInfoDialogOpen(false)}>Close</Button>
          <Button onClick={() => window.location.href = '/admin'} variant="contained">
            Go to Admin Panel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
