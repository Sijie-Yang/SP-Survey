import { applySurveyThemePreset, matchesSurveyThemePreset, SURVEY_THEME_OPTIONS, SURVEY_THEME_PRESETS } from '../../lib/surveyThemePresets';
import DescriptionMarkdownEditor from './DescriptionMarkdownEditor';
import React, { useMemo, useState } from 'react';
import RuntimeContextSettings from './RuntimeContextSettings';
import RecruitmentSettings from './RecruitmentSettings';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  Alert,
  Paper,
  Snackbar,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { UI_LANGUAGES, normalizeUiLanguage, uiPair } from '../../lib/uiLanguages';
import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
import { parsePageRule } from '../../lib/surveyRuntimeContext';
import {
  Add,
  Delete,
  Edit,
  DragIndicator,
  ContentCopy,
  Clear,
  Download,
  ArticleOutlined,
  ImageOutlined,
  Translate,
  GTranslate,
  Tune,
  PaletteOutlined,
  Preview,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PageEditor from './PageEditor';
import TranslationEditor from './TranslationEditor';
import FullSurveyPreview from './FullSurveyPreview';
import SurveyPreview from './SurveyPreview';
import ConfirmDialog from '../layout/ConfirmDialog';
import AiAssistantPanel from './AiAssistantPanel';
import SpSchemePanel from './SpSchemePanel';
import PhonePreviewButton from './PhonePreviewButton';
import SurveyThemePreviewPanel from '../SurveyThemePreviewPanel';
import useSurveyAssistant from '../../hooks/useSurveyAssistant';
import { AdminActionBar, AdminActionButton, AdminPageHeader } from './AdminPageLayout';
import {
  allocateUniqueName,
  allocateUniquePageName,
  collectUsedQuestionNames,
  findDuplicateQuestionNames,
  repairDuplicateQuestionNames,
} from '../../lib/questionNames';
// Old API functions removed - now using chatApi.js
import { getSurveyValidationWarningStrings } from '../../lib/designProtocol';

/** Compact color picker row for Theme Customization */
function ThemeColorField({ label, hint, value, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <TextField
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ width: 60, flexShrink: 0 }}
        InputProps={{ sx: { height: 50 } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
          {label}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
            {hint}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block', mt: 0.25 }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

/** One clearly separated block in the theme color palette. */
function ThemeColorPart({ step, title, description, children }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: description ? 0.5 : 1.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: 'primary.main',
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Part {step}
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Box>
      {description ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.4 }}>
          {description}
        </Typography>
      ) : null}
      <Grid container spacing={2}>
        {children}
      </Grid>
    </Box>
  );
}

