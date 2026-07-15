import React, { useState, useEffect, useMemo } from 'react';
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
  Alert,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  Add,
  Delete,
  Search,
} from '@mui/icons-material';
import { listSkillsForBuilder } from '../../lib/skillManager';
import {
  filterPoolForQuestion,
  getMediaPoolStatus,
  applyMediaToElement,
  getMediaPerCategory,
  expectedCategoryImageCount,
  resolveMediaFolderTags,
} from '../../lib/surveyMediaInjection';
import { sortMediaByName, normalizeMediaAssignmentMode } from '../../lib/mediaUtils';
import { SkillDimensionsEditor, SkillStringListEditor } from './SkillConfigFieldEditors';
import SkillQuestionFrame from '../SkillQuestionWidget';
import {
  getSkillMediaConstraints,
  getPresetBuilderTypeOptions,
  resolveBuilderSkill,
} from '../../lib/presetSkills';
import { enrichEmotionColorConfig } from '../../lib/emotionColor';
import { listSkillPreviewMedia, pickPreviewMedia } from '../../lib/skillPreviewMedia';
import {
  getQuestionMediaConstraints,
  clampQuestionImageCount,
  isMediaStimulusQuestion,
  isCuratedSelectionMode,
} from '../../lib/questionTypeConstraints';
import MediaPairingGuide from './MediaPairingGuide';
import MediaCategoryGuide from './MediaCategoryGuide';
import QuestionParticipantPreview from './QuestionParticipantPreview';

const CURATED_STIMULUS_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagematrix',
  'image', 'imageslidergroup', 'imagepointallocation',
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'imageannotation',
];

function SettingsSection({ step, title, hint, children }) {
  return (
    <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
        {step != null ? `${step}. ${title}` : title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          {hint}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

function mediaDisplayName(image) {
  if (!image) return '(unnamed)';
  const raw = image.name || image.url || '';
  try {
    const base = String(raw).split('?')[0].split('/').pop();
    return decodeURIComponent(base || raw);
  } catch {
    return String(raw).split('?')[0].split('/').pop() || raw;
  }
}

/** Curated picker: searchable by filename, shows full file names. */
function CuratedMediaPicker({
  availableImages,
  selectedImages,
  maxCount,
  loading,
  error,
  onToggle,
  title = 'Select files',
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? availableImages
      : availableImages.filter((img) => mediaDisplayName(img).toLowerCase().includes(q));
    return sortMediaByName(list);
  }, [availableImages, query]);

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {title} ({selectedImages.length}/{maxCount} selected)
      </Typography>
      <TextField
        fullWidth
        size="small"
        variant="outlined"
        placeholder="Search by file name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" color="action" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 1.5, bgcolor: 'white', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Alert severity="info" sx={{ py: 0.5 }}>
          {availableImages.length === 0
            ? 'No media available to pick from.'
            : `No file names match “${query.trim()}”.`}
        </Alert>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Showing {filtered.length} of {availableImages.length} file{availableImages.length === 1 ? '' : 's'}
          </Typography>
          <Grid container spacing={1.5} sx={{ maxHeight: 420, overflow: 'auto' }}>
            {filtered.map((image) => {
              const name = mediaDisplayName(image);
              const checked = selectedImages.includes(image.url);
              const atCap = !checked && selectedImages.length >= maxCount;
              return (
                <Grid item xs={12} sm={6} md={4} key={image.url}>
                  <Card
                    variant="outlined"
                    sx={{
                      display: 'flex',
                      alignItems: 'stretch',
                      opacity: atCap ? 0.55 : 1,
                      borderColor: checked ? 'primary.main' : 'divider',
                      bgcolor: checked ? 'primary.50' : 'background.paper',
                    }}
                  >
                    <Box
                      component="img"
                      src={image.url}
                      alt={name}
                      sx={{
                        width: 72,
                        height: 72,
                        objectFit: 'cover',
                        flexShrink: 0,
                        bgcolor: 'grey.100',
                        cursor: atCap ? 'default' : 'pointer',
                      }}
                      onClick={() => !atCap && onToggle(image.url, !checked)}
                    />
                    <Box sx={{ flex: 1, minWidth: 0, p: 1, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                      <Tooltip title={name} placement="top" enterDelay={400}>
                        <Typography
                          variant="body2"
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: '0.75rem',
                            lineHeight: 1.35,
                            wordBreak: 'break-all',
                            cursor: atCap ? 'default' : 'pointer',
                          }}
                          onClick={() => !atCap && onToggle(image.url, !checked)}
                        >
                          {name}
                        </Typography>
                      </Tooltip>
                      <Checkbox
                        size="small"
                        checked={checked}
                        disabled={atCap}
                        onChange={(e) => onToggle(image.url, e.target.checked)}
                        sx={{ p: 0.25, mt: -0.25 }}
                      />
                    </Box>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}
    </Box>
  );
}

/** Random vs curated sampling — wording matches project media pool. */
function SamplingModeSelect({ question, onQuestionPatch }) {
  const mode = isCuratedSelectionMode(question.imageSelectionMode)
    ? 'huggingface_manual'
    : 'huggingface_random';
  return (
    <FormControl fullWidth variant="outlined">
      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>How stimuli are chosen</InputLabel>
      <Select
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          onQuestionPatch({
            imageSelectionMode: next,
            randomImageSelection: next === 'huggingface_random',
          });
        }}
        label="How stimuli are chosen"
      >
        <MenuItem value="huggingface_random">Random from project media pool</MenuItem>
        <MenuItem value="huggingface_manual">Curated list (pick specific files)</MenuItem>
      </Select>
    </FormControl>
  );
}

function StimulusCountField({ question, onChange, constraints }) {
  if (!constraints?.hasStimuli) return null;
  if (!constraints.countAdjustable) {
    return (
      <Alert severity="info" sx={{ py: 0.75 }}>
        <strong>Stimulus count:</strong>{' '}
        {constraints.countLabel || `Fixed at ${constraints.countFixed}`}.
        {' '}Drawn from the project media pool for each participant.
      </Alert>
    );
  }
  return (
    <TextField
      fullWidth
      variant="outlined"
      type="number"
      label={constraints.countLabel || 'Number of stimuli'}
      value={question.imageCount ?? constraints.defaultCount}
      onChange={(e) => onChange(
        'imageCount',
        clampQuestionImageCount(question.type, question, e.target.value),
      )}
      onFocus={(e) => e.target.select()}
      helperText="Randomly drawn from the project media pool (or your curated list)"
      inputProps={{ min: constraints.countMin, max: constraints.countMax, step: 1 }}
      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
    />
  );
}

function AttentionCheckFields({ question, onChange }) {
  const supported = ['rating', 'radiogroup', 'dropdown', 'boolean', 'imagepicker'].includes(question.type);
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
              : question.type === 'boolean'
                ? 'Use true or false (or the Yes/No label text as stored — usually true/false)'
                : 'Exact choice value the participant must select (checked in analysis, not blocked at submit)'
          }
        />
      )}
    </Box>
  );
}

