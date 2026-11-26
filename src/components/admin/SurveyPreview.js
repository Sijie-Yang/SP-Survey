import React, { useState, useEffect, useMemo, useRef } from 'react';
import { alpha } from '@mui/material/styles';
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Accordion, AccordionDetails, AccordionSummary, Box, Alert, CircularProgress, Typography, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ViewportLayoutFrame from '../ViewportLayoutFrame';
import { attachPageEditor, attachQuestionEditor, attachSurveyHeader, bindLivePreviewEditing } from '../../lib/livePreviewEditing';
import { applyContentWidthToModel, configForPreviewRefresh } from '../../lib/viewportLayout';
import { generateCustomTheme, normalizeBuilderSurveyJson } from '../../lib/surveyStorage';
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
import { adaptSurveyForPreviewLibrary, resolvePreviewMediaContext, surveyUsesSampledMedia } from '../../lib/previewMediaLibrary';
import { markGuideProgress } from '../../lib/adminGuide';
import { applyRuntimeVariables, normalizeConditions } from '../../lib/surveyRuntimeContext';
import SpSitePreview from './SpSitePreview';

export function previewSourceKey(config, currentProject) {
  const images = currentProject?.preloadedImages || [];
  const dataset = currentProject?.imageDatasetConfig || {};
  return JSON.stringify({
    config: configForPreviewRefresh(config || null),
    imageKeys: images.map((img) => img.key || img.url || img.name || ''),
    imageFolders: images.map((img) => img.logicalFolder || img.folder || ''),
    mediaFolderTags: dataset.mediaFolderTags || {},
    mediaFolders: dataset.mediaFolders || [],
  });
}

