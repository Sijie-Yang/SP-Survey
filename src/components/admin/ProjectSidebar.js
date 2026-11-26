import React, { useState, useEffect } from 'react';
import {
  Drawer,
  useMediaQuery,
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Divider,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Menu,
  MenuItem,
  Alert,
  Collapse,
  Tooltip,
  Select,
  FormControl,
  InputLabel,
  Grid,
  InputAdornment,
  Stack,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import {
  Folder,
  Add,
  MoreVert,
  Edit,
  Delete,
  FileCopy,
  Description,
  ExpandLess,
  ExpandMore,
  Science,
  Article,
  AutoAwesome,
  Close,
  Download,
  Upload,
  Preview,
  Info,
  InfoOutlined,
  Search,
  FilterList,
  Code,
  PushPin,
} from '@mui/icons-material';
import { 
  getUserProjects, 
  createProject, 
  createProjectFromTemplate, 
  deleteProject, 
  updateProject,
  duplicateProject,
  setActiveProject,
  getActiveProjectId 
} from '../../lib/projectManager';
import SurveyPreview from './SurveyPreview';
import QsfImportReport from './QsfImportReport';
import { isQsfFile, qsfToSurveyConfig } from '../../lib/qsfImport';
import { saveSurveyConfig, loadSurveyConfig } from '../../lib/surveyStorage';
import {
  loadTemplatesFromFiles,
  saveTemplateToFile,
  loadProjectsFromFiles,
  exportProjectToExternal,
  exportProjectForIde,
  duplicateProjectInFolder,
  saveProjectAsTemplate,
  importProjectFromFile,
  deleteProjectFile
} from '../../lib/fileSystemManager';
import {
  listTemplates,
  saveTemplateToSupabase,
  buildTemplateIdBase,
  findAvailableTemplateId,
} from '../../lib/templateManager';
import { isLocalSelfHosted, LOCAL_USER_ID } from '../../lib/appMode';
import { stripOwnResponseSupabase } from '../../lib/ownResponseSupabase';
import { isR2Configured, deleteImagesFromR2, listImagesFromR2, copyImagesInR2, projectR2Prefix } from '../../lib/r2';
import { folderFromR2Key, mediaRelativePathFromListing, inferMediaType, sanitizeMediaFolderConfig } from '../../lib/mediaUtils';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

export default function ProjectSidebar({ 
  id,
  open, 
  onClose, 
  onProjectSelect, 
  onProjectUpdate, // New: Used to notify parent component that project has been updated
  currentProject,
  surveyConfig,
  projectStates = {},
  width = 400 
}) {
  const { t, language } = useRegion();
  const [qsfReport, setQsfReport] = useState(null);
  const narrow = useMediaQuery('(max-width:899px)');
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Dialog states
  const [createDialog, setCreateDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [saveAsTemplateDialog, setSaveAsTemplateDialog] = useState(false);
  // Prevents double-clicks on "Create Template" from spawning multiple
  // templates while the async R2 copy + Supabase insert is in flight.
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  // Progress for the "Save as Template" flow. `total > 0` switches the
  // LinearProgress from indeterminate to determinate (used during the
  // image copy phase).
  const [templateProgress, setTemplateProgress] = useState({
    label: '',
    current: 0,
    total: 0,
  });
  // Same pattern for the "Delete Project" flow — listing + deleting R2
  // images can take several seconds for image-heavy projects.
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({
    label: '',
    current: 0,
    total: 0,
  });
  // "Create Project from Template" is now a fast metadata-only operation
  // — image copying is deferred to an explicit user action on the Image
  // Dataset page, so we only need a simple disabled/spinner flag here.
  const [isCreatingFromTemplate, setIsCreatingFromTemplate] = useState(false);
  
  // Form states
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectAuthor, setNewProjectAuthor] = useState('');
  const [newProjectYear, setNewProjectYear] = useState(new Date().getFullYear().toString());
  const [newProjectCategory, setNewProjectCategory] = useState('');
  const [newProjectTags, setNewProjectTags] = useState('');
  const [newProjectWebsite, setNewProjectWebsite] = useState('');
  const [newProjectDataset, setNewProjectDataset] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [previewingTemplate, setPreviewingTemplate] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [deletingProject, setDeletingProject] = useState(null);
  const [projectToTemplate, setProjectToTemplate] = useState(null);
  
  // UI states
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuProject, setMenuProject] = useState(null);
  const [templatesExpanded, setTemplatesExpanded] = useState(true);
  // Once the researcher has their own projects, start with templates folded
  // so "My Projects" is what they see first (they can still expand it).
  const autoCollapsedTemplatesRef = React.useRef(false);
  useEffect(() => {
    if (autoCollapsedTemplatesRef.current || projects.length === 0) return;
    autoCollapsedTemplatesRef.current = true;
    setTemplatesExpanded(false);
  }, [projects.length]);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [expandedTemplateMetadata, setExpandedTemplateMetadata] = useState({});
  const [expandedProjectMetadata, setExpandedProjectMetadata] = useState({});
  const [error, setError] = useState('');

  // Template search / filter / sort
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateSort, setTemplateSort] = useState('year_desc');
  const [templateFiltersExpanded, setTemplateFiltersExpanded] = useState(false);
  const [templateLimit, setTemplateLimit] = useState(5);

  useEffect(() => {
    setTemplateLimit(5);
  }, [templateSearch, templateCategory, templateSort]);

  const templateCategories = [...new Set(templates.map(template => template.category).filter(Boolean))].sort();
  const templateQuery = templateSearch.trim().toLowerCase();
  const filteredTemplates = templates.filter(template => {
    const fields = [template.name, template.author, template.description, template.id, template.year, template.category,
      ...(Array.isArray(template.tags) ? template.tags : [template.tags])];
    return (!templateQuery || fields.some(value => String(value ?? '').toLowerCase().includes(templateQuery)))
      && (!templateCategory || template.category === templateCategory);
  }).sort((a, b) => {
    const pinDiff = Number(!!b.is_pinned) - Number(!!a.is_pinned);
    if (pinDiff) return pinDiff;
    if (templateSort === 'name') return (a.name || '').localeCompare(b.name || '');
    if (templateSort === 'name_desc') return (b.name || '').localeCompare(a.name || '');
    const yearDiff = (Number(b.year) || 0) - (Number(a.year) || 0);
    return (templateSort === 'year_asc' ? -yearDiff : yearDiff) || (a.name || '').localeCompare(b.name || '');
  });

  useEffect(() => {
    if (isLocalSelfHosted()) {
      setCurrentUserId(LOCAL_USER_ID);
    }
    loadProjects();
    loadTemplates();
    setActiveProjectId(getActiveProjectId());
  }, []);

  const loadProjects = async () => {
    try {
      // Platform mode: load from Supabase (filtered by current user via RLS)
      // Self-hosted mode: load from local file system
      const loadedProjects = await getUserProjects();
      setProjects(loadedProjects);
    } catch (error) {
      console.error('Error loading projects:', error);
      setProjects([]);
    }
  };

  const loadTemplates = async () => {
    try {
      if (isLocalSelfHosted()) {
        const fileTemplates = await loadTemplatesFromFiles();
        console.log('Templates loaded from files:', fileTemplates.length);
        setTemplates(fileTemplates);
        return;
      }
      const fileTemplates = await loadTemplatesFromFiles();
      setTemplates(fileTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
      setTemplates([]);
    }
  };


  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setError('Project name is required');
      return;
    }

    try {
      const result = await createProject({
        name: newProjectName.trim(),
        description: newProjectDescription.trim()
      });

      if (result.success) {
        // Reload projects to update panel
        await loadProjects();
        setActiveProject(result.project.id);
        setActiveProjectId(result.project.id);
        onProjectSelect(result.project, result.surveyConfig);
        setCreateDialog(false);
        setNewProjectName('');
        setNewProjectDescription('');
        setError('');
        console.log('✅ Project created and panel refreshed');
      } else {
        setError(result.error);
      }
    } catch (error) {
      console.error('Error creating project:', error);
      setError('Error creating project: ' + error.message);
    }
  };

  const handleCreateFromTemplate = async () => {
    if (!selectedTemplate || !newProjectName.trim()) {
      setError('Template and project name are required');
      return;
    }

    // Validate template config
    if (!selectedTemplate.config) {
      console.error('❌ Template config is missing:', selectedTemplate);
      setError('Template configuration is missing. Please contact support.');
      return;
    }

    // Re-entry guard against rapid double-clicks on Create Project.
    if (isCreatingFromTemplate) return;
    setIsCreatingFromTemplate(true);

    try {
      console.log('🎯 Creating project from template:', selectedTemplate.name);

      // The project is created with NO images — copying the template's
      // Template media is not copied; the researcher uploads or imports from Hugging Face.
      // action on the Image Dataset page so this flow stays fast and
      // doesn't burn storage for users who never use the images.
      const projectData = {
        name: newProjectName.trim(),
        description: `Based on ${selectedTemplate.name}`,
        templateId: selectedTemplate.id,
        surveyConfig: selectedTemplate.config,
        preloadedImages: Array.isArray(selectedTemplate.preloadedImages)
          ? selectedTemplate.preloadedImages
          : [],
        preloadedAt: selectedTemplate.preloadedAt || (selectedTemplate.preloadedImages?.length ? new Date().toISOString() : null),
        preloadedSource: selectedTemplate.preloadedSource || (selectedTemplate.preloadedImages?.length ? 'template' : null),
      };
      const createResult = await createProject(projectData);
      if (!createResult.success) {
        throw new Error(createResult.error || 'Failed to create project');
      }
      const createdProject = createResult.project;
      const finalConfig = createResult.surveyConfig;

      await loadProjects();
      setActiveProject(createdProject.id);
      setActiveProjectId(createdProject.id);
      onProjectSelect(createdProject, finalConfig);

      setTemplateDialog(false);
      setNewProjectName('');
      setSelectedTemplate(null);
      setError('');
      console.log('✅ Project created from template and panel refreshed');
    } catch (error) {
      console.error('❌ Error creating project from template:', error);
      setError('Error creating project from template: ' + error.message);
    } finally {
      setIsCreatingFromTemplate(false);
    }
  };

  const handleProjectSelect = async (project) => {
    setActiveProject(project.id);
    setActiveProjectId(project.id);
    onProjectSelect(project);
  };

  const handleProjectMenu = (event, project) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuProject(project);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuProject(null);
  };

  const handleEditProject = () => {
    setEditingProject(menuProject);
    setNewProjectName(menuProject.name);
    setNewProjectDescription(menuProject.description || '');
    setNewProjectAuthor(menuProject.author || '');
    setNewProjectYear(menuProject.year || new Date().getFullYear().toString());
    setNewProjectCategory(menuProject.category || '');
    setNewProjectTags(Array.isArray(menuProject.tags) ? menuProject.tags.join(', ') : (menuProject.tags || ''));
    setNewProjectWebsite(menuProject.website || '');
    setNewProjectDataset(menuProject.huggingfaceDataset || menuProject.dataset || '');
    setEditDialog(true);
    handleMenuClose();
  };

  const handleDeleteProject = () => {
    setDeletingProject(menuProject);
    setDeleteDialog(true);
    handleMenuClose();
  };

  const handleDuplicateProject = async () => {
    try {
      const result = await duplicateProjectInFolder(menuProject, surveyConfig, `${menuProject.name} (Copy)`);
      if (result.success) {
        // Project is automatically saved, reload immediately
        await loadProjects();
        // Switch to the duplicated project
        setActiveProject(result.project.id);
        setActiveProjectId(result.project.id);
        onProjectSelect(result.project, result.surveyConfig);
        console.log('✅ Project duplicated and panel refreshed');
      }
    } catch (error) {
      console.error('Error duplicating project:', error);
      setError('Error duplicating project: ' + error.message);
    }
    handleMenuClose();
  };

  const handleExportProject = async () => {
    if (!menuProject) {
      console.error('No project selected for export');
      return;
    }

    try {
      console.log('📦 Exporting project:', menuProject.name);
      
      // Load the project's surveyConfig from file system
      const projectConfig = await loadSurveyConfig(menuProject.id);
      if (!projectConfig) {
        console.error('Failed to load survey config for project:', menuProject.id);
        setError('Failed to load project configuration');
        return;
      }
      
      const result = await exportProjectToExternal(menuProject, projectConfig);
      if (result.success) {
        console.log(`✅ Project exported as ${result.filename} to your downloads folder.`);
        setError('');
      } else {
        setError('Failed to export project: ' + result.error);
      }
    } catch (error) {
      console.error('Error exporting project:', error);
      setError('Error exporting project: ' + error.message);
    }
    
    handleMenuClose();
  };

  const handleExportForIde = async () => {
    if (!menuProject) return;
    try {
      const projectConfig = await loadSurveyConfig(menuProject.id);
      if (!projectConfig) throw new Error('Failed to load project configuration');
      const result = await exportProjectForIde(menuProject, projectConfig);
      if (!result.success) throw new Error(result.error || 'Export failed');
      setError('');
    } catch (exportError) {
      setError(`AI / IDE export failed: ${exportError.message}`);
    }
    handleMenuClose();
  };

  const handleExportAsTemplate = () => {
    if (!menuProject) {
      console.error('No project selected for template creation');
      return;
    }

    // Populate form with project metadata
    setProjectToTemplate(menuProject);
    setNewProjectName(menuProject.name);
    setNewProjectDescription(menuProject.description || `Template created from project: ${menuProject.name}`);
    setNewProjectAuthor(menuProject.author || 'User');
    setNewProjectYear(menuProject.year || new Date().getFullYear().toString());
    setNewProjectCategory(menuProject.category || 'Custom');
    setNewProjectTags(Array.isArray(menuProject.tags) ? menuProject.tags.join(', ') : (menuProject.tags || 'custom, user-created'));
    setNewProjectWebsite(menuProject.website || '');
    setNewProjectDataset(menuProject.huggingfaceDataset || menuProject.dataset || '');
    
    // Open confirmation dialog
    setSaveAsTemplateDialog(true);
    handleMenuClose();
  };

  // Copy a project's R2 image folder over to a template prefix. Returns the
  // new preloadedImages array pointing at template-owned URLs. Best-effort:
  // anything that fails to copy is omitted so the template still saves.
  //
  // `onProgress({ current, total })` is invoked after each batch so the
  // caller can render a determinate progress bar. The total reported is the
  // count discovered under the project prefix; current is the cumulative
  // number processed so far (successes + failures).
  const promoteProjectImagesToTemplate = async (project, templateId, onProgress) => {
    if (!isR2Configured()) return [];
    const userId = currentUserId || 'anonymous';
    const projectPrefix = `${userId}/${project.id}/`;
    const templatePrefix = `templates/${templateId}/`;

    // Discover everything actually in R2 under the project prefix — this
    // catches images uploaded outside of project.preloadedImages too.
    const listed = await listImagesFromR2(projectPrefix);
    if (!listed.success || listed.images.length === 0) {
      onProgress?.({ current: 0, total: 0 });
      return [];
    }

    const allCopies = listed.images.map((img) => {
      const rel = mediaRelativePathFromListing(img, projectPrefix);
      return {
        from: img.key,
        to: `${templatePrefix}${rel}`,
        rel,
        name: img.name,
        type: img.type || inferMediaType(img.name),
        folder: folderFromR2Key(img.key, projectPrefix) || img.folder || '',
      };
    });
    const total = allCopies.length;
    onProgress?.({ current: 0, total });

    // Batch the copies so the LinearProgress can advance smoothly instead
    // of waiting for the whole set to finish in one request. The server
    // processes copies sequentially per request anyway, so batching just
    // moves the await boundaries — total wall time is similar.
    const BATCH_SIZE = 200;
    const copied = [];
    const errors = [];
    for (let i = 0; i < allCopies.length; i += BATCH_SIZE) {
      const batch = allCopies.slice(i, i + BATCH_SIZE);
      const result = await copyImagesInR2(batch);
      if (result.copied?.length) copied.push(...result.copied);
      if (result.errors?.length) errors.push(...result.errors);
      onProgress?.({ current: Math.min(i + batch.length, total), total });
    }

    if (errors.length) {
      console.warn(`⚠️ ${errors.length} image(s) failed to copy to template:`, errors);
    }
    // Build the preloadedImages payload from successful copies.
    const metaByTo = new Map(allCopies.map((c) => [c.to, c]));
    return copied.map(({ to, url }) => {
      const meta = metaByTo.get(to) || {};
      return {
        url: url || '',
        name: meta.name || to.split('/').pop(),
        key: to,
        type: meta.type || 'image',
        folder: meta.folder || '',
        media_id: to,
      };
    });
  };

  const confirmSaveAsTemplate = async () => {
    if (!projectToTemplate) {
      console.error('No project to save as template');
      return;
    }
    // Re-entry guard: the button is also disabled while saving, but this
    // protects against rapid double-clicks landing before React re-renders
    // the disabled state.
    if (isSavingTemplate) return;
    setIsSavingTemplate(true);
    setTemplateProgress({ label: 'Loading project configuration…', current: 0, total: 0 });

    try {
      console.log('📝 Creating template from project:', projectToTemplate.name);

      // Load the project's surveyConfig
      const projectConfig = await loadSurveyConfig(projectToTemplate.id);
      if (!projectConfig) {
        setError('Failed to load project configuration');
        return;
      }

      // Parse tags
      const tagsArray = newProjectTags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      const finalYear   = newProjectYear.trim() || new Date().getFullYear().toString();
      const finalName   = newProjectName.trim();
      const finalAuthor = newProjectAuthor.trim() || 'User';

      // Reserve a human-readable, collision-free id BEFORE we touch R2 so
      // images land in their final folder. saveTemplateToSupabase will still
      // retry on the rare race where another save grabs the same id between
      // our SELECT and INSERT — but the R2 destination is locked in here.
      setTemplateProgress({ label: 'Reserving template id…', current: 0, total: 0 });
      const baseId    = buildTemplateIdBase({ name: finalName, author: finalAuthor, year: finalYear });
      const templateId = await findAvailableTemplateId(baseId);

      // Carry the project's image folder over to the template's own R2
      // prefix so the template owns its images independently of the source
      // project (project images can be edited / deleted without affecting
      // the template).
      let templateImages = [];
      try {
        setTemplateProgress({ label: 'Listing project images…', current: 0, total: 0 });
        templateImages = await promoteProjectImagesToTemplate(
          projectToTemplate,
          templateId,
          ({ current, total }) => {
            setTemplateProgress({
              label: total > 0
                ? `Copying images to template folder… (${current}/${total})`
                : 'No images to copy',
              current,
              total,
            });
          },
        );
        if (templateImages.length > 0) {
          console.log(`☁️  Copied ${templateImages.length} image(s) into templates/${templateId}/`);
        }
      } catch (copyErr) {
        console.warn('Image carryover failed (continuing without images):', copyErr);
      }

      const modifiedProject = {
        ...projectToTemplate,
        id: templateId,
        name: finalName,
        description: newProjectDescription.trim(),
        author: newProjectAuthor.trim() || 'User',
        year: finalYear,
        category: newProjectCategory.trim() || 'Custom',
        tags: tagsArray.length > 0 ? tagsArray : ['custom', 'user-created'],
        website: newProjectWebsite.trim() || undefined,
        huggingfaceDataset: newProjectDataset.trim() || undefined,
        preloadedImages: templateImages,
        preloadedAt: templateImages.length > 0 ? new Date().toISOString() : null,
        preloadedSource: templateImages.length > 0 ? 'supabase' : null,
        imageDatasetConfig: sanitizeMediaFolderConfig(projectToTemplate.imageDatasetConfig || {}),
      };

      setTemplateProgress({ label: 'Saving template…', current: 0, total: 0 });
      let result;
      if (isLocalSelfHosted()) {
        result = await saveTemplateToSupabase({
          ...modifiedProject,
          config: stripSensitiveFields(projectConfig),
        });
      } else {
        result = await saveProjectAsTemplate(modifiedProject, projectConfig);
      }

      if (result.success) {
        setTemplateProgress({ label: 'Refreshing template list…', current: 0, total: 0 });
        await loadTemplates();
        console.log('✅ Template submitted for review');
        setError('');
        setSaveAsTemplateDialog(false);
        setProjectToTemplate(null);
      } else {
        setError('Failed to create template: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating template:', error);
      setError('Error creating template: ' + error.message);
    } finally {
      setIsSavingTemplate(false);
      setTemplateProgress({ label: '', current: 0, total: 0 });
    }
  };

  // Strip Supabase credentials and preloaded images from config before saving as template
  const stripSensitiveFields = (config) => {
    const cleaned = stripOwnResponseSupabase(JSON.parse(JSON.stringify(config)));
    const rootRemove = [
      'preloadedImages', 'preloadedAt', 'preloadedSource', 'supabaseBucket',
      'supabaseConfig', 'imageDatasetConfig', 'supabaseUrl', 'supabaseKey',
      'supabaseConnectionStatus', 'datasetInfo', 'huggingFaceToken',
    ];
    rootRemove.forEach(f => { if (cleaned[f]) delete cleaned[f]; });
    (cleaned.pages || []).forEach(page => {
      ['supabaseConfig', 'supabaseUrl', 'supabaseKey', 'bucketPath',
       'huggingFaceConfig', 'imageDatasetConfig'].forEach(f => { if (page[f]) delete page[f]; });
      (page.elements || []).forEach(el => {
        ['supabaseConfig', 'supabaseUrl', 'supabaseKey', 'bucketPath',
         'preloadedImages', 'huggingFaceToken', 'datasetInfo',
         'imageDatasetConfig', 'huggingFaceConfig'].forEach(f => { if (el[f]) delete el[f]; });
      });
    });
    return cleaned;
  };

  // A Qualtrics .qsf becomes a new project; the report lists what was not carried over.
  const importQualtrics = async (text) => {
    const { surveyConfig, report } = qsfToSurveyConfig(JSON.parse(text));
    const result = await createProject({
      name: report.title,
      description: `Imported from Qualtrics (${report.converted} questions)`,
      surveyConfig: { ...surveyConfig, title: report.title },
    });
    if (!result.success) throw new Error(result.error || 'Could not create the project');
    await loadProjects();
    setActiveProject(result.project.id);
    setActiveProjectId(result.project.id);
    onProjectSelect(result.project, result.surveyConfig);
    setError('');
    setQsfReport(report);
  };

  const handleImportProject = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        if (isQsfFile(file.name, text)) {
          await importQualtrics(text);
          event.target.value = '';
          return;
        }
        const result = await importProjectFromFile(file);
        if (result.success) {
          // Project is automatically saved, reload immediately
          await loadProjects();
          // Switch to the imported project
          setActiveProject(result.project.id);
          setActiveProjectId(result.project.id);
          onProjectSelect(result.project, result.surveyConfig);
          console.log('✅ Project imported and panel refreshed');
          setError('');
        }
      } catch (error) {
        console.error('Import error:', error);
        setError('Error importing project: ' + error.message);
      }
    }
    // Reset file input
    event.target.value = '';
  };

  const confirmEditProject = async () => {
    if (!newProjectName.trim()) {
      setError('Project name is required');
      return;
    }

    // Parse tags from comma-separated string
    const tagsArray = newProjectTags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    const updates = {
      name: newProjectName.trim(),
      description: newProjectDescription.trim(),
      author: newProjectAuthor.trim() || undefined,
      year: newProjectYear.trim() || undefined,
      category: newProjectCategory.trim() || undefined,
      tags: tagsArray.length > 0 ? tagsArray : undefined,
      website: newProjectWebsite.trim() || undefined,
      huggingfaceDataset: newProjectDataset.trim() || undefined
    };

    const result = await updateProject(editingProject.id, updates);

    if (result.success) {
      // Reload projects list
      await loadProjects();
      
      // If the edited project is the current active project, update it in parent
      if (currentProject && currentProject.id === editingProject.id && onProjectUpdate) {
        console.log('✅ Updating current project with new metadata');
        onProjectUpdate({
          ...currentProject,
          ...updates,
          lastModified: new Date().toISOString()
        });
      }
      
      // Close dialog and reset state
      setEditDialog(false);
      setEditingProject(null);
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectAuthor('');
      setNewProjectYear(new Date().getFullYear().toString());
      setNewProjectCategory('');
      setNewProjectTags('');
      setError('');
    } else {
      setError(result.error);
    }
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    // Re-entry guard mirrors the create-template flow: the Delete button
    // is also disabled while running, but this catches rapid double-clicks
    // landing before React re-renders the disabled state.
    if (isDeletingProject) return;
    setIsDeletingProject(true);
    setDeleteProgress({ label: 'Preparing…', current: 0, total: 0 });

    try {
      // ── Supabase Storage cleanup ──────────────────────────────────────
      if (isR2Configured()) {
        const prefix = projectR2Prefix(currentUserId || 'anonymous', deletingProject.id);
        setDeleteProgress({ label: 'Listing project images…', current: 0, total: 0 });
        const listResult = await listImagesFromR2(prefix);
        const keys = (listResult.success ? listResult.images : [])
          .map((img) => img.key)
          .filter((key) => key && key.startsWith(prefix));
        const total = keys.length;
        if (total > 0) {
          setDeleteProgress({
            label: `Deleting images from Supabase… (0/${total})`,
            current: 0,
            total,
          });
          const BATCH_SIZE = 50;
          for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            await deleteImagesFromR2(batch, { allowedPrefix: prefix });
            const done = Math.min(i + batch.length, total);
            setDeleteProgress({
              label: `Deleting images from Supabase… (${done}/${total})`,
              current: done,
              total,
            });
          }
          console.log(`🗑️ Deleted ${total} Supabase Storage object(s) for project ${deletingProject.id}`);
        }
      }

      // ── Project record cleanup ────────────────────────────────────────
      // Platform mode (Supabase): the row is deleted via deleteProject ↓.
      // Self-hosted mode: also nuke the JSON file on the Express server.
      // The old code called deleteProjectFile unconditionally, which hard-
      // coded http://localhost:3001 and broke deletion in production.
      setDeleteProgress({ label: 'Removing project record…', current: 0, total: 0 });
      if (isLocalSelfHosted()) {
        const fileResult = await deleteProjectFile(deletingProject.id);
        if (!fileResult.success) throw new Error(fileResult.error);
      }

      const result = await deleteProject(deletingProject.id);
      if (!result.success) throw new Error(result.error);

      // Reload projects to update panel
      setDeleteProgress({ label: 'Refreshing project list…', current: 0, total: 0 });
      await loadProjects();

      // If we deleted the active project, clear selection
      if (activeProjectId === deletingProject.id) {
        setActiveProjectId(null);
        onProjectSelect(null);
      }

      console.log('✅ Project deleted and panel refreshed');
      setError('');
      setDeleteDialog(false);
      setDeletingProject(null);
    } catch (error) {
      console.error('Error deleting project:', error);
      setError('Error deleting project: ' + error.message);
    } finally {
      setIsDeletingProject(false);
      setDeleteProgress({ label: '', current: 0, total: 0 });
    }
  };

  const getTemplateIcon = (category) => {
    switch (category) {
      case 'Academic Research':
        return <Science />;
      case 'General':
        return <Article />;
      case 'Reference Template':
        return <AutoAwesome />;
      default:
        return <Description />;
    }
  };

  return (
    <>
      <Drawer
        id={id}
        anchor="left"
        open={open}
        onClose={onClose}
        variant={narrow ? 'temporary' : 'persistent'}
        sx={{
          width: narrow ? 'min(400px, 100vw)' : width,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: narrow ? 'min(400px, 100vw)' : width,
            boxSizing: 'border-box',
            top: '64px', // Below AppBar
            height: 'calc(100vh - 64px)',
            borderRight: '1px solid',
            borderColor: 'divider'
          },
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
              {t.sidebarProjects}
            </Typography>
            <IconButton onClick={onClose} size="small">
              <Close />
            </IconButton>
          </Box>

          {/* User Projects Section */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <ListItemButton
                onClick={() => setProjectsExpanded(!projectsExpanded)}
                aria-expanded={projectsExpanded}
                aria-controls="sidebar-project-list"
                sx={{ px: 0, py: 0.5, flex: 1, minHeight: 'unset' }}
              >
                <ListItemIcon sx={{ minWidth: 32, minHeight: 'unset' }}>
                  <Folder fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                      {tf(t.sidebarMyProjects, { n: projects.length })}
                    </Typography>
                  }
                  sx={{ my: 0 }}
                />
                {projectsExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
              </ListItemButton>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Tooltip title={t.sidebarImportProject}>
                  <IconButton component="label" size="small" color="primary">
                    <Upload />
                    <input
                      type="file"
                      hidden
                      accept=".json,.qsf"
                      onChange={handleImportProject}
                    />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t.sidebarCreateProject}>
                  <IconButton
                    onClick={() => setCreateDialog(true)}
                    size="small"
                    color="primary"
                  >
                    <Add />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <Collapse in={projectsExpanded} timeout="auto" unmountOnExit>
              <List id="sidebar-project-list" disablePadding>
                {projects.length === 0 ? (
                  <ListItem sx={{ py: 0.5 }}>
                    <ListItemText
                      primary={
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.75rem' }}>
                          {t.sidebarNoProjects}
                        </Typography>
                      }
                    />
                  </ListItem>
                ) : (
                  projects.map((project) => (
                    <ListItem key={project.id} disablePadding sx={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <ListItemButton
                        selected={activeProjectId === project.id}
                        onClick={() => handleProjectSelect(project)}
                        sx={{
                          borderRadius: 1,
                          mb: 0.25,
                          py: 0.5,
                          px: 1,
                          minHeight: 'unset',
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                            color: 'primary.main',
                            '&:hover': {
                              bgcolor: 'action.hover',
                            }
                          }
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 28, minHeight: 'unset' }}>
                          <Folder color={activeProjectId === project.id ? 'inherit' : 'action'} fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="body2" sx={{ fontSize: '0.875rem', lineHeight: 1.3 }}>
                                {project.name}
                              </Typography>
                              {project.accessRole === 'collaborator' && (
                                <Chip label={t.sidebarShared} size="small" color="primary" variant="outlined" sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.65rem' } }} />
                              )}
                              {projectStates[project.id]?.hasUnsavedChanges && (
                                <Chip
                                  label="*"
                                  size="small"
                                  color="error"
                                  sx={{
                                    minWidth: 16,
                                    height: 16,
                                    fontSize: '0.65rem',
                                    '& .MuiChip-label': { px: 0.3 }
                                  }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                              <Typography
                                variant="caption"
                                color="inherit"
                                sx={{
                                  opacity: 0.7,
                                  fontSize: '0.7rem',
                                  lineHeight: 1.2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  width: '100%'
                                }}
                                title={project.description || t.sidebarNoDescription}
                              >
                                {project.description || t.sidebarNoDescription}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="inherit"
                                sx={{
                                  opacity: 0.6,
                                  fontSize: '0.65rem',
                                  lineHeight: 1.1
                                }}
                              >
                                {new Date(project.lastModified).toLocaleDateString()}
                                {projectStates[project.id]?.hasUnsavedChanges && (language === 'zh' ? ' • 未保存' : ' • Unsaved')}
                              </Typography>
                            </Box>
                          }
                          sx={{ my: 0 }}
                        />
                        <Box sx={{ display: 'flex', gap: 0.25, ml: 'auto' }}>
                          <Tooltip title={expandedProjectMetadata[project.id] ? t.sidebarHideMetadata : t.sidebarShowMetadata}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedProjectMetadata(prev => ({
                                  ...prev,
                                  [project.id]: !prev[project.id]
                                }));
                              }}
                              sx={{ color: 'inherit', p: 0.25 }}
                            >
                              {expandedProjectMetadata[project.id] ? <ExpandLess fontSize="small" /> : <InfoOutlined fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <IconButton
                            size="small"
                            onClick={(e) => handleProjectMenu(e, project)}
                            sx={{ color: 'inherit', p: 0.5 }}
                          >
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </Box>
                      </ListItemButton>

                      {/* Metadata Collapse */}
                      <Collapse in={expandedProjectMetadata[project.id]} timeout="auto" unmountOnExit>
                        <Box sx={{
                          px: 2,
                          py: 1,
                          bgcolor: activeProjectId === project.id ? 'primary.dark' : 'action.hover',
                          borderRadius: 1,
                          mx: 0.5,
                          mb: 0.5,
                          color: activeProjectId === project.id ? 'primary.contrastText' : 'inherit'
                        }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                            Metadata
                          </Typography>
                          {project.author && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Author:</strong> {project.author}
                            </Typography>
                          )}
                          {project.year && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Year:</strong> {project.year}
                            </Typography>
                          )}
                          {project.category && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Category:</strong> {project.category}
                            </Typography>
                          )}
                          {project.tags && project.tags.length > 0 && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Tags:</strong> {Array.isArray(project.tags) ? project.tags.join(', ') : project.tags}
                            </Typography>
                          )}
                          {project.website && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                              <strong>Website:</strong> <a href={project.website} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{project.website}</a>
                            </Typography>
                          )}
                          {project.huggingfaceDataset && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>{language === 'zh' ? 'HF 数据集：' : 'HF Dataset:'}</strong> {project.huggingfaceDataset}
                            </Typography>
                          )}
                          {project.templateId && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5 }}>
                              <strong>{language === 'zh' ? '模板：' : 'Template:'}</strong> {project.templateId}
                            </Typography>
                          )}
                          <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem', mt: 0.5, opacity: 0.7 }}>
                            {language === 'zh' ? '创建于 ' : 'Created: '}{new Date(project.createdAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                      </Collapse>
                    </ListItem>
                  ))
                )}
              </List>
            </Collapse>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Templates Section */}
          <Box sx={{ mb: 1.5 }}>
            <ListItemButton
              onClick={() => setTemplatesExpanded(!templatesExpanded)}
              aria-expanded={templatesExpanded}
              aria-controls="sidebar-template-list"
              sx={{ px: 0, py: 0.5, minHeight: 'unset' }}
            >
              <ListItemIcon sx={{ minWidth: 32, minHeight: 'unset' }}>
                <Description fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                    {t.sidebarTemplates}
                    <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>{templates.length}</Box>
                  </Typography>
                }
                sx={{ my: 0 }}
              />
              {templatesExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </ListItemButton>

            <Collapse in={templatesExpanded} timeout="auto" unmountOnExit>
              {templates.length > 0 && (
                <Box sx={{ pt: 1, pb: 1.5 }}>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <TextField
                      size="small"
                      placeholder={t.sidebarSearchTemplates}
                      fullWidth
                      value={templateSearch}
                      onChange={e => setTemplateSearch(e.target.value)}
                      inputProps={{ 'aria-label': t.sidebarSearchTemplates }}
                      InputProps={{
                        startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                        endAdornment: templateSearch ? (
                          <InputAdornment position="end">
                            <IconButton size="small" aria-label={t.sidebarClearSearch} onClick={() => setTemplateSearch('')}>
                              <Close fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ) : null,
                        sx: { fontSize: '0.8125rem' },
                      }}
                    />
                    <Tooltip title={t.sidebarTemplateFilters} placement="top" disableInteractive>
                      <IconButton
                        aria-label={t.sidebarTemplateFilters}
                        aria-expanded={templateFiltersExpanded}
                        aria-controls="sidebar-template-filters"
                        onClick={() => setTemplateFiltersExpanded(value => !value)}
                        color={templateFiltersExpanded || templateCategory || templateSort !== 'year_desc' ? 'primary' : 'default'}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                      >
                        <FilterList fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Collapse in={templateFiltersExpanded}>
                    <Stack id="sidebar-template-filters" direction="row" spacing={1} sx={{ pt: 1.5 }}>
                      <TextField id="sidebar-template-category" select size="small" label={t.sidebarCategory} value={templateCategory}
                        onChange={e => setTemplateCategory(e.target.value)}
                        SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
                        sx={{ flex: 1, minWidth: 0, '& .MuiSelect-select': { fontSize: '0.75rem' } }}>
                        <MenuItem value="">{t.sidebarAllCategories}</MenuItem>
                        {templateCategories.map(category => <MenuItem key={category} value={category}>{category}</MenuItem>)}
                      </TextField>
                      <TextField id="sidebar-template-sort" select size="small" label={t.sidebarSort} value={templateSort}
                        onChange={e => setTemplateSort(e.target.value)}
                        sx={{ flex: 1, minWidth: 0, '& .MuiSelect-select': { fontSize: '0.75rem' } }}>
                        <MenuItem value="year_desc">{t.sidebarNewest}</MenuItem>
                        <MenuItem value="year_asc">{t.sidebarOldest}</MenuItem>
                        <MenuItem value="name">{t.sidebarNameAZ}</MenuItem>
                        <MenuItem value="name_desc">{t.sidebarNameZA}</MenuItem>
                      </TextField>
                    </Stack>
                  </Collapse>
                  {templateCategory && (
                    <Chip label={templateCategory} size="small" onDelete={() => setTemplateCategory('')} sx={{ mt: 1 }} />
                  )}
                </Box>
              )}
              <List id="sidebar-template-list" disablePadding>
                {filteredTemplates.length === 0 ? (
                  <ListItem sx={{ px: 1, py: 1.5 }}>
                    <ListItemText secondary={templates.length === 0 ? t.sidebarNoTemplates : t.sidebarNoTemplateMatch} />
                  </ListItem>
                ) : filteredTemplates.slice(0, templateLimit).map(template => (
                    <ListItem key={template.id} disablePadding sx={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <ListItemButton
                        sx={{
                          borderRadius: 1,
                          mb: 0.25,
                          py: 0.5,
                          px: 1,
                          minHeight: 'unset',
                          '&:hover': {
                            bgcolor: 'action.hover',
                          },
                          bgcolor: 'transparent',
                        }}
                        onClick={() => {
                          setSelectedTemplate(template);
                          setNewProjectName(`${template.name} - New`);
                          setNewProjectDescription(template.description);
                          setError(''); // Clear any previous errors
                          setTemplateDialog(true);
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 28, minHeight: 'unset' }}>
                          {template.is_pinned
                            ? <PushPin sx={{ fontSize: 18, color: 'warning.main', transform: 'rotate(45deg)' }} />
                            : getTemplateIcon(template.category)}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ fontSize: '0.875rem', lineHeight: 1.3 }}>
                                {template.name}
                              </Typography>
                              {/* Show "Pending Review" badge for user's own pending templates */}
                              {false && !template.is_approved && template.user_id === currentUserId && (
                                <Chip
                                  label="Pending Review"
                                  size="small"
                                  color="warning"
                                  variant="outlined"
                                  sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                              {[template.author, template.year].filter(Boolean).join(' · ')}
                            </Typography>
                          }
                          sx={{ my: 0 }}
                        />
                        <Box sx={{ display: 'flex', gap: 0.25, ml: 'auto' }}>
                          <Tooltip title={expandedTemplateMetadata[template.id] ? "Hide Metadata" : "Show Metadata"}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedTemplateMetadata(prev => ({
                                  ...prev,
                                  [template.id]: !prev[template.id]
                                }));
                              }}
                              sx={{ p: 0.25, color: 'text.secondary' }}
                            >
                              {expandedTemplateMetadata[template.id] ? <ExpandLess fontSize="small" /> : <InfoOutlined fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Preview Template">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewingTemplate(template);
                                setPreviewDialog(true);
                              }}
                              color="primary"
                              sx={{ p: 0.25 }}
                            >
                              <Preview fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </ListItemButton>

                      {/* Metadata Collapse */}
                      <Collapse in={expandedTemplateMetadata[template.id]} timeout="auto" unmountOnExit>
                        <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover', borderRadius: 1, mx: 0.5, mb: 0.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                            Metadata
                          </Typography>
                          {template.author && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Author:</strong> {template.author}
                            </Typography>
                          )}
                          {template.year && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Year:</strong> {template.year}
                            </Typography>
                          )}
                          {template.category && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Category:</strong> {template.category}
                            </Typography>
                          )}
                          {template.tags && template.tags.length > 0 && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>Tags:</strong> {Array.isArray(template.tags) ? template.tags.join(', ') : template.tags}
                            </Typography>
                          )}
                          {template.website && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                              <strong>Website:</strong> <a href={template.website} target="_blank" rel="noopener noreferrer">{template.website}</a>
                            </Typography>
                          )}
                          {template.huggingfaceDataset && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              <strong>HF Dataset:</strong> {template.huggingfaceDataset}
                            </Typography>
                          )}
                          {template.description && (
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5, fontStyle: 'italic' }}>
                              {template.description}
                            </Typography>
                          )}
                        </Box>
                      </Collapse>
                    </ListItem>
                ))}
              </List>
              {filteredTemplates.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, pt: 1 }}>
                  <Typography variant="caption" color="text.secondary" aria-live="polite">
                    {tf(t.sidebarTemplateCount, { shown: Math.min(templateLimit, filteredTemplates.length), total: filteredTemplates.length })}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {templateLimit > 5 && <Button size="small" onClick={() => setTemplateLimit(5)}>{t.sidebarShowLess}</Button>}
                    {templateLimit < filteredTemplates.length && (
                      <Button size="small" onClick={() => setTemplateLimit(limit => limit + 5)}>{t.sidebarShowMore}</Button>
                    )}
                  </Box>
                </Box>
              )}
            </Collapse>
          </Box>
        </Box>
      </Drawer>

      {/* Project Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEditProject}>
          <ListItemIcon><Edit /></ListItemIcon>
          <ListItemText>{t.sidebarEditProject}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDuplicateProject}>
          <ListItemIcon><FileCopy /></ListItemIcon>
          <ListItemText>{t.sidebarDuplicate}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExportProject}>
          <ListItemIcon><Download /></ListItemIcon>
          <ListItemText>{t.sidebarExportProject}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExportForIde}>
          <ListItemIcon><Code /></ListItemIcon>
          <ListItemText primary={t.sidebarExportIde} secondary={t.sidebarExportIdeHelp} />
        </MenuItem>
        <MenuItem onClick={handleExportAsTemplate}>
          <ListItemIcon><Description /></ListItemIcon>
          <ListItemText>{t.sidebarSaveAsTemplate}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleDeleteProject} sx={{ color: 'error.main' }}>
          <ListItemIcon><Delete color="error" /></ListItemIcon>
          <ListItemText>{t.sidebarDelete}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Project Dialog */}
      <QsfImportReport report={qsfReport} language={language} onClose={() => setQsfReport(null)} />
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t.sidebarCreateProject}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            label={t.sidebarProjectName}
            fullWidth
            variant="outlined"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label={t.sidebarDescriptionOptional}
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog(false)}>{t.sidebarCancel}</Button>
          <Button onClick={handleCreateProject} variant="contained">{t.sidebarCreate}</Button>
        </DialogActions>
      </Dialog>

      {/* Create from Template Dialog */}
      <Dialog
        open={templateDialog}
        onClose={(_, reason) => {
          if (isCreatingFromTemplate) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setTemplateDialog(false);
          setError('');
        }}
        disableEscapeKeyDown={isCreatingFromTemplate}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Project from Template</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {selectedTemplate && (
            <Box sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                {selectedTemplate.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedTemplate.description}
              </Typography>
              {Array.isArray(selectedTemplate.preloadedImages) && selectedTemplate.preloadedImages.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  This template ships with {selectedTemplate.preloadedImages.length} image{selectedTemplate.preloadedImages.length === 1 ? '' : 's'}.
                  You can import them into your project later from the Image Dataset step.
                </Typography>
              )}
            </Box>
          )}
          <TextField
            autoFocus
            margin="dense"
            label={t.sidebarProjectName}
            fullWidth
            variant="outlined"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            disabled={isCreatingFromTemplate}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setTemplateDialog(false); setError(''); }}
            disabled={isCreatingFromTemplate}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateFromTemplate}
            variant="contained"
            disabled={isCreatingFromTemplate}
            startIcon={isCreatingFromTemplate ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isCreatingFromTemplate ? 'Creating Project…' : 'Create Project'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Project</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          
          {/* Basic Information */}
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>
            Basic Information
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label={t.sidebarProjectName}
            fullWidth
            variant="outlined"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            sx={{ mb: 3 }}
          />

          {/* Template Metadata */}
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 'bold', color: 'primary.main' }}>
            Template Metadata (for when saving as template)
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                margin="dense"
                label="Author (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectAuthor}
                onChange={(e) => setNewProjectAuthor(e.target.value)}
                placeholder="e.g., Yang et al."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                margin="dense"
                label="Year (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectYear}
                onChange={(e) => setNewProjectYear(e.target.value)}
                placeholder="e.g., 2025"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth margin="dense">
                <InputLabel>Category (Optional)</InputLabel>
                <Select
                  value={newProjectCategory}
                  onChange={(e) => setNewProjectCategory(e.target.value)}
                  label="Category (Optional)"
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="Academic Research">Academic Research</MenuItem>
                  <MenuItem value="Urban Theory">Urban Theory</MenuItem>
                  <MenuItem value="AI Template">AI Template</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Tags (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectTags}
                onChange={(e) => setNewProjectTags(e.target.value)}
                placeholder="e.g., streetscape, perception, urban planning"
                helperText="Separate multiple tags with commas"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Research Paper Website (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectWebsite}
                onChange={(e) => setNewProjectWebsite(e.target.value)}
                placeholder="e.g., https://doi.org/10.xxxx/xxxxx or https://your-paper-url.com"
                helperText="URL to the research paper or project website"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Huggingface Image Dataset (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectDataset}
                onChange={(e) => setNewProjectDataset(e.target.value)}
                placeholder="e.g., username/dataset-name or organization/dataset-name"
                helperText="Hugging Face dataset identifier for preloaded images"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(false)}>Cancel</Button>
          <Button onClick={confirmEditProject} variant="contained">Save Changes</Button>
        </DialogActions>
      </Dialog>

      {/* Save As Template Dialog */}
      <Dialog
        open={saveAsTemplateDialog}
        onClose={(_, reason) => {
          // Don't let the user dismiss the dialog while the save is in flight —
          // closing here doesn't cancel the underlying R2 copy / Supabase insert
          // and would mask the in-progress state.
          if (isSavingTemplate) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setSaveAsTemplateDialog(false);
        }}
        disableEscapeKeyDown={isSavingTemplate}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Save As Template</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          
          <Alert severity="info" sx={{ mb: 2 }}>
            Please confirm or modify the template metadata. Sensitive data (Supabase credentials, tokens) will be automatically removed.
          </Alert>
          
          {/* Template Information */}
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>
            Template Information
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Template Name"
            fullWidth
            variant="outlined"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            sx={{ mb: 2 }}
            helperText="This will be the template's display name"
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            sx={{ mb: 3 }}
          />

          {/* Template Metadata */}
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 'bold', color: 'primary.main' }}>
            Template Metadata
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                margin="dense"
                label="Author"
                fullWidth
                variant="outlined"
                value={newProjectAuthor}
                onChange={(e) => setNewProjectAuthor(e.target.value)}
                placeholder="e.g., Yang et al."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                margin="dense"
                label="Year"
                fullWidth
                variant="outlined"
                value={newProjectYear}
                onChange={(e) => setNewProjectYear(e.target.value)}
                placeholder="e.g., 2025"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth margin="dense">
                <InputLabel>Category</InputLabel>
                <Select
                  value={newProjectCategory}
                  onChange={(e) => setNewProjectCategory(e.target.value)}
                  label="Category"
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="Academic Research">Academic Research</MenuItem>
                  <MenuItem value="Urban Theory">Urban Theory</MenuItem>
                  <MenuItem value="AI Template">AI Template</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Tags"
                fullWidth
                variant="outlined"
                value={newProjectTags}
                onChange={(e) => setNewProjectTags(e.target.value)}
                placeholder="e.g., streetscape, perception, urban planning"
                helperText="Separate multiple tags with commas"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Research Paper Website (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectWebsite}
                onChange={(e) => setNewProjectWebsite(e.target.value)}
                placeholder="e.g., https://doi.org/10.xxxx/xxxxx"
                helperText="URL to the research paper or project website"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                margin="dense"
                label="Huggingface Image Dataset (Optional)"
                fullWidth
                variant="outlined"
                value={newProjectDataset}
                onChange={(e) => setNewProjectDataset(e.target.value)}
                placeholder="e.g., username/dataset-name or organization/dataset-name"
                helperText="Hugging Face dataset identifier for preloaded images"
              />
            </Grid>
          </Grid>
          
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>Note:</strong> The template ID will be generated as{' '}
            <code>{buildTemplateIdBase({
              name:   newProjectName,
              author: newProjectAuthor,
              year:   newProjectYear,
            })}</code>
            {' '}(a <code>-2</code>, <code>-3</code>… suffix is appended if that id already exists).
          </Alert>

          {isSavingTemplate && (
            <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {templateProgress.label || 'Working…'}
                </Typography>
                {templateProgress.total > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {templateProgress.current} / {templateProgress.total}
                  </Typography>
                )}
              </Box>
              <LinearProgress
                variant={templateProgress.total > 0 ? 'determinate' : 'indeterminate'}
                value={templateProgress.total > 0
                  ? (templateProgress.current / templateProgress.total) * 100
                  : undefined}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setSaveAsTemplateDialog(false); setProjectToTemplate(null); setError(''); }}
            disabled={isSavingTemplate}
          >
            Cancel
          </Button>
          <Button
            onClick={confirmSaveAsTemplate}
            variant="contained"
            color="primary"
            disabled={isSavingTemplate}
            startIcon={isSavingTemplate ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isSavingTemplate ? 'Creating Template…' : 'Create Template'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog}
        onClose={(_, reason) => {
          // Don't let the user dismiss the dialog while the delete is in
          // flight — the underlying R2 / Supabase calls don't get cancelled
          // and the in-progress state would be lost from view.
          if (isDeletingProject) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setDeleteDialog(false);
        }}
        disableEscapeKeyDown={isDeletingProject}
      >
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent>
          {error && isDeletingProject === false && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}
          <Typography>
            Are you sure you want to delete "{deletingProject?.name}"? This action cannot be undone.
          </Typography>

          {isDeletingProject && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {deleteProgress.label || 'Working…'}
                </Typography>
                {deleteProgress.total > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {deleteProgress.current} / {deleteProgress.total}
                  </Typography>
                )}
              </Box>
              <LinearProgress
                variant={deleteProgress.total > 0 ? 'determinate' : 'indeterminate'}
                value={deleteProgress.total > 0
                  ? (deleteProgress.current / deleteProgress.total) * 100
                  : undefined}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(false)} disabled={isDeletingProject}>
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteProject}
            color="error"
            variant="contained"
            disabled={isDeletingProject}
            startIcon={isDeletingProject ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isDeletingProject ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Template Preview Dialog */}
      <Dialog 
        open={previewDialog} 
        onClose={() => {
          setPreviewDialog(false);
          setPreviewingTemplate(null);
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">
              Preview: {previewingTemplate?.name}
            </Typography>
            <IconButton 
              onClick={() => {
                setPreviewDialog(false);
                setPreviewingTemplate(null);
              }}
            >
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {previewingTemplate && (
            <SurveyPreview
              config={previewingTemplate.config}
              currentProject={{
                id: `tpl-${previewingTemplate.id}`,
                name: previewingTemplate.name,
                preloadedImages: Array.isArray(previewingTemplate.preloadedImages)
                  ? previewingTemplate.preloadedImages
                  : [],
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
