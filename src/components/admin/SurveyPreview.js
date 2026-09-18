import React, { useState, useEffect, useMemo } from 'react';
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Typography, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { convertToSurveyJS, generateCustomTheme, normalizeBuilderSurveyJson } from '../../lib/surveyStorage';
import { themeJson } from "../../theme";
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget,
  registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import {
  isRandomMediaQuestion, defaultMediaCount, filterPoolForQuestion, resolveSkillQuestions,
  pickMediaForQuestion, trackMediaAssignment, getImageKey, usesSetMediaAssignment,
  applyMediaAssignmentToElement, hasMediaSlots,
  usesCategoryMediaAssignment, buildMediaAssignmentLogEntry, shouldInjectMedia, applyCuratedMediaIfNeeded,
  resolveMediaFolderTags, pickTrialMediaSetsForQuestion, syncInjectedMediaOntoSurveyModel,
  clearInjectedMediaStore, describeMediaAssignmentFailure,
} from '../../lib/surveyMediaInjection';
import { getTrialCount } from '../../lib/trialNavigation';
import { applySurveyLocale } from '../../lib/surveyLocale';
import { SurveyTrialNavProvider } from '../../contexts/SurveyTrialNavContext';
import SurveyProgressBridge, { isProgressEnabled } from '../SurveyProgressBridge';
import { resolvePreviewMediaContext } from '../../lib/previewMediaLibrary';

export function previewSourceKey(config, currentProject) {
  const images = currentProject?.preloadedImages || [];
  const dataset = currentProject?.imageDatasetConfig || {};
  return JSON.stringify({
    config: config || null,
    imageKeys: images.map((img) => img.key || img.url || img.name || ''),
    imageFolders: images.map((img) => img.logicalFolder || img.folder || ''),
    mediaFolderTags: dataset.mediaFolderTags || {},
    mediaFolders: dataset.mediaFolders || [],
  });
}

export function createSurveyPreviewModel(processedConfig) {
  const configToUse = JSON.parse(JSON.stringify(processedConfig || {}));
  if (typeof configToUse.showQuestionNumbers === 'boolean') {
    configToUse.showQuestionNumbers = configToUse.showQuestionNumbers ? 'on' : 'off';
  }
  if (typeof configToUse.showProgressBar === 'boolean') {
    configToUse.showProgressBar = configToUse.showProgressBar ? 'top' : 'off';
  }
  const normalizedPreviewJson = normalizeBuilderSurveyJson(configToUse);
  const model = new Model(normalizedPreviewJson);
  applySurveyLocale(model, normalizedPreviewJson);
  syncInjectedMediaOntoSurveyModel(model, normalizedPreviewJson);
  try {
    if (configToUse.theme) {
      const customTheme = generateCustomTheme(configToUse);
      if (customTheme) model.applyTheme(customTheme);
    } else if (themeJson) {
      model.applyTheme(themeJson);
    }
  } catch {
    // SurveyJS default styling
  }
  model.mode = 'display';
  try {
    model.showProgressBar = 'off';
  } catch { /* ignore */ }
  return model;
}

