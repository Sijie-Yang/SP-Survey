import React, { useState, useEffect } from 'react';
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Typography, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { convertToSurveyJS, generateCustomTheme } from '../../lib/surveyStorage';
import { themeJson } from "../../theme";
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import {
  isRandomMediaQuestion, defaultMediaCount, filterPoolForQuestion, applyMediaToElement, resolveSkillQuestions,
  ensureSkillDemoMedia, pickRandomMediaForQuestion, trackMediaAssignment, getImageKey, usesGroupMediaAssignment,
  usesCategoryMediaAssignment, buildMediaAssignmentLogEntry, shouldInjectMedia,
} from '../../lib/surveyMediaInjection';

export default function SurveyPreview({ config, currentProject }) {
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
        
        // Register custom components
        registerImageRankingWidget();
        registerImageRatingWidget();
        registerImageBooleanWidget();
        registerAllExtendedWidgets();
        
        const configCopy = JSON.parse(JSON.stringify(config));
        await resolveSkillQuestions(configCopy);
        const mediaAssignmentLog = [];
        const globallyUsedImageKeys = new Set();
        const globallyUsedGroupKeys = new Set();
        const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
        const finalizeMediaSelection = (element, pool, preselected) => {
          if (!usesGroupMediaAssignment(element) && !usesCategoryMediaAssignment(element) && preselected?.length) {
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
          );
          trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
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
                
                if (shouldInjectMedia(element)) {
                  console.log(`🔄 Preview: Loading random images for ${element.type} question: ${element.name}`);
                  try {
                    let result;
                    
                    // PRIORITY 1: Check if project has preloaded images
                    if (currentProject?.preloadedImages && currentProject.preloadedImages.length > 0) {
                      console.log(`📦 Preview: Using preloaded images from project (${currentProject.preloadedImages.length} available)`);
                      const pool = filterPoolForQuestion(currentProject.preloadedImages, element);
                      let assignment = finalizeMediaSelection(element, pool);
                      let selectedImages = assignment.images;
                      if (!selectedImages.length && pool.length > 0 && element.type === 'skillquestion' && !usesGroupMediaAssignment(element)) {
                        const imageCount = element.imageCount || defaultMediaCount(element);
                        selectedImages = [...pool].sort(() => 0.5 - Math.random()).slice(0, imageCount);
                        assignment = { images: selectedImages, groupKey: null, groupId: null };
                        trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys);
                        console.log(`♻️ Preview: Pool exhausted, reusing ${selectedImages.length} images for skill question`);
                      }
                      result = {
                        success: true,
                        images: selectedImages,
                        groupId: assignment.groupId,
                        categories: assignment.categories,
                        _assigned: true,
                      };
                      console.log(`✅ Preview: Selected ${selectedImages.length} media file(s) from preloaded pool${assignment.groupId ? ` (group: ${assignment.groupId})` : ''}${assignment.categories?.length ? ` (categories: ${assignment.categories.join(', ')})` : ''}`);
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
                        result = { success: true, images: assignment.images, groupId: assignment.groupId, categories: assignment.categories, _assigned: true };
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
                      if (groupId) element.assignedMediaGroupId = groupId;
                      if (categories?.length) element.assignedMediaCategories = categories;
                      mediaAssignmentLog.push(buildMediaAssignmentLogEntry(element, selectedImages, groupId, categories));
                      applyMediaToElement(element, selectedImages);
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
                if (element.type === 'imageboolean' && element.imageHtml) {
                  // Convert imageboolean to panel - keeps everything in one frame
                  console.log(`Preview: Converting imageboolean question ${element.name} to panel with HTML`);
                  
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
                } else if (element.type === 'imagerating' && element.imageHtml) {
                  // Convert imagerating to panel - keeps everything in one frame
                  console.log(`Preview: Converting imagerating question ${element.name} to panel with HTML`);
                  
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
                } else if (element.type === 'imagematrix' && element.imageHtml) {
                  // Convert imagematrix to panel - keeps everything in one frame
                  console.log(`Preview: Converting imagematrix question ${element.name} to panel with HTML`);
                  
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
                } else if (element.type === 'mediarating' && element.imageHtml) {
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
                } else if (element.type === 'mediaboolean' && element.imageHtml) {
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
                } else if (element.type === 'imageslidergroup' && element.imageHtml) {
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
                } else if (element.type === 'imagepointallocation' && element.imageHtml) {
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
    const model = new Model(configToUse);
    
    // Apply theme (same as Live Survey) - with error handling
    try {
      if (config.theme) {
        // Use custom theme from admin config
        const customTheme = generateCustomTheme(config);
        if (customTheme) {
          console.log('Preview: Applying custom theme...');
          model.applyTheme(customTheme);
          console.log('✅ Preview applied custom theme successfully');
        }
      } else if (themeJson) {
        // Use default theme
        console.log('Preview: Applying default theme...');
        model.applyTheme(themeJson);
      }
    } catch (themeError) {
      console.error('⚠️ Error applying theme in preview, using default styling:', themeError);
      // Continue without theme - SurveyJS will use default styling
    }
    
    // Configuration already applied directly to model (via new Model(config))
    // No additional setup needed
    
    // Disable survey completion for preview
    model.mode = "display";
    
    console.log('Preview using standard SurveyJS config:', {
      title: model.title,
      description: model.description,
      logo: model.logo,
      logoPosition: model.logoPosition,
      showQuestionNumbers: model.showQuestionNumbers,
      showProgressBar: model.showProgressBar
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
        {mediaAssignments.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              This preview&apos;s media assignment (simulated participant draw)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              Refresh preview to re-roll random sets. Group mode shows which <strong>group ID</strong> was picked per question.
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 700 } }}>
                    <TableCell>Question</TableCell>
                    <TableCell>Mode</TableCell>
                    <TableCell>Group ID</TableCell>
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
                          label={row.mode === 'group' ? 'Fixed set' : row.mode === 'category' ? 'One per category' : 'Individual'}
                          color={row.mode === 'group' || row.mode === 'category' ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {row.groupId ? (
                          <Typography variant="body2" fontWeight={600} color="primary.main">{row.groupId}</Typography>
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
        <Box sx={{ maxWidth: 900, mx: 'auto', px: 2 }}>
          <Survey model={model} />
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
