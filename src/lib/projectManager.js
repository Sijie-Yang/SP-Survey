// Project management system for handling multiple survey projects
// ✅ No localStorage - all data via API
import { saveSurveyConfig, loadSurveyConfig, deleteSurveyConfig, getSavedConfigList } from './surveyStorage';
import { saveProjectToProjectsFolder, loadProjectsFromFiles } from './fileSystemManager';
import { projectTemplates, getTemplateById } from './projectTemplates';
import { API_ROOT } from './apiConfig';

// Active project is now stored in sessionStorage (session-only)
const ACTIVE_PROJECT_KEY = 'active_project_id';

// Project structure:
// {
//   id: string,
//   name: string,
//   description: string,
//   createdAt: string,
//   lastModified: string,
//   templateId: string | null,  // null for custom projects
//   supabaseConfig: object | null
// }

export const createProject = async (projectData) => {
  try {
    const projectId = generateProjectId();
    const now = new Date().toISOString();
    
    const project = {
      id: projectId,
      name: projectData.name,
      description: projectData.description || '',
      createdAt: now,
      lastModified: now,
      templateId: projectData.templateId || null,
      supabaseConfig: projectData.supabaseConfig || null,
      imageDatasetConfig: projectData.imageDatasetConfig || {
        enabled: true,
        huggingFaceToken: '',
        datasetName: '',
        supabaseProjectId: '',
        supabaseUrl: '',
        supabaseKey: '',
        supabaseAnonKey: ''
      }
    };
    
    // Save survey configuration
    let surveyConfig;
    
    // ✅ Priority 1: Use provided surveyConfig (from file-based templates)
    if (projectData.surveyConfig) {
      console.log('✅ Using provided surveyConfig from template');
      surveyConfig = { ...projectData.surveyConfig };
      surveyConfig.title = projectData.name; // Override title with project name
    }
    // Priority 2: Try to load from static template by ID
    else if (projectData.templateId) {
      const template = getTemplateById(projectData.templateId);
      if (!template) {
        console.warn(`⚠️ Template ${projectData.templateId} not found in static templates`);
        throw new Error('Template not found');
      }
      console.log('✅ Using surveyConfig from static template:', projectData.templateId);
      surveyConfig = { ...template.config };
      surveyConfig.title = projectData.name; // Override title with project name
    }
    // Priority 3: Create default config for custom project
    else {
      console.log('✅ Creating default surveyConfig for custom project');
      surveyConfig = createDefaultSurveyConfig(projectData.name);
    }
    
    await saveSurveyConfig(projectId, surveyConfig);
    
    // ✅ Save directly to file system via API (no localStorage!)
    const fileResult = await saveProjectToProjectsFolder(project, surveyConfig);
    if (!fileResult.success) {
      console.error('Failed to create project file:', fileResult.error);
      throw new Error('Failed to create project file: ' + fileResult.error);
    } else {
      console.log('✅ Project file created successfully');
    }
    
    return { success: true, project, surveyConfig };
  } catch (error) {
    console.error('Error creating project:', error);
    return { success: false, error: error.message };
  }
};

export const duplicateProject = async (sourceProjectId, newName, sourceProject) => {
  try {
    const sourceConfig = await loadSurveyConfig(sourceProjectId);
    if (!sourceConfig) {
      throw new Error('Source project not found');
    }
    
    // ✅ sourceProject is now passed as parameter (from API)
    const result = await createProject({
      name: newName,
      description: `Copy of ${sourceProject?.name || 'Unknown Project'}`,
      templateId: null, // Duplicated projects are always custom
      supabaseConfig: sourceProject?.supabaseConfig || null,
      imageDatasetConfig: sourceProject?.imageDatasetConfig || {
        enabled: true,
        huggingFaceToken: '',
        datasetName: '',
        supabaseUrl: '',
        supabaseKey: ''
      }
    });
    
    if (result.success) {
      // Override the survey config with the source config
      const modifiedConfig = { ...sourceConfig };
      modifiedConfig.title = newName;
      await saveSurveyConfig(result.project.id, modifiedConfig);
    }
    
    return result;
  } catch (error) {
    console.error('Error duplicating project:', error);
    return { success: false, error: error.message };
  }
};