function MediaAssignmentFields({ question, onChange, currentProject }) {
  const mode = question.mediaAssignmentMode === 'group' ? 'set' : (question.mediaAssignmentMode || 'individual');
  const isSet = mode === 'set';
  const isCategory = mode === 'category';
  const count = question.imageCount || 1;
  const folderTags = React.useMemo(
    () => resolveMediaFolderTags(currentProject, { pages: [{ elements: [question] }] }),
    [currentProject, question],
  );
  const taggedFolderOptions = React.useMemo(() => {
    const tags = folderTags || {};
    return Object.keys(tags).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [folderTags]);
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
        eligibleSetCount: isSet ? 0 : null,
        filesPerSet: count,
      };
    }
    const q = { ...question, mediaAssignmentMode: mode };
    return getMediaPoolStatus(currentProject.preloadedImages, q, folderTags);
  }, [currentProject?.preloadedImages, question, isSet, count, mode, folderTags]);

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
          <MenuItem value="set">Random fixed sets (tagged folders)</MenuItem>
          <MenuItem value="category">Per category (tagged folders)</MenuItem>
        </Select>
      </FormControl>
      {isCategory && (
        <TextField
          fullWidth
          type="number"
          size="small"
          variant="outlined"
          label="Files per category"
          value={question.mediaPerCategory ?? 1}
          onChange={(e) => {
            const n = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
            onChange('mediaPerCategory', n);
          }}
          inputProps={{ min: 1, max: 50 }}
          helperText={
            poolStatus.matchingCategoryCount > 0
              ? `${poolStatus.matchingCategoryCount} categor${poolStatus.matchingCategoryCount === 1 ? 'y' : 'ies'} × ${poolStatus.mediaPerCategory} = ${poolStatus.expectedCategoryTotal} file(s) total`
              : 'How many files to draw from each tagged category folder'
          }
          sx={{ mt: 1 }}
        />
      )}
      {(isSet || isCategory) && taggedFolderOptions.length > 0 && (
        <FormControl fullWidth variant="outlined" sx={{ mt: 1 }}>
          <InputLabel shrink sx={{ backgroundColor: 'white', px: 1 }}>Folder scope (optional)</InputLabel>
          <Select
            multiple
            displayEmpty
            value={Array.isArray(question.mediaFolders) ? question.mediaFolders : []}
            onChange={(e) => onChange('mediaFolders', e.target.value)}
            label="Folder scope (optional)"
            renderValue={(selected) => (selected?.length ? selected.join(', ') : 'All tagged folders')}
          >
            {taggedFolderOptions
              .filter((f) => {
                const tag = folderTags[f];
                if (isSet) return tag === 'set';
                if (isCategory) return tag === 'category';
                return true;
              })
              .map((f) => (
                <MenuItem key={f} value={f}>{f} ({folderTags[f]})</MenuItem>
              ))}
          </Select>
        </FormControl>
      )}
      {isSet && (
        <>
          {poolStatus.totalFileCount === 0 ? (
            <Alert severity="warning">No media in project — upload files in Media Dataset first.</Alert>
          ) : poolStatus.matchingFileCount === 0 ? (
            <Alert severity="warning">
              {poolStatus.totalFileCount} file(s) in project, but none match this question&apos;s media type
              filter{mediaTypeHint}.
            </Alert>
          ) : (poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount) === 0 ? (
            <Alert severity="warning">
              No eligible set folders (need folders tagged <code>set</code> with exactly {poolStatus.filesPerSet} direct file(s)
              {mediaTypeHint}). Tag folders in Media Dataset.
            </Alert>
          ) : (
            <Alert severity="success">
              {poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount} set(s) of size {poolStatus.filesPerSet} available
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
            eligibleSetCount={poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount}
            filesPerSet={poolStatus.filesPerSet}
          />
        </>
      )}
      {isCategory && (
        <>
          {poolStatus.totalFileCount === 0 ? (
            <Alert severity="warning">No media in project — upload files in Media Dataset first.</Alert>
          ) : poolStatus.matchingCategoryCount > 0 ? (
            <Alert severity="success">
              Will show <strong>{poolStatus.expectedCategoryTotal}</strong> file(s):
              {' '}<strong>{poolStatus.mediaPerCategory}</strong> from each of{' '}
              <strong>{poolStatus.matchingCategoryCount}</strong> categor
              {poolStatus.matchingCategoryCount === 1 ? 'y' : 'ies'}
              {' '}({poolStatus.matchingCategoryLabels.map((c) => (
                <code key={c} style={{ marginRight: 6 }}>{c}</code>
              ))})
              {mediaTypeHint && <span>{mediaTypeHint}</span>}
            </Alert>
          ) : (
            <Alert severity="warning">
              No category folders tagged yet (or none match this filter). Tag folders as <code>category</code> in Media Dataset.
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
            mediaPerCategory={poolStatus.mediaPerCategory}
          />
        </>
      )}
      {!isSet && !isCategory && (
        <Typography variant="caption" color="text.secondary" display="block">
          Randomly samples {count} file(s) from the project media pool
          {poolStatus.totalFileCount > 0
            ? ` (${poolStatus.matchingFileCount} matching${mediaTypeHint}).`
            : ' — upload media in Media Dataset first.'}
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
  const [skillPreviewPool, setSkillPreviewPool] = useState([]);

  useEffect(() => {
    listSkillsForBuilder().then(setBuilderSkills);
  }, []);

  useEffect(() => {
    listSkillPreviewMedia().then(setSkillPreviewPool).catch(() => setSkillPreviewPool([]));
  }, []);

  const presetTypeOptions = getPresetBuilderTypeOptions();
  const presetSkillIds = new Set(presetTypeOptions.map((o) => o.value.slice(6)));

  // Library skills that are not built-in presets (custom / approved community)
  const libraryTypeOptions = builderSkills
    .filter((s) => !presetSkillIds.has(s.id) && !String(s.id).startsWith('preset_'))
    .map((s) => ({
      value: `skill:${s.id}`,
      label: s.scope === 'mine' && !s.is_approved
        ? `Advanced · My task: ${s.name}`
        : `Advanced · Library: ${s.name}`,
      group: 'advanced',
    }));

  const questionTypes = [
    { value: 'text', label: 'Text Input', group: 'text' },
    { value: 'comment', label: 'Text Multi-line Input', group: 'text' },
    { value: 'number', label: 'Text Number', group: 'text' },
    { value: 'radiogroup', label: 'Text Single Choice', group: 'text' },
    { value: 'checkbox', label: 'Text Multiple Choice', group: 'text' },
    { value: 'ranking', label: 'Text Ranking', group: 'text' },
    { value: 'rating', label: 'Text Rating Scale', group: 'text' },
    { value: 'boolean', label: 'Text Yes/No', group: 'text' },
    { value: 'dropdown', label: 'Text Dropdown', group: 'text' },
    { value: 'matrix', label: 'Text Matrix', group: 'text' },
    { value: 'expression', label: 'Text Instruction', group: 'text' },
    { value: 'consent', label: 'Text Consent', group: 'text' },
    { value: 'slidergroup', label: 'Text Slider Group', group: 'text' },
    { value: 'pointallocation', label: 'Text Point Allocation', group: 'text' },
    { value: 'imagepicker', label: 'Image Choice', group: 'image' },
    { value: 'imageranking', label: 'Image Ranking', group: 'image' },
    { value: 'imagerating', label: 'Image Rating Scale', group: 'image' },
    { value: 'imageboolean', label: 'Image Yes/No', group: 'image' },
    { value: 'imagematrix', label: 'Image Matrix', group: 'image' },
    { value: 'image', label: 'Image Display (single image)', group: 'image' },
    { value: 'imageannotation', label: 'Image Annotation', group: 'image' },
    { value: 'imageslidergroup', label: 'Image Slider Group', group: 'image' },
    { value: 'imagepointallocation', label: 'Image Point Allocation', group: 'image' },
    { value: 'mediadisplay', label: 'Media Display (image / video / audio)', group: 'media' },
    { value: 'mediarating', label: 'Media Rating Scale', group: 'media' },
    { value: 'mediaboolean', label: 'Media Yes/No', group: 'media' },
    { value: 'mediaranking', label: 'Media Ranking', group: 'media' },
    // Built-in interactive questions — first-class types (not labeled "Skill")
    ...presetTypeOptions,
    // Advanced: blank custom HTML skill + user/library skills
    {
      value: 'skillquestion',
      label: 'Advanced · Build custom interactive task (HTML)',
      group: 'advanced',
    },
    ...libraryTypeOptions,
  ];

  const typeMenuGroups = [
    { id: 'text', label: 'Text & choice' },
    { id: 'image', label: 'Image questions' },
    { id: 'media', label: 'Media questions' },
    { id: 'perception', label: 'Interactive questions' },
    { id: 'advanced', label: 'Advanced · custom tasks' },
  ];

  const handleQuestionChange = (field, value) => {
    const updates = { [field]: value };
    
    if (
      (field === 'mediaAssignmentMode' && value === 'category')
      || (field === 'mediaPerCategory' && normalizeMediaAssignmentMode(editedQuestion.mediaAssignmentMode) === 'category')
      || (field === 'mediaFolders' && normalizeMediaAssignmentMode(editedQuestion.mediaAssignmentMode) === 'category')
    ) {
      const nextQ = {
        ...editedQuestion,
        ...updates,
        mediaAssignmentMode: field === 'mediaAssignmentMode' ? value : editedQuestion.mediaAssignmentMode,
      };
      if (normalizeMediaAssignmentMode(nextQ.mediaAssignmentMode) === 'category' && currentProject?.preloadedImages?.length) {
        const pool = filterPoolForQuestion(currentProject.preloadedImages, nextQ);
        const tags = currentProject?.imageDatasetConfig?.mediaFolderTags || {};
        const total = expectedCategoryImageCount(pool, {
          ...nextQ,
          mediaPerCategory: field === 'mediaPerCategory' ? updates.mediaPerCategory : getMediaPerCategory(nextQ),
        }, tags);
        if (total > 0) updates.imageCount = total;
      }
    }

    if (field === 'mediaAssignmentMode' && value === 'category' && updates.mediaPerCategory == null && editedQuestion.mediaPerCategory == null) {
      updates.mediaPerCategory = 1;
    }

    if (field === 'imageCount') {
      const mode = editedQuestion.pairingMode || 'random';
      if (mode === 'uncertain' || mode === 'high_sigma') {
        updates.pairingMode = 'balanced';
      }
    }

    // Set default properties when question type changes to image type
    if (field === 'type') {
      if (String(value).startsWith('skill:')) {
        const skillId = String(value).slice(6);
        const skill = resolveBuilderSkill(skillId, builderSkills);
        updates.type = 'skillquestion';
        updates.skillId = skill?.id || skillId;
        updates.skillHtml = skill?.sourceHtml || '';
        const mediaConstraints = getSkillMediaConstraints(updates.skillId, skill);
        const lockedCount = mediaConstraints.countFixed
          ?? skill?.defaultConfig?.mediaCount
          ?? 1;
        const lockedType = mediaConstraints.typeFixed || skill?.defaultConfig?.mediaType || 'image';
        updates.skillConfig = {
          ...(skill?.defaultConfig || {}),
          mediaCount: lockedCount,
          mediaType: lockedType,
        };
        updates.skillResultSchema = skill?.resultSchema || [];
        updates.randomImageSelection = true;
        updates.imageSelectionMode = 'huggingface_random';
        updates.excludePreviouslyUsedImages = true;
        updates.imageCount = lockedCount;
        if (!editedQuestion.title || editedQuestion.title === 'New Question') {
          updates.title = skill?.builderLabel || skill?.name || 'Interactive question';
        }
        return setEditedQuestion({ ...editedQuestion, ...updates });
      }
      if (value === 'skillquestion') {
        // Blank advanced custom task — no preset HTML until user picks/imports a skill
        updates.skillId = '';
        updates.skillHtml = '';
        updates.skillConfig = {};
        updates.skillResultSchema = [];
        updates.randomImageSelection = true;
        updates.imageSelectionMode = 'huggingface_random';
        updates.excludePreviouslyUsedImages = true;
        updates.imageCount = 1;
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
          updates.allowedTools = ['point', 'line', 'region', 'bbox'];
          if (editedQuestion.minAnnotations == null) updates.minAnnotations = 0;
          if (editedQuestion.maxAnnotations == null) updates.maxAnnotations = 50;
          if (!Array.isArray(editedQuestion.annotationLabels)) updates.annotationLabels = [];
        }
      }
      else if (value === 'mediaranking') {
        if (!editedQuestion.imageCount) updates.imageCount = 4;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        updates.mediaType = editedQuestion.mediaType || 'any';
        updates.choices = updates.choices || [];
      }
      else if (value === 'number') {
        updates.inputType = 'number';
        if (editedQuestion.min == null) updates.min = 0;
        if (editedQuestion.max == null) updates.max = 100;
      }
      else if (value === 'consent') {
        updates.isRequired = true;
        updates.labelTrue = editedQuestion.labelTrue || 'I agree / I consent';
        updates.labelFalse = editedQuestion.labelFalse || 'I do not agree';
        if (!editedQuestion.title || editedQuestion.title === 'New Question') {
          updates.title = 'I have read and agree to participate in this study.';
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
  const isStimulusQuestion = isMediaStimulusQuestion(editedQuestion.type)
    || (editedQuestion.type === 'skillquestion' && !!editedQuestion.skillId);
  const mediaConstraints = getQuestionMediaConstraints(editedQuestion.type, editedQuestion);
  const isRankingQuestion = editedQuestion.type === 'ranking';
  const isCuratedMode = isCuratedSelectionMode(editedQuestion.imageSelectionMode);

  // Load curated picker options for all stimulus types (project pool first)
  useEffect(() => {
    if (CURATED_STIMULUS_TYPES.includes(editedQuestion.type) && isCuratedMode) {
      loadImages();
    }
  }, [editedQuestion.type, editedQuestion.imageSelectionMode, currentProject?.preloadedImages]);

  // Initialize selected images from existing question data
  useEffect(() => {
    if (CURATED_STIMULUS_TYPES.includes(editedQuestion.type) && editedQuestion.selectedImageUrls) {
      setSelectedImages(editedQuestion.selectedImageUrls);
    }
  }, [editedQuestion.type]);

  // Auto-initialize stimulus questions with random selection mode if not set
  useEffect(() => {
    if (CURATED_STIMULUS_TYPES.includes(editedQuestion.type)) {
      if (!editedQuestion.imageSelectionMode) {
        setEditedQuestion((prev) => ({
          ...prev,
          imageSelectionMode: 'huggingface_random',
          randomImageSelection: true,
          excludePreviouslyUsedImages: true,
          choices: prev.choices || [],
        }));
      }
    }
  }, [editedQuestion.type]);

  const loadImages = async () => {
    if (!isCuratedSelectionMode(editedQuestion.imageSelectionMode)) {
      return;
    }
    // Curated list: pick from project-uploaded media (Image Dataset).
    // Hugging Face is only a fallback when the project has no preloaded media.
    setLoadingImages(true);
    setImageError(null);
    try {
      const pool = filterPoolForQuestion(currentProject?.preloadedImages || [], editedQuestion);
      if (pool.length > 0) {
        setAvailableImages(sortMediaByName(pool.map((img) => ({
          url: img.url,
          name: img.name || img.url,
          type: img.type,
        }))));
        setImageError(null);
        return;
      }

      if (currentProject?.imageDatasetConfig?.enabled && currentProject?.imageDatasetConfig?.datasetName) {
        const { getImagesFromHuggingFace } = await import('../../lib/huggingface');
        const { huggingFaceToken, datasetName } = currentProject.imageDatasetConfig;
        const allImages = [];
        let offset = 0;
        const batchSize = 100;
        let hasMore = true;
        while (hasMore) {
          const result = await getImagesFromHuggingFace(huggingFaceToken, datasetName, batchSize, offset);
          if (result.success && result.images.length > 0) {
            allImages.push(...result.images);
            offset += batchSize;
            if (result.images.length < batchSize || (result.total && offset >= result.total)) {
              hasMore = false;
            }
          } else {
            hasMore = false;
            if (allImages.length === 0) {
              setImageError(`Failed to load Hugging Face fallback: ${result.error}`);
            }
          }
        }
        if (allImages.length > 0) {
          setAvailableImages(sortMediaByName(allImages));
          setImageError(null);
        } else {
          setAvailableImages([]);
          setImageError((prev) => prev || 'No images found in the Hugging Face fallback dataset');
        }
        return;
      }

      setAvailableImages([]);
      setImageError('No media in this project yet. Upload files in Image Dataset, then pick a curated list here.');
    } catch (error) {
      console.error('Error loading curated media:', error);
      setImageError(error.message || 'Failed to load project media');
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
                  {typeMenuGroups.flatMap((group) => {
                    const items = questionTypes.filter((t) => t.group === group.id);
                    if (!items.length) return [];
                    return [
                      <MenuItem
                        key={`hdr-${group.id}`}
                        disabled
                        sx={{
                          opacity: '1 !important',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          color: 'text.secondary',
                          bgcolor: 'grey.50',
                          py: 0.75,
                        }}
                      >
                        {group.label}
                      </MenuItem>,
                      ...items.map((type) => (
                        <MenuItem key={type.value} value={type.value} sx={{ pl: 3 }}>
                          {type.label}
                        </MenuItem>
                      )),
                    ];
                  })}
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

              {editedQuestion.type === 'imageannotation' && (
                <Alert severity="info">
                  Participants can draw points, lines, regions, and bounding boxes on an image from your sampling settings.
                  Optionally define class labels, then set tools and min/max counts in the task options below.
                </Alert>
              )}

              {editedQuestion.type === 'skillquestion' && !editedQuestion.skillId && (
                <Alert severity="warning">
                  <strong>Advanced custom task.</strong> Most studies only need a ready-made perception task
                  (Pairwise Preference, Best–Worst, etc.) from the type list above.
                  To continue here, import or create a task in <strong>My Skill Library</strong>, then re-select it
                  under <em>Advanced · Library</em>.
                </Alert>
              )}

              {editedQuestion.type === 'skillquestion' && editedQuestion.skillId && (() => {
                const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                const isPreset = skillDef?.scope === 'preset' || String(editedQuestion.skillId).startsWith('preset_');
                return (
                  <>
                    <Alert severity="success" sx={{ mt: 0 }}>
                      <strong>{skillDef?.builderLabel || skillDef?.name || 'Interactive question'}</strong>
                      {(skillDef?.builderHint || skillDef?.description) && (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {skillDef.builderHint || skillDef.description}
                        </Typography>
                      )}
                      {!isPreset && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5 }} color="text.secondary">
                          Custom / library task · id: {editedQuestion.skillId}
                        </Typography>
                      )}
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
                        This question uses an older copy of the task. Update to the latest version
                        (your current wording settings are kept).
                      </Alert>
                    )}
                    <Alert severity="info" sx={{ mt: 1 }}>
                      <strong>Question Title</strong> is the heading participants see.
                      Use <strong>Task instructions</strong> in task options below for guidance inside the interactive area.
                    </Alert>
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
                label="Required — participants must answer to continue"
              />

              {editedQuestion.type === 'boolean' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Yes label"
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder="Yes"
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="No label"
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder="No"
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </Box>
                  <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                </Box>
              )}

              {editedQuestion.type === 'consent' && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Participants must accept to continue. Set the consent statement in the Question Title
                  (and optional Description). The Yes label is the accept action.
                </Alert>
              )}

              {editedQuestion.type === 'expression' && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Instruction-only — participants do not answer. Use the title and description above as the message.
                </Alert>
              )}

              {editedQuestion.type === 'slidergroup' && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  This question has no built-in media. Put a <strong>Media Display</strong> on the same page for the stimulus,
                  or use <strong>Image Slider Group</strong> instead.
                </Alert>
              )}
            </Box>
          </Box>

          {/* Unified stimulus sampling + task options + preview */}
          {isStimulusQuestion && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
                Stimulus & task settings
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Configure how stimuli are sampled, then set task-specific options and preview the participant view.
              </Typography>

              <SettingsSection
                step={1}
                title="How stimuli are sampled"
                hint="Exclude reuse, assignment mode, random vs curated list, and stimulus count."
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={editedQuestion.excludePreviouslyUsedImages !== false}
                      onChange={(e) => handleQuestionChange('excludePreviouslyUsedImages', e.target.checked)}
                    />
                  }
                  label="Do not reuse media already shown earlier in this survey"
                />

                {editedQuestion.type === 'skillquestion' ? (() => {
                  const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                  const mediaConstraintsSkill = getSkillMediaConstraints(editedQuestion.skillId, skillDef);
                  const cfg = editedQuestion.skillConfig || {};
                  const effectiveMediaType = mediaConstraintsSkill.typeFixed || cfg.mediaType || 'image';
                  const mediaTypeLabel = effectiveMediaType === 'video' ? 'video'
                    : effectiveMediaType === 'audio' ? 'audio'
                    : effectiveMediaType === 'any' ? 'media file' : 'image';
                  const setCfg = (key, value) => handleQuestionChange('skillConfig', { ...cfg, [key]: value });
                  const setMediaCount = (n) => {
                    if (!mediaConstraintsSkill.countAdjustable) return;
                    const count = Math.min(
                      Math.max(parseInt(n, 10) || mediaConstraintsSkill.countMin, mediaConstraintsSkill.countMin),
                      mediaConstraintsSkill.countMax,
                    );
                    setEditedQuestion({
                      ...editedQuestion,
                      imageCount: count,
                      skillConfig: { ...cfg, mediaCount: count },
                    });
                  };
                  const displayMediaCount = mediaConstraintsSkill.countFixed
                    ?? cfg.mediaCount
                    ?? editedQuestion.imageCount
                    ?? 1;
                  return (
                    <>
                      {mediaConstraintsSkill.countAdjustable && (
                        <TextField
                          fullWidth
                          type="number"
                          variant="outlined"
                          label={mediaConstraintsSkill.countLabel || `Number of ${mediaTypeLabel}s`}
                          value={displayMediaCount}
                          onChange={(e) => setMediaCount(e.target.value)}
                          helperText={`Randomly drawn from the project ${mediaTypeLabel} pool for each participant`}
                          inputProps={{
                            min: mediaConstraintsSkill.countMin,
                            max: mediaConstraintsSkill.countMax,
                            step: 1,
                          }}
                          sx={{ bgcolor: 'white' }}
                        />
                      )}
                      {!mediaConstraintsSkill.countAdjustable && (
                        <Alert severity="info" sx={{ py: 0.75 }}>
                          <strong>Stimulus count:</strong>{' '}
                          {mediaConstraintsSkill.countLabel
                            || `Always ${mediaConstraintsSkill.countFixed} ${mediaTypeLabel}(s)`}.
                        </Alert>
                      )}
                      {mediaConstraintsSkill.typeAdjustable && (
                        <FormControl fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                          <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Media type filter</InputLabel>
                          <Select
                            value={cfg.mediaType || 'image'}
                            label="Media type filter"
                            onChange={(e) => setCfg('mediaType', e.target.value)}
                          >
                            <MenuItem value="image">Image</MenuItem>
                            <MenuItem value="video">Video</MenuItem>
                            <MenuItem value="audio">Audio</MenuItem>
                            <MenuItem value="any">Any (mixed)</MenuItem>
                          </Select>
                        </FormControl>
                      )}
                      <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />
                      {(() => {
                        const skillKey = String(editedQuestion.skillId || '').replace(/^preset_/, '');
                        if (skillKey !== 'best_worst_choice') return null;
                        if ((editedQuestion.mediaAssignmentMode || 'individual') !== 'individual') return null;
                        return (
                          <FormControl fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                            <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Sampling Mode</InputLabel>
                            <Select
                              value={(() => {
                                const mode = editedQuestion.pairingMode || 'random';
                                if (mode === 'uncertain' || mode === 'high_sigma') return 'balanced';
                                return mode;
                              })()}
                              onChange={(e) => handleQuestionChange('pairingMode', e.target.value)}
                              label="Sampling Mode"
                            >
                              <MenuItem value="random">Random — uniform from the pool</MenuItem>
                              <MenuItem value="balanced">Balanced — prefer least-exposed images</MenuItem>
                              <MenuItem value="adaptive">Adaptive — μ bands + cold-start for new images</MenuItem>
                            </Select>
                          </FormControl>
                        );
                      })()}
                    </>
                  );
                })() : (
                  <>
                    <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />

                    {['mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking'].includes(editedQuestion.type) && (
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

                    {mediaConstraints.samplingModes && (
                      <SamplingModeSelect
                        question={editedQuestion}
                        onQuestionPatch={(patch) => setEditedQuestion((prev) => ({ ...prev, ...patch }))}
                      />
                    )}

                    <StimulusCountField
                      question={editedQuestion}
                      onChange={handleQuestionChange}
                      constraints={mediaConstraints}
                    />

                    {isCuratedMode && (
                      <CuratedMediaPicker
                        availableImages={availableImages}
                        selectedImages={selectedImages}
                        maxCount={editedQuestion.imageCount || mediaConstraints.defaultCount || 1}
                        loading={loadingImages}
                        error={imageError}
                        onToggle={handleImageSelection}
                        title="Select files"
                      />
                    )}
                  </>
                )}
              </SettingsSection>

              <SettingsSection
                step={2}
                title={editedQuestion.type === 'skillquestion' ? 'Wording & task options' : 'Task options'}
                hint={editedQuestion.type === 'skillquestion'
                  ? 'Labels and instructions participants see inside this task.'
                  : 'Type-specific response and presentation options.'}
              >
                {editedQuestion.type === 'skillquestion' && (() => {
                  const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                  const schema = skillDef?.configSchema || [];
                  const cfg = editedQuestion.skillConfig || {};
                  const setCfg = (key, value) => handleQuestionChange('skillConfig', { ...cfg, [key]: value });
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
                          inputProps={{ min: field.min, max: field.max, step: field.step || 1 }}
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
                            value={val ?? field.defaultValue ?? ''}
                            label={field.label || field.key}
                            onChange={(e) => setCfg(field.key, e.target.value)}
                          >
                            {field.options.map((opt) => {
                              const value = typeof opt === 'object' && opt != null ? opt.value : opt;
                              const label = typeof opt === 'object' && opt != null ? (opt.label || opt.value) : opt;
                              return (
                                <MenuItem key={String(value)} value={value}>{label}</MenuItem>
                              );
                            })}
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
                      {editableSchema.length === 0 && (
                        <Alert severity="info" sx={{ py: 0.5 }}>
                          No extra wording fields for this task. Edit the Question Title above if needed.
                        </Alert>
                      )}
                      {editableSchema.map((field) => renderSchemaField(field))}
                    </>
                  );
                })()}

                {editedQuestion.type === 'imagepicker' && (
                  <>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={editedQuestion.multiSelect || false}
                          onChange={(e) => handleQuestionChange('multiSelect', e.target.checked)}
                        />
                      }
                      label="Allow Multiple Selection - participants can choose more than one image"
                    />
                    {(editedQuestion.mediaAssignmentMode || 'individual') === 'individual' && (
                      <FormControl fullWidth variant="outlined">
                        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Sampling Mode</InputLabel>
                        <Select
                          value={(() => {
                            const mode = editedQuestion.pairingMode || 'random';
                            if (mode === 'uncertain' || mode === 'high_sigma') return 'balanced';
                            return mode;
                          })()}
                          onChange={(e) => handleQuestionChange('pairingMode', e.target.value)}
                          label="Sampling Mode"
                        >
                          <MenuItem value="random">Random — uniform from the pool</MenuItem>
                          <MenuItem value="balanced">Balanced — prefer least-exposed images</MenuItem>
                          <MenuItem value="adaptive">Adaptive — μ bands + cold-start for new images</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                    <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                  </>
                )}

                {(editedQuestion.type === 'imageranking' || editedQuestion.type === 'mediaranking') && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    Participants drag items into ranked order. Stimulus count is set above.
                  </Alert>
                )}

                {editedQuestion.type === 'imagerating' && (
                  <>
                    <TextField fullWidth variant="outlined" type="number" label="Minimum Rating Value"
                      value={editedQuestion.rateMin || 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" type="number" label="Maximum Rating Value"
                      value={editedQuestion.rateMax || 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="Minimum Rating Label"
                      value={editedQuestion.minRateDescription || ''}
                      onChange={(e) => handleQuestionChange('minRateDescription', e.target.value)}
                      placeholder="e.g., Very Poor"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="Maximum Rating Label"
                      value={editedQuestion.maxRateDescription || ''}
                      onChange={(e) => handleQuestionChange('maxRateDescription', e.target.value)}
                      placeholder="e.g., Excellent"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'imageboolean' && (
                  <>
                    <TextField fullWidth variant="outlined" label="Yes Label"
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder="e.g., Yes, Agree, Like"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="No Label"
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder="e.g., No, Disagree, Dislike"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'image' && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    <strong>Image Display shows exactly one image</strong> per participant.
                    To show multiple images, use <strong>Media Display</strong> instead.
                  </Alert>
                )}

                {editedQuestion.type === 'imagematrix' && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    Configure matrix rows and columns in the section below.
                  </Alert>
                )}

                {editedQuestion.type === 'mediadisplay' && (
                  <>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      For <strong>2+ images</strong>, the default gallery layout matches <strong>Image Choice</strong>.
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
                        <TextField fullWidth variant="outlined" label="Before label"
                          value={editedQuestion.beforeLabel || 'Before'}
                          onChange={(e) => handleQuestionChange('beforeLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                        <TextField fullWidth variant="outlined" label="After label"
                          value={editedQuestion.afterLabel || 'After'}
                          onChange={(e) => handleQuestionChange('afterLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                      </Box>
                    )}
                    {editedQuestion.displayMode === 'timed' && (
                      <TextField fullWidth variant="outlined" type="number" label="Exposure time (seconds)"
                        value={editedQuestion.exposureSeconds ?? 5}
                        onChange={(e) => handleQuestionChange('exposureSeconds', Math.min(Math.max(parseInt(e.target.value, 10) || 5, 1), 120))}
                        helperText="Participant clicks to start; media hides permanently after this many seconds."
                        inputProps={{ min: 1, max: 120, step: 1 }}
                        sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    )}
                  </>
                )}

                {editedQuestion.type === 'mediarating' && (
                  <>
                    <TextField fullWidth variant="outlined" type="number" label="Minimum rating"
                      value={editedQuestion.rateMin ?? 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value) || 1)}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" type="number" label="Maximum rating"
                      value={editedQuestion.rateMax ?? 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value) || 5)}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="Low-end label"
                      value={editedQuestion.minRateDescription || ''}
                      onChange={(e) => handleQuestionChange('minRateDescription', e.target.value)}
                      placeholder="e.g., Very poor"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="High-end label"
                      value={editedQuestion.maxRateDescription || ''}
                      onChange={(e) => handleQuestionChange('maxRateDescription', e.target.value)}
                      placeholder="e.g., Excellent"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'mediaboolean' && (
                  <>
                    <TextField fullWidth variant="outlined" label="Yes Label"
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder="e.g., Yes, Agree, Like"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField fullWidth variant="outlined" label="No Label"
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder="e.g., No, Disagree, Dislike"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'imageannotation' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Allowed Tools</InputLabel>
                      <Select
                        multiple
                        value={editedQuestion.allowedTools || ['point', 'line', 'region', 'bbox']}
                        onChange={(e) => handleQuestionChange('allowedTools',
                          typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                        label="Allowed Tools"
                      >
                        <MenuItem value="point">Point</MenuItem>
                        <MenuItem value="line">Line</MenuItem>
                        <MenuItem value="region">Region (polygon)</MenuItem>
                        <MenuItem value="bbox">Bounding box</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Class labels (optional)"
                      value={(editedQuestion.annotationLabels || []).join(', ')}
                      onChange={(e) => {
                        const labels = e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        handleQuestionChange('annotationLabels', labels);
                      }}
                      helperText="Comma-separated labels applied to new shapes (e.g. building, tree, sky). Leave empty for unlabeled annotation."
                      placeholder="building, tree, sky"
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <TextField fullWidth variant="outlined" type="number" label="Minimum annotations"
                        value={editedQuestion.minAnnotations ?? 0}
                        onChange={(e) => handleQuestionChange('minAnnotations', Math.max(0, parseInt(e.target.value, 10) || 0))}
                        helperText="Required before continuing (0 = no minimum)"
                        inputProps={{ min: 0, max: 100, step: 1 }}
                        sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                      <TextField fullWidth variant="outlined" type="number" label="Maximum annotations"
                        value={editedQuestion.maxAnnotations ?? 50}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10);
                          handleQuestionChange('maxAnnotations', Number.isNaN(raw) ? 50 : Math.max(0, raw));
                        }}
                        helperText="Cap on shapes per participant (0 = unlimited)"
                        inputProps={{ min: 0, max: 500, step: 1 }}
                        sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    </Box>
                  </>
                )}

                {editedQuestion.type === 'imageslidergroup' && (
                  <>
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
                  </>
                )}

                {editedQuestion.type === 'imagepointallocation' && (
                  <TextField
                    fullWidth
                    variant="outlined"
                    type="number"
                    label="Total points to allocate"
                    value={editedQuestion.budget ?? 100}
                    onChange={(e) => handleQuestionChange('budget', Math.max(1, parseInt(e.target.value, 10) || 100))}
                    helperText="Participants distribute exactly this many points across the allocation categories below"
                    inputProps={{ min: 1, step: 1 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {!['skillquestion', 'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image',
                  'imagematrix', 'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'imageannotation',
                  'imageslidergroup', 'imagepointallocation'].includes(editedQuestion.type) && (
                  <Alert severity="info" sx={{ py: 0.5 }}>No extra task options for this type.</Alert>
                )}
              </SettingsSection>

              <SettingsSection
                step={3}
                title="Participant preview"
                hint="What participants will interact with. Uses project media when available."
              >
                {editedQuestion.type === 'skillquestion' ? (() => {
                  const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                  const cfg = editedQuestion.skillConfig || {};
                  const mediaConstraintsSkill = getSkillMediaConstraints(editedQuestion.skillId, skillDef);
                  const effectiveMediaType = mediaConstraintsSkill.typeFixed || cfg.mediaType || 'image';
                  const displayMediaCount = mediaConstraintsSkill.countFixed
                    ?? cfg.mediaCount
                    ?? editedQuestion.imageCount
                    ?? 1;
                  const previewHtml = editedQuestion.skillHtml || skillDef?.sourceHtml;
                  if (!previewHtml) {
                    return <Alert severity="info" sx={{ py: 0.5 }}>No skill HTML available to preview.</Alert>;
                  }
                  const mergedCfgRaw = {
                    ...(skillDef?.defaultConfig || {}),
                    ...cfg,
                    mediaCount: displayMediaCount,
                    mediaType: effectiveMediaType,
                  };
                  const skillKey = String(editedQuestion.skillId || '').replace(/^preset_/, '');
                  const mergedCfg = skillKey === 'emotion_color_picker'
                    ? enrichEmotionColorConfig(mergedCfgRaw)
                    : mergedCfgRaw;
                  let previewImages = [];
                  if (currentProject?.preloadedImages?.length) {
                    previewImages = filterPoolForQuestion(currentProject.preloadedImages, {
                      ...editedQuestion,
                      imageCount: displayMediaCount,
                      skillConfig: mergedCfg,
                    }).slice(0, displayMediaCount);
                  }
                  if (!previewImages.length && skillPreviewPool.length) {
                    previewImages = pickPreviewMedia(
                      skillPreviewPool,
                      effectiveMediaType,
                      displayMediaCount,
                    );
                  }
                  return (
                    <>
                      {!previewImages.length && (
                        <Alert severity="info" sx={{ py: 0.5, mb: 1 }}>
                          No project media or admin skill-preview library media available.
                          Upload project media, or ask an admin to add files to the skill-preview library.
                        </Alert>
                      )}
                      <SkillQuestionFrame
                        skillHtml={previewHtml}
                        config={mergedCfg}
                        images={previewImages}
                        skillId={editedQuestion.skillId}
                        readOnly
                      />
                    </>
                  );
                })() : (
                  <QuestionParticipantPreview
                    question={editedQuestion}
                    currentProject={currentProject}
                  />
                )}
              </SettingsSection>
            </Box>
          )}

          {/* Slider group (non-image) — image variant uses Card 2 above */}
          {editedQuestion.type === 'slidergroup' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Task options — semantic differential
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
                <Alert severity="info" sx={{ py: 0.5 }}>
                  To rate an image / video / audio clip, put a Media Display question on the same page —
                  it handles media injection; this question collects the ratings.
                  Or use <strong>Image Slider Group</strong> for built-in image display.
                </Alert>
              </Box>
            </Box>
          )}

          {/* Point allocation (non-image) — image variant uses Card 2 above */}
          {editedQuestion.type === 'pointallocation' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Task options — budget allocation
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
                {['pointallocation', 'imagepointallocation'].includes(editedQuestion.type)
                  ? 'Allocation categories'
                  : editedQuestion.type === 'ranking'
                    ? 'Items to rank'
                    : 'Answer choices'}
              </Typography>
              {['pointallocation', 'imagepointallocation'].includes(editedQuestion.type) && (
                <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
                  These are the categories participants distribute points across
                  {editedQuestion.type === 'imagepointallocation'
                    ? ' (independent of the sampled images above)'
                    : ''}.
                </Alert>
              )}
              {(editedQuestion.type === 'radiogroup' || editedQuestion.type === 'dropdown') && (
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
                Task options — matrix rows & columns
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
                      helperText="Type a column label and press Enter or click Add (value is auto-filled; you can edit it below)"
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
                      {editedQuestion.columns.map((col, index) => {
                        const colObj = typeof col === 'object' && col !== null
                          ? col
                          : { value: String(col ?? ''), text: String(col ?? '') };
                        const updateColumn = (field, next) => {
                          const columns = [...(editedQuestion.columns || [])];
                          columns[index] = {
                            value: colObj.value ?? '',
                            text: colObj.text ?? '',
                            ...colObj,
                            [field]: next,
                          };
                          setEditedQuestion({ ...editedQuestion, columns });
                        };
                        return (
                          <ListItem
                            key={index}
                            divider={index < editedQuestion.columns.length - 1}
                            alignItems="flex-start"
                            sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, py: 1.5 }}
                          >
                            <Box sx={{ display: 'flex', gap: 1, width: '100%', alignItems: 'flex-start' }}>
                              <TextField
                                fullWidth
                                size="small"
                                variant="outlined"
                                label="Label (shown to participants)"
                                value={colObj.text ?? ''}
                                onChange={(e) => updateColumn('text', e.target.value)}
                                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                variant="outlined"
                                label="Value (stored in data)"
                                value={colObj.value ?? ''}
                                onChange={(e) => updateColumn('value', e.target.value)}
                                helperText="Used in exports / analysis"
                                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                              />
                              <IconButton
                                onClick={() => {
                                  const newColumns = editedQuestion.columns.filter((_, i) => i !== index);
                                  setEditedQuestion({ ...editedQuestion, columns: newColumns });
                                }}
                                color="error"
                                sx={{ mt: 0.5 }}
                              >
                                <Delete />
                              </IconButton>
                            </Box>
                          </ListItem>
                        );
                      })}
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
          {(editedQuestion.type === 'comment' || editedQuestion.type === 'text' || editedQuestion.type === 'rating' || editedQuestion.type === 'number' || editedQuestion.type === 'consent') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
                Task options
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

                {editedQuestion.type === 'number' && (
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Minimum"
                      value={editedQuestion.min ?? 0}
                      onChange={(e) => handleQuestionChange('min', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ flex: '1 1 160px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      type="number"
                      label="Maximum"
                      value={editedQuestion.max ?? 100}
                      onChange={(e) => handleQuestionChange('max', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ flex: '1 1 160px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </Box>
                )}

                {editedQuestion.type === 'consent' && (
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Accept label"
                      value={editedQuestion.labelTrue || 'I agree / I consent'}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Decline label"
                      value={editedQuestion.labelFalse || 'I do not agree'}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Alert severity="info" sx={{ width: '100%', py: 0.5 }}>
                      Consent is always required. Participants must choose accept to continue.
                    </Alert>
                  </Box>
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

          {/* Non-stimulus: task options live above; Card 3 preview only */}
          {!isStimulusQuestion && editedQuestion.type && editedQuestion.type !== 'expression' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
                Participant preview
              </Typography>
              <SettingsSection
                step={3}
                title="Participant preview"
                hint="Compact SurveyJS preview of this question alone."
              >
                <QuestionParticipantPreview
                  question={editedQuestion}
                  currentProject={currentProject}
                />
              </SettingsSection>
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

          if (['imagepicker','imageranking','imagerating','imageboolean','imagematrix','image','imageslidergroup','imagepointallocation','mediadisplay','mediarating','mediaboolean','mediaranking','imageannotation'].includes(questionToSave.type)) {
            questionToSave.imageCount = clampQuestionImageCount(
              questionToSave.type,
              questionToSave,
              questionToSave.imageCount,
            );
          }

          // Skill questions: enforce preset mediaConstraints (e.g. pairwise = always 2 images)
          if (questionToSave.type === 'consent') {
            questionToSave.isRequired = true;
            questionToSave.labelTrue = questionToSave.labelTrue || 'I agree / I consent';
            questionToSave.labelFalse = questionToSave.labelFalse || 'I do not agree';
          }
          if (questionToSave.type === 'number') {
            questionToSave.inputType = 'number';
          }

          if (questionToSave.type === 'skillquestion' && questionToSave.skillId) {
            const skillDef = resolveBuilderSkill(questionToSave.skillId, builderSkills);
            const mediaConstraints = getSkillMediaConstraints(questionToSave.skillId, skillDef);
            const nextCfg = { ...(questionToSave.skillConfig || {}) };
            if (mediaConstraints.countFixed != null) {
              nextCfg.mediaCount = mediaConstraints.countFixed;
              questionToSave.imageCount = mediaConstraints.countFixed;
            } else if (nextCfg.mediaCount != null) {
              nextCfg.mediaCount = Math.min(
                Math.max(Number(nextCfg.mediaCount) || mediaConstraints.countMin, mediaConstraints.countMin),
                mediaConstraints.countMax,
              );
              questionToSave.imageCount = nextCfg.mediaCount;
            }
            if (mediaConstraints.typeFixed) {
              nextCfg.mediaType = mediaConstraints.typeFixed;
            }
            questionToSave.skillConfig = nextCfg;
            questionToSave.randomImageSelection = true;
          }

          // Media display / rating / boolean / annotation — honor curated vs random
          if (['mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation'].includes(questionToSave.type)) {
            if (!questionToSave.imageSelectionMode) {
              questionToSave.imageSelectionMode = 'huggingface_random';
            }
            const curated = isCuratedSelectionMode(questionToSave.imageSelectionMode);
            questionToSave.randomImageSelection = !curated;
            questionToSave.excludePreviouslyUsedImages = questionToSave.excludePreviouslyUsedImages !== false;
            questionToSave.imageCount = clampQuestionImageCount(
              questionToSave.type,
              questionToSave,
              questionToSave.imageCount,
            );
            if (curated && questionToSave.selectedImageUrls?.length) {
              const pool = filterPoolForQuestion(currentProject?.preloadedImages || [], questionToSave);
              const byUrl = new Map(pool.map((img) => [img.url, img]));
              const selected = questionToSave.selectedImageUrls.map((url) => {
                const found = byUrl.get(url);
                if (found) return found;
                const name = String(url).split('?')[0].split('/').pop() || url;
                return { url, name };
              });
              applyMediaToElement(questionToSave, selected);
            }
          }
          
          // Convert selectedImageUrls to SurveyJS choices format for imagepicker, imageranking, and image questions
          // Note: imageboolean, imagerating, imagematrix use imageHtml instead (handled above)
          if (questionToSave.type === 'imagepicker' || questionToSave.type === 'imageranking' || questionToSave.type === 'mediaranking' || questionToSave.type === 'image') {
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
                // For imagepicker / imageranking / mediaranking, use choices
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
