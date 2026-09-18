import { questionSettingErrorText, useQuestionEditorText } from '../../contexts/questionEditorI18n';
import QuestionDataPreview from './QuestionDataPreview';
import ConfirmDialog from '../layout/ConfirmDialog';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import { useRegion } from '../../contexts/RegionContext';
import { validateQuestionSettings } from '../../lib/designProtocol/validate';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  Tabs, Tab, useMediaQuery,
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
  Chip,
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
  usesSingleCategoryPerTrial,
  resolveMediaFolderTags,
} from '../../lib/surveyMediaInjection';
import { sortMediaByName, normalizeMediaAssignmentMode, listAllKnownFolders } from '../../lib/mediaUtils';
import { normalizeAllowedTools } from '../../lib/annotationTools';
import { SkillDimensionsEditor, SkillStringListEditor } from './SkillConfigFieldEditors';
import {
  getSkillMediaConstraints,
  getPresetBuilderTypeOptions,
  resolveBuilderSkill,
} from '../../lib/presetSkills';
import {
  getQuestionMediaConstraints,
  clampQuestionImageCount,
  isMediaStimulusQuestion,
  isCuratedSelectionMode,
  supportsTrialCount,
} from '../../lib/questionTypeConstraints';
import { clampTrialCount, TRIAL_COUNT_MAX } from '../../lib/trialNavigation';
import { normalizeSliderQuestion } from '../../lib/sliderScale';
import {
  getQuestionTypeDefinition,
  QUESTION_TYPE_IDS,
} from '../../lib/platformSchema';
import MediaPairingGuide from './MediaPairingGuide';
import MediaCategoryGuide from './MediaCategoryGuide';
import QuestionParticipantPreview from './QuestionParticipantPreview';
import MediaSlotsEditor from './MediaSlotsEditor';
import MediaFolderScopeSelect from './MediaFolderScopeSelect';

const MEDIA_STAR_EDITOR_TYPES = [
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
];

const CURATED_STIMULUS_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'imagematrix',
  'image', 'imageslidergroup', 'imagepointallocation',
  ...MEDIA_STAR_EDITOR_TYPES, 'imageannotation',
];

function annotationLabelText(label) {
  if (typeof label === 'string' || typeof label === 'number') return String(label).trim();
  if (label && typeof label === 'object') return String(label.text ?? label.label ?? label.value ?? '').trim();
  return '';
}

function formatAnnotationLabels(labels) {
  return (Array.isArray(labels) ? labels : []).map(annotationLabelText).filter(Boolean).join(', ');
}

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
  const { tr, zh } = useQuestionEditorText();
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
        {tr(title)} ({selectedImages.length}/{maxCount} {zh ? '已选' : 'selected'})
      </Typography>
      <TextField
        fullWidth
        size="small"
        variant="outlined"
        placeholder={tr("Search by file name…")}
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
        <Alert severity="error" sx={{ mb: 1.5 }}>{tr(error)}</Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Alert severity="info" sx={{ py: 0.5 }}>
          {availableImages.length === 0
            ? (zh ? '没有可供选择的媒体。' : 'No media available to pick from.')
            : (zh ? `没有匹配“${query.trim()}”的文件名。` : `No file names match “${query.trim()}”.`)}
        </Alert>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {zh ? `共 ${availableImages.length} 个文件，显示 ${filtered.length} 个` : `Showing ${filtered.length} of ${availableImages.length} files`}
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
  const { tr, zh } = useQuestionEditorText();
  const mode = isCuratedSelectionMode(question.imageSelectionMode)
    ? 'huggingface_manual'
    : 'huggingface_random';
  return (
    <FormControl fullWidth variant="outlined">
      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("How stimuli are chosen")}</InputLabel>
      <Select inputProps={{ 'aria-label': tr("How stimuli are chosen") }}
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          onQuestionPatch({
            imageSelectionMode: next,
            randomImageSelection: next === 'huggingface_random',
          });
        }}
        label={tr("How stimuli are chosen")}
      >
        <MenuItem value="huggingface_random">{tr(zh ? '从媒体库随机抽取' : 'Random from media library')}</MenuItem>
        <MenuItem value="huggingface_manual">{tr("Curated list (pick specific files)")}</MenuItem>
      </Select>
    </FormControl>
  );
}

function StimulusCountField({ question, onChange, constraints }) {
  const { tr, zh } = useQuestionEditorText();
  if (!constraints?.hasStimuli) return null;
  if (!constraints.countAdjustable) {
    return (
      <Alert severity="info" sx={{ py: 0.75 }}>
        <strong>{tr("Stimulus count:")}</strong>{' '}
        {constraints.countLabel ? tr(constraints.countLabel) : (zh ? `固定为 ${constraints.countFixed}` : `Fixed at ${constraints.countFixed}`)}.
        {' '}{tr("Drawn from the project media pool for each participant.")} </Alert>
    );
  }
  return (
    <TextField
      fullWidth
      variant="outlined"
      type="number"
      label={tr(constraints.countLabel || 'Number of stimuli')}
      value={question.imageCount ?? constraints.defaultCount}
      onChange={(e) => onChange(
        'imageCount',
        clampQuestionImageCount(question.type, question, e.target.value),
      )}
      onFocus={(e) => e.target.select()}
      helperText={tr("Randomly drawn from the project media pool (or your curated list)")}
      inputProps={{ min: constraints.countMin, max: constraints.countMax, step: 1 }}
      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
    />
  );
}

function TrialCountField({ question, onChange }) {
  const { tr, zh } = useQuestionEditorText();
  if (!supportsTrialCount(question.type)) return null;
  return (
    <TextField
      fullWidth
      variant="outlined"
      type="number"
      label={tr("Number of trials (repeat this question)")}
      value={question.trialCount ?? 1}
      onChange={(e) => onChange('trialCount', clampTrialCount(e.target.value))}
      onFocus={(e) => e.target.select()}
      helperText={tr(zh ? `${clampTrialCount(question.trialCount ?? 1)} 轮作答 × 每轮 ${question.imageCount ?? 1} 个媒体。每轮保存对应素材的答案。选择题自动进入下一轮，评分和是非题可修改答案；媒体不足时可能重复。` : `${clampTrialCount(question.trialCount ?? 1)} response rounds × ${question.imageCount ?? 1} media per round. Each round records one answer for its shown set. Choice auto-advances; rating and yes/no allow review. Repeats may occur if the media pool is too small.`)}
      inputProps={{ min: 1, max: TRIAL_COUNT_MAX, step: 1 }}
      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
    />
  );
}

function AttentionCheckFields({ question, onChange }) {
  const { tr } = useQuestionEditorText();
  const supported = ['rating', 'radiogroup', 'dropdown', 'boolean', 'imagepicker', 'mediapicker'].includes(question.type);
  if (!supported) return null;
  const isPicker = question.type === 'imagepicker' || question.type === 'mediapicker';
  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{tr("Attention Check (data quality)")} </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={!!question.isAttentionCheck}
            onChange={(e) => onChange('isAttentionCheck', e.target.checked)}
          />
        }
        label={tr("Mark as attention-check question")}
      />
      {question.isAttentionCheck && (
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          label={tr("Expected answer")}
          value={question.expectedAnswer ?? ''}
          onChange={(e) => onChange('expectedAnswer', e.target.value)}
          helperText={
            tr(isPicker
              ? 'Filename or choice value the participant must select (checked in analysis, not blocked at submit)'
              : question.type === 'boolean'
                ? 'Use true or false (or the Yes/No label text as stored — usually true/false)'
                : 'Exact choice value the participant must select (checked in analysis, not blocked at submit)')
          }
        />
      )}
    </Box>
  );
}