export const createProjectFromTemplate = async (templateId, projectName) => {
  try {
    const template = getTemplateById(templateId);
    if (!template) {
      throw new Error('Template not found');
    }
    
    return await createProject({
      name: projectName,
      description: `Based on ${template.name}`,
      templateId: templateId
    });
  } catch (error) {
    console.error('Error creating project from template:', error);
    return { success: false, error: error.message };
  }
};

export const deleteProject = async (projectId) => {
  try {
    // Delete survey configuration
    await deleteSurveyConfig(projectId);
    
    // ✅ Project deletion now handled by API (no localStorage!)
    
    // If this was the active project, clear active project
    const activeProjectId = getActiveProjectId();
    if (activeProjectId === projectId) {
      sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting project:', error);
    return { success: false, error: error.message };
  }
};

export const updateProject = async (projectId, updates) => {
  try {
    console.log(`📝 Updating project ${projectId}...`);
    
    // Step 1: Load the current project from file system
    const response = await fetch(`${API_ROOT}/projects/${projectId}`);
    if (!response.ok) {
      throw new Error('Failed to load project');
    }
    
    const data = await response.json();
    if (!data.success || !data.project) {
      throw new Error('Project not found');
    }
    
    // Step 2: Merge updates with existing project data
    const updatedProject = {
      ...data.project,
      ...updates,
      id: projectId, // Ensure ID is preserved
      lastModified: new Date().toISOString()
    };
    
    // Step 3: Save back to file system
    const saveResponse = await fetch(`${API_ROOT}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: updatedProject,
        surveyConfig: data.surveyConfig // Preserve existing surveyConfig
      })
    });
    
    if (!saveResponse.ok) {
      const errorData = await saveResponse.json();
      throw new Error(errorData.error || 'Failed to save project');
    }
    
    const saveResult = await saveResponse.json();
    console.log('✅ Project updated successfully:', updatedProject.name);
    
    return { success: true, project: updatedProject };
  } catch (error) {
    console.error('Error updating project:', error);
    return { success: false, error: error.message };
  }
};

// Load all projects from local JSON files via backend API
export const getUserProjects = async () => {
  try {
    return await loadProjectsFromFiles();
  } catch (error) {
    console.error('Error getting user projects from API:', error);
    return [];
  }
};

// ✅ getProjectById now fetches from API
export const getProjectById = async (projectId) => {
  try {
    const response = await fetch(`${API_ROOT}/projects/${projectId}`);
    const data = await response.json();
    return data.project || null;
  } catch (error) {
    console.error('Error getting project by ID from API:', error);
    return null;
  }
};

// ✅ Active project is now stored in sessionStorage (session-only)
export const setActiveProject = (projectId) => {
  sessionStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
};

export const getActiveProjectId = () => {
  return sessionStorage.getItem(ACTIVE_PROJECT_KEY);
};

export const getActiveProject = async () => {
  const activeId = getActiveProjectId();
  return activeId ? await getProjectById(activeId) : null;
};

const generateProjectId = () => {
  return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

const createDefaultSurveyConfig = (title) => {
  return {
    title: title,
    description: "This survey helps us understand user preferences and opinions.",
    logo: "",
    logoPosition: "right",
    settings: {
      showQuestionNumbers: "off",
      showProgressBar: "aboveheader",
      progressBarType: "questions",
      autoGrowComment: true,
      showPreviewBeforeComplete: "showAllQuestions"
    },
    images: [],
    pages: [
      {
        name: "page1",
        title: "Survey Questions",
        description: "Please answer the following questions.",
        elements: []
      }
    ]
  };
};

// ✅ Migration function no longer needed (no localStorage to migrate from)
export const migrateExistingConfig = async () => {
  console.log('📝 Migration skipped (no longer using localStorage)');
  return null;
};

/** Save project + survey config to local file system (used by auto-save). */
export const saveProjectFull = async (project, surveyConfig, supabaseConfig = null) => {
  try {
    const result = await saveProjectToProjectsFolder(project, surveyConfig, supabaseConfig);
    if (!result.success) throw new Error(result.error || 'Save failed');
    return { success: true };
  } catch (error) {
    console.error('saveProjectFull:', error);
    return { success: false, error: error.message };
  }
};

export const loadSurveyConfigForProject = async (projectId) => {
  return loadSurveyConfig(projectId);
};
