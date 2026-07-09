import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Box,
  Typography,
  Grid,
  Card,
  CardMedia,
  CardActions,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Checkbox,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  Add,
  Delete
} from '@mui/icons-material';
import { listSkillsForBuilder } from '../../lib/skillManager';
import { filterPoolForQuestion, getMediaPoolStatus } from '../../lib/surveyMediaInjection';
import { getMediaCategories } from '../../lib/mediaUtils';
import { SkillDimensionsEditor, SkillStringListEditor } from './SkillConfigFieldEditors';
import SkillQuestionFrame from '../SkillQuestionWidget';
import { buildFallbackDemoImages } from '../../lib/presetSkills';
import { MediaPairingGuide } from './MediaPairingGuide';
import { MediaCategoryGuide } from './MediaCategoryGuide';

function AttentionCheckFields({ question, onChange }) {
  const supported = ['rating', 'radiogroup', 'imagepicker'].includes(question.type);
  if (!supported) return null;
  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Attention Check (data quality)
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={!!question.isAttentionCheck}
            onChange={(e) => onChange('isAttentionCheck', e.target.checked)}
          />
        }
        label="Mark as attention-check question"
      />
      {question.isAttentionCheck && (
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          label="Expected answer"
          value={question.expectedAnswer ?? ''}
          onChange={(e) => onChange('expectedAnswer', e.target.value)}
          helperText={
            question.type === 'imagepicker'
              ? 'Filename or choice value the participant must select (checked in analysis, not blocked at submit)'
              : 'Exact value the participant must select (checked in analysis, not blocked at submit)'
          }
        />
      )}
    </Box>
  );
}

function MediaAssignmentFields({ question, onChange, currentProject }) {
  const mode = question.mediaAssignmentMode || 'individual';
  const isGroup = mode === 'group';
  const isCategory = mode === 'category';
  const count = question.imageCount || 1;
  const poolStatus = React.useMemo(() => {
    if (!currentProject?.preloadedImages?.length) {
      return {
        totalFileCount: 0,
        matchingFileCount: 0,
        mediaTypeFilter: 'any',
        pairedSetCount: 0,
        projectCategoryCount: 0,
        matchingCategoryCount: 0,
        matchingCategoryLabels: [],
        eligibleGroupCount: isGroup ? 0 : null,
        filesPerSet: count,
      };
    }
    return getMediaPoolStatus(currentProject.preloadedImages, question);
  }, [currentProject?.preloadedImages, question, isGroup, count]);

  const mediaTypeHint = poolStatus.mediaTypeFilter !== 'any'
    ? ` (${poolStatus.mediaTypeFilter} only)`
    : '';

  return (
    <>
      <FormControl fullWidth variant="outlined">
        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Media Assignment</InputLabel>
        <Select
          value={mode}
          onChange={(e) => onChange('mediaAssignmentMode', e.target.value)}
          label="Media Assignment"
        >
          <MenuItem value="individual">Random individual files</MenuItem>
          <MenuItem value="group">Random fixed sets (filename pairs/groups)</MenuItem>
          <MenuItem value="category">One per category (random within each class)</MenuItem>
        </Select>
      </FormControl>
      {isGroup && (
        <>
          {poolStatus.totalFileCount === 0 ? (
            <Alert severity="warning">No media in project — upload files in Image Dataset first.</Alert>
          ) : poolStatus.matchingFileCount === 0 ? (
            <Alert severity="warning">
              {poolStatus.totalFileCount} file(s) in project, but none match this question&apos;s media type
              filter{mediaTypeHint}.
            </Alert>
          ) : poolStatus.eligibleGroupCount === 0 ? (
            <Alert severity="warning">
              No paired sets in matching media ({poolStatus.matchingFileCount} individual file(s){mediaTypeHint}).
              Filenames need <code>__</code> (e.g. <code>scene__1.jpg</code> + <code>scene__2.jpg</code>).
              Files like <code>image_1.jpg</code> are not sets.
            </Alert>
          ) : (
            <Alert severity="success">
              {poolStatus.eligibleGroupCount} paired set(s) of size {poolStatus.filesPerSet} available
              ({poolStatus.matchingFileCount} matching file(s){mediaTypeHint}).
            </Alert>
          )}
          <MediaPairingGuide
            compact
            context="question"
            totalFileCount={poolStatus.totalFileCount}
            matchingFileCount={poolStatus.matchingFileCount}
            mediaTypeFilter={poolStatus.mediaTypeFilter}
            pairedSetCount={poolStatus.pairedSetCount}
            eligibleGroupCount={poolStatus.eligibleGroupCount}
            filesPerSet={poolStatus.filesPerSet}
          />
        </>
      )}
      {isCategory && (
        <>
          {poolStatus.totalFileCount === 0 ? (
            <Alert severity="warning">No media in project — upload files in Image Dataset first.</Alert>
          ) : poolStatus.matchingCategoryCount > 0 ? (
            <Alert severity="success">
              This question will show <strong>{poolStatus.matchingCategoryCount} file(s)</strong>
              {' '}— one from each category:{' '}
              {poolStatus.matchingCategoryLabels.map((c) => (
                <code key={c} style={{ marginRight: 6 }}>{c}</code>
              ))}
              {mediaTypeHint && <span>{mediaTypeHint}</span>}
            </Alert>
          ) : poolStatus.projectCategoryCount > 0 && poolStatus.matchingFileCount === 0 ? (
            <Alert severity="warning">
              {poolStatus.projectCategoryCount} categor{poolStatus.projectCategoryCount === 1 ? 'y' : 'ies'} in project,
              but no media matches this question&apos;s type filter{mediaTypeHint}.
            </Alert>
          ) : poolStatus.projectCategoryCount > 0 ? (
            <Alert severity="warning">
              {poolStatus.projectCategoryCount} categor{poolStatus.projectCategoryCount === 1 ? 'y' : 'ies'} in project,
              but none in the {poolStatus.matchingFileCount} matching file(s){mediaTypeHint}.
              Check category <code>@</code> prefixes on filtered media types.
            </Alert>
          ) : (
            <Alert severity="warning">
              No categorized media in project ({poolStatus.totalFileCount} file(s) without <code>category@</code> prefix).
              Example: <code>street@photo.jpg</code>, <code>park@photo.jpg</code>.
            </Alert>
          )}
          <MediaCategoryGuide
            compact
            context="question"
            categoryCount={poolStatus.matchingCategoryCount}
            projectCategoryCount={poolStatus.projectCategoryCount}
            categoryLabels={poolStatus.matchingCategoryLabels}
            totalFileCount={poolStatus.totalFileCount}
            matchingFileCount={poolStatus.matchingFileCount}
            mediaTypeFilter={poolStatus.mediaTypeFilter}
          />
        </>
      )}
      {!isGroup && !isCategory && (
        <Typography variant="caption" color="text.secondary" display="block">
          Picks {count} unrelated file(s) from the project media pool
          {poolStatus.totalFileCount > 0
            ? ` (${poolStatus.matchingFileCount} matching${mediaTypeHint}).`
            : ' — upload media in Image Dataset first.'}
        </Typography>
      )}
    </>
  );
}