// Ordering is an editing operation, not a request for another random media draw.
export function previewPreparationKey(config, project) {
  const source = JSON.parse(previewSourceKey(config, project));
  const pages = source.config?.pages;
  if (pages) {
    source.elements = pages.flatMap((p) => p.elements || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    source.config.pages = pages.map(({ elements, ...page }) => page).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return JSON.stringify(source);
}

export function reorderPreparedPreview(prepared, config) {
  const elements = new Map((prepared.pages || []).flatMap((p) => p.elements || []).map((q) => [q.name, q]));
  return { ...prepared, ...config, pages: (config.pages || []).map((page) => ({
    ...page,
    elements: page.elements?.length ? page.elements.map((q) => ({ ...elements.get(q.name), title: q.title, description: q.description }))
      : [{ type: 'html', name: `${page.name}_placeholder`, html: '<div style="height: 1px;"></div>' }],
  })) };
}

export function createSurveyPreviewModel(processedConfig, runtimeContext = null, options = {}) {
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
  applyRuntimeVariables(model, runtimeContext);
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
  // Previews never accept answers. Layout Studio still turns pages and edits layout.
  model.mode = 'display';
  try {
    model.showProgressBar = 'off';
    if (options.interactive) model.showPreviewBeforeComplete = false;
  } catch { /* ignore */ }
  return model;
}

export const DEFAULT_PREVIEW_LABELS = {
  questionText: 'Question text',
  questionDescription: 'Question description',
  pageTitle: 'Page title',
  pageDescription: 'Page description',
  surveyTitle: 'Survey title',
  surveyDescription: 'Survey description',
  editSurveyTitle: 'Edit survey title',
  editSurveyDescription: 'Edit survey description',
  moveUp: 'Move up',
  moveDown: 'Move down',
  reorderQuestion: 'Question {index} of {count}: {name}',
  reorderPage: 'Page {index} of {count}: {name}',
  moveQuestionUp: 'Move question up',
  moveQuestionDown: 'Move question down',
  movePageUp: 'Move page up',
  movePageDown: 'Move page down',
  mediaAssignment: 'Media assignment',
};

function MediaAssignmentTable({ rows }) {
  return (
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
          {rows.map((row) => (
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
  );
}

export default function SurveyPreview({
  config,
  currentProject,
  showMediaAssignment = true,
  interactive = false,
  onConfigChange = null,
  viewport = 'desktop',
  contentWidth = null,
  questionWidth = null,
  mediaMaxHeight = null,
  labels = DEFAULT_PREVIEW_LABELS,
  studio = null,
  hideSiteImportNotice = false,
}) {
  useEffect(() => { markGuideProgress(currentProject?.id, 'preview'); }, [currentProject?.id]);
  const previewRef = useRef(null);
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const preparationRef = useRef(null);
  const [processedConfig, setProcessedConfig] = useState(null);
  const [mediaAssignments, setMediaAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingPreviewLibrary, setUsingPreviewLibrary] = useState(false);
  const [mediaErrors, setMediaErrors] = useState([]);
  const [siteMediaPool, setSiteMediaPool] = useState([]);
  const sourceKey = useMemo(
    () => previewSourceKey(config, currentProject),
    [config, currentProject],
  );

  useEffect(() => {
    let cancelled = false;
    const preparationKey = previewPreparationKey(config, currentProject);
    const processConfig = async () => {
      if (interactive && preparationRef.current?.key === preparationKey) {
        setProcessedConfig(reorderPreparedPreview(preparationRef.current.config, config));
        return;
      }
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
        
        let configCopy = JSON.parse(JSON.stringify(config));
        await resolveSkillQuestions(configCopy);
        const mediaContext = surveyUsesSampledMedia(configCopy) || configCopy.spSite?.html
          ? await resolvePreviewMediaContext(currentProject || {})
          : { images: [], fromPreviewLibrary: false };
        const mediaPool = mediaContext.images;
        if (!cancelled) setSiteMediaPool(mediaPool);
        const fromPreviewLibrary = mediaContext.fromPreviewLibrary;
        if (fromPreviewLibrary) configCopy = adaptSurveyForPreviewLibrary(configCopy, mediaPool);
        if (cancelled) return;
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
        
        if (cancelled) return;
        preparationRef.current = { key: preparationKey, config: configCopy };
        setMediaAssignments(mediaAssignmentLog);
        setMediaErrors(nextMediaErrors);
        setProcessedConfig(configCopy);
      } catch (error) {
        if (cancelled) return;
        console.error('Error processing config for preview:', error);
        setMediaErrors([error.message || 'Preview could not load media.']);
        setProcessedConfig(config);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    processConfig();
    return () => { cancelled = true; };
    // sourceKey deliberately ignores live text/size edits; they sync onto the model below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, interactive]);

  const conditions = useMemo(() => normalizeConditions(config), [config]);
  const [conditionChoice, setConditionChoice] = useState(null);
  const previewCondition = conditions.length > 1
    ? (conditions.some((c) => c.id === conditionChoice) ? conditionChoice : conditions[0].id)
    : null;
  const pageRef = useRef(0);
  const modelGeneration = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const canEdit = interactive && typeof onConfigChange === 'function';
  const editorApi = useMemo(() => ({
    getConfig: () => configRef.current,
    onConfigChange: (next) => onConfigChangeRef.current?.(next),
    getLabels: () => labelsRef.current,
    getStudio: () => studioRef.current,
  }), []);
  const model = useMemo(() => {
    if (!processedConfig || loading) return null;
    const created = createSurveyPreviewModel(
      processedConfig,
      { condition: previewCondition },
      { interactive },
    );
    if (interactive) {
      const pageCount = created.visiblePageCount || created.pageCount || 1;
      const pageNo = Math.min(pageRef.current || 0, Math.max(0, pageCount - 1));
      if (pageNo > 0) created.currentPageNo = pageNo;
      created.onCurrentPageChanged.add(() => {
        pageRef.current = created.currentPageNo || 0;
        if (previewRef.current) previewRef.current.dataset.previewPage = String(pageRef.current + 1);
        studioRef.current?.onPageChange?.(created.currentPage?.name);
      });
    }
    created.__spPreviewKey = ++modelGeneration.current;
    if (canEdit) created.__spUnbindEditors = bindLivePreviewEditing(created, editorApi);
    return created;
  }, [processedConfig, loading, previewCondition, interactive, canEdit, editorApi]);

  useEffect(() => { studioRef.current?.onPageChange?.(model?.currentPage?.name || null); }, [model]);

  useEffect(() => {
    if (model) model.applyTheme(config?.theme ? generateCustomTheme({ theme: config.theme }) : themeJson);
  }, [model, config?.theme]); // Theme edits keep the current sample and page.

  const previewOrderRef = useRef(new WeakMap());
  useEffect(() => {
    if (!model || !studio?.previewOrder) return;
    Object.entries(studio.previewOrder).forEach(([name, reversed]) => {
      const question = model.getQuestionByName(name);
      if (!question) return;
      let originals = previewOrderRef.current.get(question);
      if (!originals) {
        originals = Object.fromEntries(['choices', 'imageLinks', 'selectedImageUrls'].filter(k => Array.isArray(question[k])).map(k => [k, [...question[k]]]));
        previewOrderRef.current.set(question, originals);
      }
      Object.entries(originals).forEach(([key, values]) => { question[key] = reversed ? [...values].reverse() : [...values]; });
    });
  }, [model, studio?.previewOrder]);

  useEffect(() => () => {
    model?.__spUnbindEditors?.();
    model?.dispose?.();
  }, [model]);

  useEffect(() => {
    if (!canEdit || !model) return undefined;
    const title = config?.title || '';
    // Keep the active editor mounted even while the user clears all text.
    // The invisible placeholder lives only in this preview model, never in config.
    const descriptionValue = (kind, name, value) => value || (studio?.editingDescription?.kind === kind && (studio.editingDescription.name || '') === name ? '\u200b' : '');
    const description = descriptionValue('survey', '', config?.description);
    const logo = config?.logo || '';
    if ((model.title || '') !== title) model.title = title;
    if ((model.description || '') !== description) model.description = description;
    if ((model.logo || '') !== logo) model.logo = logo;
    (config?.pages || []).forEach((page) => {
      const livePage = model.getPageByName(page.name);
      ['title', 'description'].forEach((field) => {
        const value = field === 'description' ? descriptionValue('page', page.name, page[field]) : page[field] || '';
        if (livePage && (livePage[field] || '') !== value) livePage[field] = value;
      });
      (page.elements || []).forEach((element) => {
        const live = model.getQuestionByName(element.name);
        ['title', 'description'].forEach((field) => {
          const value = field === 'description' ? descriptionValue('question', element.name, element[field]) : element[field] || '';
          if (live && (live[field] || '') !== value) {
            const descriptionVisibilityChanged = field === 'description' && Boolean(live[field]) !== Boolean(value);
            live[field] = value;
            // SurveyJS caches description CSS when initially empty. Refresh it
            // when adding/removing a description so styling and selection bind.
            if (descriptionVisibilityChanged) live.updateElementCss?.(true);
          }
        });
      });
    });
    return undefined;
  }, [canEdit, model, config, studio?.editingDescription]);

  useEffect(() => {
    if (!canEdit || !model) return undefined;
    let cancelled = false;
    const bind = () => {
      if (cancelled) return;
      const previewRoot = previewRef.current;
      // SurveyJS can replace only the description after a live text update.
      // Its React rootRef is not available in every renderer/version.
      const questionRoots = new Map(Array.from(previewRoot?.querySelectorAll('[data-sp-question-name]') || [], (root) => [root.dataset.spQuestionName, root]));
      const questions = typeof model.getAllQuestions === 'function' ? model.getAllQuestions() : [];
      questions.forEach((question) => {
        const root = question?.react?.rootRef?.current || questionRoots.get(question.name);
        if (root) attachQuestionEditor(root, question, editorApi);
      });
      const pageRoot = previewRoot?.querySelector('.sd-page');
      if (pageRoot && model.currentPage) attachPageEditor(pageRoot, model.currentPage, editorApi);
      if (previewRoot) {
        attachSurveyHeader(previewRoot, model, editorApi);
        previewRoot.querySelectorAll('[data-sp-edit]').forEach((node) => {
          node.contentEditable = studioRef.current?.guides === false || node.dataset.spMarkdown === 'true' ? 'false' : 'true';
          node.tabIndex = studioRef.current?.guides === false ? -1 : 0;
        });
      }
    };
    // SurveyJS may mount a new string viewer after the scheduled render frames
    // (notably undoing a cleared description). Bind that new node as it arrives.
    let rebindFrame;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === 1 && (node.matches('.sv-string-viewer') || node.querySelector('.sv-string-viewer'))))) {
        cancelAnimationFrame(rebindFrame);
        rebindFrame = requestAnimationFrame(bind);
      }
    });
    if (previewRef.current) observer.observe(previewRef.current, { childList: true, subtree: true });
    bind();
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(bind);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(rebindFrame);
      observer.disconnect();
    };
  }, [canEdit, model, editorApi, config, viewport, contentWidth, questionWidth, mediaMaxHeight, studio]);

  useEffect(() => {
    if (!model || !studio?.selection?.pageName || studio?.editingDescription) return;
    const page = model.getPageByName(studio.selection.pageName);
    if (page && model.currentPage !== page) model.currentPage = page;
    const frame = requestAnimationFrame(() => {
      const question = model.getQuestionByName(studio.selection.name);
      question?.react?.rootRef?.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [model, studio?.selection?.pageName, studio?.selection?.name, studio?.editingDescription]);

  useEffect(() => {
    if (!interactive || !model) return;
    applyContentWidthToModel(model, contentWidth);
  }, [interactive, model, contentWidth]);

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

  if (config.spSite?.html && processedConfig) {
    return (
      <SpSitePreview
        config={processedConfig}
        spSite={config.spSite}
        mediaPool={siteMediaPool}
        previewLibrary={usingPreviewLibrary}
        viewport={interactive ? viewport : 'desktop'}
        hideImportNotice={hideSiteImportNotice}
      />
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
    
    const mediaTable = showMediaAssignment && mediaAssignments.length > 0 ? (
      <MediaAssignmentTable rows={mediaAssignments} />
    ) : null;
    const surveyBody = (
      <Box
        className="sp-survey-with-progress"
        sx={interactive || config?.viewportLayout ? undefined : { maxWidth: 900, mx: 'auto', px: { xs: 0, sm: 2 } }}
      >
        <SurveyTrialNavProvider key={model.__spPreviewKey}>
          <SurveyProgressBridge
            surveyModel={model}
            progressEnabled={progressEnabled}
            theme={config?.theme || null}
          />
          <Survey model={model} />
        </SurveyTrialNavProvider>
      </Box>
    );

    return (
      <Box
        ref={previewRef}
        data-preview-mode={interactive ? 'format' : 'display'}
        data-preview-page={String((model.currentPageNo || 0) + 1)}
        sx={{ maxHeight: interactive ? 'none' : '70vh', overflow: 'auto' }}
      >
        {!interactive && (
          <Box sx={{
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            color: 'text.primary',
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.25),
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
        )}
        {conditions.length > 1 && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
            <Typography variant="body2">Condition:</Typography>
            {conditions.map((c) => (
              <Chip
                key={c.id}
                size="small"
                label={c.label}
                color={c.id === previewCondition ? 'primary' : 'default'}
                onClick={() => setConditionChoice(c.id)}
              />
            ))}
          </Box>
        )}
        {mediaErrors.map((message) => (
          <Alert key={message} severity="error" sx={{ mb: 1 }}>{message}</Alert>
        ))}
        {!interactive && mediaTable && (
          <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              This preview&apos;s media assignment (simulated participant draw)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              Refresh preview to re-roll random sets. Set mode shows which <strong>set ID</strong> was picked per question.
            </Typography>
            {mediaTable}
          </Box>
        )}
        {interactive ? (
          <ViewportLayoutFrame
            config={config}
            forcedViewport={viewport}
            contentWidth={contentWidth}
            questionWidth={questionWidth}
            mediaMaxHeight={mediaMaxHeight}
            surveyModel={model}
          >
            {surveyBody}
          </ViewportLayoutFrame>
        ) : (
          <ViewportLayoutFrame config={config} surveyModel={model}>
            {surveyBody}
          </ViewportLayoutFrame>
        )}
        {interactive && mediaTable && (
          <Accordion disableGutters elevation={0} sx={{ mt: 2, border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2">{labels.mediaAssignment}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                Refresh preview to re-roll random sets. Set mode shows which set ID was picked per question.
              </Typography>
              {mediaTable}
            </AccordionDetails>
          </Accordion>
        )}
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
