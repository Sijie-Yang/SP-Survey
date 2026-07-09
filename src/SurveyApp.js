import React, { useState, useEffect, useRef } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography } from '@mui/material';
import { saveSurveyResponse, isSupabaseConfigured } from './lib/supabase';
import { findDraftForProject, saveDraft, clearDraft, clearDraftByKey, clearAllDraftsForProject } from './lib/surveyDraft';
import { surveyJson, displayedImages } from './config/questions';
import { surveyConfig } from './config/surveyConfig';
import { themeJson } from "./theme";
import { loadSurveyConfig, convertToSurveyJS, generateCustomTheme } from './lib/surveyStorage';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget,
  registerAllExtendedWidgets,
} from './components/SurveyCustomComponents';
import { getBrowserId, generateCompletionCode } from './lib/browserId';
import { countProjectResponses, fetchPairStats } from './lib/surveyPublicApi';
import {
  isRandomMediaQuestion, defaultMediaCount, filterPoolForQuestion, applyMediaToElement, resolveSkillQuestions,
  ensureSkillDemoMedia, pickRandomMediaForQuestion, trackMediaAssignment, getImageKey, usesGroupMediaAssignment,
  usesCategoryMediaAssignment, buildMediaAssignmentLogEntry, shouldInjectMedia,
} from './lib/surveyMediaInjection';
import { getSkillMediaUrls } from './lib/skillMediaUtils';

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
  const [pendingSubmission, setPendingSubmission] = useState(null);
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
  const displayedMediaCategoriesRef = useRef({});
  const surveyStartedAtRef = useRef(null);
  const pageEnteredAtRef = useRef(null);
  const pageTimingRef = useRef({});
  const pairStatsRef = useRef(null);
  const lastPageNameRef = useRef(null);
  const submissionGuardRef = useRef(false);

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

  // Force reload when page becomes visible (to refresh expired image URLs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && surveyModel) {
        console.log('👁️ Page became visible, checking if survey needs refresh...');
        // Optionally reload survey if it's been hidden for too long
        const timeSinceLastLoad = Date.now() - (window.lastSurveyLoadTime || 0);
        if (timeSinceLastLoad > 30 * 60 * 1000) { // 30 minutes
          console.log('⏰ Survey data is stale (>30min), reloading...');
          initializeSurvey();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [surveyModel]);

  // ✅ No longer monitoring localStorage (using sessionStorage now)
  useEffect(() => {
    const handleStorageChange = (e) => {
      // Get current project ID
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || 'default';
      
      if (e.key === `survey_config_${projectId}` && useAdminConfig) {
        console.log(`Project ${projectId} configuration updated, reloading survey...`);
        initializeSurvey();
      }
    };

    // Listen to storage events
    window.addEventListener('storage', handleStorageChange);
    
    // Also listen to custom storage events (updates within the same page)
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [useAdminConfig]);

  const submitSurveyResponse = async (completeData, { isRepeatMode, repeatTotal, attemptIndex }) => {
    const result = await saveSurveyResponse(completeData);
    if (result.success) {
      discardDraftForProject(projectIdRef.current, completeData.participant_id);
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
        surveyData: { ...model.data },
        currentPageNo: model.currentPageNo,
        displayedImages: { ...imageTracker },
        finalSurveyJson: JSON.parse(JSON.stringify(finalSurveyJson)),
      });
    }, 800);
  };

  const initializeSurvey = async (options = {}) => {
    try {
      submissionGuardRef.current = false;
      draftSavingEnabledRef.current = true;
      cancelPendingDraftSave();
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
      const globallyUsedImageKeys = new Set();
      const globallyUsedGroupKeys = new Set();
      const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
      const finalizeMediaSelection = (element, pool, preselected) => {
        if (preselected?.length && !usesGroupMediaAssignment(element) && !usesCategoryMediaAssignment(element)) {
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
          const assignment = { images: selected, groupKey: null, groupId: null };
          trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
          return assignment;
        }
        const assignment = pickRandomMediaForQuestion(
          pool,
          element,
          globallyUsedImageKeys,
          globallyUsedGroupKeys,
          pairStatsRef.current,
        );
        trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
        return assignment;
      };

      // Get project ID from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || 'default';
      projectIdRef.current = projectId;
      
      if (!participantIdRef.current) {
        participantIdRef.current = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      }
      
      console.log('📂 Loading survey for project:', projectId);

      // Load project object (including Supabase configuration)
      let projectData = null;
      try {
        const { getProjectById } = await import('./lib/projectManager');
        projectData = await getProjectById(projectId);
        console.log('✅ Loaded project data:', projectData);
      } catch (error) {
        console.error('❌ Error loading project data:', error);
      }
      
      // Load survey configuration (platform mode: Supabase, self-hosted: local server)
      const adminConfig = await loadSurveyConfig(projectId);
      setCompletionMessage(adminConfig?.completionMessage || '');

      // Response quota gate
      const responseQuota = Number(adminConfig?.responseQuota) || 0;
      if (responseQuota > 0) {
        setLoadingMessage('Checking survey availability…');
        const currentCount = await countProjectResponses(projectId);
        if (currentCount != null && currentCount >= responseQuota) {
          setQuotaClosed(true);
          setSurveyPhase('closed');
          setLoading(false);
          return;
        }
      }
      setQuotaClosed(false);

      // Pair stats for adaptive/balanced pairing (best-effort)
      pairStatsRef.current = await fetchPairStats(projectId);
      
      // Build runtime Supabase config from project sources.
      // Priority: project.supabaseConfig (legacy/system status) -> imageDatasetConfig (current UI flow)
      const runtimeSupabaseConfig = (() => {
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
      
      if (useAdminConfig && adminConfig) {
        // Directly use admin configuration (already in standard SurveyJS format)
        // Use deep copy to avoid modifying the original config
        finalSurveyJson = JSON.parse(JSON.stringify(adminConfig));
        await resolveSkillQuestions(finalSurveyJson);
        
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
                
                if (shouldInjectMedia(element)) {
                  console.log(`🔄 Loading random images for ${element.type} question: ${element.name}`);
                  try {
                    let result;
                    
                    // PRIORITY 1: Check if project has preloaded images
                    if (projectData?.preloadedImages && projectData.preloadedImages.length > 0) {
                      console.log(`📦 Using preloaded media from project (${projectData.preloadedImages.length} available)`);
                      const pool = filterPoolForQuestion(projectData.preloadedImages, element);
                      let assignment = finalizeMediaSelection(element, pool);
                      let selectedImages = assignment.images;
                      // Skill questions: reuse pool images rather than falling back to demo media
                      if (!selectedImages.length && pool.length > 0 && element.type === 'skillquestion' && !usesGroupMediaAssignment(element)) {
                        const imageCount = element.imageCount || defaultMediaCount(element);
                        selectedImages = [...pool].sort(() => 0.5 - Math.random()).slice(0, imageCount);
                        assignment = { images: selectedImages, groupKey: null, groupId: null };
                        trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
                        console.log(`♻️ Pool exhausted, reusing ${selectedImages.length} images for skill question`);
                      }
                      
                      result = {
                        success: true,
                        images: selectedImages,
                        groupId: assignment.groupId,
                        categories: assignment.categories,
                        _assigned: true,
                      };
                      
                      console.log(`✅ Selected ${selectedImages.length} media file(s) from preloaded pool${assignment.groupId ? ` (group: ${assignment.groupId})` : ''}${assignment.categories?.length ? ` (categories: ${assignment.categories.join(', ')})` : ''}`);
                    }
                    // PRIORITY 2: Use global imageDatasetConfig if available
                    else if (projectData?.imageDatasetConfig?.enabled && projectData.imageDatasetConfig.datasetName) {
                      // Load from Hugging Face using global config
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'image' || element.type === 'imageslidergroup' || element.type === 'imagepointallocation') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Fetching ${imageCount} images from Hugging Face dataset (global config): ${projectData.imageDatasetConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('./lib/huggingface');
                      const { huggingFaceToken, datasetName } = projectData.imageDatasetConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                        console.log(`✅ Successfully loaded ${result?.images?.length || 0} images from Hugging Face`);
                      } else {
                        console.warn(`Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    }
                    // PRIORITY 3: Legacy - element-specific config (kept for backward compatibility)
                    else if (element.imageSource === 'huggingface' && element.huggingFaceConfig) {
                      // Load from Hugging Face using element config (deprecated)
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'image' || element.type === 'imageslidergroup' || element.type === 'imagepointallocation') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 [Legacy] Fetching ${imageCount} images from element config: ${element.huggingFaceConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('./lib/huggingface');
                      const { huggingFaceToken, datasetName } = element.huggingFaceConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                        console.log(`✅ Successfully loaded ${result?.images?.length || 0} images from Hugging Face`);
                      } else {
                        console.warn(`Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    } else if (element.supabaseConfig) {
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
                        result = { success: true, images: assignment.images, groupId: assignment.groupId, categories: assignment.categories, _assigned: true };
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
                    
                    if (result?.success && result.images.length > 0) {
                      let selectedImages = result.images;
                      let groupId = result.groupId || null;
                      let categories = result.categories || null;
                      if (!result._assigned) {
                        const assignment = finalizeMediaSelection(
                          element,
                          filterPoolForQuestion(result.images, element),
                          usesGroupMediaAssignment(element) ? null : result.images,
                        );
                        selectedImages = assignment.images;
                        groupId = assignment.groupId;
                        categories = assignment.categories;
                      }
                      if (groupId) {
                        element.assignedMediaGroupId = groupId;
                        mediaGroupTracker[element.name] = groupId;
                      }
                      if (categories?.length) {
                        element.assignedMediaCategories = categories;
                        mediaCategoryTracker[element.name] = categories;
                      }
                      
                      const imageUrls = selectedImages.map(img => img.url);
                      imageTracker[element.name] = imageUrls;
                      console.log(`✅ Tracked ${imageUrls.length} image URLs for question: ${element.name}`, imageUrls);
                      if (groupId) console.log(`🔗 Assigned media group "${groupId}" → ${selectedImages.map((i) => i.name).join(', ')}`);
                      if (categories?.length) console.log(`🏷️ Categories [${categories.join(', ')}] → ${selectedImages.map((i) => i.name).join(', ')}`);
                      
                      applyMediaToElement(element, selectedImages);
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
                
                // Check if element should be converted to panel (has imageHtml from manual or random selection)
                if (element.type === 'imageboolean' && (element.imageHtml || element.randomImageSelection)) {
                  // If no imageHtml yet, this means images weren't loaded (shouldn't happen after image loading loop)
                  if (!element.imageHtml) {
                    console.warn(`imageboolean ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  // Convert imageboolean to panel - keeps everything in one frame
                  console.log(`Converting imageboolean question ${element.name} to panel with HTML`);
                  
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:', // Fixed instruction text
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml
                      },
                      {
                        type: 'boolean',
                        name: element.name,
                        title: element.title, // Show actual question title
                        isRequired: element.isRequired,
                        labelTrue: element.labelTrue || 'Yes',
                        labelFalse: element.labelFalse || 'No',
                        valueTrue: element.valueTrue,
                        valueFalse: element.valueFalse
                      }
                    ]
                  });
                } else if (element.type === 'imagerating' && (element.imageHtml || element.randomImageSelection)) {
                  // If no imageHtml yet, this means images weren't loaded (shouldn't happen after image loading loop)
                  if (!element.imageHtml) {
                    console.warn(`imagerating ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  // Convert imagerating to panel - keeps everything in one frame
                  console.log(`Converting imagerating question ${element.name} to panel with HTML`);
                  
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:', // Fixed instruction text
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml
                      },
                      {
                        type: 'rating',
                        name: element.name,
                        title: element.title, // Show actual question title
                        isRequired: element.isRequired,
                        rateMin: element.rateMin || 1,
                        rateMax: element.rateMax || 5,
                        minRateDescription: element.minRateDescription,
                        maxRateDescription: element.maxRateDescription
                      }
                    ]
                  });
                } else if (element.type === 'imagematrix' && (element.imageHtml || element.randomImageSelection)) {
                  // If no imageHtml yet, this means images weren't loaded (shouldn't happen after image loading loop)
                  if (!element.imageHtml) {
                    console.warn(`imagematrix ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  // Convert imagematrix to panel - keeps everything in one frame
                  console.log(`Converting imagematrix question ${element.name} to panel with HTML`);
                  
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:', // Fixed instruction text
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml
                      },
                      {
                        type: 'matrix',
                        name: element.name,
                        title: element.title, // Show actual question title
                        isRequired: element.isRequired,
                        columns: element.columns,
                        rows: element.rows
                      }
                    ]
                  });
                } else if (element.type === 'mediarating' && (element.imageHtml || element.randomImageSelection)) {
                  if (!element.imageHtml) {
                    console.warn(`mediarating ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:',
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml,
                      },
                      {
                        type: 'rating',
                        name: element.name,
                        title: element.title,
                        isRequired: element.isRequired,
                        rateMin: element.rateMin || 1,
                        rateMax: element.rateMax || 5,
                        minRateDescription: element.minRateDescription,
                        maxRateDescription: element.maxRateDescription,
                      },
                    ],
                  });
                } else if (element.type === 'mediaboolean' && (element.imageHtml || element.randomImageSelection)) {
                  if (!element.imageHtml) {
                    console.warn(`mediaboolean ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:',
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml,
                      },
                      {
                        type: 'boolean',
                        name: element.name,
                        title: element.title,
                        isRequired: element.isRequired,
                        labelTrue: element.labelTrue || 'Yes',
                        labelFalse: element.labelFalse || 'No',
                        valueTrue: element.valueTrue,
                        valueFalse: element.valueFalse,
                      },
                    ],
                  });
                } else if (element.type === 'imageslidergroup' && (element.imageHtml || element.randomImageSelection)) {
                  if (!element.imageHtml) {
                    console.warn(`imageslidergroup ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:',
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml,
                      },
                      {
                        type: 'slidergroup',
                        name: element.name,
                        title: element.title,
                        isRequired: element.isRequired,
                        dimensions: element.dimensions || [],
                        scaleMin: element.scaleMin ?? 1,
                        scaleMax: element.scaleMax ?? 7,
                      },
                    ],
                  });
                } else if (element.type === 'imagepointallocation' && (element.imageHtml || element.randomImageSelection)) {
                  if (!element.imageHtml) {
                    console.warn(`imagepointallocation ${element.name} has no imageHtml, skipping panel conversion`);
                    newElements.push(element);
                    continue;
                  }
                  newElements.push({
                    type: 'panel',
                    name: `${element.name}_panel`,
                    title: 'See below images:',
                    description: element.description,
                    state: 'expanded',
                    elements: [
                      {
                        type: 'html',
                        name: `${element.name}_images`,
                        html: element.imageHtml,
                      },
                      {
                        type: 'pointallocation',
                        name: element.name,
                        title: element.title,
                        isRequired: element.isRequired,
                        choices: element.choices || [],
                        budget: element.budget ?? 100,
                      },
                    ],
                  });
                } else {
                  newElements.push(element);
                }
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
      if (typeof finalSurveyJson.showProgressBar === 'boolean') {
        finalSurveyJson.showProgressBar = finalSurveyJson.showProgressBar ? 'top' : 'off';
        console.log('🔧 Survey: Fixed showProgressBar boolean to string');
      }
      
      // Create survey model
      const model = new Model(finalSurveyJson);
      
      // Apply theme - with error handling
      try {
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

      model.onComplete.add(async (survey) => {
        if (submissionGuardRef.current) return;
        submissionGuardRef.current = true;
        draftSavingEnabledRef.current = false;
        cancelPendingDraftSave();
        discardDraftForProject(projectId, participantIdRef.current);
        setSurveyPhase('submitting');

        console.log("=== SURVEY COMPLETION STARTED ===");
        const responses = survey.data;
        const displayedImages = displayedImagesRef.current || {};
        const displayedMediaGroups = displayedMediaGroupsRef.current || {};
        const displayedMediaCategories = displayedMediaCategoriesRef.current || {};
        const surveyQuestionTypeMap = {};
        survey.getAllQuestions().forEach((question) => {
          surveyQuestionTypeMap[question.name] = question.getType();
        });

        const mapImageChoiceAnswerToNames = (answerValue, shownImages) => {
          if (!shownImages || shownImages.length === 0) return answerValue;

          const mapSingleValue = (value) => {
            if (typeof value !== 'string') return value;
            const match = value.match(/^image_(\d+)$/);
            if (!match) return value;
            const imageIndex = parseInt(match[1], 10);
            return shownImages[imageIndex] || value;
          };

          if (Array.isArray(answerValue)) {
            return answerValue.map(mapSingleValue);
          }
          return mapSingleValue(answerValue);
        };

        const enrichedResponses = Object.entries(responses).reduce((acc, [questionName, answerValue]) => {
          const shownImages = displayedImages[questionName] || [];
          const mappedAnswer = mapImageChoiceAnswerToNames(answerValue, shownImages);
          acc[questionName] = {
            type: surveyQuestionTypeMap[questionName] || null,
            answer: mappedAnswer,
            shown_images: shownImages,
            shown_media_group: displayedMediaGroups[questionName] || null,
            shown_media_categories: displayedMediaCategories[questionName] || null,
          };
          return acc;
        }, {});
        
        // Check Supabase configuration before saving
        const currentSupabaseConfig = sessionStorage.getItem('supabase_config');
        console.log('Current Supabase config in sessionStorage:', currentSupabaseConfig);
        
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
          displayed_images: displayedImages,
          displayed_media_groups: displayedMediaGroups,
          displayed_media_categories: displayedMediaCategories,
          survey_metadata: {
            completion_time: new Date().toISOString(),
            completion_code: completionCode,
            browser_id: getBrowserId(),
            user_agent: navigator.userAgent,
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            survey_version: useAdminConfig ? `2.0-admin-${projectId}` : "1.0-original",
            project_id: projectId,
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

      const existingDraft = !options.skipDraftCheck ? findDraftForProject(projectId) : null;
      if (existingDraft && !resumeChoiceRef.current) {
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

      if (resumeChoiceRef.current === 'resume' && existingDraft?.draft) {
        model.data = existingDraft.draft.surveyData || {};
        if (typeof existingDraft.draft.currentPageNo === 'number') {
          model.currentPageNo = existingDraft.draft.currentPageNo;
        }
        if (existingDraft.draft.displayedImages) {
          Object.assign(imageTracker, existingDraft.draft.displayedImages);
          displayedImagesRef.current = existingDraft.draft.displayedImages;
        }
        if (existingDraft.draft.participantId) {
          participantIdRef.current = existingDraft.draft.participantId;
        }
      }
      resumeChoiceRef.current = null;

      // Save displayed images mapping (both state and ref)
      setDisplayedImagesMap(imageTracker);
      displayedImagesRef.current = imageTracker; // Save to ref for onComplete callback
      displayedMediaGroupsRef.current = mediaGroupTracker;
      displayedMediaCategoriesRef.current = mediaCategoryTracker;
      console.log('📸 Displayed images tracker:', imageTracker);
      console.log('🔗 Media group assignments:', mediaGroupTracker);
      console.log('🏷️ Media category assignments:', mediaCategoryTracker);
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
        <Typography variant="body2" color="text.secondary">Saving your responses…</Typography>
      </Box>
    );
  }

  if (surveyPhase === 'closed' || quotaClosed) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Survey closed</Typography>
        <Typography variant="body1" color="text.secondary">
          This survey is no longer accepting responses. Thank you for your interest.
        </Typography>
      </Box>
    );
  }

  if (surveyPhase === 'completed' && completionInfo) {
    const defaultMsg = completionInfo.isRepeatMode
      ? `All ${completionInfo.repeatTotal} annotation rounds completed!`
      : 'Thank you for completing the survey!';
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>Thank you!</Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {completionMessage || defaultMsg}
        </Typography>
        {completionInfo.completionCode && (
          <Typography variant="body1" sx={{ mb: 2, fontWeight: 600, letterSpacing: 1 }}>
            Completion code: <strong>{completionInfo.completionCode}</strong>
          </Typography>
        )}
        {completionInfo.participantId && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your participant ID: <strong>{completionInfo.participantId}</strong>
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {completionInfo.storage === 'file'
            ? 'Responses saved locally.'
            : 'Responses saved successfully.'}
        </Typography>
      </Box>
    );
  }

  if (surveyPhase === 'submit-error' && pendingSubmission) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 4, textAlign: 'center' }}>
        <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
          We could not save your responses due to a network or server issue. Your answers are preserved — please try again.
        </Alert>
        <Button
          variant="contained"
          size="large"
          onClick={() => {
            submissionGuardRef.current = true;
            setSurveyPhase('submitting');
            submitSurveyResponse(pendingSubmission, {
              isRepeatMode: !!pendingSubmission.survey_metadata?.researcher_mode,
              repeatTotal: pendingSubmission.survey_metadata?.repeat_total || 1,
              attemptIndex: pendingSubmission.survey_metadata?.attempt_index || 1,
            });
          }}
        >
          Retry submission
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

  // Hide the dev panel when opened via a project survey link (participant view)
  const urlParams = new URLSearchParams(window.location.search);
  const isParticipantView = !!urlParams.get('project');

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
              Live: Updates automatically from Admin Panel
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
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: 3 }}>
          {repeatProgress && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Research annotation mode: Round {repeatProgress.current} of {repeatProgress.total}
            </Alert>
          )}
          <Survey model={surveyModel} />
        </Box>
      )}

      <Dialog open={!!resumeDialog} onClose={() => {}}>
        <DialogTitle>Resume previous session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            We found an unfinished survey from{' '}
            {resumeDialog?.draft?.savedAt
              ? new Date(resumeDialog.draft.savedAt).toLocaleString()
              : 'a previous visit'}.
            Would you like to continue where you left off?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              clearDraftByKey(resumeDialog.draftKey);
              clearAllDraftsForProject(projectIdRef.current);
              participantIdRef.current = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              const { model, imageTracker } = resumeDialog;
              setResumeDialog(null);
              resumeChoiceRef.current = 'fresh';
              draftSavingEnabledRef.current = true;
              model.data = {};
              model.currentPageNo = 0;
              Object.keys(imageTracker).forEach((k) => delete imageTracker[k]);
              displayedImagesRef.current = imageTracker;
              setDisplayedImagesMap(imageTracker);
              setSurveyModel(model);
              setSurveyPhase('active');
              setLoading(false);
            }}
          >
            Start over
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const { draft, model, imageTracker } = resumeDialog;
              model.data = draft.surveyData || {};
              if (typeof draft.currentPageNo === 'number') {
                model.currentPageNo = draft.currentPageNo;
              }
              if (draft.displayedImages) {
                Object.assign(imageTracker, draft.displayedImages);
                displayedImagesRef.current = draft.displayedImages;
              }
              if (draft.participantId) {
                participantIdRef.current = draft.participantId;
              }
              setResumeDialog(null);
              setDisplayedImagesMap(imageTracker);
              setSurveyModel(model);
              setSurveyPhase('active');
              setLoading(false);
            }}
          >
            Continue
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