function MediaAssignmentFields({ question, onChange, currentProject }) {
  const { tr, zh } = useQuestionEditorText();
  const mode = question.mediaAssignmentMode === 'group' ? 'set' : (question.mediaAssignmentMode || 'individual');
  const isSet = mode === 'set';
  const isCategory = mode === 'category';
  const singleCategory = usesSingleCategoryPerTrial(question);
  const count = question.imageCount || 1;
  const folderTags = React.useMemo(
    () => resolveMediaFolderTags(currentProject, { pages: [{ elements: [question] }] }),
    [currentProject, question],
  );
  const folderOptions = React.useMemo(() => {
    if (isSet || isCategory) return Object.keys(folderTags).filter((folder) => folderTags[folder] === (isSet ? 'set' : 'category'));
    return listAllKnownFolders(currentProject?.preloadedImages || [], folderTags, null, currentProject?.imageDatasetConfig?.mediaFolders || []);
  }, [currentProject, folderTags, isSet, isCategory]);
  const hasSlots = question.mediaSlots?.length > 0;
  const isCurated = isCuratedSelectionMode(question.imageSelectionMode);
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
    ? (zh ? `（仅${tr(poolStatus.mediaTypeFilter)}）` : ` (${poolStatus.mediaTypeFilter} only)`)
    : '';

  return (
    <>
      <FormControl fullWidth variant="outlined">
        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Media Assignment")}</InputLabel>
        <Select inputProps={{ 'aria-label': tr("Media Assignment") }}
          value={mode}
          onChange={(e) => onChange('mediaAssignmentMode', e.target.value)}
          label={tr("Media Assignment")}
        >
          <MenuItem value="individual">{tr("Random individual files")}</MenuItem>
          <MenuItem value="set">{tr("Random fixed sets (tagged folders)")}</MenuItem>
          <MenuItem value="category">{tr("Per category (tagged folders)")}</MenuItem>
        </Select>
      </FormControl>
      {isCategory && !hasSlots && !isCurated && (
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel>{tr('Category selection per trial')}</InputLabel>
          <Select
            label={tr('Category selection per trial')}
            inputProps={{ 'aria-label': tr('Category selection per trial') }}
            value={singleCategory ? 'single' : 'all'}
            onChange={(e) => onChange('mediaCategoryMode', e.target.value)}
          >
            <MenuItem value="single">{tr('One category per trial')}</MenuItem>
            <MenuItem value="all">{tr('All selected categories per trial')}</MenuItem>
          </Select>
        </FormControl>
      )}
      {isCategory && (
        <TextField
          fullWidth
          type="number"
          size="small"
          variant="outlined"
          label={tr(singleCategory ? 'Files per trial' : 'Files per category')}
          value={question.mediaPerCategory ?? 1}
          onChange={(e) => {
            const n = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
            onChange('mediaPerCategory', n);
          }}
          inputProps={{ min: 1, max: 50 }}
          helperText={
            singleCategory
              ? tr('Each trial randomly chooses one selected category and draws {count} files only from it.', { count: question.mediaPerCategory ?? 1 })
              : tr(poolStatus.matchingCategoryCount > 0
              ? (zh ? `${poolStatus.matchingCategoryCount} 个分类 × 每类 ${poolStatus.mediaPerCategory} 个文件，共 ${poolStatus.expectedCategoryTotal} 个文件` : `${poolStatus.matchingCategoryCount} categories × ${poolStatus.mediaPerCategory} = ${poolStatus.expectedCategoryTotal} file(s) total`)
              : 'How many files to draw from each tagged category folder')
          }
          sx={{ mt: 1 }}
        />
      )}
      {!hasSlots && !isCurated && <MediaFolderScopeSelect
        folders={folderOptions}
        value={question.mediaFolders || []}
        onChange={(folders) => onChange('mediaFolders', folders)}
        allLabel={tr(isSet ? 'All tagged sets' : isCategory ? 'All tagged categories' : 'All media (all folders)')}
        helperText={tr(isSet
          ? 'Select one or more set folders. Each draw uses one complete set. Clear the selection to use all sets.'
          : isCategory
            ? (singleCategory ? 'Select the categories eligible for each trial. Each trial uses only one of them. Clear to use all categories.' : 'Select one or more category folders. Draw the specified count from each selected category, including subfolders. Clear to use all categories.')
            : 'Select one or more folders, including their subfolders. Files are drawn from their combined pool. Clear to use all media.')}
      />}
      {!isSet && !isCategory && !hasSlots && !isCurated && <Alert severity={poolStatus.matchingFileCount ? 'info' : 'warning'}>
        {tr('Available in this scope: {count} matching files.', { count: poolStatus.matchingFileCount })}
        {question.mediaFolders?.length > 0 && !poolStatus.matchingFileCount && ` ${tr('No matching media in the selected folders. Choose other folders or upload media there.')}`}
      </Alert>}
      {isSet && (
        <>
          {poolStatus.totalFileCount === 0 ? (
            <Alert severity="warning">{tr("No media in project — upload files in Media Dataset first.")}</Alert>
          ) : poolStatus.matchingFileCount === 0 ? (
            <Alert severity="warning">
              {zh ? `项目中有 ${poolStatus.totalFileCount} 个文件，但没有符合本题媒体类型筛选条件的文件${mediaTypeHint}。` : `${poolStatus.totalFileCount} file(s) in project, but none match this question's media type filter${mediaTypeHint}.`}
            </Alert>
          ) : (poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount) === 0 ? (
            <Alert severity="warning">
              {zh ? `没有符合条件的分组：需要标记为“分组”的文件夹，且每组直属文件数恰好为 ${poolStatus.filesPerSet}${mediaTypeHint}。请到媒体库设置文件夹标记。` : `No eligible set folders (need folders tagged set with exactly ${poolStatus.filesPerSet} direct file(s)${mediaTypeHint}). Tag folders in Media Dataset.`}
            </Alert>
          ) : (
            <Alert severity="success">
              {zh ? `可用分组 ${poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount} 个，每组 ${poolStatus.filesPerSet} 个文件（共 ${poolStatus.matchingFileCount} 个匹配文件${mediaTypeHint}）。` : `${poolStatus.eligibleSetCount ?? poolStatus.eligibleGroupCount} set(s) of size ${poolStatus.filesPerSet} available (${poolStatus.matchingFileCount} matching file(s)${mediaTypeHint}).`}
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
            <Alert severity="warning">{tr("No media in project — upload files in Media Dataset first.")}</Alert>
          ) : singleCategory && poolStatus.eligibleSingleCategoryCount === 0 ? (
            <Alert severity="warning">{tr('No selected category has enough matching files for a complete trial. Reduce the count or add media.')}</Alert>
          ) : poolStatus.matchingCategoryCount > 0 ? (
            <Alert severity="success">
              {singleCategory ? tr('Each trial randomly chooses one selected category and draws {count} files only from it.', { count: poolStatus.expectedCategoryTotal }) : zh ? `将展示 ${poolStatus.expectedCategoryTotal} 个文件：从 ${poolStatus.matchingCategoryCount} 个分类中，每类抽取 ${poolStatus.mediaPerCategory} 个。` : `Will show ${poolStatus.expectedCategoryTotal} file(s): ${poolStatus.mediaPerCategory} from each of ${poolStatus.matchingCategoryCount} categories.`}
              {' '}({poolStatus.matchingCategoryLabels.join(', ')}){mediaTypeHint}
            </Alert>
          ) : (
            <Alert severity="warning">
              {zh ? '尚未标记分类文件夹，或没有符合筛选条件的分类。请在媒体库中将文件夹标记为“分类”。' : 'No category folders tagged yet (or none match this filter). Tag folders as category in Media Dataset.'}
            </Alert>
          )}
          <MediaCategoryGuide
            singleCategory={singleCategory}
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
          {zh
            ? `从媒体库随机抽取 ${count} 个文件。来源：${(currentProject?.preloadedImages || []).some((img) => String(img.key || '').startsWith('skill-preview/')) ? '示例预览库' : '项目媒体库'}；范围内可用 ${poolStatus.matchingFileCount || 0} / 总共 ${poolStatus.totalFileCount || 0}。优先不重复，不足时回退到该范围未过滤池。`
            : `Random from media library (${count} file(s)). Source: ${(currentProject?.preloadedImages || []).some((img) => String(img.key || '').startsWith('skill-preview/')) ? 'preview sample library' : 'project media library'}; in-scope ${poolStatus.matchingFileCount || 0} / total ${poolStatus.totalFileCount || 0}. Prefer unused files; fall back to the unfiltered range if needed.`}
        </Typography>
      )}
    </>
  );
}

// JSON config field with local text state so invalid intermediate input
// doesn't corrupt skillConfig; commits on successful parse.
function SkillJsonField({ label, value, onCommit }) {
  const { tr } = useQuestionEditorText();
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
      helperText={tr(invalid ? 'Invalid JSON — changes not applied' : 'JSON value')}
      sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
    />
  );
}