// Sortable Page Item Component
function SortablePageItem({ page, pageIndex, onEdit, onDelete, onDuplicate }) {
  const { tr } = useQuestionEditorText();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `page-${pageIndex}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 1.5,
        flexWrap: 'wrap',
        gap: 1,
        px: 1.5,
        bgcolor: 'background.paper',
        borderRadius: 1.5,
        border: 1,
        borderColor: 'divider',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        aria-label={tr('Drag to reorder page')}
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'grab',
          mr: 0,
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator color="action" />
      </Box>
      
      <ListItemText
        sx={{ flex: '1 1 150px', minWidth: 0 }}
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
              {page.title || tr('Page {number}', { number: pageIndex + 1 })}
            </Typography>
            <Chip
              label={tr(page.elements?.length === 1 ? '{count} question' : '{count} questions', { count: page.elements?.length || 0 })}
              size="small"
              color="primary"
              variant="outlined"
            />
            {(() => {
              const rule = parsePageRule(page.visibleIf);
              if (rule?.kind === 'always') return null;
              const label = !rule ? tr('Custom display rule')
                : tr(rule.kind === 'with_param' ? 'Only links with {param}' : 'Only links without {param}', { param: rule.param });
              return <Chip label={label} size="small" color="primary" variant="outlined" />;
            })()}
          </Box>
        }
        secondary={page.description ? (
          <Typography variant="body2" color="text.secondary">
            {page.description}
          </Typography>
        ) : null}
      />
      
      <Box sx={{ ml: 'auto' }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            color="primary"
            aria-label={tr("Edit page")}
            onClick={() => onEdit({ page, index: pageIndex })}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <Edit fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            aria-label={tr("Duplicate page")}
            onClick={() => onDuplicate(pageIndex)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <ContentCopy fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={tr("Delete page")}
            onClick={() => onDelete(pageIndex)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
          >
            <Delete fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </ListItem>
  );
}

export default function SurveyBuilder({ config, onChange, currentProject, onProjectUpdate = null, onNextStep, onRepairComplete, hideAssistant = false, onEditorSelectionChange, onOpenAssistant, onOpenLayoutStudio, onOpenPreview, editorCommitKey = 0 }) {
  const { t, language } = useRegion();
  // A survey that is an uploaded page (SP-Scheme) is defined by that page.
  const siteLocked = Boolean(config?.spSite?.html);
  const { tr } = useQuestionEditorText();
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);
  const [settingsDialog, setSettingsDialog] = useState(null);
  const [localPreviewOpen, setLocalPreviewOpen] = useState(false);
  const [localStudioOpen, setLocalStudioOpen] = useState(false);
  const closeSettings = () => setSettingsDialog(null);
  const openLayoutStudio = () => {
    if (onOpenLayoutStudio) onOpenLayoutStudio();
    else setLocalStudioOpen(true);
  };
  const openPreview = () => {
    if (onOpenPreview) onOpenPreview();
    else setLocalPreviewOpen(true);
  };

  const reportSelection = (next) => {
    onEditorSelectionChange?.(next);
  };

  const [themeSnackbar, setThemeSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  const assistant = useSurveyAssistant({
    currentProject,
    surveyConfig: config,
    onSurveyConfigChange: onChange,
    enabled: !hideAssistant,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );


  const handleBasicInfoChange = (field, value) => {
    // Convert boolean values to SurveyJS expected string format
    let finalValue = value;
    if (field === 'showQuestionNumbers') {
      finalValue = value ? 'on' : 'off';
    } else if (field === 'showProgressBar') {
      // Participant runtime uses ProgressChrome; 'top' means enabled
      finalValue = value ? 'top' : 'off';
    }
    
    onChange({
      ...config,
      [field]: finalValue
    });
  };

  const handleThemeChange = (field, value) => {
    onChange({
      ...config,
      theme: {
        ...config.theme,
        [field]: value
      }
    });
  };

  const handleThemeReset = () => onChange(applySurveyThemePreset(config, 'default'));
  const handleThemePreset = (presetName) => onChange(applySurveyThemePreset(config, presetName));

  // Export theme configuration
  const handleExportTheme = () => {
    const themeData = {
      theme: config.theme,
      exportDate: new Date().toISOString(),
      projectName: currentProject?.name || 'survey'
    };
    const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `theme_${currentProject?.id || 'default'}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import theme configuration
  const handleImportTheme = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const themeData = JSON.parse(e.target.result);
          if (themeData.theme) {
            onChange({
              ...config,
              theme: themeData.theme
            });
            setThemeSnackbar({ open: true, message: 'Theme imported successfully!', severity: 'success' });
          } else {
            setThemeSnackbar({ open: true, message: 'Invalid theme file format.', severity: 'error' });
          }
        } catch (error) {
          console.error('Error importing theme:', error);
          setThemeSnackbar({ open: true, message: 'Error importing theme file.', severity: 'error' });
        }
      };
      reader.readAsText(file);
    }
  };

  const addNewPage = () => {
    const newPage = {
      name: `page_${Date.now()}`,
      title: "New Page",
      description: "Page description",
      elements: []
    };
    
    onChange({
      ...config,
      pages: [...config.pages, newPage]
    });
  };

  const deletePage = (pageIndex) => {
    const page = config.pages[pageIndex];
    const questionCount = page?.elements?.length || 0;
    const pageTitle = page?.title || tr('Page {number}', { number: pageIndex + 1 });
    const message = questionCount > 0
      ? 'Delete "{title}" and its {count} question(s)? This cannot be undone.'
      : 'Delete "{title}"? This cannot be undone.';
    setConfirmDialog({
      title: 'Delete page',
      message,
      values: { title: pageTitle, count: questionCount },
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        const newPages = config.pages.filter((_, index) => index !== pageIndex);
        onChange({
          ...config,
          pages: newPages
        });
        setSelectedPage(null);
      },
    });
  };

  const duplicatePage = (pageIndex) => {
    const pageToDuplicate = config.pages[pageIndex];
    const duplicatedPage = JSON.parse(JSON.stringify(pageToDuplicate));

    duplicatedPage.name = allocateUniquePageName(
      pageToDuplicate.name || `page_${pageIndex + 1}`,
      config,
    );

    const originalTitle = pageToDuplicate.title || `Page ${pageIndex + 1}`;
    const titleUsed = new Set(
      (config.pages || []).map((p) => p?.title).filter(Boolean),
    );
    duplicatedPage.title = allocateUniqueName(originalTitle, titleUsed);

    const usedNames = collectUsedQuestionNames(config);
    if (duplicatedPage.elements) {
      duplicatedPage.elements = duplicatedPage.elements.map((element) => {
        if (element?.type === 'panel' && Array.isArray(element.elements)) {
          return {
            ...element,
            elements: element.elements.map((child) => ({
              ...child,
              name: allocateUniqueName(child.name || 'question', usedNames),
            })),
          };
        }
        return {
          ...element,
          name: allocateUniqueName(element.name || 'question', usedNames),
        };
      });
    }

    const newPages = [
      ...config.pages.slice(0, pageIndex + 1),
      duplicatedPage,
      ...config.pages.slice(pageIndex + 1),
    ];

    onChange({
      ...config,
      pages: newPages,
    });
  };

  const updatePage = (pageIndex, updatedPage) => {
    const newPages = [...config.pages];
    newPages[pageIndex] = updatedPage;
    onChange({
      ...config,
      pages: newPages
    });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = parseInt(active.id.split('-')[1]);
      const newIndex = parseInt(over.id.split('-')[1]);

      const newPages = arrayMove(config.pages, oldIndex, newIndex);
      onChange({
        ...config,
        pages: newPages
      });
    }
  };



  const validationWarnings = useMemo(() => getSurveyValidationWarningStrings(config), [config]);
  const duplicateQuestionIssues = useMemo(() => findDuplicateQuestionNames(config), [config]);

  const handleRepairDuplicateQuestionNames = async () => {
    const { config: fixed, renames, remainingDuplicates } = repairDuplicateQuestionNames(config);
    if (!renames.length && remainingDuplicates?.length) {
      setThemeSnackbar({
        open: true,
        message: 'Could not repair duplicate ids automatically. Please rename them manually.',
        severity: 'error',
      });
      return;
    }
    if (!renames.length) {
      setThemeSnackbar({
        open: true,
        message: 'No duplicate ids to fix.',
        severity: 'info',
      });
      return;
    }
    onChange(fixed);
    if (remainingDuplicates?.length) {
      setThemeSnackbar({
        open: true,
        message: `Renamed ${renames.length} id(s), but ${remainingDuplicates.length} duplicate(s) remain. Rename manually.`,
        severity: 'warning',
      });
      return;
    }
    try {
      if (typeof onRepairComplete === 'function') {
        await onRepairComplete(fixed, renames);
        setThemeSnackbar({
          open: true,
          message: `Fixed and saved ${renames.length} duplicate question id(s).`,
          severity: 'success',
        });
      } else {
        setThemeSnackbar({
          open: true,
          message: `Fixed ${renames.length} duplicate id(s) in the editor. Click Save to write to the database.`,
          severity: 'success',
        });
      }
    } catch (err) {
      setThemeSnackbar({
        open: true,
        message: err.message || 'Repair saved locally but failed to persist.',
        severity: 'error',
      });
    }
  };

  return (
    <Box>
      <AdminPageHeader
        icon={<Edit />}
        title={t.builderTitle}
        description={t.builderDescription}
      />

      <SpSchemePanel config={config} onChange={onChange} currentProject={currentProject} onProjectUpdate={onProjectUpdate} />

      <AdminActionBar
        label={t.builderSurveySettings}
        primaryAction={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" startIcon={<Tune />} onClick={openLayoutStudio}>{t.builderLayoutStudio}</Button>
            <Button size="small" variant="outlined" startIcon={<Preview />} onClick={openPreview}>{t.builderPreview}</Button>
            <PhonePreviewButton project={currentProject} language={language} />
          </Box>
        }
      >
          {[
            ['basic', t.builderBasicInfo, <ArticleOutlined />],
            ['logo', t.builderLogoSettings, <ImageOutlined />],
            ['language', t.builderSurveyLanguage, <Translate />],
            ['translations', uiPair(language, 'Translations', '翻译'), <GTranslate />],
            ['display', t.builderDisplaySettings, <Tune />],
            ['theme', t.builderThemeCustomization, <PaletteOutlined />],
          ].map(([id, label, icon]) => (
            <AdminActionButton
              key={id}
              startIcon={icon}
              aria-haspopup="dialog"
              onClick={() => setSettingsDialog(id)}
              sx={{ flex: { xs: '1 1 130px', sm: '0 1 auto' } }}
            >
              {label}
            </AdminActionButton>
          ))}
      </AdminActionBar>

      {validationWarnings.length > 0 && (
        <Alert
          severity={duplicateQuestionIssues.length ? 'error' : 'warning'}
          sx={{ mb: 2 }}
          action={duplicateQuestionIssues.length ? (
            <Button color="inherit" size="small" onClick={handleRepairDuplicateQuestionNames}>
              Fix duplicate ids
            </Button>
          ) : null}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {duplicateQuestionIssues.length
              ? 'Duplicate question ids detected (data risk)'
              : 'Survey checks (non-blocking)'}
          </Typography>
          {validationWarnings.slice(0, 5).map((w, i) => (
            <Typography key={i} variant="body2">• {w}</Typography>
          ))}
          {validationWarnings.length > 5 && (
            <Typography variant="caption">+ {validationWarnings.length - 5} more</Typography>
          )}
          {duplicateQuestionIssues.length > 0 && (
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              Fix renames later copies only. Already-collected answers under a shared id cannot be split automatically.
            </Typography>
          )}
        </Alert>
      )}

      {!hideAssistant && (
        <AiAssistantPanel assistant={assistant} />
      )}

      <Dialog open={settingsDialog === 'basic'} onClose={closeSettings} fullWidth maxWidth="sm">
        <DialogTitle>{t.builderBasicInfo}</DialogTitle>
        <DialogContent dividers>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                  fullWidth
                  variant="outlined"
                  label={t.builderSurveyTitle}
                  value={config.title || ''}
                  onChange={(e) => handleBasicInfoChange('title', e.target.value)}
                  helperText={t.builderSurveyTitleHelp}
                />
                
                <DescriptionMarkdownEditor label={t.builderSurveyDescription} value={config.description || ''} onChange={(value) => handleBasicInfoChange('description', value)} />

                <TextField
                  fullWidth
                  variant="outlined"
                  multiline
                  rows={2}
                  label={t.builderCompletionMessage}
                  value={config.completionMessage || ''}
                  onChange={(e) => handleBasicInfoChange('completionMessage', e.target.value)}
                  helperText={t.builderCompletionMessageHelp}
                />

                <TextField
                  fullWidth
                  variant="outlined"
                  type="number"
                  label={t.builderResponseQuota}
                  value={config.responseQuota ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    handleBasicInfoChange('responseQuota', v === '' ? null : Math.max(1, parseInt(v, 10) || 1));
                  }}
                  helperText={t.builderResponseQuotaHelp}
                  inputProps={{ min: 1 }}
                />

                <RuntimeContextSettings config={config} onChange={handleBasicInfoChange} />

                <RecruitmentSettings config={config} onChange={handleBasicInfoChange} />
              </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialog === 'logo'} onClose={closeSettings} fullWidth maxWidth="sm">
        <DialogTitle>{t.builderLogoSettings}</DialogTitle>
        <DialogContent dividers>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                  fullWidth
                  label="Logo URL"
                  value={config.logo || ''}
                  onChange={(e) => handleBasicInfoChange('logo', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  helperText="URL of your organization's logo"
                />
                
                <FormControl fullWidth>
                  <InputLabel>Logo Position</InputLabel>
                  <Select
                    value={config.logoPosition || 'top'}
                    label="Logo Position"
                    onChange={(e) => handleBasicInfoChange('logoPosition', e.target.value)}
                  >
                    <MenuItem value="top">Top</MenuItem>
                    <MenuItem value="left">Left</MenuItem>
                    <MenuItem value="right">Right</MenuItem>
                  </Select>
                </FormControl>
              </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialog === 'language'} onClose={closeSettings} fullWidth maxWidth="xs">
        <DialogTitle>{t.builderSurveyLanguage}</DialogTitle>
        <DialogContent dividers>
            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
              <InputLabel>{t.builderSurveyLanguage}</InputLabel>
              <Select
                label={t.builderSurveyLanguage}
                value={normalizeUiLanguage(config.locale || 'en')}
                onChange={(e) => handleBasicInfoChange('locale', e.target.value)}
              >
                {UI_LANGUAGES.map((item) => (
                  <MenuItem key={item.id} value={item.id}>{item.nativeName}</MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {t.builderSurveyLanguageHelp}
              </Typography>
            </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialog === 'translations'} onClose={closeSettings} fullWidth maxWidth="lg">
        <DialogContent dividers>
          <TranslationEditor config={config} onChange={onChange} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialog === 'display'} onClose={closeSettings} fullWidth maxWidth="sm">
        <DialogTitle>{t.builderDisplaySettings}</DialogTitle>
        <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.showQuestionNumbers !== 'off' && config.showQuestionNumbers !== false}
                        onChange={(e) => handleBasicInfoChange('showQuestionNumbers', e.target.checked)}
                      />
                    }
                    label="Show Question Numbers"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.showProgressBar !== 'off' && config.showProgressBar !== false}
                        onChange={(e) => handleBasicInfoChange('showProgressBar', e.target.checked)}
                      />
                    }
                    label="Show Progress Bar (page · question · trial)"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5, mt: -0.5, mb: 0.5 }}>
                    Uses Primary / Success colors from Theme Customization. Preview it under Theme Preview.
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.hidePlatformBadge !== true}
                        onChange={(e) => onChange({ ...config, hidePlatformBadge: !e.target.checked })}
                      />
                    }
                    label={uiPair(language, 'Show a small "Made with SP-Survey" link at the bottom', '页尾显示「用 SP-Survey 制作」小字链接')}
                  />
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">Research Annotation Mode</Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!config.repeatConfig?.enabled}
                        onChange={(e) => onChange({
                          ...config,
                          repeatConfig: { ...(config.repeatConfig || {}), enabled: e.target.checked, total: config.repeatConfig?.total || 10 },
                        })}
                      />
                    }
                    label="Enable repeat annotation (researcher answers N times)"
                  />
                  {config.repeatConfig?.enabled && (
                    <TextField
                      label="Repeat count"
                      type="number"
                      size="small"
                      value={config.repeatConfig?.total || 10}
                      onChange={(e) => onChange({
                        ...config,
                        repeatConfig: { ...config.repeatConfig, enabled: true, total: Math.max(1, parseInt(e.target.value, 10) || 1) },
                      })}
                      inputProps={{ min: 2, max: 500 }}
                      helperText="Also overridable via survey URL: ?repeat=20"
                      sx={{ maxWidth: 200 }}
                    />
                  )}
                </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialog === 'theme'} onClose={closeSettings} fullWidth maxWidth="md">
        <DialogTitle>{t.builderThemeCustomization}</DialogTitle>
        <DialogContent dividers>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2, pt: 1 }}>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportTheme}
                  style={{ display: 'none' }}
                  id="theme-import-input"
                />
                <label htmlFor="theme-import-input">
                  <Button
                    variant="outlined"
                    size="small"
                    component="span"
                    startIcon={<Download sx={{ transform: 'rotate(180deg)' }} />}
                  >
                    Import
                  </Button>
                </label>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleExportTheme}
                  startIcon={<Download />}
                >
                  Export
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleThemeReset}
                  startIcon={<Clear />}
                >
                  Reset
                </Button>
              </Box>

              {/* Theme Presets */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1.5, color: 'text.secondary' }}>
                  Quick Presets
                </Typography>
                <Grid container spacing={1.5}>
                  {SURVEY_THEME_OPTIONS.map((option) => {
                    const theme = SURVEY_THEME_PRESETS[option.id];
                    const selected = matchesSurveyThemePreset(config.theme, option.id);
                    return (
                    <Grid item xs={6} sm={4} md={3} key={option.id}>
                      <Paper
                        component="button"
                        type="button"
                        aria-label={option.name}
                        aria-pressed={selected}
                        onClick={() => handleThemePreset(option.id)}
                        sx={{
                          cursor: 'pointer',
                          border: 2,
                          borderColor: selected ? 'primary.main' : 'divider',
                          width: '100%',
                          font: 'inherit',
                          color: 'inherit',
                          borderRadius: 1.5,
                          p: 1.5,
                          textAlign: 'center',
                          transition: 'all 0.3s',
                          '&:hover': { 
                            borderColor: 'primary.main',
                            transform: 'translateY(-4px)',
                            boxShadow: 4
                          }
                        }}
                      >
                        <Box sx={{ 
                          display: 'flex',
                          height: 50,
                          borderRadius: 1,
                          overflow: 'hidden',
                          mb: 1
                        }}>
                          <Box sx={{ flex: 1, bgcolor: theme.primaryColor }} />
                          <Box sx={{ flex: 1, bgcolor: theme.secondaryColor }} />
                          <Box sx={{ flex: 1, bgcolor: theme.backgroundColor }} />
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                          {option.emoji} {option.name}
                        </Typography>
                      </Paper>
                    </Grid>
                    );
                  })}
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Custom Colors — four clear parts + preview */}
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5, color: 'text.secondary' }}>
                  Custom Color Palette
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Split into parts so you can tune what participants see most often first.
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <ThemeColorPart
                    step={1}
                    title="Brand"
                    description="Most visible: Next / Complete, selected answers, progress current state."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary"
                        hint="Buttons, selection, progress current"
                        value={config.theme?.primaryColor || '#1976d2'}
                        onChange={(v) => handleThemeChange('primaryColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary light"
                        hint="Hover / soft highlight"
                        value={config.theme?.primaryLight || '#42a5f5'}
                        onChange={(v) => handleThemeChange('primaryLight', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Primary dark"
                        hint="Pressed / darker hover"
                        value={config.theme?.primaryDark || '#1565c0'}
                        onChange={(v) => handleThemeChange('primaryDark', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={2}
                    title="Surfaces & text"
                    description="Page canvas, question panels, and readable text colors."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Page background"
                        hint="Overall page behind questions"
                        value={config.theme?.backgroundColor || '#ffffff'}
                        onChange={(v) => handleThemeChange('backgroundColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Question panel"
                        hint="Background of each question card"
                        value={config.theme?.cardBackground || '#f8f9fa'}
                        onChange={(v) => handleThemeChange('cardBackground', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Header / footer strip"
                        hint="Dim areas around navigation"
                        value={config.theme?.headerBackground || '#ffffff'}
                        onChange={(v) => handleThemeChange('headerBackground', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Body text"
                        hint="Question titles and main copy"
                        value={config.theme?.textColor || '#212121'}
                        onChange={(v) => handleThemeChange('textColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Muted text"
                        hint="Descriptions, progress labels"
                        value={config.theme?.secondaryText || '#757575'}
                        onChange={(v) => handleThemeChange('secondaryText', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Disabled text"
                        hint="Unavailable controls / grey"
                        value={config.theme?.disabledText || '#bdbdbd'}
                        onChange={(v) => handleThemeChange('disabledText', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={3}
                    title="Lines & status"
                    description="Borders, focus outlines, and completed-progress green."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Borders"
                        hint="Card edges, inputs, progress track"
                        value={config.theme?.borderColor || '#e0e0e0'}
                        onChange={(v) => handleThemeChange('borderColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Focus ring"
                        hint="Keyboard / click focus outline"
                        value={config.theme?.focusBorder || '#1976d2'}
                        onChange={(v) => handleThemeChange('focusBorder', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Success (green)"
                        hint="Completed questions on progress"
                        value={config.theme?.successColor || '#4caf50'}
                        onChange={(v) => handleThemeChange('successColor', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <ThemeColorPart
                    step={4}
                    title="Rarely seen (optional)"
                    description="SurveyJS internal tokens — usually not big buttons in a typical questionnaire."
                  >
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Secondary"
                        hint="Almost unused — leave default unless needed"
                        value={config.theme?.secondaryColor || '#dc004e'}
                        onChange={(v) => handleThemeChange('secondaryColor', v)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <ThemeColorField
                        label="Accent (error / alert)"
                        hint="Validation errors & required markers"
                        value={config.theme?.accentColor || '#ff9800'}
                        onChange={(v) => handleThemeChange('accentColor', v)}
                      />
                    </Grid>
                  </ThemeColorPart>

                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      bgcolor: 'background.paper',
                      p: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          letterSpacing: 0.3,
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        Part 5
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Preview
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.4 }}>
                      How participants will see your colors (SurveyJS + progress chrome).
                    </Typography>
                    <SurveyThemePreviewPanel
                      theme={config.theme}
                      showProgress={config.showProgressBar !== 'off' && config.showProgressBar !== false}
                    />
                  </Box>
                </Box>
              </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSettings}>{t.resultsClose}</Button>
        </DialogActions>
      </Dialog>

      {siteLocked ? (
        <Alert severity="info" sx={{ mb: 1.5 }} data-testid="builder-site-locked">
          {uiPair(language,
            'This survey is the uploaded page: its pages and questions come from that page and cannot be edited here. To edit them, remove the uploaded page in SP-Scheme above.',
            '这份问卷就是上传的页面：页面和题目都由它决定，这里不能编辑。要编辑，请先在上方 SP-Scheme 里移除上传的页面。')}
        </Alert>
      ) : null}
      <Box
        aria-disabled={siteLocked || undefined}
        sx={siteLocked ? { opacity: 0.5, pointerEvents: 'none', userSelect: 'none', filter: 'grayscale(1)' } : undefined}
      >
          {config.pages && config.pages.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={config.pages.map((_, index) => `page-${index}`)}
                strategy={verticalListSortingStrategy}
              >
                <List sx={{ width: '100%', py: 0 }}>
                  {config.pages.map((page, pageIndex) => (
                    <SortablePageItem
                      key={`page-${pageIndex}`}
                      page={page}
                      pageIndex={pageIndex}
                      onEdit={(next) => {
                        setSelectedPage(next);
                        reportSelection({ pageName: next?.page?.name, questionName: null, panel: 'builder' });
                      }}
                      onDuplicate={duplicatePage}
                      onDelete={deletePage}
                    />
                  ))}
                </List>
              </SortableContext>
            </DndContext>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No pages created yet. Click "Add New Page" to get started.
              </Typography>
            </Box>
          )}
      </Box>

      {/* Page Editor Dialog */}
      {selectedPage && (
        <PageEditor
          key={`${selectedPage.index}-${editorCommitKey}`}
          page={selectedPage.page}
          pageIndex={selectedPage.index}
          onSave={(updatedPage) => {
            updatePage(selectedPage.index, updatedPage);
            setSelectedPage(null);
            reportSelection({ pageName: updatedPage?.name || selectedPage.page?.name, questionName: null, panel: 'builder' });
          }}
          onCancel={() => {
            setSelectedPage(null);
            reportSelection({ pageName: selectedPage.page?.name, questionName: null, panel: 'builder' });
          }}
          onSelectionChange={(selection) => {
            reportSelection({
              pageName: selection?.pageName || selectedPage.page?.name,
              questionName: selection?.questionName || null,
              workingCopy: selection?.workingCopy || null,
              baseline: selection?.baseline || null,
              dirty: Boolean(selection?.dirty || selection?.pageDirty),
              pageWorkingCopy: selection?.pageWorkingCopy || null,
              pageDirty: Boolean(selection?.pageDirty),
              panel: 'builder',
            });
          }}
          images={config.images || []}
          currentProject={currentProject}
          surveyConfig={config}
        />
      )}

      <Box
        data-builder-page-actions=""
        sx={{ mt: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <AdminActionButton startIcon={<Add />} onClick={addNewPage} disabled={siteLocked}>
          {t.builderAddPage}
        </AdminActionButton>
        {onNextStep && (
          <Button size="small" onClick={onNextStep}>{t.nextHost}</Button>
        )}
      </Box>
      {localStudioOpen && (
        <Dialog open onClose={() => setLocalStudioOpen(false)} className="sp-studio-dialog" maxWidth={false} fullWidth PaperProps={{ sx: { maxWidth: 'none', m: 1.5, width: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)' } }}>
          <DialogTitle>{t.builderLayoutStudio}</DialogTitle>
          <DialogContent sx={{ p: 0, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            <FullSurveyPreview config={config} currentProject={currentProject} onConfigChange={onChange} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLocalStudioOpen(false)}>{t.resultsClose}</Button>
          </DialogActions>
        </Dialog>
      )}
      {localPreviewOpen && (
        <Dialog open onClose={() => setLocalPreviewOpen(false)} maxWidth="lg" fullWidth>
          <DialogTitle>{t.previewSurvey}</DialogTitle>
          <DialogContent>
            <SurveyPreview config={config} currentProject={currentProject} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLocalPreviewOpen(false)}>{t.resultsClose}</Button>
          </DialogActions>
        </Dialog>
      )}
      <Snackbar
        open={themeSnackbar.open}
        autoHideDuration={4000}
        onClose={() => setThemeSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert severity={themeSnackbar.severity} onClose={() => setThemeSnackbar((s) => ({ ...s, open: false }))}>
          {themeSnackbar.message}
        </Alert>
      </Snackbar>
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={tr(confirmDialog?.title)}
        message={tr(confirmDialog?.message, confirmDialog?.values)}
        confirmLabel={tr(confirmDialog?.confirmLabel)}
        cancelLabel={tr('Cancel')}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
  );
}
