import React, { useState, useEffect } from 'react';
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Typography, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { applyAdminThemeToSurveyModel, buildSurveyHostStyle, convertToSurveyJS, normalizeBuilderSurveyJson } from '../../lib/surveyStorage';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget,
  registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import {
  isRandomMediaQuestion, defaultMediaCount, filterPoolForQuestion, resolveSkillQuestions,
  ensureSkillDemoMedia, pickMediaForQuestion, trackMediaAssignment, getImageKey, usesSetMediaAssignment,
  applyMediaAssignmentToElement, hasMediaSlots,
  usesCategoryMediaAssignment, buildMediaAssignmentLogEntry, shouldInjectMedia, applyCuratedMediaIfNeeded,
  resolveMediaFolderTags, pickTrialMediaSetsForQuestion, syncInjectedMediaOntoSurveyModel,
  clearInjectedMediaStore,
} from '../../lib/surveyMediaInjection';
import { getTrialCount } from '../../lib/trialNavigation';
import { SurveyTrialNavProvider } from '../../contexts/SurveyTrialNavContext';
import SurveyProgressBridge, { isProgressEnabled } from '../SurveyProgressBridge';

export default function SurveyPreview({ config, currentProject, showMediaAssignment = true }) {
  const [processedConfig, setProcessedConfig] = useState(null);
  const [mediaAssignments, setMediaAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const processConfig = async () => {
      if (!config) {
        setLoading(false);
        return;
      }

      try {
        console.log('🎨 Preview: Processing config at:', new Date().toISOString());
        clearInjectedMediaStore();

        // Register custom components
        registerImageRankingWidget();
        registerImageRatingWidget();
        registerImageBooleanWidget();
        registerImageMatrixWidget();
        registerAllExtendedWidgets();
        
        const configCopy = JSON.parse(JSON.stringify(config));
        await resolveSkillQuestions(configCopy);
        const mediaAssignmentLog = [];
        const globallyUsedImageKeys = new Set();
        const globallyUsedGroupKeys = new Set();
        const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
        const finalizeMediaSelection = (element, pool, preselected) => {
          const folderTags = resolveMediaFolderTags(currentProject, configCopy);
          if (
            !hasMediaSlots(element)
            && !usesSetMediaAssignment(element)
            && !usesCategoryMediaAssignment(element)
            && preselected?.length
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
              images: selected,
              flatMedia: selected,
              slots: selected.map((img, i) => ({
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
            null,
            folderTags,
          );
          if (!hasMediaSlots(element)) {
            trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
          }
          return assignment;
        };
        
        // Process image questions and convert imageranking to ranking for SurveyJS
        if (configCopy.pages) {
          for (const page of configCopy.pages) {
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
                
                // Process random image selection for imagepicker, imageranking, imagerating, imageboolean, imagematrix, and image questions
                // ✅ Skip if manual selection mode - use existing choices
                const isImageQuestion = isRandomMediaQuestion(element);
                const isManualMode = (element.imageSelectionMode === 'huggingface_manual' || element.imageSelectionMode === 'manual');
                
                if (isImageQuestion && isManualMode && element.choices && element.choices.length > 0) {
                  console.log(`✅ Preview: Skipping image loading for ${element.type} question "${element.name}" - using manually selected images (${element.choices.length} images)`);
                }

                if (isManualMode && applyCuratedMediaIfNeeded(element, currentProject?.preloadedImages || [])) {
                  console.log(`✅ Preview: Applied curated media for ${element.type} question "${element.name}"`);
                }
                
                if (shouldInjectMedia(element)) {
                  console.log(`🔄 Preview: Loading random images for ${element.type} question: ${element.name}`);
                  try {
                    let result;
                    
                    // PRIORITY 1: Check if project has preloaded images
                    if (currentProject?.preloadedImages && currentProject.preloadedImages.length > 0) {
                      console.log(`📦 Preview: Using preloaded images from project (${currentProject.preloadedImages.length} available)`);
                      const pool = filterPoolForQuestion(currentProject.preloadedImages, element);
                      const elementTrialCount = getTrialCount(element);
                      const folderTags = resolveMediaFolderTags(currentProject, currentProject?.config);
                      if (elementTrialCount > 1) {
                        const { trialMediaSets, trialAssignments } = pickTrialMediaSetsForQuestion(
                          pool, element, elementTrialCount,
                          globallyUsedImageKeys, globallyUsedGroupKeys, null, folderTags,
                        );
                        element.trialMediaSets = trialMediaSets;
                        element.trialCount = elementTrialCount;
                        const assignment = trialAssignments[0] || { images: [] };
                        const selectedImages = assignment.flatMedia || assignment.images || [];
                        result = {
                          success: !!selectedImages.length || trialMediaSets.some((s) => s?.length),
                          images: selectedImages,
                          setId: assignment.setId || assignment.groupId,
                          groupId: assignment.setId || assignment.groupId,
                          categories: assignment.categories,
                          assignment,
                          _assigned: true,
                          trialMediaSets,
                        };
                      } else {
                      let assignment = finalizeMediaSelection(element, pool);
                      let selectedImages = assignment.images;
                      if (!selectedImages.length && pool.length > 0 && element.type === 'skillquestion' && !usesSetMediaAssignment(element)) {
                        const imageCount = element.imageCount || defaultMediaCount(element);
                        selectedImages = [...pool].sort(() => 0.5 - Math.random()).slice(0, imageCount);
                        assignment = {
                          images: selectedImages, flatMedia: selectedImages,
                          slots: selectedImages.map((img, i) => ({
                            slotId: `legacy_${i}`, role: 'stimulus',
                            type: img.type, url: img.url, name: img.name,
                            media_id: img.media_id || img.key || img.name,
                          })),
                          groupKey: null, groupId: null,
                        };
                        trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
                        console.log(`♻️ Preview: Pool exhausted, reusing ${selectedImages.length} images for skill question`);
                      }
                      result = {
                        success: true,
                        images: selectedImages,
                        setId: assignment.setId || assignment.groupId,
                        groupId: assignment.setId || assignment.groupId,
                        categories: assignment.categories,
                        assignment,
                        _assigned: true,
                      };
                      console.log(`✅ Preview: Selected ${selectedImages.length} media file(s) from preloaded pool${(assignment.setId || assignment.groupId) ? ` (set: ${assignment.setId || assignment.groupId})` : ''}${assignment.categories?.length ? ` (categories: ${assignment.categories.join(', ')})` : ''}`);
                      }
                    }
                    // PRIORITY 2: Use global imageDatasetConfig if available
                    else if (currentProject?.imageDatasetConfig?.enabled && currentProject.imageDatasetConfig.datasetName) {
                      // Load from Hugging Face using global config
                      // Use type-specific defaults if imageCount is not set
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'image') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Preview: Fetching ${imageCount} images from Hugging Face dataset (global config): ${currentProject.imageDatasetConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('../../lib/huggingface');
                      const { huggingFaceToken, datasetName } = currentProject.imageDatasetConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                        console.log(`✅ Preview: Successfully loaded ${result?.images?.length || 0} images from Hugging Face`);
                      } else {
                        console.warn(`Preview: Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    }
                    // PRIORITY 3: Legacy - element-specific config (kept for backward compatibility)
                    else if (element.imageSource === 'huggingface' && element.huggingFaceConfig) {
                      // Load from Hugging Face using element config (deprecated)
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'image') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Preview: [Legacy] Fetching ${imageCount} images from element config: ${element.huggingFaceConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('../../lib/huggingface');
                      const { huggingFaceToken, datasetName } = element.huggingFaceConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                        console.log(`✅ Preview: Successfully loaded ${result?.images?.length || 0} images from Hugging Face`);
                      } else {
                        console.warn(`Preview: Hugging Face dataset name missing for question: ${element.name}`);
                        continue;
                      }
                    } else if (element.supabaseConfig) {
                      // Load from Supabase (default/legacy behavior)
                      const { getAllImagesFromSupabase } = await import('../../lib/supabase');
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
                          setId: assignment.setId || assignment.groupId,
                          groupId: assignment.setId || assignment.groupId,
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
                        console.log(`Preview: Using demo media for skill question: ${element.name}`);
                      } else {
                        console.warn(`Preview: No image source configured for question: ${element.name}`);
                        continue;
                      }
                    }
                    
                    if (result?.success && (result.images?.length > 0 || result.trialMediaSets?.length)) {
                      let selectedImages = result.images || [];
                      let setId = result.setId || result.groupId || null;
                      let categories = result.categories || null;
                      let assignment = result.assignment;
                      if (!result._assigned || !assignment) {
                        assignment = finalizeMediaSelection(
                          element,
                          filterPoolForQuestion(result.images, element),
                          usesSetMediaAssignment(element) ? null : result.images,
                        );
                        selectedImages = assignment.images || selectedImages;
                        setId = assignment.setId || assignment.groupId || setId;
                        categories = assignment.categories || categories;
                      }
                      if (setId) {
                        element.assignedMediaSetId = setId;
                        element.assignedMediaGroupId = setId;
                      }
                      if (categories?.length) element.assignedMediaCategories = categories;
                      mediaAssignmentLog.push(buildMediaAssignmentLogEntry(element, selectedImages, setId, categories));
                      if (result.trialMediaSets?.length) {
                        element.trialMediaSets = result.trialMediaSets;
                      }
                      applyMediaAssignmentToElement(element, assignment);
                      console.log(`Preview loaded ${selectedImages.length} random media for question: ${element.name}`);
                    } else if (element.type === 'skillquestion') {
                      ensureSkillDemoMedia(element);
                      console.log(`Preview: Fallback demo media for skill: ${element.name}`);
                    } else {
                      console.warn(`Preview: No images found for random selection in question: ${element.name}`);
                    }
                  } catch (error) {
                    console.error(`Preview: Error loading random images for question ${element.name}:`, error);
                  }
                }
              }
            }
          }
        }
        
        // Post-process: Convert imageboolean questions to panels with HTML + boolean
        if (configCopy.pages) {
          for (const page of configCopy.pages) {
            if (page.elements) {
              const newElements = [];
              for (const element of page.elements) {
                // Keep custom widgets as-is so trial=1 matches trial>1 (no "See below images:" panel).
                newElements.push(element);
              }
              page.elements = newElements;
              
              // ✅ FIX: If page has no questions, add a dummy HTML element so the page displays
              // This ensures pages with only title/description are visible in the preview
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
        
        setMediaAssignments(mediaAssignmentLog);
        setProcessedConfig(configCopy);
      } catch (error) {
        console.error('Error processing config for preview:', error);
        setProcessedConfig(config);
      } finally {
        setLoading(false);
      }
    };

    processConfig();
  }, [config, currentProject?.preloadedImages]);

  if (!config) {
    return (
      <Alert severity="warning">
        No survey configuration available for preview.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  try {
    // Fix config before creating model
    const configToUse = processedConfig || config;
    
    // Ensure showQuestionNumbers and showProgressBar are strings, not booleans
    if (typeof configToUse.showQuestionNumbers === 'boolean') {
      configToUse.showQuestionNumbers = configToUse.showQuestionNumbers ? 'on' : 'off';
      console.log('🔧 Preview: Fixed showQuestionNumbers boolean to string');
    }
    if (typeof configToUse.showProgressBar === 'boolean') {
      configToUse.showProgressBar = configToUse.showProgressBar ? 'top' : 'off';
      console.log('🔧 Preview: Fixed showProgressBar boolean to string');
    }
    
    // Directly use processed configuration (already in standard SurveyJS format)
    const normalizedPreviewJson = normalizeBuilderSurveyJson(configToUse);
    const model = new Model(normalizedPreviewJson);
    syncInjectedMediaOntoSurveyModel(model, normalizedPreviewJson);
    
    // Use the exact same theme entry point as question preview and Live Survey.
    applyAdminThemeToSurveyModel(model, config);
    
    // Configuration already applied directly to model (via new Model(config))
    // No additional setup needed
    
    // Disable survey completion for preview
    model.mode = "display";

    const progressEnabled = isProgressEnabled(configToUse);
    try {
      // Match live SurveyApp: ProgressChrome replaces the native SurveyJS bar
      model.showProgressBar = 'off';
    } catch { /* ignore */ }
    
    console.log('Preview using standard SurveyJS config:', {
      title: model.title,
      description: model.description,
      logo: model.logo,
      logoPosition: model.logoPosition,
      showQuestionNumbers: model.showQuestionNumbers,
      showProgressBar: model.showProgressBar,
      progressChrome: progressEnabled,
    });
    
    return (
      <Box sx={{ maxHeight: '70vh', overflow: 'auto' }}>
        <Box sx={{ 
          bgcolor: 'info.light', 
          color: 'info.contrastText', 
          p: 1, 
          textAlign: 'center', 
          mb: 2,
          borderRadius: 1
        }}>
          📋 Preview Mode - This shows exactly how your survey will appear to participants
        </Box>
        {showMediaAssignment && mediaAssignments.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              This preview&apos;s media assignment (simulated participant draw)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              Refresh preview to re-roll random sets. Set mode shows which <strong>set ID</strong> was picked per question.
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 700 } }}>
                    <TableCell>Question</TableCell>
                    <TableCell>Mode</TableCell>
                    <TableCell>Set ID</TableCell>
                    <TableCell>Categories</TableCell>
                    <TableCell>Assigned files</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mediaAssignments.map((row) => (
                    <TableRow key={row.questionName}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{row.questionTitle}</Typography>
                        <Typography variant="caption" color="text.secondary">{row.questionName}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={row.mode === 'group' || row.mode === 'set' ? 'Fixed set' : row.mode === 'category' ? 'Per category' : 'Individual'}
                          color={row.mode === 'set' || row.mode === 'group' || row.mode === 'category' ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {(row.setId || row.groupId) ? (
                          <Typography variant="body2" fontWeight={600} color="primary.main">{row.setId || row.groupId}</Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.categories?.length ? (
                          <Typography variant="caption">{row.categories.join(', ')}</Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {row.fileNames.join(' · ') || '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
        <Box
          className="sp-survey-with-progress sp-survey-theme-host"
          style={buildSurveyHostStyle(configToUse?.theme || {})}
          sx={{ maxWidth: 900, mx: 'auto', px: { xs: 0, sm: 2 }, py: { xs: 1, sm: 2 } }}
        >
          <SurveyTrialNavProvider>
            <SurveyProgressBridge
              surveyModel={model}
              progressEnabled={progressEnabled}
              theme={config?.theme || null}
            />
            <Survey model={model} />
          </SurveyTrialNavProvider>
        </Box>
      </Box>
    );
  } catch (error) {
    console.error('Error creating survey preview:', error);
    return (
      <Alert severity="error">
        Error creating survey preview: {error.message}
      </Alert>
    );
  }
}