// JSON config field with local text state so invalid intermediate input
// doesn't corrupt skillConfig; commits on successful parse.
function SkillJsonField({ label, value, onCommit }) {
  const [text, setText] = useState(JSON.stringify(value ?? null, null, 2));
  const [invalid, setInvalid] = useState(false);

  const handleChange = (raw) => {
    setText(raw);
    try {
      onCommit(JSON.parse(raw));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <TextField
      fullWidth
      variant="outlined"
      multiline
      minRows={3}
      maxRows={10}
      label={label}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      error={invalid}
      helperText={invalid ? 'Invalid JSON — changes not applied' : 'JSON value'}
      sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
    />
  );
}

export default function QuestionEditor({ question, onSave, onCancel, images, currentProject }) {
  // Convert ranking with isImageRanking back to imageranking for editing
  const initialQuestion = { ...question };
  if (initialQuestion.type === 'ranking' && initialQuestion.isImageRanking) {
    initialQuestion.type = 'imageranking';
  }
  
  const [editedQuestion, setEditedQuestion] = useState(initialQuestion);
  const [newChoice, setNewChoice] = useState('');
  
  // Image selection states
  const [availableImages, setAvailableImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [builderSkills, setBuilderSkills] = useState([]);

  useEffect(() => {
    listSkillsForBuilder().then(setBuilderSkills);
  }, []);

  const baseQuestionTypes = [
    { value: 'text', label: 'Text Input' },
    { value: 'comment', label: 'Text Multi-line Input' },
    { value: 'radiogroup', label: 'Text Single Choice' },
    { value: 'checkbox', label: 'Text Multiple Choice' },
    { value: 'imagepicker', label: 'Image Choice' },
    { value: 'ranking', label: 'Text Ranking' },
    { value: 'imageranking', label: 'Image Ranking' },
    { value: 'rating', label: 'Text Rating Scale' },
    { value: 'imagerating', label: 'Image Rating Scale' },
    { value: 'boolean', label: 'Text Yes/No' },
    { value: 'imageboolean', label: 'Image Yes/No' },
    { value: 'dropdown', label: 'Text Dropdown' },
    { value: 'matrix', label: 'Matrix' },
    { value: 'imagematrix', label: 'Image Matrix' },
    { value: 'slidergroup', label: 'Slider Group (Semantic Differential)' },
    { value: 'imageslidergroup', label: 'Image Slider Group (Semantic Differential)' },
    { value: 'pointallocation', label: 'Point Allocation (Budget)' },
    { value: 'imagepointallocation', label: 'Image Point Allocation (Budget)' },
    { value: 'expression', label: 'Text Instruction' },
    { value: 'image', label: 'Image Display (single image only)' },
    { value: 'mediadisplay', label: 'Media Display (multi-image / video / audio)' },
    { value: 'mediarating', label: 'Media Rating Scale' },
    { value: 'mediaboolean', label: 'Media Yes/No' },
    { value: 'imageannotation', label: 'Image Annotation' },
    { value: 'skillquestion', label: 'Custom Skill Question' },
  ];

  const questionTypes = [
    ...baseQuestionTypes,
    ...builderSkills.map((s) => ({
      value: `skill:${s.id}`,
      label: s.scope === 'mine' && !s.is_approved ? `Skill (Mine): ${s.name}` : `Skill: ${s.name}`,
    })),
  ];

  const handleQuestionChange = (field, value) => {
    const updates = { [field]: value };
    
    if (field === 'mediaAssignmentMode' && value === 'category' && currentProject?.preloadedImages?.length) {
      const pool = filterPoolForQuestion(currentProject.preloadedImages, {
        ...editedQuestion,
        mediaAssignmentMode: value,
      });
      const n = getMediaCategories(pool).length;
      if (n > 0) updates.imageCount = n;
    }

    // Set default properties when question type changes to image type
    if (field === 'type') {
      if (String(value).startsWith('skill:')) {
        const skillId = String(value).slice(6);
        const skill = builderSkills.find((s) => s.id === skillId);
        updates.type = 'skillquestion';
        updates.skillId = skillId;
        updates.skillHtml = skill?.sourceHtml || '';
        updates.skillConfig = skill?.defaultConfig || {};
        updates.skillResultSchema = skill?.resultSchema || [];
        updates.randomImageSelection = true;
        updates.imageSelectionMode = 'huggingface_random';
        updates.excludePreviouslyUsedImages = true;
        updates.imageCount = skill?.defaultConfig?.mediaCount || 1;
        return setEditedQuestion({ ...editedQuestion, ...updates });
      }
      // Types that should have 1 image/media by default
      if (value === 'imagerating' || value === 'imagematrix' || value === 'imageboolean' || value === 'image'
        || value === 'imageslidergroup' || value === 'imagepointallocation'
        || value === 'mediadisplay' || value === 'mediarating' || value === 'mediaboolean' || value === 'imageannotation') {
        if (!editedQuestion.imageCount) updates.imageCount = 1;
        if (value === 'image') updates.imageCount = 1;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        updates.choices = updates.choices || [];
        if (['mediadisplay', 'mediarating', 'mediaboolean'].includes(value)) {
          updates.mediaType = 'any';
        }
        if (value === 'imageannotation') {
          updates.allowedTools = ['point', 'line', 'region'];
          if (editedQuestion.minAnnotations == null) updates.minAnnotations = 0;
          if (editedQuestion.maxAnnotations == null) updates.maxAnnotations = 50;
        }
      }
      else if (value === 'slidergroup') {
        if (!editedQuestion.dimensions?.length) {
          updates.dimensions = [
            { id: 'dim_1', left: 'Negative', right: 'Positive' },
            { id: 'dim_2', left: 'Unpleasant', right: 'Pleasant' },
          ];
        }
        if (editedQuestion.scaleMin == null) updates.scaleMin = 1;
        if (editedQuestion.scaleMax == null) updates.scaleMax = 7;
      }
      else if (value === 'imageslidergroup') {
        if (!editedQuestion.imageCount) updates.imageCount = 1;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        if (!editedQuestion.dimensions?.length) {
          updates.dimensions = [
            { id: 'dim_1', left: 'Negative', right: 'Positive' },
            { id: 'dim_2', left: 'Unpleasant', right: 'Pleasant' },
          ];
        }
        if (editedQuestion.scaleMin == null) updates.scaleMin = 1;
        if (editedQuestion.scaleMax == null) updates.scaleMax = 7;
      }
      else if (value === 'pointallocation') {
        if (editedQuestion.budget == null) updates.budget = 100;
        updates.choices = editedQuestion.choices || [];
      }
      else if (value === 'imagepointallocation') {
        if (!editedQuestion.imageCount) updates.imageCount = 1;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        if (editedQuestion.budget == null) updates.budget = 100;
        updates.choices = editedQuestion.choices || [];
      }
      // Types that should have 4 images by default
      else if (value === 'imagepicker' || value === 'imageranking') {
        if (!editedQuestion.imageCount) {
          updates.imageCount = 4;
        }
        // ✅ Auto-set Hugging Face random image selection for all image questions
        // This ensures images are randomly selected from the Hugging Face dataset
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        updates.choices = updates.choices || [];
      }
    }
    
    setEditedQuestion({
      ...editedQuestion,
      ...updates
    });
  };

  const addChoice = () => {
    if (!newChoice.trim()) return;
    
    const choices = editedQuestion.choices || [];
    // Use SurveyJS standard format: {value, text}
    const choiceValue = newChoice.trim().toLowerCase().replace(/\s+/g, '_');
    const newChoiceObj = {
      value: choiceValue,
      text: newChoice.trim()
    };
    const newChoices = [...choices, newChoiceObj];
    
    setEditedQuestion({
      ...editedQuestion,
      choices: newChoices
    });
    setNewChoice('');
  };

  const removeChoice = (index) => {
    const newChoices = editedQuestion.choices.filter((_, i) => i !== index);
    setEditedQuestion({
      ...editedQuestion,
      choices: newChoices
    });
  };

  const addRankingChoice = () => {
    if (!newChoice.trim()) return;
    
    const choices = editedQuestion.choices || [];
    const newChoices = [...choices, { value: newChoice.toLowerCase().replace(/\s+/g, '_'), text: newChoice.trim() }];
    
    setEditedQuestion({
      ...editedQuestion,
      choices: newChoices
    });
    setNewChoice('');
  };

  const removeRankingChoice = (index) => {
    const newChoices = editedQuestion.choices.filter((_, i) => i !== index);
    setEditedQuestion({
      ...editedQuestion,
      choices: newChoices
    });
  };

  const needsChoices = ['radiogroup', 'checkbox', 'dropdown', 'ranking', 'pointallocation', 'imagepointallocation'].includes(editedQuestion.type);
  const isImageQuestion = ['imagepicker', 'image', 'imageranking', 'imagerating', 'imageboolean', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(editedQuestion.type);
  const isRankingQuestion = editedQuestion.type === 'ranking';
  const isImageRankingQuestion = editedQuestion.type === 'imageranking';

  // Load images from Hugging Face when image questions are selected and in manual mode
  useEffect(() => {
    if ((editedQuestion.type === 'imagepicker' || editedQuestion.type === 'imageranking' || editedQuestion.type === 'imagerating' || editedQuestion.type === 'imageboolean' || editedQuestion.type === 'image' || editedQuestion.type === 'imagematrix' || editedQuestion.type === 'imageslidergroup' || editedQuestion.type === 'imagepointallocation') && editedQuestion.imageSelectionMode === 'huggingface_manual') {
      loadImages();
    }
  }, [editedQuestion.type, editedQuestion.imageSelectionMode]);

  // Initialize selected images from existing question data
  useEffect(() => {
    if ((editedQuestion.type === 'imagepicker' || editedQuestion.type === 'imageranking' || editedQuestion.type === 'imagerating' || editedQuestion.type === 'imageboolean' || editedQuestion.type === 'image' || editedQuestion.type === 'imagematrix' || editedQuestion.type === 'imageslidergroup' || editedQuestion.type === 'imagepointallocation') && editedQuestion.selectedImageUrls) {
      setSelectedImages(editedQuestion.selectedImageUrls);
    }
  }, [editedQuestion.type]);

  // ✅ Auto-initialize image questions with random selection mode if not set
  useEffect(() => {
    const imageQuestionTypes = ['imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageslidergroup', 'imagepointallocation'];
    
    if (imageQuestionTypes.includes(editedQuestion.type)) {
      // Check if imageSelectionMode is missing or undefined
      if (!editedQuestion.imageSelectionMode) {
        console.log('🔧 Auto-setting imageSelectionMode to huggingface_random for', editedQuestion.type);
        setEditedQuestion(prev => ({
          ...prev,
          imageSelectionMode: 'huggingface_random',
          randomImageSelection: true,
          excludePreviouslyUsedImages: true,
          choices: prev.choices || []
        }));
      }
    }
  }, [editedQuestion.type]);

  const loadImages = async () => {
    // Only load from Hugging Face now
    if (editedQuestion.imageSelectionMode === 'huggingface_manual') {
      return loadImagesFromHuggingFace();
    }
  };

  const loadImagesFromHuggingFace = async () => {
    if (!currentProject?.imageDatasetConfig?.enabled || !currentProject?.imageDatasetConfig?.datasetName) {
      setImageError('Hugging Face dataset not configured for this project');
      return;
    }

    setLoadingImages(true);
    setImageError(null);

    try {
      // Import Hugging Face functions dynamically
      const { getImagesFromHuggingFace } = await import('../../lib/huggingface');
      
      const { huggingFaceToken, datasetName } = currentProject.imageDatasetConfig;
      
      // Load ALL images from the dataset (since they're just URLs)
      const allImages = [];
      let offset = 0;
      const batchSize = 100;
      let hasMore = true;
      
      console.log('Loading all images from Hugging Face dataset...');
      
      while (hasMore) {
        const result = await getImagesFromHuggingFace(huggingFaceToken, datasetName, batchSize, offset);
        
        if (result.success && result.images.length > 0) {
          allImages.push(...result.images);
          offset += batchSize;
          
          console.log(`Loaded batch: ${result.images.length} images (total so far: ${allImages.length})`);
          
          // Check if we've reached the end
          if (result.images.length < batchSize || (result.total && offset >= result.total)) {
            hasMore = false;
          }
        } else {
          hasMore = false;
          if (allImages.length === 0) {
            setImageError(`Failed to load images from Hugging Face: ${result.error}`);
          }
        }
      }
      
      if (allImages.length > 0) {
        setAvailableImages(allImages);
        setImageError(null);
        console.log(`✅ Successfully loaded ALL ${allImages.length} images from Hugging Face dataset`);
      } else {
        setImageError('No images found in the Hugging Face dataset');
        setAvailableImages([]);
      }
    } catch (error) {
      console.error('Error loading images from Hugging Face:', error);
      setImageError(`Error loading images from Hugging Face: ${error.message}`);
      setAvailableImages([]);
    } finally {
      setLoadingImages(false);
    }
  };


  const handleImageSelection = (imageUrl, selected) => {
    if (selected) {
      if (selectedImages.length < (editedQuestion.imageCount || 4)) {
        const newSelected = [...selectedImages, imageUrl];
        setSelectedImages(newSelected);
        handleQuestionChange('selectedImageUrls', newSelected);
      }
    } else {
      const newSelected = selectedImages.filter(url => url !== imageUrl);
      setSelectedImages(newSelected);
      handleQuestionChange('selectedImageUrls', newSelected);
    }
  };

  return (
    <Dialog open={true} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Question
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Basic Question Settings */}
          <Box>
            <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
              Basic Settings
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <TextField
                fullWidth
                variant="outlined"
                label="Question Name (Internal ID)"
                value={editedQuestion.name || ''}
                onChange={(e) => handleQuestionChange('name', e.target.value)}
                helperText="Used internally to identify this question (e.g., 'age_group', 'satisfaction_rating')"
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
              
              <FormControl fullWidth variant="outlined">
                <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Question Type</InputLabel>
                <Select
                  value={editedQuestion.type === 'skillquestion' && editedQuestion.skillId
                    ? `skill:${editedQuestion.skillId}` : (editedQuestion.type || 'text')}
                  onChange={(e) => handleQuestionChange('type', e.target.value)}
                  label="Question Type"
                >
                  {questionTypes.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                variant="outlined"
                label="Question Title"
                value={editedQuestion.title || ''}
                onChange={(e) => handleQuestionChange('title', e.target.value)}
                helperText="The main question text that participants will see"
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />

              <TextField
                fullWidth
                variant="outlined"
                multiline
                rows={2}
                label="Question Description (Optional)"
                value={editedQuestion.description || ''}
                onChange={(e) => handleQuestionChange('description', e.target.value)}
                helperText="Additional instructions or context for this question"
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />

              {['mediadisplay', 'mediarating', 'mediaboolean'].includes(editedQuestion.type) && (
                <FormControl fullWidth variant="outlined">
                  <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Media Type Filter</InputLabel>
                  <Select
                    value={editedQuestion.mediaType || 'any'}
                    label="Media Type Filter"
                    onChange={(e) => handleQuestionChange('mediaType', e.target.value)}
                  >
                    <MenuItem value="any">Any (image/video/audio)</MenuItem>
                    <MenuItem value="image">Image only</MenuItem>
                    <MenuItem value="video">Video only</MenuItem>
                    <MenuItem value="audio">Audio only</MenuItem>
                  </Select>
                </FormControl>
              )}

              {editedQuestion.type === 'imageannotation' && (
                <Alert severity="info">
                  Participants can draw points, lines, and regions on a randomly selected image.
                  Set minimum / maximum annotation counts in Annotation Settings below.
                </Alert>
              )}

              {editedQuestion.type === 'skillquestion' && editedQuestion.skillId && (() => {
                const skillDef = builderSkills.find((s) => s.id === editedQuestion.skillId);
                const schema = skillDef?.configSchema || [];
                const cfg = editedQuestion.skillConfig || {};
                const mediaTypeLabel = cfg.mediaType === 'video' ? 'video'
                  : cfg.mediaType === 'audio' ? 'audio'
                  : cfg.mediaType === 'any' ? 'media file' : 'image';
                const setCfg = (key, value) => handleQuestionChange('skillConfig', { ...cfg, [key]: value });
                const setMediaCount = (n) => {
                  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), 6);
                  setEditedQuestion({
                    ...editedQuestion,
                    imageCount: count,
                    skillConfig: { ...cfg, mediaCount: count },
                  });
                };
                const editableSchema = schema.filter((f) => !['mediaCount', 'mediaType'].includes(f.key));
                const renderSchemaField = (field) => {
                  const val = cfg[field.key];
                  if (field.type === 'boolean') {
                    return (
                      <FormControlLabel
                        key={field.key}
                        control={
                          <Switch
                            checked={!!val}
                            onChange={(e) => setCfg(field.key, e.target.checked)}
                          />
                        }
                        label={field.label || field.key}
                      />
                    );
                  }
                  if (field.type === 'number') {
                    return (
                      <TextField
                        key={field.key}
                        fullWidth
                        type="number"
                        variant="outlined"
                        label={field.label || field.key}
                        value={val ?? ''}
                        onChange={(e) => setCfg(field.key, e.target.value === '' ? undefined : Number(e.target.value))}
                        inputProps={{
                          min: field.min,
                          max: field.max,
                          step: field.step || 1,
                        }}
                        sx={{ bgcolor: 'white' }}
                      />
                    );
                  }
                  if (field.type === 'dimensions') {
                    return (
                      <Box key={field.key}>
                        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{field.label || 'Scale dimensions'}</Typography>
                        <SkillDimensionsEditor
                          value={val}
                          onChange={(parsed) => setCfg(field.key, parsed)}
                          scaleMin={cfg.scaleMin ?? field.scaleMin ?? 1}
                          scaleMax={cfg.scaleMax ?? field.scaleMax ?? 7}
                        />
                      </Box>
                    );
                  }
                  if (field.type === 'stringList') {
                    return (
                      <Box key={field.key}>
                        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{field.label || field.key}</Typography>
                        <SkillStringListEditor
                          value={val}
                          onChange={(parsed) => setCfg(field.key, parsed)}
                          label={field.itemLabel || 'Item'}
                          placeholder={field.placeholder || 'items'}
                        />
                      </Box>
                    );
                  }
                  if (field.type === 'json') {
                    return (
                      <SkillJsonField
                        key={field.key}
                        label={field.label || field.key}
                        value={val}
                        onCommit={(parsed) => setCfg(field.key, parsed)}
                      />
                    );
                  }
                  if (field.type === 'select' && Array.isArray(field.options)) {
                    return (
                      <FormControl key={field.key} fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{field.label || field.key}</InputLabel>
                        <Select
                          value={val ?? ''}
                          label={field.label || field.key}
                          onChange={(e) => setCfg(field.key, e.target.value)}
                        >
                          {field.options.map((opt) => (
                            <MenuItem key={String(opt)} value={opt}>{String(opt)}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    );
                  }
                  return (
                    <TextField
                      key={field.key}
                      fullWidth
                      variant="outlined"
                      label={field.label || field.key}
                      value={val ?? ''}
                      onChange={(e) => setCfg(field.key, e.target.value)}
                      multiline={field.type === 'text'}
                      rows={field.type === 'text' ? 3 : undefined}
                      sx={{ bgcolor: 'white' }}
                    />
                  );
                };
                return (
                  <>
                    <Alert severity="success">
                      Using Skill: {skillDef?.name || editedQuestion.skillId}
                    </Alert>
                    {skillDef?.sourceHtml && editedQuestion.skillHtml
                      && skillDef.sourceHtml !== editedQuestion.skillHtml && (
                      <Alert
                        severity="warning"
                        sx={{ mt: 1 }}
                        action={(
                          <Button
                            color="inherit"
                            size="small"
                            onClick={() => {
                              setEditedQuestion({
                                ...editedQuestion,
                                skillHtml: skillDef.sourceHtml,
                                skillConfig: { ...(skillDef.defaultConfig || {}), ...(editedQuestion.skillConfig || {}) },
                              });
                            }}
                          >
                            Update now
                          </Button>
                        )}
                      >
                        This question uses an older copy of the skill. Update to the latest library version
                        to get new configurable fields (your current settings are kept).
                      </Alert>
                    )}
                    <Alert severity="info" sx={{ mt: 1 }}>
                      <strong>Question Title</strong> above is shown to participants as the survey question heading.
                      Use <strong>Prompt</strong> below for instructions inside the skill widget.
                    </Alert>
                    <Box sx={{ mt: 2 }}>
                      <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />
                    </Box>
                    <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                        Skill Settings
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                          fullWidth
                          type="number"
                          variant="outlined"
                          label="Media count"
                          value={cfg.mediaCount ?? editedQuestion.imageCount ?? 1}
                          onChange={(e) => setMediaCount(e.target.value)}
                          helperText={`Number of ${mediaTypeLabel}(s) injected from the project media pool`}
                          inputProps={{ min: 1, max: 6, step: 1 }}
                          sx={{ bgcolor: 'white' }}
                        />
                        <FormControl fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                          <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Media type</InputLabel>
                          <Select
                            value={cfg.mediaType || 'image'}
                            label="Media type"
                            onChange={(e) => setCfg('mediaType', e.target.value)}
                          >
                            <MenuItem value="image">Image</MenuItem>
                            <MenuItem value="video">Video</MenuItem>
                            <MenuItem value="audio">Audio</MenuItem>
                            <MenuItem value="any">Any (mixed)</MenuItem>
                          </Select>
                        </FormControl>
                        {editableSchema.length === 0 && (
                          <Alert severity="warning" sx={{ py: 0.5 }}>
                            This skill has no extra config fields. Edit the skill source in My Skill Library to expose
                            prompts, scales, or dimensions via configSchema.
                          </Alert>
                        )}
                        {editableSchema.map((field) => renderSchemaField(field))}
                      </Box>
                    </Box>
                    {(() => {
                      const previewHtml = editedQuestion.skillHtml || skillDef?.sourceHtml;
                      if (!previewHtml) return null;
                      const mergedCfg = { ...(skillDef?.defaultConfig || {}), ...cfg };
                      const count = mergedCfg.mediaCount || editedQuestion.imageCount || 1;
                      let previewImages = [];
                      if (currentProject?.preloadedImages?.length) {
                        previewImages = filterPoolForQuestion(currentProject.preloadedImages, editedQuestion).slice(0, count);
                      }
                      if (!previewImages.length) {
                        previewImages = buildFallbackDemoImages(count, mergedCfg.mediaType || 'image', editedQuestion.skillId);
                      }
                      return (
                        <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'primary.light', borderRadius: 1, bgcolor: 'white' }}>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                            Live Preview
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                            Updates as you change settings above. Uses project media when available, otherwise demo images.
                          </Typography>
                          <SkillQuestionFrame
                            skillHtml={previewHtml}
                            config={mergedCfg}
                            images={previewImages}
                            readOnly
                          />
                        </Box>
                      );
                    })()}
                  </>
                );
              })()}

              <FormControlLabel
                control={
                  <Switch
                    checked={editedQuestion.isRequired || false}
                    onChange={(e) => handleQuestionChange('isRequired', e.target.checked)}
                  />
                }
                label="Required Question - participants must answer this question to continue"
              />
            </Box>
          </Box>

          {/* Image Choice for Image Questions */}
          {isImageQuestion && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Image Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editedQuestion.excludePreviouslyUsedImages !== false}
                      onChange={(e) => handleQuestionChange('excludePreviouslyUsedImages', e.target.checked)}
                    />
                  }
                  label="Ensure images in this question have not been used earlier in this survey"
                />

                <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />

                {editedQuestion.type === 'imagepicker' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Show"
                      value={editedQuestion.imageCount || 4}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 20));
                      }}
                      onFocus={(e) => e.target.select()}
                      helperText={editedQuestion.imageSelectionMode === 'huggingface_random' 
                        ? "How many images to randomly select from Hugging Face" 
                        : "How many images you will manually select"}
                      inputProps={{ min: 1, max: 20, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    
                    <FormControlLabel
                      control={
                        <Switch
                          checked={editedQuestion.multiSelect || false}
                          onChange={(e) => handleQuestionChange('multiSelect', e.target.checked)}
                        />
                      }
                      label="Allow Multiple Selection - participants can choose more than one image"
                    />

                    {(editedQuestion.imageCount || 4) === 2
                      && (editedQuestion.mediaAssignmentMode || 'individual') === 'individual' && (
                      <FormControl fullWidth variant="outlined">
                        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Pairing Mode</InputLabel>
                        <Select
                          value={editedQuestion.pairingMode || 'random'}
                          onChange={(e) => handleQuestionChange('pairingMode', e.target.value)}
                          label="Pairing Mode"
                        >
                          <MenuItem value="random">Random — uniform random pairs</MenuItem>
                          <MenuItem value="balanced">Balanced — prioritize least-exposed images</MenuItem>
                          <MenuItem value="adaptive">Adaptive — prioritize similar-score images (TrueSkill)</MenuItem>
                        </Select>
                      </FormControl>
                    )}

                    <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />

                    {/* Manual Image Choice Interface */}
                    {editedQuestion.imageSelectionMode === 'huggingface_manual' && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images ({selectedImages.length}/{editedQuestion.imageCount || 4} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ objectFit: 'cover' }}
                                  />
                                  <CardActions sx={{ position: 'absolute', top: 0, right: 0, p: 0.5 }}>
                                    <Checkbox
                                      checked={selectedImages.includes(image.url)}
                                      onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                      disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 4)}
                                      sx={{ 
                                        bgcolor: 'rgba(255,255,255,0.8)',
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' }
                                      }}
                                    />
                                  </CardActions>
                                  <Box sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.7)', color: 'white' }}>
                                    <Typography variant="caption" noWrap>
                                      {image.name}
                                    </Typography>
                                  </Box>
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {editedQuestion.type === 'imageranking' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Rank"
                      value={editedQuestion.imageCount || 4}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 2;
                        handleQuestionChange('imageCount', Math.min(Math.max(value, 2), 10));
                      }}
                      onFocus={(e) => e.target.select()}
                      helperText={editedQuestion.imageSelectionMode === 'huggingface_random' 
                        ? "How many images to randomly select for ranking from Hugging Face" 
                        : "How many images you will manually select for ranking"}
                      inputProps={{ min: 2, max: 10, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {/* Manual Image Selection Interface for Ranking */}
                    {(editedQuestion.imageSelectionMode === 'manual' || editedQuestion.imageSelectionMode === 'huggingface_manual') && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images for Ranking ({selectedImages.length}/{editedQuestion.imageCount || 4} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ objectFit: 'cover' }}
                                  />
                                  <CardActions sx={{ position: 'absolute', top: 0, right: 0, p: 0.5 }}>
                                    <Checkbox
                                      checked={selectedImages.includes(image.url)}
                                      onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                      disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 4)}
                                      sx={{ 
                                        bgcolor: 'rgba(255,255,255,0.8)',
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' }
                                      }}
                                    />
                                  </CardActions>
                                  <Box sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.7)', color: 'white' }}>
                                    <Typography variant="caption" noWrap>
                                      {image.name}
                                    </Typography>
                                  </Box>
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {/* Image selection (rating / slider group / point allocation with image) */}
                {['imagerating', 'imageslidergroup', 'imagepointallocation'].includes(editedQuestion.type) && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Display"
                      value={editedQuestion.imageCount || 1}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 6));
                      }}
                      onFocus={(e) => e.target.select()}
                      helperText={editedQuestion.imageSelectionMode === 'huggingface_random'
                        ? 'How many images to randomly select from the project media pool'
                        : 'How many images you will manually select'}
                      inputProps={{ min: 1, max: 6, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {editedQuestion.type === 'imagerating' && (
                      <>
                    {/* Rating Scale Configuration */}
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Minimum Rating Value"
                      value={editedQuestion.rateMin || 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Maximum Rating Value"
                      value={editedQuestion.rateMax || 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Minimum Rating Label"
                      value={editedQuestion.minRateDescription || ''}
                      onChange={(e) => handleQuestionChange('minRateDescription', e.target.value)}
                      placeholder="e.g., Very Poor"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Maximum Rating Label"
                      value={editedQuestion.maxRateDescription || ''}
                      onChange={(e) => handleQuestionChange('maxRateDescription', e.target.value)}
                      placeholder="e.g., Excellent"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                      </>
                    )}

                    {/* Manual Image Selection */}
                    {(editedQuestion.imageSelectionMode === 'manual' || editedQuestion.imageSelectionMode === 'huggingface_manual') && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images ({selectedImages.length}/{editedQuestion.imageCount || 1} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ cursor: 'pointer' }}
                                    onClick={() => handleImageSelection(image.url, !selectedImages.includes(image.url))}
                                  />
                                  <Checkbox
                                    checked={selectedImages.includes(image.url)}
                                    onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                    disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 1)}
                                    sx={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8,
                                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.9)' }
                                    }}
                                  />
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {/* Image Yes/No Configuration */}
                {editedQuestion.type === 'imageboolean' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Display"
                      value={editedQuestion.imageCount || 1}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 6));
                      }}
                      onFocus={(e) => e.target.select()}
                      helperText={editedQuestion.imageSelectionMode === 'huggingface_random' 
                        ? "How many images to randomly select for yes/no question from Hugging Face" 
                        : "How many images you will manually select for yes/no question"}
                      inputProps={{ min: 1, max: 6, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {/* Yes/No Labels Configuration */}
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Yes Label"
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder="e.g., Yes, Agree, Like"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    <TextField
                      fullWidth
                      variant="outlined"
                      label="No Label"
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder="e.g., No, Disagree, Dislike"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {/* Manual Image Selection Interface for Yes/No */}
                    {(editedQuestion.imageSelectionMode === 'manual' || editedQuestion.imageSelectionMode === 'huggingface_manual') && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images for Yes/No Question ({selectedImages.length}/{editedQuestion.imageCount || 1} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ cursor: 'pointer' }}
                                    onClick={() => handleImageSelection(image.url, !selectedImages.includes(image.url))}
                                  />
                                  <Checkbox
                                    checked={selectedImages.includes(image.url)}
                                    onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                    disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 1)}
                                    sx={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8,
                                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.9)' }
                                    }}
                                  />
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {/* Image Matrix Configuration */}
                {editedQuestion.type === 'imagematrix' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'huggingface_random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Display"
                      value={editedQuestion.imageCount || 1}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 6));
                      }}
                      onFocus={(e) => e.target.select()}
                      helperText={editedQuestion.imageSelectionMode === 'huggingface_random' 
                        ? "How many images to randomly select for matrix from Hugging Face" 
                        : "How many images you will manually select for matrix"}
                      inputProps={{ min: 1, max: 6, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {/* Manual Image Selection Interface for Matrix */}
                    {(editedQuestion.imageSelectionMode === 'manual' || editedQuestion.imageSelectionMode === 'huggingface_manual') && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images for Matrix ({selectedImages.length}/{editedQuestion.imageCount || 1} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ cursor: 'pointer' }}
                                    onClick={() => handleImageSelection(image.url, !selectedImages.includes(image.url))}
                                  />
                                  <Checkbox
                                    checked={selectedImages.includes(image.url)}
                                    onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                    disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 1)}
                                    sx={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8,
                                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.9)' }
                                    }}
                                  />
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {/* Image Display Configuration */}
                {editedQuestion.type === 'image' && (
                  <>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      <strong>Image Display shows exactly one image</strong> per participant (large, natural aspect ratio).
                      To show <strong>multiple images</strong> in the same justified layout as Image Choice,
                      use <strong>Media Display</strong> instead and set the number of media files to 2 or more.
                    </Alert>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Image Selection Mode</InputLabel>
                      <Select
                        value={editedQuestion.imageSelectionMode || 'random'}
                        onChange={(e) => handleQuestionChange('imageSelectionMode', e.target.value)}
                        label="Image Selection Mode"
                      >
                        <MenuItem value="huggingface_random">Random Selection from Hugging Face</MenuItem>
                        <MenuItem value="huggingface_manual">Manual Selection from Hugging Face</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Number of Images to Display"
                      value={1}
                      disabled
                      helperText="Image Display always shows one randomly selected image. Use Media Display for multiple images."
                      inputProps={{ min: 1, max: 1, step: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />

                    {/* Manual Image Selection Interface for Display */}
                    {(editedQuestion.imageSelectionMode === 'manual' || editedQuestion.imageSelectionMode === 'huggingface_manual') && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Select Images for Display ({selectedImages.length}/{editedQuestion.imageCount || 1} selected)
                        </Typography>
                        
                        {imageError && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {imageError}
                          </Alert>
                        )}
                        
                        {loadingImages ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                          </Box>
                        ) : (
                          <Grid container spacing={2} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {availableImages.map((image) => (
                              <Grid item xs={6} sm={4} md={3} key={image.url}>
                                <Card sx={{ position: 'relative' }}>
                                  <CardMedia
                                    component="img"
                                    height="120"
                                    image={image.url}
                                    alt={image.name}
                                    sx={{ cursor: 'pointer' }}
                                    onClick={() => handleImageSelection(image.url, !selectedImages.includes(image.url))}
                                  />
                                  <Checkbox
                                    checked={selectedImages.includes(image.url)}
                                    onChange={(e) => handleImageSelection(image.url, e.target.checked)}
                                    disabled={!selectedImages.includes(image.url) && selectedImages.length >= (editedQuestion.imageCount || 1)}
                                    sx={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8,
                                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.9)' }
                                    }}
                                  />
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        )}
                      </Box>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )}

          {/* Media Settings for media (video/audio/image) questions */}
          {['mediadisplay', 'mediarating', 'mediaboolean'].includes(editedQuestion.type) && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Media Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {editedQuestion.type === 'mediadisplay' && (
                  <>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      For <strong>2+ images</strong>, the default gallery layout matches <strong>Image Choice</strong>:
                      same row height, widths proportional to each image&apos;s aspect ratio (panoramas wider, squares narrower).
                      Use <strong>Image Display</strong> only when you need a single large image.
                    </Alert>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Display Mode</InputLabel>
                      <Select
                        value={editedQuestion.displayMode || 'single'}
                        label="Display Mode"
                        onChange={(e) => {
                          const mode = e.target.value;
                          const updates = { displayMode: mode };
                          if (mode === 'reveal' || mode === 'sideBySide') {
                            updates.imageCount = Math.max(editedQuestion.imageCount || 1, 2);
                          }
                          setEditedQuestion({ ...editedQuestion, ...updates });
                        }}
                      >
                        <MenuItem value="single">Gallery — Image Choice layout (2+ images)</MenuItem>
                        <MenuItem value="reveal">Before/After drag reveal (2 images)</MenuItem>
                        <MenuItem value="timed">Timed exposure (hide after N seconds)</MenuItem>
                      </Select>
                    </FormControl>
                    {editedQuestion.displayMode === 'reveal' && (
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                          fullWidth
                          variant="outlined"
                          label="Before label"
                          value={editedQuestion.beforeLabel || 'Before'}
                          onChange={(e) => handleQuestionChange('beforeLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                        />
                        <TextField
                          fullWidth
                          variant="outlined"
                          label="After label"
                          value={editedQuestion.afterLabel || 'After'}
                          onChange={(e) => handleQuestionChange('afterLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                        />
                      </Box>
                    )}
                    {editedQuestion.displayMode === 'reveal' && (
                      <Alert severity="info" sx={{ py: 0.5 }}>
                        Needs exactly 2 images: the 1st is shown as "{editedQuestion.beforeLabel || 'Before'}",
                        the 2nd as "{editedQuestion.afterLabel || 'After'}". Use paired media sets
                        (<code>name__before.jpg</code> / <code>name__after.jpg</code>) to keep the order stable.
                      </Alert>
                    )}
                    {editedQuestion.displayMode === 'timed' && (
                      <TextField
                        fullWidth
                        variant="outlined"
                        type="number"
                        label="Exposure time (seconds)"
                        value={editedQuestion.exposureSeconds ?? 5}
                        onChange={(e) => handleQuestionChange('exposureSeconds', Math.min(Math.max(parseInt(e.target.value, 10) || 5, 1), 120))}
                        helperText="Participant clicks to start; media hides permanently after this many seconds. Put rating questions on the same page."
                        inputProps={{ min: 1, max: 120, step: 1 }}
                        sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                      />
                    )}
                  </>
                )}
                <FormControlLabel
                  control={
                    <Switch
                      checked={editedQuestion.excludePreviouslyUsedImages !== false}
                      onChange={(e) => handleQuestionChange('excludePreviouslyUsedImages', e.target.checked)}
                    />
                  }
                  label="Ensure media in this question has not been used earlier in this survey"
                />

                <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />

                <TextField
                  fullWidth
                  variant="outlined"
                  type="number"
                  label={editedQuestion.mediaAssignmentMode === 'group' ? 'Files per set' : 'Number of media files'}
                  value={editedQuestion.imageCount || 1}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10) || 1;
                    handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 6));
                  }}
                  onFocus={(e) => e.target.select()}
                  helperText={
                    editedQuestion.type === 'mediadisplay' && (editedQuestion.imageCount || 1) > 1
                      ? 'Multiple images use the Image Choice justified gallery (same height per row, widths by aspect ratio)'
                      : editedQuestion.mediaAssignmentMode === 'group'
                        ? 'Must match the number of files in each filename group (e.g. 2 for before/after pairs)'
                        : 'How many media files to inject (use 2+ for multi-image gallery)'
                  }
                  inputProps={{ min: 1, max: 6, step: 1 }}
                  sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                />

                <Alert severity="info">
                  {editedQuestion.mediaAssignmentMode === 'group'
                    ? 'One complete media set will be randomly assigned per participant.'
                    : 'One media file matching the type filter above will be randomly selected per participant.'}
                </Alert>

                {editedQuestion.type === 'mediarating' && (
                  <>
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Minimum Rating Value"
                      value={editedQuestion.rateMin ?? 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value) || 1)}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Maximum Rating Value"
                      value={editedQuestion.rateMax ?? 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value) || 5)}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </>
                )}

                {editedQuestion.type === 'mediaboolean' && (
                  <>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Yes Label"
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder="e.g., Yes, Agree, Like"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="No Label"
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder="e.g., No, Disagree, Dislike"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </>
                )}
              </Box>
            </Box>
          )}

          {/* Annotation Settings */}
          {editedQuestion.type === 'imageannotation' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Annotation Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editedQuestion.excludePreviouslyUsedImages !== false}
                      onChange={(e) => handleQuestionChange('excludePreviouslyUsedImages', e.target.checked)}
                    />
                  }
                  label="Ensure the image in this question has not been used earlier in this survey"
                />
                <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />
                <TextField
                  fullWidth
                  variant="outlined"
                  type="number"
                  label={editedQuestion.mediaAssignmentMode === 'group' ? 'Files per set' : 'Number of images'}
                  value={editedQuestion.imageCount || 1}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10) || 1;
                    handleQuestionChange('imageCount', Math.min(Math.max(value, 1), 6));
                  }}
                  onFocus={(e) => e.target.select()}
                  helperText={editedQuestion.mediaAssignmentMode === 'group'
                    ? 'For group mode, annotation uses the first image in the assigned set.'
                    : 'Number of images to inject (annotation uses the first)'}
                  inputProps={{ min: 1, max: 6, step: 1 }}
                  sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                />
                <FormControl fullWidth variant="outlined">
                  <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Allowed Tools</InputLabel>
                  <Select
                    multiple
                    value={editedQuestion.allowedTools || ['point', 'line', 'region']}
                    onChange={(e) => handleQuestionChange('allowedTools',
                      typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                    label="Allowed Tools"
                  >
                    <MenuItem value="point">Point</MenuItem>
                    <MenuItem value="line">Line</MenuItem>
                    <MenuItem value="region">Region (polygon)</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Minimum annotations"
                    value={editedQuestion.minAnnotations ?? 0}
                    onChange={(e) => {
                      const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                      handleQuestionChange('minAnnotations', n);
                    }}
                    helperText="Required before continuing (0 = no minimum)"
                    inputProps={{ min: 0, max: 100, step: 1 }}
                    sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Maximum annotations"
                    value={editedQuestion.maxAnnotations ?? 50}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      handleQuestionChange('maxAnnotations', Number.isNaN(raw) ? 50 : Math.max(0, raw));
                    }}
                    helperText="Cap on shapes per participant (0 = unlimited)"
                    inputProps={{ min: 0, max: 500, step: 1 }}
                    sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                </Box>
              </Box>
            </Box>
          )}

          {/* Slider group (semantic differential) settings */}
          {(editedQuestion.type === 'slidergroup' || editedQuestion.type === 'imageslidergroup') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                {editedQuestion.type === 'imageslidergroup' ? 'Image Slider Group Settings' : 'Slider Group Settings'}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <SkillDimensionsEditor
                  value={editedQuestion.dimensions || []}
                  onChange={(dims) => handleQuestionChange('dimensions', dims)}
                  scaleMin={editedQuestion.scaleMin ?? 1}
                  scaleMax={editedQuestion.scaleMax ?? 7}
                />
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Scale minimum"
                    value={editedQuestion.scaleMin ?? 1}
                    onChange={(e) => handleQuestionChange('scaleMin', parseInt(e.target.value, 10) || 0)}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Scale maximum"
                    value={editedQuestion.scaleMax ?? 7}
                    onChange={(e) => handleQuestionChange('scaleMax', parseInt(e.target.value, 10) || 7)}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                </Box>
                {editedQuestion.type === 'slidergroup' && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  To rate an image / video / audio clip, put a Media Display question on the same page —
                  it handles random media injection; this question collects the ratings.
                  Or use <strong>Image Slider Group</strong> for built-in image display.
                </Alert>
                )}
              </Box>
            </Box>
          )}

          {/* Point allocation settings */}
          {(editedQuestion.type === 'pointallocation' || editedQuestion.type === 'imagepointallocation') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                {editedQuestion.type === 'imagepointallocation' ? 'Image Point Allocation Settings' : 'Budget Settings'}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TextField
                  fullWidth
                  variant="outlined"
                  type="number"
                  label="Total points to allocate"
                  value={editedQuestion.budget ?? 100}
                  onChange={(e) => handleQuestionChange('budget', Math.max(1, parseInt(e.target.value, 10) || 100))}
                  helperText="Participants distribute exactly this many points across the choices below (when the question is required)"
                  inputProps={{ min: 1, step: 1 }}
                  sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                />
              </Box>
            </Box>
          )}

          {/* Choices for Choice-based Questions */}
          {needsChoices && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Answer Choices
              </Typography>
              {editedQuestion.type === 'radiogroup' && (
                <Box sx={{ mb: 2 }}>
                  <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                </Box>
              )}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Add new choice"
                    value={newChoice}
                    onChange={(e) => setNewChoice(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        isRankingQuestion ? addRankingChoice() : addChoice();
                      }
                    }}
                    helperText="Type a choice and press Enter or click Add"
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <Button
                    variant="contained"
                    onClick={isRankingQuestion ? addRankingChoice : addChoice}
                    startIcon={<Add />}
                    sx={{ minWidth: 100 }}
                  >
                    Add
                  </Button>
                </Box>

                {(editedQuestion.choices && editedQuestion.choices.length > 0) ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                      Current Choices:
                    </Typography>
                    <List sx={{ bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      {editedQuestion.choices.map((choice, index) => (
                        <ListItem key={index} divider={index < editedQuestion.choices.length - 1}>
                          <ListItemText
                            primary={isRankingQuestion ? choice.text : (typeof choice === 'object' ? choice.text : choice)}
                            secondary={isRankingQuestion ? `Internal value: ${choice.value}` : (typeof choice === 'object' ? `Internal value: ${choice.value}` : null)}
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              onClick={() => isRankingQuestion ? removeRankingChoice(index) : removeChoice(index)}
                              color="error"
                            >
                              <Delete />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      No choices added yet. Add some choices above to get started.
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Matrix Configuration */}
          {(editedQuestion.type === 'matrix' || editedQuestion.type === 'imagematrix') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Matrix Configuration
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Rows Configuration */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    Rows (Questions)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Add new row"
                      value={newChoice}
                      onChange={(e) => setNewChoice(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!newChoice.trim()) return;
                          const rows = editedQuestion.rows || [];
                          const rowValue = newChoice.trim().toLowerCase().replace(/\s+/g, '_');
                          const newRow = { value: rowValue, text: newChoice.trim() };
                          setEditedQuestion({ ...editedQuestion, rows: [...rows, newRow] });
                          setNewChoice('');
                        }
                      }}
                      helperText="Type a row label and press Enter or click Add"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Button
                      variant="contained"
                      onClick={() => {
                        if (!newChoice.trim()) return;
                        const rows = editedQuestion.rows || [];
                        const rowValue = newChoice.trim().toLowerCase().replace(/\s+/g, '_');
                        const newRow = { value: rowValue, text: newChoice.trim() };
                        setEditedQuestion({ ...editedQuestion, rows: [...rows, newRow] });
                        setNewChoice('');
                      }}
                      startIcon={<Add />}
                      sx={{ minWidth: 100 }}
                    >
                      Add
                    </Button>
                  </Box>
                  {editedQuestion.rows && editedQuestion.rows.length > 0 ? (
                    <List sx={{ bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      {editedQuestion.rows.map((row, index) => (
                        <ListItem key={index} divider={index < editedQuestion.rows.length - 1}>
                          <ListItemText
                            primary={typeof row === 'object' ? row.text : row}
                            secondary={typeof row === 'object' ? `Value: ${row.value}` : null}
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              onClick={() => {
                                const newRows = editedQuestion.rows.filter((_, i) => i !== index);
                                setEditedQuestion({ ...editedQuestion, rows: newRows });
                              }}
                              color="error"
                            >
                              <Delete />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        No rows added yet
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Columns Configuration */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    Columns (Answer Options)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Add new column"
                      placeholder="e.g., Strongly Agree, Agree, Neutral..."
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const colText = e.target.value.trim();
                          if (!colText) return;
                          const columns = editedQuestion.columns || [];
                          const colValue = colText.toLowerCase().replace(/\s+/g, '_');
                          const newCol = { value: colValue, text: colText };
                          setEditedQuestion({ ...editedQuestion, columns: [...columns, newCol] });
                          e.target.value = '';
                        }
                      }}
                      helperText="Type a column label and press Enter or click Add"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Button
                      variant="contained"
                      onClick={(e) => {
                        const input = e.target.closest('div').parentElement.querySelector('input');
                        const colText = input.value.trim();
                        if (!colText) return;
                        const columns = editedQuestion.columns || [];
                        const colValue = colText.toLowerCase().replace(/\s+/g, '_');
                        const newCol = { value: colValue, text: colText };
                        setEditedQuestion({ ...editedQuestion, columns: [...columns, newCol] });
                        input.value = '';
                      }}
                      startIcon={<Add />}
                      sx={{ minWidth: 100 }}
                    >
                      Add
                    </Button>
                  </Box>
                  {editedQuestion.columns && editedQuestion.columns.length > 0 ? (
                    <List sx={{ bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      {editedQuestion.columns.map((col, index) => (
                        <ListItem key={index} divider={index < editedQuestion.columns.length - 1}>
                          <ListItemText
                            primary={typeof col === 'object' ? col.text : col}
                            secondary={typeof col === 'object' ? `Value: ${col.value}` : null}
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              onClick={() => {
                                const newColumns = editedQuestion.columns.filter((_, i) => i !== index);
                                setEditedQuestion({ ...editedQuestion, columns: newColumns });
                              }}
                              color="error"
                            >
                              <Delete />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        No columns added yet
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* Additional Settings for Specific Question Types */}
          {(editedQuestion.type === 'comment' || editedQuestion.type === 'text' || editedQuestion.type === 'rating') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Advanced Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {editedQuestion.type === 'comment' && (
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Number of Rows"
                    value={editedQuestion.rows || 3}
                    onChange={(e) => handleQuestionChange('rows', parseInt(e.target.value))}
                    helperText="How many rows the text area should display"
                    inputProps={{ min: 1, max: 10 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {editedQuestion.type === 'text' && (
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Maximum Length"
                    value={editedQuestion.maxLength || ''}
                    onChange={(e) => handleQuestionChange('maxLength', e.target.value ? parseInt(e.target.value) : undefined)}
                    helperText="Maximum number of characters allowed (leave empty for no limit)"
                    inputProps={{ min: 1 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {editedQuestion.type === 'rating' && (
                  <>
                    <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Minimum Value"
                      value={editedQuestion.rateMin || 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value))}
                      helperText="The lowest rating value"
                      inputProps={{ min: 0 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Maximum Value"
                      value={editedQuestion.rateMax || 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value))}
                      helperText="The highest rating value"
                      inputProps={{ min: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => {
          const questionToSave = { ...editedQuestion };
          
          console.log('💾 Saving question:', questionToSave);
          
          if (questionToSave.type === 'imagematrix') {
            console.log('📊 ImageMatrix - rows:', questionToSave.rows);
            console.log('📊 ImageMatrix - columns:', questionToSave.columns);
            console.log('🖼️ ImageMatrix - imageSelectionMode:', questionToSave.imageSelectionMode);
            console.log('🖼️ ImageMatrix - selectedImageUrls:', questionToSave.selectedImageUrls);
            console.log('🖼️ ImageMatrix - imageCount:', questionToSave.imageCount);
          }
          
          // Handle image types: keep type, generate imageHtml for runtime display
          if (['imageboolean', 'imagerating', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(questionToSave.type)) {
            console.log(`🔄 Processing ${questionToSave.type} - keeping type, generating imageHtml`);
            
            // Set default imageSelectionMode if not set
            if (!questionToSave.imageSelectionMode) {
              questionToSave.imageSelectionMode = 'huggingface_random';
            }
            
            // Keep type for Survey Builder recognition
            // But generate HTML for images for runtime display
            
            if (questionToSave.imageSelectionMode === 'huggingface_manual' && questionToSave.selectedImageUrls && questionToSave.selectedImageUrls.length > 0) {
              // Manual selection: generate HTML from selected images
              // Try to find image names from availableImages
              const imageNamesMap = {};
              if (availableImages && availableImages.length > 0) {
                availableImages.forEach(img => {
                  imageNamesMap[img.url] = img.name;
                });
              }
              
              // The .sp-image-gallery class is picked up by
              // src/lib/imagePickerLayout.js for uniform per-question image
              // heights at natural aspect ratio.
              let imagesHtml = '<div class="sp-image-gallery">';
              const imageNames = [];
              questionToSave.selectedImageUrls.forEach((url) => {
                const imageName = imageNamesMap[url] || 'unknown';
                imageNames.push(imageName);
                imagesHtml += `<div class="sp-image-gallery__item"><div class="sp-image-gallery__image-container"><img src="${url}" data-image-name="${imageName}" alt="${imageName}" /></div></div>`;
              });
              imagesHtml += '</div>';
              
              // Store the HTML and names for runtime display
              questionToSave.imageHtml = imagesHtml;
              questionToSave.imageNames = imageNames;
            } else if (questionToSave.imageSelectionMode === 'huggingface_random') {
              // Random selection: store config for runtime loading
              questionToSave.randomImageSelection = true;
              // ✅ No need to save imageSource and huggingFaceConfig - they're global project settings
              // Images will be loaded at runtime and imageHtml will be generated then
            }
            
            console.log(`✅ Processed ${questionToSave.type}, randomImageSelection:`, questionToSave.randomImageSelection, 'imageHtml:', questionToSave.imageHtml ? 'yes' : 'no');
          }

          if (questionToSave.type === 'image') {
            questionToSave.imageCount = 1;
          }

          // Media display / rating / boolean / annotation — always inject from project pool at runtime
          if (['mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation'].includes(questionToSave.type)) {
            if (!questionToSave.imageSelectionMode) {
              questionToSave.imageSelectionMode = 'huggingface_random';
            }
            questionToSave.randomImageSelection = true;
            questionToSave.excludePreviouslyUsedImages = questionToSave.excludePreviouslyUsedImages !== false;
            if (!questionToSave.imageCount) {
              questionToSave.imageCount = 1;
            }
          }
          
          // Convert selectedImageUrls to SurveyJS choices format for imagepicker, imageranking, and image questions
          // Note: imageboolean, imagerating, imagematrix use imageHtml instead (handled above)
          if (questionToSave.type === 'imagepicker' || questionToSave.type === 'imageranking' || questionToSave.type === 'image') {
            if (questionToSave.imageSelectionMode === 'huggingface_manual' && questionToSave.selectedImageUrls && questionToSave.selectedImageUrls.length > 0) {
              // Manual selection: use the specifically selected images
              if (questionToSave.type === 'image') {
                // For image display questions, set imageLink directly
                questionToSave.imageLink = questionToSave.selectedImageUrls[0]; // Use first image
                if (questionToSave.selectedImageUrls.length > 1) {
                  // Store all images for potential future use
                  questionToSave.imageLinks = questionToSave.selectedImageUrls;
                }
              } else {
                // For imagepicker and imageranking, use choices
                questionToSave.choices = questionToSave.selectedImageUrls.map((url, index) => ({
                  value: `image_${index}`,
                  imageLink: url
                }));
              }
              // Default imageFit to "contain" to preserve each image's natural aspect ratio.
              if (!questionToSave.imageFit) {
                questionToSave.imageFit = "contain";
              }
            } else if (questionToSave.imageSelectionMode === 'huggingface_random') {
              // Random selection: store the configuration for runtime image loading
              if (!questionToSave.imageFit) {
                questionToSave.imageFit = "contain";
              }
              questionToSave.randomImageSelection = true;
              
              // ✅ No need to save imageSource and huggingFaceConfig - they're global project settings
              
              // Don't set choices - they'll be generated at runtime
              delete questionToSave.choices;
            }
          }
          
          onSave(questionToSave);
        }} variant="contained">
          Save Question
        </Button>
      </DialogActions>
    </Dialog>
  );
}