export default function SurveyPreview({ config, currentProject, showMediaAssignment = true }) {
  const [processedConfig, setProcessedConfig] = useState(null);
  const [mediaAssignments, setMediaAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingPreviewLibrary, setUsingPreviewLibrary] = useState(false);
  const [mediaErrors, setMediaErrors] = useState([]);
  const sourceKey = useMemo(
    () => previewSourceKey(config, currentProject),
    [config, currentProject],
  );

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
        const mediaContext = await resolvePreviewMediaContext(currentProject || {});
        const mediaPool = mediaContext.images;
        const fromPreviewLibrary = mediaContext.fromPreviewLibrary;
        setUsingPreviewLibrary(fromPreviewLibrary);
        const folderHost = fromPreviewLibrary
          ? { ...currentProject, imageDatasetConfig: mediaContext.imageDatasetConfig, config: configCopy }
          : { ...currentProject, config: configCopy };
        const folderTags = resolveMediaFolderTags(folderHost, configCopy);
        const mediaAssignmentLog = [];
        const nextMediaErrors = [];
        const globallyUsedImageKeys = new Set();
        const globallyUsedGroupKeys = new Set();
        const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
        const recordAssignmentGap = (element, assignment = {}) => {
          nextMediaErrors.push(
            describeMediaAssignmentFailure(element, mediaPool, folderTags, assignment)
            || `Question "${element?.name || 'unnamed'}": not enough matching media.`,
          );
        };
        const finalizeMediaSelection = (element, pool, preselected) => {
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

                if (isManualMode && applyCuratedMediaIfNeeded(element, mediaPool)) {
                  console.log(`✅ Preview: Applied curated media for ${element.type} question "${element.name}"`);
                }
                
                if (shouldInjectMedia(element)) {
                  console.log(`🔄 Preview: Loading random images for ${element.type} question: ${element.name}`);
                  try {
                    let result;
                    
                    // PRIORITY 1: Project media, else platform preview library
                    if (mediaPool.length > 0) {
                      console.log(`📦 Preview: Using media pool (${mediaPool.length} available${fromPreviewLibrary ? ', preview library' : ''})`);
                      const pool = filterPoolForQuestion(mediaPool, element);
                      const elementTrialCount = getTrialCount(element);
                      if (elementTrialCount > 1) {
                        const { trialMediaSets, trialAssignments } = pickTrialMediaSetsForQuestion(
                          pool, element, elementTrialCount,
                          globallyUsedImageKeys, globallyUsedGroupKeys, null, folderTags,
                        );
                        element.trialMediaSets = trialMediaSets;
                        element.trialCount = elementTrialCount;
                        const assignment = trialAssignments[0] || { images: [] };
                        const selectedImages = assignment.flatMedia || assignment.images || [];
                        const complete = trialMediaSets.length === elementTrialCount
                          && trialMediaSets.every((items) => items?.length);
                        result = {
                          success: complete,
                          images: selectedImages,
                          setId: assignment.setId || assignment.groupId,
                          groupId: assignment.setId || assignment.groupId,
                          categories: assignment.categories,
                          assignment: { ...assignment, trialMediaSets },
                          _assigned: true,
                          trialMediaSets,
                        };
                      } else {
                      const assignment = finalizeMediaSelection(element, pool);
                      const selectedImages = assignment.images || [];
                      result = {
                        success: selectedImages.length > 0,
                        images: selectedImages,
                        setId: assignment.setId || assignment.groupId,
                        groupId: assignment.setId || assignment.groupId,
                        categories: assignment.categories,
                        assignment,
                        _assigned: true,
                      };
                      }
                    }
                    // PRIORITY 2: Use global imageDatasetConfig if available
                    else if (currentProject?.imageDatasetConfig?.enabled && currentProject.imageDatasetConfig.datasetName) {
                      // Load from Hugging Face using global config
                      // Use type-specific defaults if imageCount is not set
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'imagecheckbox' || element.type === 'image') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Preview: Fetching ${imageCount} images from Hugging Face dataset (global config): ${currentProject.imageDatasetConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('../../lib/huggingface');
                      const { huggingFaceToken, datasetName } = currentProject.imageDatasetConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                      } else {
                        recordAssignmentGap(element);
                        continue;
                      }
                    }
                    // PRIORITY 3: Legacy - element-specific config (kept for backward compatibility)
                    else if (element.imageSource === 'huggingface' && element.huggingFaceConfig) {
                      // Load from Hugging Face using element config (deprecated)
                      const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'imagecheckbox' || element.type === 'image') ? 1 : 4;
                      const imageCount = element.imageCount || defaultCount;
                      console.log(`📥 Preview: [Legacy] Fetching ${imageCount} images from element config: ${element.huggingFaceConfig.datasetName}`);
                      const { getRandomImagesFromHuggingFace } = await import('../../lib/huggingface');
                      const { huggingFaceToken, datasetName } = element.huggingFaceConfig;
                      
                      if (datasetName) {
                        result = await getRandomImagesFromHuggingFace(huggingFaceToken, datasetName, imageCount);
                      } else {
                        recordAssignmentGap(element);
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
                      recordAssignmentGap(element);
                      continue;
                    }
                    
                    if (result?.success && (result.images?.length > 0 || result.trialMediaSets?.every((items) => items?.length))) {
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
                    } else if (result) {
                      recordAssignmentGap(element, result.assignment || result);
                    } else {
                      recordAssignmentGap(element);
                    }
                  } catch (error) {
                    recordAssignmentGap(element, { images: [] });
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
        setMediaErrors(nextMediaErrors);
        setProcessedConfig(configCopy);
      } catch (error) {
        console.error('Error processing config for preview:', error);
        setMediaErrors([error.message || 'Preview could not load media.']);
        setProcessedConfig(config);
      } finally {
        setLoading(false);
      }
    };

    processConfig();
  }, [sourceKey]);

  const model = useMemo(
    () => (processedConfig && !loading ? createSurveyPreviewModel(processedConfig) : null),
    [processedConfig, loading],
  );

  useEffect(() => () => {
    model?.dispose?.();
  }, [model]);

  if (!config) {
    return (
      <Alert severity="warning">
        No survey configuration available for preview.
      </Alert>
    );
  }

  if (loading || !model) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  try {
    const configToUse = processedConfig || config;
    const progressEnabled = isProgressEnabled(configToUse);
    
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
          {usingPreviewLibrary
            ? ' · No project media — sampling from the platform preview media library'
            : ''}
        </Box>
        {mediaErrors.map((message) => (
          <Alert key={message} severity="error" sx={{ mb: 1 }}>{message}</Alert>
        ))}
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
          sx={{ maxWidth: 900, mx: 'auto', px: { xs: 0, sm: 2 } }}
          className="sp-survey-with-progress"
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