export default function QuestionEditor({
  question,
  onSave,
  onCancel,
  images,
  currentProject,
  surveyConfig = null,
  variant = 'dialog',
  pageName = '',
  onWorkingCopyChange,
  onOpenAssistant,
}) {
  const { tr } = useQuestionEditorText();
  // Convert ranking with isImageRanking back to imageranking for editing
  const initialQuestion = normalizeSliderQuestion({ ...question });
  if (initialQuestion.type === 'ranking' && initialQuestion.isImageRanking) {
    initialQuestion.type = 'imageranking';
  }
  
  const [editedQuestion, setEditedQuestion] = useState(initialQuestion);
  const [taskFilter, setTaskFilter] = useState('all');
  const [newChoice, setNewChoice] = useState('');
  // Draft string so trailing commas stay while typing (array join would strip them).
  const [annotationLabelsText, setAnnotationLabelsText] = useState(
    () => formatAnnotationLabels(initialQuestion.annotationLabels),
  );
  
  // Image selection states
  const [availableImages, setAvailableImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [builderSkills, setBuilderSkills] = useState([]);
  const initialSnapshot = useRef(JSON.stringify(initialQuestion));
  const dirty = JSON.stringify(editedQuestion) !== initialSnapshot.current || !!newChoice.trim()
    || annotationLabelsText !== formatAnnotationLabels(initialQuestion.annotationLabels);
  const guard = useUnsavedChanges(dirty);
  const { language } = useRegion();
  const zh = language === 'zh';
  const mobile = useMediaQuery('(max-width:600px)');
  const wide = useMediaQuery('(min-width:1000px)');
  const [editorTab, setEditorTab] = useState(0);
  const workspace = variant === 'workspace';
  const settingsRef = useRef(null);
  const settingsErrors = validateQuestionSettings(editedQuestion);
  const closeEditor = () => guard.request(onCancel);
  const focusSetting = (path) => {
    setEditorTab(0);
    requestAnimationFrame(() => {
      const field = [...(settingsRef.current?.querySelectorAll('[name]') || [])]
        .find((node) => node.getAttribute('name') === path);
      field?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      field?.focus();
    });
  };

  useEffect(() => {
    listSkillsForBuilder().then(setBuilderSkills);
  }, []);

  const workingCopyChangeRef = useRef(onWorkingCopyChange);
  workingCopyChangeRef.current = onWorkingCopyChange;
  useEffect(() => {
    workingCopyChangeRef.current?.({
      questionName: editedQuestion.name || question?.name || null,
      pageName: pageName || null,
      workingCopy: editedQuestion,
      baseline: question,
      dirty,
    });
  }, [dirty, editedQuestion, pageName, question]);

  useEffect(() => {
    if (editedQuestion.type === 'imageannotation') {
      setAnnotationLabelsText(formatAnnotationLabels(editedQuestion.annotationLabels));
    }
  }, [editedQuestion.type]);


  const presetTypeOptions = getPresetBuilderTypeOptions();
  const presetSkillIds = new Set(presetTypeOptions.map((o) => o.value.slice(6)));

  // Library skills that are not built-in presets (custom / approved community)
  const libraryTypeOptions = builderSkills
    .filter((s) => !presetSkillIds.has(s.id) && !String(s.id).startsWith('preset_'))
    .map((s) => ({
      value: `skill:${s.id}`,
      label: s.scope === 'mine' && !s.is_approved
        ? (zh ? `高级 · 我的任务：${s.name}` : `Advanced · My task: ${s.name}`)
        : (zh ? `高级 · 自定义交互：${s.name}` : `Advanced · Custom interactions: ${s.name}`),
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
    { value: 'imagecheckbox', label: 'Image Multi-select (text tags)', group: 'image' },
    { value: 'imagematrix', label: 'Image Matrix', group: 'image' },
    { value: 'image', label: 'Image Display (single image)', group: 'image' },
    { value: 'imageannotation', label: 'Image Annotation', group: 'image' },
    { value: 'imageslidergroup', label: 'Image Slider Group', group: 'image' },
    { value: 'imagepointallocation', label: 'Image Point Allocation', group: 'image' },
    { value: 'mediapicker', label: 'Media Choice', group: 'media' },
    { value: 'mediaranking', label: 'Media Ranking', group: 'media' },
    { value: 'mediarating', label: 'Media Rating Scale', group: 'media' },
    { value: 'mediaboolean', label: 'Media Yes/No', group: 'media' },
    { value: 'mediacheckbox', label: 'Media Multi-select (text tags)', group: 'media' },
    { value: 'mediamatrix', label: 'Media Matrix', group: 'media' },
    { value: 'mediadisplay', label: 'Media Display (image / video / audio)', group: 'media' },
    { value: 'mediaslidergroup', label: 'Media Slider Group', group: 'media' },
    { value: 'mediapointallocation', label: 'Media Point Allocation', group: 'media' },
    // Built-in interactive questions — first-class types (not labeled "Skill")
    ...presetTypeOptions,
    // Advanced: blank custom HTML skill + user/library skills
    {
      value: 'skillquestion',
      label: 'Advanced · Build custom interactive task (HTML)',
      group: 'advanced',
    },
    ...libraryTypeOptions,
  ].filter(({ value }) => QUESTION_TYPE_IDS.includes(value) || String(value).startsWith('skill:'));

  const taskFamily = (type) => {
    if (/ranking/.test(type) || type === 'ranking') return 'ranking';
    if (/allocation/.test(type)) return 'allocation';
    if (/matrix/.test(type)) return 'matrix';
    if (/annotation/.test(type)) return 'annotation';
    if (/rating|slider/.test(type) || type === 'number') return 'rating';
    if (/picker|checkbox|boolean|choice|forced/.test(type) || ['radiogroup', 'dropdown', 'consent'].includes(type)) return 'choice';
    if (type.startsWith('skill:') || type === 'skillquestion') return 'advanced';
    return 'text';
  };
  const selectedType = editedQuestion.type === 'skillquestion' && editedQuestion.skillId
    ? `skill:${editedQuestion.skillId}` : editedQuestion.type || 'text';

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
      || (field === 'mediaCategoryMode' && normalizeMediaAssignmentMode(editedQuestion.mediaAssignmentMode) === 'category')
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
      const schemaDefinition = getQuestionTypeDefinition(value);
      if (schemaDefinition?.defaults) {
        Object.assign(
          updates,
          JSON.parse(JSON.stringify(schemaDefinition.defaults)),
          { type: value },
        );
      }
      if (String(value).startsWith('skill:')) {
        const skillId = String(value).slice(6);
        const skill = resolveBuilderSkill(skillId, builderSkills);
        updates.type = 'skillquestion';
        updates.skillId = skill?.id || skillId;
        updates.skillHtml = skill?.sourceHtml || '';
        updates.skillAnalysisHtml = skill?.analysisHtml || '';
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
        updates.skillRevision = Number(skill?.revision || skill?.currentRevision || 1);
        updates.skillContractVersion = Number(skill?.contractVersion || 1);
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
        updates.skillAnalysisHtml = '';
        updates.skillConfig = {};
        updates.skillResultSchema = [];
        updates.skillRevision = 0;
        updates.skillContractVersion = 1;
        updates.randomImageSelection = true;
        updates.imageSelectionMode = 'huggingface_random';
        updates.excludePreviouslyUsedImages = true;
        updates.imageCount = 1;
        return setEditedQuestion({ ...editedQuestion, ...updates });
      }
      // Types that should have 1 image/media by default
      if (value === 'imagerating' || value === 'imagematrix' || value === 'imageboolean' || value === 'imagecheckbox' || value === 'image'
        || value === 'imageslidergroup' || value === 'imagepointallocation'
        || value === 'mediadisplay' || value === 'mediarating' || value === 'mediaboolean' || value === 'mediacheckbox'
        || value === 'mediamatrix' || value === 'mediaslidergroup' || value === 'mediapointallocation'
        || value === 'imageannotation') {
        if (!editedQuestion.imageCount) updates.imageCount = 1;
        if (value === 'image') updates.imageCount = 1;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        updates.choices = updates.choices || [];
        if (value === 'imagecheckbox' || value === 'mediacheckbox') {
          if (!editedQuestion.choices?.length) {
            updates.choices = [
              { value: 'tag_a', text: 'Tag A' },
              { value: 'tag_b', text: 'Tag B' },
              { value: 'tag_c', text: 'Tag C' },
            ];
          }
        }
        if (MEDIA_STAR_EDITOR_TYPES.includes(value)) {
          updates.mediaType = 'any';
          if (!Array.isArray(editedQuestion.mediaSlots)) updates.mediaSlots = [];
          if (!editedQuestion.mediaPresentation) updates.mediaPresentation = 'stack';
        }
        if ((value === 'mediamatrix' || value === 'imagematrix') && !editedQuestion.rows?.length) {
          updates.rows = [{ value: 'row1', text: 'Criterion 1' }];
          updates.columns = [
            { value: '1', text: '1' }, { value: '2', text: '2' },
            { value: '3', text: '3' }, { value: '4', text: '4' }, { value: '5', text: '5' },
          ];
        }
        if (value === 'mediaslidergroup' && !editedQuestion.dimensions?.length) {
          updates.dimensions = [
            { id: 'd1', label: 'Dimension 1', left: 'Low', right: 'High' },
            { id: 'd2', label: 'Dimension 2', left: 'Disagree', right: 'Agree' },
          ];
          updates.scaleMin = 1;
          updates.scaleMax = 7;
        }
        if (value === 'mediapointallocation' && !editedQuestion.choices?.length) {
          updates.choices = [
            { value: 'a', text: 'Option A' },
            { value: 'b', text: 'Option B' },
          ];
          updates.budget = 100;
        }
        if (value === 'imageannotation') {
          updates.allowedTools = ['point', 'line', 'polygon', 'bbox'];
          if (editedQuestion.minAnnotations == null) updates.minAnnotations = 0;
          if (editedQuestion.maxAnnotations == null) updates.maxAnnotations = 50;
          if (!Array.isArray(editedQuestion.annotationLabels)) updates.annotationLabels = [];
        }
      }
      else if (value === 'mediaranking' || value === 'mediapicker') {
        if (!editedQuestion.imageCount) updates.imageCount = 4;
        updates.imageSelectionMode = 'huggingface_random';
        updates.randomImageSelection = true;
        updates.excludePreviouslyUsedImages = true;
        updates.mediaType = editedQuestion.mediaType || 'any';
        updates.choices = updates.choices || [];
        if (!Array.isArray(editedQuestion.mediaSlots)) updates.mediaSlots = [];
        if (!editedQuestion.mediaPresentation) updates.mediaPresentation = 'stack';
        if (value === 'mediapicker' && editedQuestion.multiSelect == null) {
          updates.multiSelect = false;
        }
        if (value === 'mediapicker' && !editedQuestion.pairingMode) {
          updates.pairingMode = 'random';
        }
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
            { id: 'dim_1', label: 'Dimension 1', left: 'Negative', right: 'Positive' },
            { id: 'dim_2', label: 'Dimension 2', left: 'Unpleasant', right: 'Pleasant' },
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
            { id: 'dim_1', label: 'Dimension 1', left: 'Negative', right: 'Positive' },
            { id: 'dim_2', label: 'Dimension 2', left: 'Unpleasant', right: 'Pleasant' },
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

  const uniqueChoiceValue = (text) => {
    const base = text.trim().toLowerCase().replace(/\s+/g, '_');
    const used = new Set((editedQuestion.choices || []).map((c) => String(typeof c === 'object' ? c.value : c)));
    let value = base;
    let suffix = 2;
    while (used.has(value)) value = `${base}_${suffix++}`;
    return value;
  };

  const addChoice = () => {
    if (!newChoice.trim()) return;
    
    const choices = editedQuestion.choices || [];
    // Use SurveyJS standard format: {value, text}
    const choiceValue = uniqueChoiceValue(newChoice);
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
    const newChoices = [...choices, { value: uniqueChoiceValue(newChoice), text: newChoice.trim() }];
    
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

  const needsChoices = [
    'radiogroup', 'checkbox', 'dropdown', 'ranking',
    'pointallocation', 'imagepointallocation', 'mediapointallocation',
    'imagecheckbox', 'mediacheckbox',
  ].includes(editedQuestion.type);
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

  const Root = workspace ? Box : Dialog;
  const rootProps = workspace
    ? {
      sx: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: { xs: '70vh', md: '75vh' },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      },
    }
    : {
      open: true,
      onClose: closeEditor,
      maxWidth: 'xl',
      fullWidth: true,
      fullScreen: mobile,
      PaperProps: { sx: { height: mobile ? '100dvh' : '90dvh' } },
    };

  return (
    <>
    <Root {...rootProps}>

      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {zh ? '编辑题目' : 'Edit Question'}
        {workspace && pageName ? <Chip size="small" label={pageName} /> : null}
      </DialogTitle>
      {!wide && <Tabs value={editorTab} onChange={(_, v) => setEditorTab(v)} variant="fullWidth" aria-label={tr(zh ? '题目编辑视图' : 'Question editor views')}>
        <Tab label={tr(zh ? '题目设置' : 'Settings')} /><Tab label={tr(zh ? '参与者预览' : 'Participant preview')} />
        {workspace && mobile ? <Tab label={tr(zh ? '助手' : 'Assistant')} /> : null}
      </Tabs>}
      <DialogContent sx={{ p: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) minmax(0, 0.9fr)' : 'minmax(0, 1fr)' }}>
        <Box ref={settingsRef} sx={{ display: wide || editorTab === 0 ? 'flex' : 'none', flexDirection: 'column', gap: 4, overflowY: 'auto', minWidth: 0, p: { xs: 2, sm: 3 } }}>
          {/* Basic Question Settings */}
          <Box>
            <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>{tr("Basic Settings")} </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <TextField name="name"
                fullWidth
                variant="outlined"
                label={tr("Question Name (Internal ID)")}
                value={editedQuestion.name || ''}
                onChange={(e) => handleQuestionChange('name', e.target.value)}
                helperText={tr("Used internally to identify this question (e.g., 'age_group', 'satisfaction_rating')")}
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
              
              <TextField name="type" select fullWidth label={tr("Find by task")} value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}
                helperText={tr("Filter available types by the answer you want to collect. Your current type stays selected until you choose another.")}>
                {[['all', 'All tasks'], ['choice', 'Choose / Yes–No'], ['rating', 'Rate / Measure'], ['ranking', 'Rank'], ['allocation', 'Allocate points'], ['matrix', 'Matrix'], ['annotation', 'Annotate'], ['text', 'Text / Display'], ['advanced', 'Custom interactions']]
                  .map(([value, label]) => <MenuItem key={value} value={value}>{tr(label)}</MenuItem>)}
              </TextField>
              <FormControl fullWidth variant="outlined">
                <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Question Type")}</InputLabel>
                <Select
                  value={editedQuestion.type === 'skillquestion' && editedQuestion.skillId
                    ? `skill:${editedQuestion.skillId}` : (editedQuestion.type || 'text')}
                  onChange={(e) => handleQuestionChange('type', e.target.value)}
                  label={tr("Question Type")}
                  inputProps={{ 'aria-label': tr('Question Type') }}
                >
                  {typeMenuGroups.flatMap((group) => {
                    const items = questionTypes.filter((t) => t.group === group.id && (taskFilter === 'all' || taskFamily(t.value) === taskFilter || t.value === selectedType));
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
                        {tr(group.label)}
                      </MenuItem>,
                      ...items.map((type) => (
                        <MenuItem key={type.value} value={type.value} sx={{ pl: 3 }}>
                          {tr(type.label)}
                        </MenuItem>
                      )),
                    ];
                  })}
                </Select>
              </FormControl>

              <TextField name="title"
                fullWidth
                variant="outlined"
                label={tr("Question Title")}
                value={editedQuestion.title || ''}
                onChange={(e) => handleQuestionChange('title', e.target.value)}
                helperText={tr("The main question text that participants will see")}
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />

              <TextField name="description"
                fullWidth
                variant="outlined"
                multiline
                rows={2}
                label={tr("Question Description (Optional)")}
                value={editedQuestion.description || ''}
                onChange={(e) => handleQuestionChange('description', e.target.value)}
                helperText={tr("Additional instructions or context for this question")}
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />

              {editedQuestion.type === 'imageannotation' && (
                <Alert severity="info">{tr("Participants can draw points, lines, polygons, and bounding boxes on an image from your sampling settings. Optionally define class labels, then set tools and min/max counts in the task options below.")} </Alert>
              )}

              {editedQuestion.type === 'skillquestion' && !editedQuestion.skillId && (
                <Alert severity="warning">
                  <strong>{tr("Advanced custom task.")}</strong> {tr("Most studies only need a ready-made perception task (Pairwise Preference, Best–Worst, etc.) from the type list above. To continue here, import or create a task in")} <strong>{tr("My custom interactions")}</strong>{tr(", then re-select it under")} <em>{tr("Advanced · Custom interactions")}</em>.
                </Alert>
              )}

              {editedQuestion.type === 'skillquestion' && editedQuestion.skillId && (() => {
                const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                const isPreset = skillDef?.scope === 'preset' || String(editedQuestion.skillId).startsWith('preset_');
                return (
                  <>
                    <Alert severity="success" sx={{ mt: 0 }}>
                      <strong>{isPreset ? tr(skillDef?.builderLabel || skillDef?.name || 'Interactive question') : skillDef?.name}</strong>
                      {(skillDef?.builderHint || skillDef?.description) && (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {isPreset ? tr(skillDef.builderHint || skillDef.description) : skillDef.description}
                        </Typography>
                      )}
                      {!isPreset && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5 }} color="text.secondary">{tr("Custom / library task · id:")} {editedQuestion.skillId}
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
                          >{tr("Update now")} </Button>
                        )}
                      >{tr("This question uses an older copy of the task. Update to the latest version (your current wording settings are kept).")} </Alert>
                    )}
                    <Alert severity="info" sx={{ mt: 1 }}>
                      <strong>{tr("Question Title")}</strong> {tr("is the heading participants see. Use")} <strong>{tr("Task instructions")}</strong> {tr("in task options below for guidance inside the interactive area.")} </Alert>
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
                label={tr("Required — participants must answer to continue")}
              />

              {editedQuestion.type === 'boolean' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField name="labelTrue"
                      fullWidth
                      variant="outlined"
                      label={tr("Yes label")}
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder={tr("Yes")}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField name="labelFalse"
                      fullWidth
                      variant="outlined"
                      label={tr("No label")}
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder={tr("No")}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </Box>
                  <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                </Box>
              )}

              {editedQuestion.type === 'consent' && (
                <Alert severity="info" sx={{ py: 0.5 }}>{tr("Participants must accept to continue. Set the consent statement in the Question Title (and optional Description). The Yes label is the accept action.")} </Alert>
              )}

              {editedQuestion.type === 'expression' && (
                <Alert severity="info" sx={{ py: 0.5 }}>{tr("Instruction-only — participants do not answer. Use the title and description above as the message.")} </Alert>
              )}

              {editedQuestion.type === 'slidergroup' && (
                <Alert severity="info" sx={{ py: 0.5 }}>{tr("This question has no built-in media. Put a")} <strong>{tr("Media Display")}</strong> {tr("on the same page for the stimulus, or use")} <strong>{tr("Image Slider Group")}</strong> {tr("instead.")} </Alert>
              )}
            </Box>
          </Box>

          {/* Unified stimulus sampling + task options + preview */}
          {isStimulusQuestion && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>{tr("Stimulus & task settings")} </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr("Configure how stimuli are sampled, then set task-specific options and preview the participant view.")} </Typography>

              <SettingsSection
                step={1}
                title={tr("How stimuli are sampled")}
                hint={tr("Exclude reuse, assignment mode, random vs curated list, and stimulus count.")}
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={editedQuestion.excludePreviouslyUsedImages !== false}
                      onChange={(e) => handleQuestionChange('excludePreviouslyUsedImages', e.target.checked)}
                    />
                  }
                  label={tr(zh
                    ? '优先不重复已展示的媒体；范围内不足时会回退到该范围未过滤池'
                    : 'Prefer unused media; if the filtered pool is too small, fall back to the unfiltered range')}
                />

                {editedQuestion.type === 'skillquestion' ? (() => {
                  const skillDef = resolveBuilderSkill(editedQuestion.skillId, builderSkills);
                  const mediaConstraintsSkill = getSkillMediaConstraints(editedQuestion.skillId, skillDef);
                  const cfg = editedQuestion.skillConfig || {};
                  const effectiveMediaType = mediaConstraintsSkill.typeFixed || cfg.mediaType || 'image';
                  const mediaTypeLabel = effectiveMediaType === 'video' ? tr("video")
                    : effectiveMediaType === 'audio' ? tr("audio")
                    : effectiveMediaType === 'any' ? (zh ? '媒体文件' : 'media file') : tr("image");
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
                          label={tr(mediaConstraintsSkill.countLabel || (zh ? `${tr(mediaTypeLabel)}数量` : `Number of ${mediaTypeLabel}s`))}
                          value={displayMediaCount}
                          onChange={(e) => setMediaCount(e.target.value)}
                          helperText={tr(zh ? `为每位参与者从项目${tr(mediaTypeLabel)}库随机抽取` : `Randomly drawn from the project ${mediaTypeLabel} pool for each participant`)}
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
                          <strong>{tr("Stimulus count:")}</strong>{' '}
                          {tr(mediaConstraintsSkill.countLabel)
                            || (zh ? `固定 ${mediaConstraintsSkill.countFixed} 个${tr(mediaTypeLabel)}` : `Always ${mediaConstraintsSkill.countFixed} ${mediaTypeLabel}(s)`)}.
                        </Alert>
                      )}
                      {mediaConstraintsSkill.typeAdjustable && (
                        <FormControl fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                          <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Media type filter")}</InputLabel>
                          <Select inputProps={{ 'aria-label': tr("Media type filter") }}
                            value={cfg.mediaType || 'image'}
                            label={tr("Media type filter")}
                            onChange={(e) => setCfg('mediaType', e.target.value)}
                          >
                            <MenuItem value="image">{tr("Image")}</MenuItem>
                            <MenuItem value="video">{tr("Video")}</MenuItem>
                            <MenuItem value="audio">{tr("Audio")}</MenuItem>
                            <MenuItem value="any">{tr("Any (mixed)")}</MenuItem>
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
                            <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Sampling Mode")}</InputLabel>
                            <Select inputProps={{ 'aria-label': tr("Sampling Mode") }}
                              value={(() => {
                                const mode = editedQuestion.pairingMode || 'random';
                                if (mode === 'uncertain' || mode === 'high_sigma') return 'balanced';
                                return mode;
                              })()}
                              onChange={(e) => handleQuestionChange('pairingMode', e.target.value)}
                              label={tr("Sampling Mode")}
                            >
                              <MenuItem value="random">{tr("Random — uniform from the pool")}</MenuItem>
                              <MenuItem value="balanced">{tr("Balanced — prefer least-exposed images")}</MenuItem>
                              <MenuItem value="adaptive">{tr("Adaptive — μ bands + cold-start for new images")}</MenuItem>
                            </Select>
                          </FormControl>
                        );
                      })()}
                    </>
                  );
                })() : (
                  <>
                    <MediaAssignmentFields question={editedQuestion} onChange={handleQuestionChange} currentProject={currentProject} />

                    {MEDIA_STAR_EDITOR_TYPES.includes(editedQuestion.type) && (
                      <FormControl fullWidth variant="outlined">
                        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Media Type Filter")}</InputLabel>
                        <Select inputProps={{ 'aria-label': tr("Media Type Filter") }}
                          value={editedQuestion.mediaType || 'any'}
                          label={tr("Media Type Filter")}
                          onChange={(e) => handleQuestionChange('mediaType', e.target.value)}
                          disabled={Array.isArray(editedQuestion.mediaSlots) && editedQuestion.mediaSlots.length > 0}
                        >
                          <MenuItem value="any">{tr("Any (image/video/audio)")}</MenuItem>
                          <MenuItem value="image">{tr("Image only")}</MenuItem>
                          <MenuItem value="video">{tr("Video only")}</MenuItem>
                          <MenuItem value="audio">{tr("Audio only")}</MenuItem>
                        </Select>
                      </FormControl>
                    )}

                    {mediaConstraints.samplingModes && !(editedQuestion.mediaSlots?.length) && (
                      <SamplingModeSelect
                        question={editedQuestion}
                        onQuestionPatch={(patch) => setEditedQuestion((prev) => ({ ...prev, ...patch }))}
                      />
                    )}

                    {!(editedQuestion.mediaSlots?.length) && (
                      <StimulusCountField
                        question={editedQuestion}
                        onChange={handleQuestionChange}
                        constraints={mediaConstraints}
                      />
                    )}

                    <TrialCountField
                      question={editedQuestion}
                      onChange={handleQuestionChange}
                    />

                    {isCuratedMode && !(editedQuestion.mediaSlots?.length) && (
                      <CuratedMediaPicker
                        availableImages={availableImages}
                        selectedImages={selectedImages}
                        maxCount={editedQuestion.imageCount || mediaConstraints.defaultCount || 1}
                        loading={loadingImages}
                        error={imageError}
                        onToggle={handleImageSelection}
                        title={tr("Select files")}
                      />
                    )}

                    {MEDIA_STAR_EDITOR_TYPES.includes(editedQuestion.type) && (
                      <MediaSlotsEditor
                        currentProject={currentProject}
                        question={editedQuestion}
                        onChange={handleQuestionChange}
                        availableImages={availableImages}
                      />
                    )}
                  </>
                )}
              </SettingsSection>

              <SettingsSection
                step={2}
                title={tr(editedQuestion.type === 'skillquestion' ? 'Wording & task options' : 'Task options')}
                hint={tr(editedQuestion.type === 'skillquestion'
                  ? 'Labels and instructions participants see inside this task.'
                  : 'Type-specific response and presentation options.')}
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
                          label={tr(field.label || field.key)}
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
                          label={tr(field.label || field.key)}
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
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{tr(field.label || 'Scale dimensions')}</Typography>
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
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{tr(field.label || field.key)}</Typography>
                          <SkillStringListEditor
                            value={val}
                            onChange={(parsed) => setCfg(field.key, parsed)}
                            label={tr(field.itemLabel || 'Item')}
                            placeholder={tr(field.placeholder || 'items')}
                          />
                        </Box>
                      );
                    }
                    if (field.type === 'json') {
                      return (
                        <SkillJsonField
                          key={field.key}
                          label={tr(field.label || field.key)}
                          value={val}
                          onCommit={(parsed) => setCfg(field.key, parsed)}
                        />
                      );
                    }
                    if (field.type === 'select' && Array.isArray(field.options)) {
                      return (
                        <FormControl key={field.key} fullWidth variant="outlined" sx={{ bgcolor: 'white' }}>
                          <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr(field.label || field.key)}</InputLabel>
                          <Select inputProps={{ 'aria-label': tr(field.label || field.key) }}
                            value={val ?? field.defaultValue ?? ''}
                            label={tr(field.label || field.key)}
                            onChange={(e) => setCfg(field.key, e.target.value)}
                          >
                            {field.options.map((opt) => {
                              const value = typeof opt === 'object' && opt != null ? opt.value : opt;
                              const label = typeof opt === 'object' && opt != null ? (opt.label || opt.value) : opt;
                              return (
                                <MenuItem key={String(value)} value={value}>{tr(label)}</MenuItem>
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
                        label={tr(field.label || field.key)}
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
                        <Alert severity="info" sx={{ py: 0.5 }}>{tr("No extra wording fields for this task. Edit the Question Title above if needed.")} </Alert>
                      )}
                      {editableSchema.map((field) => renderSchemaField(field))}
                    </>
                  );
                })()}

                {(['imagepicker', 'mediapicker'].includes(editedQuestion.type) || (editedQuestion.type === 'skillquestion' && ['preset_image_preference_forced', 'image_preference_forced'].includes(editedQuestion.skillId))) && <>
                  <FormControlLabel control={<Switch checked={!!editedQuestion.allowTie} disabled={!!editedQuestion.multiSelect}
                    onChange={(e) => handleQuestionChange('allowTie', e.target.checked)} />}
                    label={tr(zh ? '允许选择无偏好' : 'Allow no preference')} />
                  <Typography variant="caption" color="text.secondary">
                    {zh ? '仅在展示两个选项且为单选时显示。平局单独统计，现有 TrueSkill 排名仅使用明确胜负。' : 'Shown only for two options in single-select mode. Ties are counted separately; TrueSkill uses decisive answers only.'}
                  </Typography>
                  {editedQuestion.allowTie && <TextField fullWidth label={tr(zh ? '按钮文字' : 'Button text')}
                    value={editedQuestion.tieLabel || ''} placeholder={tr(zh ? '两者差不多' : 'About the same')}
                    helperText={tr(zh ? '留空时跟随问卷语言自动显示。' : 'Leave blank to follow the survey language.')}
                    onChange={(e) => handleQuestionChange('tieLabel', e.target.value)} />}
                </>}

                {(editedQuestion.type === 'imagepicker' || editedQuestion.type === 'mediapicker') && (
                  <>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={editedQuestion.multiSelect || false}
                          onChange={(e) => handleQuestionChange('multiSelect', e.target.checked)}
                        />
                      }
                      label={
                        tr(editedQuestion.type === 'mediapicker'
                          ? 'Allow Multiple Selection — participants can choose more than one media item'
                          : 'Allow Multiple Selection — participants can choose more than one image')
                      }
                    />
                    {(editedQuestion.mediaAssignmentMode || 'individual') === 'individual' && (
                      <FormControl fullWidth variant="outlined">
                        <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Sampling Mode")}</InputLabel>
                        <Select inputProps={{ 'aria-label': tr("Sampling Mode") }}
                          value={(() => {
                            const mode = editedQuestion.pairingMode || 'random';
                            if (mode === 'uncertain' || mode === 'high_sigma') return 'balanced';
                            return mode;
                          })()}
                          onChange={(e) => handleQuestionChange('pairingMode', e.target.value)}
                          label={tr("Sampling Mode")}
                        >
                          <MenuItem value="random">{tr("Random — uniform from the pool")}</MenuItem>
                          <MenuItem value="balanced">{tr("Balanced — prefer least-exposed")} {editedQuestion.type === 'mediapicker' ? tr("media") : tr("images")}
                          </MenuItem>
                          <MenuItem value="adaptive">{tr("Adaptive — μ bands + cold-start for new items")}</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                    <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                  </>
                )}

                {(editedQuestion.type === 'imageranking' || editedQuestion.type === 'mediaranking') && (
                  <Alert severity="info" sx={{ py: 0.5 }}>{tr("Participants drag items into ranked order. Stimulus count is set above.")} </Alert>
                )}

                {editedQuestion.type === 'imagerating' && (
                  <>
                    <TextField name="rateMin" fullWidth variant="outlined" type="number" label={tr("Minimum Rating Value")}
                      value={editedQuestion.rateMin ?? 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="rateMax" fullWidth variant="outlined" type="number" label={tr("Maximum Rating Value")}
                      value={editedQuestion.rateMax ?? 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="minRateDescription" fullWidth variant="outlined" label={tr("Minimum Rating Label")}
                      value={editedQuestion.minRateDescription || ''}
                      onChange={(e) => handleQuestionChange('minRateDescription', e.target.value)}
                      placeholder={tr("e.g., Very Poor")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="maxRateDescription" fullWidth variant="outlined" label={tr("Maximum Rating Label")}
                      value={editedQuestion.maxRateDescription || ''}
                      onChange={(e) => handleQuestionChange('maxRateDescription', e.target.value)}
                      placeholder={tr("e.g., Excellent")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'imageboolean' && (
                  <>
                    <TextField name="labelTrue" fullWidth variant="outlined" label={tr("Yes Label")}
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder={tr("e.g., Yes, Agree, Like")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="labelFalse" fullWidth variant="outlined" label={tr("No Label")}
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder={tr("e.g., No, Disagree, Dislike")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {(editedQuestion.type === 'imagecheckbox' || editedQuestion.type === 'mediacheckbox') && (
                  <Alert severity="info" sx={{ py: 0.5 }}>{tr("Participants see the stimulus, then check")} <strong>{tr("any number of text tags")}</strong>
                    {' '}{tr("(always multi-select). Edit the tag list in")} <strong>{tr("Text tags")}</strong> {tr("below — tags are independent of the sampled media.")} </Alert>
                )}

                {editedQuestion.type === 'image' && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    <strong>{tr("Image Display shows exactly one image")}</strong> {tr("per participant. To show multiple images, use")} <strong>{tr("Media Display")}</strong> {tr("instead.")} </Alert>
                )}

                {(editedQuestion.type === 'imagematrix' || editedQuestion.type === 'mediamatrix') && (
                  <Alert severity="info" sx={{ py: 0.5 }}>{tr("Configure matrix rows and columns in the section below.")} </Alert>
                )}

                {editedQuestion.type === 'mediadisplay' && (
                  <>
                    <Alert severity="info" sx={{ py: 0.5 }}>{tr("For")} <strong>{tr("2+ images")}</strong>{tr(", the default gallery layout matches")} <strong>{tr("Image Choice")}</strong>.
                    </Alert>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Display Mode")}</InputLabel>
                      <Select inputProps={{ 'aria-label': tr("Display Mode") }}
                        value={editedQuestion.displayMode || 'single'}
                        label={tr("Display Mode")}
                        onChange={(e) => {
                          const mode = e.target.value;
                          const updates = { displayMode: mode };
                          if (mode === 'reveal' || mode === 'sideBySide') {
                            updates.imageCount = Math.max(editedQuestion.imageCount || 1, 2);
                          }
                          setEditedQuestion({ ...editedQuestion, ...updates });
                        }}
                      >
                        <MenuItem value="single">{tr("Gallery — Image Choice layout (2+ images)")}</MenuItem>
                        <MenuItem value="sideBySide">{tr("Side by side (2+ images)")}</MenuItem>
                        <MenuItem value="reveal">{tr("Before/After drag reveal (2 images)")}</MenuItem>
                        <MenuItem value="timed">{tr("Timed exposure (hide after N seconds)")}</MenuItem>
                      </Select>
                    </FormControl>
                    {editedQuestion.displayMode === 'reveal' && (
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField name="beforeLabel" fullWidth variant="outlined" label={tr("Before label")}
                          value={editedQuestion.beforeLabel || 'Before'}
                          onChange={(e) => handleQuestionChange('beforeLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                        <TextField name="afterLabel" fullWidth variant="outlined" label={tr("After label")}
                          value={editedQuestion.afterLabel || 'After'}
                          onChange={(e) => handleQuestionChange('afterLabel', e.target.value)}
                          sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                      </Box>
                    )}
                    {editedQuestion.displayMode === 'timed' && (
                      <TextField name="exposureSeconds" fullWidth variant="outlined" type="number" label={tr("Exposure time (seconds)")}
                        value={editedQuestion.exposureSeconds ?? 5}
                        onChange={(e) => handleQuestionChange('exposureSeconds', Math.min(Math.max(parseInt(e.target.value, 10) || 5, 1), 120))}
                        helperText={tr("Participant clicks to start; media hides permanently after this many seconds.")}
                        inputProps={{ min: 1, max: 120, step: 1 }}
                        sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    )}
                  </>
                )}

                {editedQuestion.type === 'mediarating' && (
                  <>
                    <TextField name="rateMin" fullWidth variant="outlined" type="number" label={tr("Minimum rating")}
                      value={editedQuestion.rateMin ?? 1}
                      onChange={(e) => handleQuestionChange('rateMin', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="rateMax" fullWidth variant="outlined" type="number" label={tr("Maximum rating")}
                      value={editedQuestion.rateMax ?? 5}
                      onChange={(e) => handleQuestionChange('rateMax', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="minRateDescription" fullWidth variant="outlined" label={tr("Low-end label")}
                      value={editedQuestion.minRateDescription || ''}
                      onChange={(e) => handleQuestionChange('minRateDescription', e.target.value)}
                      placeholder={tr("e.g., Very poor")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="maxRateDescription" fullWidth variant="outlined" label={tr("High-end label")}
                      value={editedQuestion.maxRateDescription || ''}
                      onChange={(e) => handleQuestionChange('maxRateDescription', e.target.value)}
                      placeholder={tr("e.g., Excellent")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'mediaboolean' && (
                  <>
                    <TextField name="labelTrue" fullWidth variant="outlined" label={tr("Yes Label")}
                      value={editedQuestion.labelTrue || ''}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      placeholder={tr("e.g., Yes, Agree, Like")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    <TextField name="labelFalse" fullWidth variant="outlined" label={tr("No Label")}
                      value={editedQuestion.labelFalse || ''}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      placeholder={tr("e.g., No, Disagree, Dislike")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                  </>
                )}

                {editedQuestion.type === 'imageannotation' && (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>{tr("Allowed Tools")}</InputLabel>
                      <Select inputProps={{ 'aria-label': tr("Allowed Tools") }}
                        multiple
                        value={normalizeAllowedTools(
                          editedQuestion.allowedTools || ['point', 'line', 'polygon', 'bbox'],
                        )}
                        onChange={(e) => handleQuestionChange(
                          'allowedTools',
                          normalizeAllowedTools(
                            typeof e.target.value === 'string'
                              ? e.target.value.split(',')
                              : e.target.value,
                          ),
                        )}
                        label={tr("Allowed Tools")}
                      >
                        <MenuItem value="point">{tr("Point")}</MenuItem>
                        <MenuItem value="line">{tr("Line")}</MenuItem>
                        <MenuItem value="polygon">{tr("Polygon")}</MenuItem>
                        <MenuItem value="bbox">{tr("Bounding box")}</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label={tr("Class labels (optional)")}
                      value={annotationLabelsText}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAnnotationLabelsText(raw);
                        const labels = raw
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        handleQuestionChange('annotationLabels', labels);
                      }}
                      onBlur={() => {
                        const labels = annotationLabelsText
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        handleQuestionChange('annotationLabels', labels);
                        setAnnotationLabelsText(labels.join(', '));
                      }}
                      helperText={tr("Comma-separated labels applied to new shapes (e.g. building, tree, sky). Leave empty for unlabeled annotation.")}
                      placeholder={tr("building, tree, sky")}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <TextField name="minAnnotations" fullWidth variant="outlined" type="number" label={tr("Minimum annotations")}
                        value={editedQuestion.minAnnotations ?? 0}
                        onChange={(e) => handleQuestionChange('minAnnotations', Math.max(0, parseInt(e.target.value, 10) || 0))}
                        helperText={tr("Required before continuing (0 = no minimum)")}
                        inputProps={{ min: 0, max: 100, step: 1 }}
                        sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                      <TextField name="maxAnnotations" fullWidth variant="outlined" type="number" label={tr("Maximum annotations")}
                        value={editedQuestion.maxAnnotations ?? 50}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10);
                          handleQuestionChange('maxAnnotations', Number.isNaN(raw) ? 50 : Math.max(0, raw));
                        }}
                        helperText={tr("Cap on shapes per participant (0 = unlimited)")}
                        inputProps={{ min: 0, max: 500, step: 1 }}
                        sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }} />
                    </Box>
                  </>
                )}

                {(editedQuestion.type === 'imageslidergroup' || editedQuestion.type === 'mediaslidergroup') && (
                  <>
                    <SkillDimensionsEditor
                      value={editedQuestion.dimensions || []}
                      onChange={(dims) => handleQuestionChange('dimensions', dims)}
                      scaleMin={editedQuestion.scaleMin ?? 1}
                      scaleMax={editedQuestion.scaleMax ?? 7}
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <TextField name="scaleMin"
                        fullWidth
                        variant="outlined"
                        type="number"
                        label={tr("Scale minimum")}
                        value={editedQuestion.scaleMin ?? 1}
                        onChange={(e) => handleQuestionChange('scaleMin', e.target.value === '' ? undefined : Number(e.target.value))}
                        sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                      />
                      <TextField name="scaleMax"
                        fullWidth
                        variant="outlined"
                        type="number"
                        label={tr("Scale maximum")}
                        value={editedQuestion.scaleMax ?? 7}
                        onChange={(e) => handleQuestionChange('scaleMax', e.target.value === '' ? undefined : Number(e.target.value))}
                        sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                      />
                    </Box>
                  </>
                )}

                {(editedQuestion.type === 'imagepointallocation' || editedQuestion.type === 'mediapointallocation') && (
                  <TextField name="budget"
                    fullWidth
                    variant="outlined"
                    type="number"
                    label={tr("Total points to allocate")}
                    value={editedQuestion.budget ?? 100}
                    onChange={(e) => handleQuestionChange('budget', Math.max(1, parseInt(e.target.value, 10) || 100))}
                    helperText={tr("Point budget shown to participants (they do not have to spend the full amount)")}
                    inputProps={{ min: 1, step: 1 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {!['skillquestion', 'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'image',
                  'imagematrix', 'mediadisplay', 'mediapicker', 'mediarating', 'mediaboolean', 'mediacheckbox', 'mediaranking',
                  'mediamatrix', 'mediaslidergroup', 'mediapointallocation', 'imageannotation',
                  'imageslidergroup', 'imagepointallocation'].includes(editedQuestion.type) && (
                  <Alert severity="info" sx={{ py: 0.5 }}>{tr("No extra task options for this type.")}</Alert>
                )}
              </SettingsSection>


            </Box>
          )}

          {['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(editedQuestion.type) && <TextField
            name="scaleStep" type="number" label={tr("Scale step")} value={editedQuestion.scaleStep ?? 1}
            onChange={(e) => handleQuestionChange('scaleStep', e.target.value === '' ? undefined : Number(e.target.value))}
            helperText={tr("Default spacing between scale values; each dimension can override this.")}
          />}

          {/* Slider group (non-image) — image variant uses Card 2 above */}
          {editedQuestion.type === 'slidergroup' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>{tr("Task options — semantic differential")} </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <SkillDimensionsEditor
                  value={editedQuestion.dimensions || []}
                  onChange={(dims) => handleQuestionChange('dimensions', dims)}
                  scaleMin={editedQuestion.scaleMin ?? 1}
                  scaleMax={editedQuestion.scaleMax ?? 7}
                />
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField name="scaleMin"
                    fullWidth
                    variant="outlined"
                    type="number"
                    label={tr("Scale minimum")}
                    value={editedQuestion.scaleMin ?? 1}
                    onChange={(e) => handleQuestionChange('scaleMin', e.target.value === '' ? undefined : Number(e.target.value))}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <TextField name="scaleMax"
                    fullWidth
                    variant="outlined"
                    type="number"
                    label={tr("Scale maximum")}
                    value={editedQuestion.scaleMax ?? 7}
                    onChange={(e) => handleQuestionChange('scaleMax', e.target.value === '' ? undefined : Number(e.target.value))}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                </Box>
                <Alert severity="info" sx={{ py: 0.5 }}>{tr("To rate an image / video / audio clip, put a Media Display question on the same page — it handles media injection; this question collects the ratings. Or use")} <strong>{tr("Image Slider Group")}</strong> {tr("for built-in image display.")} </Alert>
              </Box>
            </Box>
          )}

          {/* Point allocation (non-image) — image variant uses Card 2 above */}
          {editedQuestion.type === 'pointallocation' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>{tr("Task options — budget allocation")} </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TextField name="budget"
                  fullWidth
                  variant="outlined"
                  type="number"
                  label={tr("Total points to allocate")}
                  value={editedQuestion.budget ?? 100}
                  onChange={(e) => handleQuestionChange('budget', Math.max(1, parseInt(e.target.value, 10) || 100))}
                  helperText={tr("Participants distribute exactly this many points across the choices below (when the question is required)")}
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
                {['pointallocation', 'imagepointallocation', 'mediapointallocation'].includes(editedQuestion.type)
                  ? tr("Allocation categories")
                  : editedQuestion.type === 'ranking'
                    ? tr("Items to rank")
                    : (editedQuestion.type === 'imagecheckbox' || editedQuestion.type === 'mediacheckbox')
                      ? tr("Text tags (multi-select)")
                      : tr("Answer choices")}
              </Typography>
              {['pointallocation', 'imagepointallocation'].includes(editedQuestion.type) && (
                <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>{tr("These are the categories participants distribute points across")} {editedQuestion.type === 'imagepointallocation'
                    ? ' (independent of the sampled images above)'
                    : ''}.
                </Alert>
              )}
              {(editedQuestion.type === 'imagecheckbox' || editedQuestion.type === 'mediacheckbox') && (
                <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>{tr("Add the labels participants can check (e.g. greenery, safety, busy). They may select multiple tags per trial.")} </Alert>
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
                    label={tr("Add new choice")}
                    value={newChoice}
                    onChange={(e) => setNewChoice(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        isRankingQuestion ? addRankingChoice() : addChoice();
                      }
                    }}
                    helperText={tr("Type a choice and press Enter or click Add")}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <Button
                    variant="contained"
                    onClick={isRankingQuestion ? addRankingChoice : addChoice}
                    startIcon={<Add />}
                    sx={{ minWidth: 100 }}
                  >{tr("Add")} </Button>
                </Box>

                {(editedQuestion.choices && editedQuestion.choices.length > 0) ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>{tr("Current Choices:")} </Typography>
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
                    <Typography variant="body2" color="text.secondary">{tr("No choices added yet. Add some choices above to get started.")} </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Matrix Configuration */}
          {(editedQuestion.type === 'matrix' || editedQuestion.type === 'imagematrix' || editedQuestion.type === 'mediamatrix') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>{tr("Task options — matrix rows & columns")} </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Rows Configuration */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>{tr("Rows (Questions)")} </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label={tr("Add new row")}
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
                      helperText={tr("Type a row label and press Enter or click Add")}
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
                    >{tr("Add")} </Button>
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
                      <Typography variant="body2" color="text.secondary">{tr("No rows added yet")} </Typography>
                    </Box>
                  )}
                </Box>

                {/* Columns Configuration */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>{tr("Columns (Answer Options)")} </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                      fullWidth
                      variant="outlined"
                      label={tr("Add new column")}
                      placeholder={tr("e.g., Strongly Agree, Agree, Neutral...")}
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
                      helperText={tr("Type a column label and press Enter or click Add (value is auto-filled; you can edit it below)")}
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
                    >{tr("Add")} </Button>
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
                                label={tr("Label (shown to participants)")}
                                value={colObj.text ?? ''}
                                onChange={(e) => updateColumn('text', e.target.value)}
                                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                variant="outlined"
                                label={tr("Value (stored in data)")}
                                value={colObj.value ?? ''}
                                onChange={(e) => updateColumn('value', e.target.value)}
                                helperText={tr("Used in exports / analysis")}
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
                      <Typography variant="body2" color="text.secondary">{tr("No columns added yet")} </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* Additional Settings for Specific Question Types */}
          {(editedQuestion.type === 'comment' || editedQuestion.type === 'text' || editedQuestion.type === 'rating' || editedQuestion.type === 'number' || editedQuestion.type === 'consent') && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>{tr("Task options")} </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {editedQuestion.type === 'comment' && (
                  <TextField name="rows"
                    fullWidth
                    variant="outlined"
                    type="number"
                    label={tr("Number of Rows")}
                    value={editedQuestion.rows || 3}
                    onChange={(e) => handleQuestionChange('rows', parseInt(e.target.value))}
                    helperText={tr("How many rows the text area should display")}
                    inputProps={{ min: 1, max: 10 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {editedQuestion.type === 'text' && (
                  <TextField name="maxLength"
                    fullWidth
                    variant="outlined"
                    type="number"
                    label={tr("Maximum Length")}
                    value={editedQuestion.maxLength || ''}
                    onChange={(e) => handleQuestionChange('maxLength', e.target.value ? parseInt(e.target.value) : undefined)}
                    helperText={tr("Maximum number of characters allowed (leave empty for no limit)")}
                    inputProps={{ min: 1 }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                )}

                {editedQuestion.type === 'number' && (
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField name="min"
                      fullWidth
                      variant="outlined"
                      type="number"
                      label={tr("Minimum")}
                      value={editedQuestion.min ?? 0}
                      onChange={(e) => handleQuestionChange('min', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ flex: '1 1 160px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField name="max"
                      fullWidth
                      variant="outlined"
                      type="number"
                      label={tr("Maximum")}
                      value={editedQuestion.max ?? 100}
                      onChange={(e) => handleQuestionChange('max', e.target.value === '' ? undefined : Number(e.target.value))}
                      sx={{ flex: '1 1 160px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </Box>
                )}

                {editedQuestion.type === 'consent' && (
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField name="labelTrue"
                      fullWidth
                      variant="outlined"
                      label={tr("Accept label")}
                      value={editedQuestion.labelTrue || 'I agree / I consent'}
                      onChange={(e) => handleQuestionChange('labelTrue', e.target.value)}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField name="labelFalse"
                      fullWidth
                      variant="outlined"
                      label={tr("Decline label")}
                      value={editedQuestion.labelFalse || 'I do not agree'}
                      onChange={(e) => handleQuestionChange('labelFalse', e.target.value)}
                      sx={{ flex: '1 1 200px', '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <Alert severity="info" sx={{ width: '100%', py: 0.5 }}>{tr("Consent is always required. Participants must choose accept to continue.")} </Alert>
                  </Box>
                )}

                {editedQuestion.type === 'rating' && (
                  <>
                    <AttentionCheckFields question={editedQuestion} onChange={handleQuestionChange} />
                    <TextField name="rateMin"
                      fullWidth
                      variant="outlined"
                      type="number"
                      label={tr("Minimum Value")}
                      value={editedQuestion.rateMin ?? 1}
                      onChange={(e) => handleQuestionChange('rateMin', parseInt(e.target.value))}
                      helperText={tr("The lowest rating value")}
                      inputProps={{ min: 0 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                    <TextField name="rateMax"
                      fullWidth
                      variant="outlined"
                      type="number"
                      label={tr("Maximum Value")}
                      value={editedQuestion.rateMax ?? 5}
                      onChange={(e) => handleQuestionChange('rateMax', parseInt(e.target.value))}
                      helperText={tr("The highest rating value")}
                      inputProps={{ min: 1 }}
                      sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                    />
                  </>
                )}
              </Box>
            </Box>
          )}

        </Box>
        <Box sx={{ display: wide || editorTab === 1 ? 'block' : 'none', overflowY: 'auto', minWidth: 0, p: { xs: 1, sm: 2 }, borderLeft: wide ? '1px solid' : 0, borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '参与者预览（修改设置后自动更新）' : 'Participant preview (updates as you edit)'}</Typography>
          <QuestionParticipantPreview question={editedQuestion} currentProject={currentProject} surveyConfig={surveyConfig} />
          <QuestionDataPreview question={editedQuestion} currentProject={currentProject} />
        </Box>
        {workspace && mobile && editorTab === 2 ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {zh ? '助手与题目设置同层，不会挡住未保存内容。' : 'The Assistant stays on the same layer so unsaved settings remain.'}
            </Typography>
            <Button variant="contained" onClick={() => onOpenAssistant?.()}>
              {zh ? '打开助手' : 'Open Assistant'}
            </Button>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', px: 2, pb: 'max(12px, env(safe-area-inset-bottom))', '& .MuiButton-root': { minHeight: 44 } }}>
        {settingsErrors.length > 0 && <Alert severity="error" sx={{ width: '100%', maxHeight: 120, overflowY: 'auto' }}>
          {settingsErrors.map((e, i) => <Button key={`${e.path}-${i}`} color="error" sx={{ display: 'block', textAlign: 'left', textTransform: 'none' }} onClick={() => focusSetting(e.path)}>{questionSettingErrorText(e.message, language)}</Button>)}
        </Alert>}
        <Button onClick={closeEditor}>{zh ? '取消' : 'Cancel'}</Button>
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
          if (['imageboolean', 'imagecheckbox', 'imagerating', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(questionToSave.type)) {
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

          if ([
            'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'imagematrix', 'image',
            'imageslidergroup', 'imagepointallocation',
            'mediadisplay', 'mediapicker', 'mediarating', 'mediaboolean', 'mediacheckbox', 'mediaranking',
            'mediamatrix', 'mediaslidergroup', 'mediapointallocation', 'imageannotation',
          ].includes(questionToSave.type)) {
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

          // Media* / annotation — honor curated vs random (skipped when slots drive selection)
          if ([
            'mediadisplay', 'mediapicker', 'mediarating', 'mediaboolean', 'mediacheckbox', 'mediaranking',
            'mediamatrix', 'mediaslidergroup', 'mediapointallocation', 'imageannotation',
          ].includes(questionToSave.type)) {
            if (!questionToSave.imageSelectionMode) {
              questionToSave.imageSelectionMode = 'huggingface_random';
            }
            const hasSlots = Array.isArray(questionToSave.mediaSlots) && questionToSave.mediaSlots.length > 0;
            const curated = !hasSlots && isCuratedSelectionMode(questionToSave.imageSelectionMode);
            questionToSave.randomImageSelection = hasSlots || !curated;
            questionToSave.excludePreviouslyUsedImages = questionToSave.excludePreviouslyUsedImages !== false;
            if (!hasSlots) {
              questionToSave.imageCount = clampQuestionImageCount(
                questionToSave.type,
                questionToSave,
                questionToSave.imageCount,
              );
            }
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
          if (questionToSave.type === 'imagepicker' || questionToSave.type === 'imageranking' || questionToSave.type === 'mediaranking' || questionToSave.type === 'mediapicker' || questionToSave.type === 'image') {
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
                // For imagepicker / imageranking / media* choice types, use choices
                const prefix = questionToSave.type === 'mediapicker' ? 'media_' : 'image_';
                questionToSave.choices = questionToSave.selectedImageUrls.map((url, index) => ({
                  value: `${prefix}${index}`,
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
          
          if (validateQuestionSettings(questionToSave).length) return;
          onSave(normalizeSliderQuestion(questionToSave));
        }} variant="contained" disabled={settingsErrors.length > 0}>
          {zh ? '保存题目' : 'Save Question'}
        </Button>
      </DialogActions>
    </Root>
    <ConfirmDialog open={guard.open} onCancel={guard.cancel} onConfirm={guard.discard}
      title={tr(zh ? '放弃未保存的修改？' : 'Discard unsaved changes?')}
      message={zh ? '题目设置尚未保存。继续编辑可保留当前内容。' : 'Your question settings have not been saved. Keep editing to retain them.'}
      confirmLabel={zh ? '放弃修改' : 'Discard changes'} cancelLabel={zh ? '继续编辑' : 'Keep editing'} />
    </>
  );
}
