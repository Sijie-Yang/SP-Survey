const path = require('path');
const crypto = require('crypto');
const { applyOperations, normalizeOperationsArg } = require('./surveyOperations.cjs');
const { isSecretField, stripSecretFields, findSecretFields } = require('../lib/secretFields');
const {
  listResponses,
  exportResponses,
  summarizeResponses,
} = require('./agentResultsLocal');

const isSafeProjectId = (projectId) => /^[A-Za-z0-9_-]+$/.test(String(projectId || ''));

const isLoopbackAddress = (address) => {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
};

const sanitizeForAgent = stripSecretFields;

// Keep credentials already stored locally when an agent replaces surveyConfig.
const restoreStoredSecrets = (incoming, stored) => {
  if (Array.isArray(incoming)) {
    return incoming.map((child, index) => restoreStoredSecrets(child, stored?.[index]));
  }
  if (!incoming || typeof incoming !== 'object') return incoming;
  const restored = {};
  Object.entries(incoming).forEach(([key, child]) => {
    restored[key] = isSecretField(key)
      ? stored?.[key]
      : restoreStoredSecrets(child, stored?.[key]);
  });
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    Object.entries(stored).forEach(([key, child]) => {
      if (isSecretField(key) && child !== undefined) restored[key] = child;
    });
  }
  return restored;
};

const validateSurveyConfig = (surveyConfig) => {
  const errors = [];
  const warnings = [];
  let questionCount = 0;

  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      errors: [{ path: 'surveyConfig', message: 'surveyConfig must be an object.' }],
      warnings,
      pageCount: 0,
      questionCount,
    };
  }

  if (!Array.isArray(surveyConfig.pages)) {
    errors.push({ path: 'surveyConfig.pages', message: 'pages must be an array.' });
  } else {
    if (surveyConfig.pages.length === 0) {
      warnings.push({ path: 'surveyConfig.pages', message: 'The survey has no pages.' });
    }
    const names = new Map();
    surveyConfig.pages.forEach((page, pageIndex) => {
      const pagePath = `surveyConfig.pages[${pageIndex}]`;
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        errors.push({ path: pagePath, message: 'Each page must be an object.' });
        return;
      }
      if (!page.name) warnings.push({ path: `${pagePath}.name`, message: 'Page name is recommended.' });
      if (!Array.isArray(page.elements)) {
        errors.push({ path: `${pagePath}.elements`, message: 'elements must be an array.' });
        return;
      }
      page.elements.forEach((element, elementIndex) => {
        questionCount += 1;
        const elementPath = `${pagePath}.elements[${elementIndex}]`;
        if (!element || typeof element !== 'object' || Array.isArray(element)) {
          errors.push({ path: elementPath, message: 'Each element must be an object.' });
          return;
        }
        if (!element.type) errors.push({ path: `${elementPath}.type`, message: 'Question type is required.' });
        if (!element.name) {
          errors.push({ path: `${elementPath}.name`, message: 'Question name is required.' });
        } else if (names.has(element.name)) {
          errors.push({
            path: `${elementPath}.name`,
            message: `Duplicate question name; first used at ${names.get(element.name)}.`,
          });
        } else {
          names.set(element.name, `${elementPath}.name`);
        }
      });
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    pageCount: Array.isArray(surveyConfig.pages) ? surveyConfig.pages.length : 0,
    questionCount,
  };
};

const buildProjectUrls = (projectId, clientOrigin) => {
  const origin = String(clientOrigin || 'http://localhost:3000').replace(/\/$/, '');
  const encodedId = encodeURIComponent(projectId);
  return {
    admin: `${origin}/admin`,
    liveSurvey: `${origin}/survey?project=${encodedId}`,
  };
};

const createDefaultSurveyConfig = (name, description = '') => ({
  title: name,
  description,
  pages: [{ name: 'page1', title: 'Page 1', elements: [] }],
  showQuestionNumbers: 'on',
  showProgressBar: 'top',
  completedHtml: '<h3>Thank you for completing the survey.</h3>',
});

const createProjectIo = ({ fs, projectsPath }) => {
  const backupPath = path.join(projectsPath, '.backups');
  const projectFile = (projectId) => path.join(projectsPath, `${projectId}.json`);

  const readProject = async (projectId) => {
    if (!isSafeProjectId(projectId)) {
      const error = new Error('Invalid project id');
      error.status = 400;
      throw error;
    }
    const filePath = projectFile(projectId);
    if (!await fs.pathExists(filePath)) {
      const error = new Error('Project not found');
      error.status = 404;
      throw error;
    }
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  };

  const persistProject = async (projectId, stored, now) => {
    await fs.ensureDir(backupPath);
    const stamp = String(now || new Date().toISOString());
    const safeTimestamp = stamp.replace(/[:.]/g, '-');
    const backupFile = path.join(backupPath, `${projectId}-${safeTimestamp}.json`);
    if (await fs.pathExists(projectFile(projectId))) {
      await fs.copy(projectFile(projectId), backupFile, { overwrite: false });
    }
    const temporaryFile = `${projectFile(projectId)}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(stored, null, 2), 'utf8');
    await fs.move(temporaryFile, projectFile(projectId), { overwrite: true });
    return path.relative(projectsPath, backupFile);
  };

  return {
    readProject,
    persistProject,
    validateSurveyConfig,
    sanitizeForAgent,
    restoreStoredSecrets,
    projectFile,
    backupPath,
  };
};

const isSafeTemplateId = (templateId) => /^[A-Za-z0-9._-]+$/.test(String(templateId || ''));

const templateSurveyConfig = (raw = {}) => raw.surveyConfig || raw.config || {};

const templateCard = (raw, source) => ({
  id: raw.id,
  name: raw.name,
  description: raw.description || '',
  author: raw.author || '',
  year: raw.year || '',
  category: raw.category || '',
  tags: raw.tags || [],
  isApproved: source === 'bundled' ? raw.isApproved !== false : !!raw.isApproved,
  createdAt: raw.createdAt || raw.created_at || null,
});

const buildTemplateIdBase = ({ name, author, year }) => {
  const safeYear = (year || String(new Date().getFullYear())).toString().trim();
  const firstWord = (value, fallback) => {
    const word = String(value || fallback).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return word || fallback;
  };
  return `${safeYear}-${firstWord(author, 'user')}-${firstWord(name, 'template')}`;
};

const registerAgentProjectApi = (app, {
  fs,
  projectsPath,
  skillsPath,
  clientOrigin,
  templatesPath,
  userTemplatesPath,
  responsesPath,
}) => {
  const { readProject, persistProject, projectFile, backupPath } = createProjectIo({ fs, projectsPath });

  const generateProjectId = async () => {
    let projectId;
    do {
      projectId = `proj_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    } while (await fs.pathExists(projectFile(projectId)));
    return projectId;
  };

  const writeNewProject = async ({
    name,
    description = '',
    surveyConfig,
    templateId = null,
    extraProject = {},
  }) => {
    const now = new Date().toISOString();
    const projectId = await generateProjectId();
    const project = {
      id: projectId,
      name,
      description,
      createdAt: now,
      lastModified: now,
      templateId,
      supabaseConfig: null,
      imageDatasetConfig: {
        enabled: true,
        huggingFaceToken: '',
        datasetName: '',
        supabaseProjectId: '',
        supabaseUrl: '',
        supabaseKey: '',
        supabaseAnonKey: '',
      },
      ...extraProject,
      id: projectId,
      name,
      description,
      createdAt: extraProject.createdAt || now,
      lastModified: now,
      templateId,
    };
    const stored = {
      project,
      surveyConfig,
      supabaseConfig: null,
      savedAt: now,
      draftUpdatedAt: now,
      version: '2.0',
    };
    const temporaryFile = `${projectFile(projectId)}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(stored, null, 2), 'utf8');
    await fs.move(temporaryFile, projectFile(projectId), { overwrite: false });
    return { project, surveyConfig, savedAt: now, draftUpdatedAt: now, stored };
  };

  const listTemplateDir = async (dir, source) => {
    if (!dir || !await fs.pathExists(dir)) return [];
    const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json') && file !== 'index.json');
    const templates = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
        if (!raw?.id && !raw?.name) continue;
        if (!raw.id) raw.id = file.replace(/\.json$/, '');
        templates.push(templateCard(raw, source));
      } catch (error) {
        console.warn(`Skipping invalid template file ${file}:`, error.message);
      }
    }
    return templates;
  };

  const readTemplate = async (templateId) => {
    if (!isSafeTemplateId(templateId)) {
      const error = new Error('Invalid template id');
      error.status = 400;
      throw error;
    }
    const userFile = userTemplatesPath ? path.join(userTemplatesPath, `${templateId}.json`) : null;
    const bundledFile = templatesPath ? path.join(templatesPath, `${templateId}.json`) : null;
    let file = null;
    let source = 'bundled';
    if (userFile && await fs.pathExists(userFile)) {
      file = userFile;
      source = 'user';
    } else if (bundledFile && await fs.pathExists(bundledFile)) {
      file = bundledFile;
      source = 'bundled';
    } else {
      const error = new Error('Template not found');
      error.status = 404;
      throw error;
    }
    return { raw: JSON.parse(await fs.readFile(file, 'utf8')), source, file };
  };

  app.use('/api/agent', (req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress || req.ip)) {
      return res.status(403).json({ success: false, error: 'The agent API is available only from this machine.' });
    }
    next();
  });

  const sendError = (res, error) => {
    res.status(error.status || 500).json({ success: false, error: error.message });
  };

  app.get('/api/agent', (req, res) => {
    res.json({
      success: true,
      name: 'SP-Survey local agent API',
      workflow: 'Create or list projects, update surveyConfig, validate, then open the returned local URLs.',
      endpoints: {
        capabilities: 'GET /api/agent/capabilities',
        create: 'POST /api/agent/projects',
        list: 'GET /api/agent/projects',
        read: 'GET /api/agent/projects/:projectId',
        deleteProject: 'DELETE /api/agent/projects/:projectId',
        duplicateProject: 'POST /api/agent/projects/:projectId/duplicate',
        exportProject: 'GET /api/agent/projects/:projectId/export',
        importProject: 'POST /api/agent/projects/import',
        listTemplates: 'GET /api/agent/templates',
        getTemplate: 'GET /api/agent/templates/:id',
        createFromTemplate: 'POST /api/agent/projects/from-template',
        saveAsTemplate: 'POST /api/agent/projects/:projectId/save-as-template',
        updateSurvey: 'PATCH /api/agent/projects/:projectId/survey',
        applyOperations: 'POST /api/agent/projects/:projectId/operations',
        media: 'GET|PATCH /api/agent/projects/:projectId/media',
        skills: 'GET /api/agent/skills  POST /api/agent/skills',
        listResponses: 'GET /api/agent/projects/:projectId/responses',
        exportResponses: 'GET /api/agent/projects/:projectId/responses/export',
        resultsSummary: 'GET /api/agent/projects/:projectId/results/summary',
        results: 'GET /api/agent/projects/:projectId/results',
        release: 'POST /api/agent/projects/:projectId/release',
        validate: 'POST /api/agent/projects/:projectId/validate',
        previewUrls: 'GET /api/agent/projects/:projectId/preview-url',
      },
      notes: [
        'Loopback only. Never send credentials.',
        'Saves update the local draft. POST .../release updates the participant snapshot; the user still deploys the participant site.',
        'Prefer operations over full surveyConfig replace. Models use the researcher\'s own API keys only.',
      ],
    });
  });

  app.get('/api/agent/capabilities', (req, res) => {
    res.json({
      success: true,
      name: 'SP-Survey local agent API',
      version: '1.1.0',
      loopbackOnly: true,
      scopes: ['surveys:read', 'surveys:write', 'surveys:publish', 'media:write', 'results:read'],
      tools: [
        'survey_capabilities',
        'survey_list_projects',
        'survey_get_draft',
        'survey_replace_draft',
        'survey_apply_operations',
        'survey_validate',
        'survey_create_project',
        'survey_duplicate_project',
        'survey_export_project',
        'survey_import_project',
        'survey_list_templates',
        'survey_get_template',
        'survey_create_from_template',
        'survey_save_as_template',
        'media_list',
        'survey_update_media_dataset',
        'skill_list',
        'skill_save',
        'survey_list_responses',
        'survey_export_responses',
        'survey_results_summary',
        'survey_publish',
      ],
      rules: [
        'Always read the draft and retain savedAt / draftUpdatedAt before writing.',
        'Prefer apply_operations over full replace.',
        'Never send API keys, HuggingFace tokens, fal keys, or Supabase credentials.',
        'Saves update the local draft. survey_publish / POST .../release updates the local participant snapshot. The user deploys the participant site themselves.',
        'Use expectedSavedAt or expectedDraftUpdatedAt for optimistic concurrency.',
        'Do not put skillHtml on questions. Save skills with skill_save, then reference skillId.',
        'Do not AI-generate media. media_upload is only for researcher-provided files.',
      ],
      operationTypes: [
        'addPage', 'removePage', 'addQuestion', 'updateQuestion', 'removeQuestion',
        'setAllRatingScales', 'replaceConfig', 'updateSurvey', 'updatePage', 'setTheme',
        'reorderPages', 'reorderQuestions',
      ],
    });
  });

  app.get('/api/agent/templates', async (req, res) => {
    try {
      const bundled = await listTemplateDir(templatesPath, 'bundled');
      const user = await listTemplateDir(userTemplatesPath, 'user');
      const seen = new Set();
      const templates = [];
      [...user, ...bundled].forEach((item) => {
        if (!item?.id || seen.has(item.id)) return;
        seen.add(item.id);
        templates.push(item);
      });
      templates.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      res.json({ success: true, templates: sanitizeForAgent(templates) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/templates/:templateId', async (req, res) => {
    try {
      const { raw, source } = await readTemplate(req.params.templateId);
      res.json({
        success: true,
        template: sanitizeForAgent({
          ...templateCard(raw, source),
          huggingfaceDataset: raw.huggingfaceDataset || raw.huggingface_dataset || '',
          website: raw.website || raw.paper_url || '',
        }),
        surveyConfig: sanitizeForAgent(templateSurveyConfig(raw)),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/from-template', async (req, res) => {
    try {
      const templateId = req.body?.templateId;
      if (!templateId) {
        return res.status(400).json({ success: false, error: 'templateId is required' });
      }
      const secretFields = findSecretFields(req.body);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const { raw, source } = await readTemplate(templateId);
      const card = templateCard(raw, source);
      const name = String(req.body?.name || card.name).trim().slice(0, 160);
      const surveyConfig = req.body?.surveyConfig
        ? sanitizeForAgent(req.body.surveyConfig)
        : { ...sanitizeForAgent(templateSurveyConfig(raw)), title: name };
      const validation = validateSurveyConfig(surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'Survey validation failed.', validation });
      }
      const created = await writeNewProject({
        name,
        description: String(req.body?.description ?? card.description ?? '').trim(),
        surveyConfig,
        templateId,
      });
      res.status(201).json({
        success: true,
        project: sanitizeForAgent(created.project),
        surveyConfig: sanitizeForAgent(created.surveyConfig),
        savedAt: created.savedAt,
        draftUpdatedAt: created.draftUpdatedAt,
        validation,
        note: 'Template media is not copied. Upload files or import from Hugging Face on the Media tab.',
        urls: buildProjectUrls(created.project.id, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/import', async (req, res) => {
    try {
      const secretFields = findSecretFields(req.body);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const pkg = req.body?.package || req.body || {};
      const inputSurveyConfig = pkg.surveyConfig || pkg.survey_config;
      const name = String(pkg?.project?.name || pkg?.name || 'Imported project').trim().slice(0, 160);
      if (!name) {
        return res.status(400).json({ success: false, error: 'Project name is required.' });
      }
      if (!inputSurveyConfig) {
        return res.status(400).json({ success: false, error: 'surveyConfig is required.' });
      }
      const surveyConfig = sanitizeForAgent(inputSurveyConfig);
      const validation = validateSurveyConfig(surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'Survey validation failed.', validation });
      }
      const created = await writeNewProject({
        name,
        description: String(pkg?.project?.description || pkg?.description || '').trim(),
        surveyConfig,
        templateId: pkg?.project?.templateId || pkg?.templateId || null,
      });
      res.status(201).json({
        success: true,
        project: sanitizeForAgent(created.project),
        surveyConfig: sanitizeForAgent(created.surveyConfig),
        savedAt: created.savedAt,
        draftUpdatedAt: created.draftUpdatedAt,
        validation,
        urls: buildProjectUrls(created.project.id, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects', async (req, res) => {
    try {
      const { name, description = '' } = req.body || {};
      if (!String(name || '').trim()) {
        return res.status(400).json({ success: false, error: 'Project name is required.' });
      }
      const secretFields = findSecretFields(req.body);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }

      const projectName = String(name).trim().slice(0, 160);
      const projectDescription = String(description || '').trim();
      const surveyConfig = req.body?.surveyConfig || createDefaultSurveyConfig(projectName, projectDescription);
      const validation = validateSurveyConfig(surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'Survey validation failed.', validation });
      }

      const now = new Date().toISOString();
      let projectId;
      do {
        projectId = `proj_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
      } while (await fs.pathExists(projectFile(projectId)));

      const project = {
        id: projectId,
        name: projectName,
        description: projectDescription,
        createdAt: now,
        lastModified: now,
        templateId: null,
        supabaseConfig: null,
        imageDatasetConfig: {
          enabled: true,
          huggingFaceToken: '',
          datasetName: '',
          supabaseProjectId: '',
          supabaseUrl: '',
          supabaseKey: '',
          supabaseAnonKey: '',
        },
      };
      const stored = { project, surveyConfig, supabaseConfig: null, savedAt: now, version: '2.0' };
      const temporaryFile = `${projectFile(projectId)}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(stored, null, 2), 'utf8');
      await fs.move(temporaryFile, projectFile(projectId), { overwrite: false });

      res.status(201).json({
        success: true,
        project: sanitizeForAgent(project),
        surveyConfig: sanitizeForAgent(surveyConfig),
        savedAt: now,
        draftUpdatedAt: now,
        validation,
        urls: buildProjectUrls(projectId, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects', async (req, res) => {
    try {
      const files = (await fs.readdir(projectsPath)).filter((file) => file.endsWith('.json'));
      const projects = [];
      for (const file of files) {
        try {
          const stored = JSON.parse(await fs.readFile(path.join(projectsPath, file), 'utf8'));
          if (!stored.project?.id) continue;
          projects.push({
            id: stored.project.id,
            name: stored.project.name || stored.project.id,
            description: stored.project.description || '',
            lastModified: stored.project.lastModified || stored.savedAt || null,
            savedAt: stored.savedAt || null,
            draftUpdatedAt: stored.draftUpdatedAt || stored.savedAt || null,
            releaseManaged: !!stored.releaseManaged,
            publishedVersion: stored.publishedVersion || 0,
          });
        } catch (error) {
          console.warn(`Skipping invalid project file ${file}:`, error.message);
        }
      }
      projects.sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || '')));
      res.json({ success: true, projects });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      res.json({
        success: true,
        project: sanitizeForAgent(stored.project),
        surveyConfig: sanitizeForAgent(stored.surveyConfig),
        savedAt: stored.savedAt || null,
        draftUpdatedAt: stored.draftUpdatedAt || stored.savedAt || null,
        releaseManaged: !!stored.releaseManaged,
        publishedVersion: stored.publishedVersion || 0,
        validation: validateSurveyConfig(stored.surveyConfig),
        urls: buildProjectUrls(req.params.projectId, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/agent/projects/:projectId/survey', async (req, res) => {
    try {
      const { surveyConfig, expectedSavedAt, expectedDraftUpdatedAt } = req.body || {};
      const secretFields = findSecretFields(surveyConfig);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const validation = validateSurveyConfig(surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'Survey validation failed.', validation });
      }

      const projectId = req.params.projectId;
      const stored = await readProject(projectId);
      const expectedStamp = expectedDraftUpdatedAt || expectedSavedAt;
      const currentStamp = stored.draftUpdatedAt || stored.savedAt;
      if (expectedStamp && currentStamp && expectedStamp !== currentStamp) {
        return res.status(409).json({
          success: false,
          error: 'Project changed after the agent read it. Read the project again before updating.',
          savedAt: stored.savedAt,
          draftUpdatedAt: stored.draftUpdatedAt || stored.savedAt,
        });
      }

      const now = new Date().toISOString();
      const next = {
        ...stored,
        project: { ...stored.project, lastModified: now },
        surveyConfig: restoreStoredSecrets(surveyConfig, stored.surveyConfig),
        savedAt: now,
        draftUpdatedAt: now,
      };

      await fs.ensureDir(backupPath);
      const safeTimestamp = now.replace(/[:.]/g, '-');
      const backupFile = path.join(backupPath, `${projectId}-${safeTimestamp}.json`);
      await fs.copy(projectFile(projectId), backupFile, { overwrite: false });

      const temporaryFile = `${projectFile(projectId)}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(next, null, 2), 'utf8');
      await fs.move(temporaryFile, projectFile(projectId), { overwrite: true });

      res.json({
        success: true,
        projectId,
        savedAt: now,
        draftUpdatedAt: now,
        validation,
        backup: path.relative(projectsPath, backupFile),
        urls: buildProjectUrls(projectId, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/:projectId/validate', async (req, res) => {
    try {
      const surveyConfig = req.body?.surveyConfig || (await readProject(req.params.projectId)).surveyConfig;
      const validation = validateSurveyConfig(surveyConfig);
      res.status(validation.valid ? 200 : 400).json({ success: validation.valid, validation });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/preview-url', async (req, res) => {
    try {
      await readProject(req.params.projectId);
      res.json({ success: true, urls: buildProjectUrls(req.params.projectId, clientOrigin) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/:projectId/operations', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const stored = await readProject(projectId);
      const expectedStamp = req.body?.expectedDraftUpdatedAt || req.body?.expectedSavedAt;
      const currentStamp = stored.draftUpdatedAt || stored.savedAt;
      if (expectedStamp && currentStamp && expectedStamp !== currentStamp) {
        return res.status(409).json({
          success: false,
          error: 'Project changed after the agent read it. Read the project again before updating.',
          savedAt: stored.savedAt,
          draftUpdatedAt: currentStamp,
        });
      }
      const operations = normalizeOperationsArg(req.body?.operations ?? req.body);
      if (!Array.isArray(operations)) {
        return res.status(400).json({ success: false, error: 'operations must be an array of {op, ...}.' });
      }
      const secretFields = findSecretFields(operations);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const result = applyOperations(stored.surveyConfig, operations);
      const validation = validateSurveyConfig(result.surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Survey validation failed.',
          validation,
          applied: result.applied,
        });
      }
      const now = new Date().toISOString();
      const next = {
        ...stored,
        project: { ...stored.project, lastModified: now },
        surveyConfig: restoreStoredSecrets(result.surveyConfig, stored.surveyConfig),
        savedAt: now,
        draftUpdatedAt: now,
      };
      const backup = await persistProject(projectId, next, now);
      res.json({
        success: true,
        projectId,
        savedAt: now,
        draftUpdatedAt: now,
        applied: result.applied,
        inverse: result.inverse,
        validation,
        backup,
        urls: buildProjectUrls(projectId, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/media', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const config = stored.surveyConfig || {};
      const dataset = stored.project?.imageDatasetConfig || {};
      res.json({
        success: true,
        media: sanitizeForAgent({
          preloadedImages: config.preloadedImages || [],
          mediaFolderTags: dataset.mediaFolderTags || {},
          imageDatasetConfig: dataset,
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/agent/projects/:projectId/media', async (req, res) => {
    try {
      const secretFields = findSecretFields(req.body);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const stored = await readProject(req.params.projectId);
      const now = new Date().toISOString();
      const dataset = { ...(stored.project?.imageDatasetConfig || {}) };
      if (req.body?.mediaFolderTags && typeof req.body.mediaFolderTags === 'object') {
        dataset.mediaFolderTags = req.body.mediaFolderTags;
      }
      if (req.body?.imageDatasetConfig && typeof req.body.imageDatasetConfig === 'object') {
        Object.entries(req.body.imageDatasetConfig).forEach(([key, value]) => {
          if (!isSecretField(key)) dataset[key] = value;
        });
      }
      const surveyConfig = { ...(stored.surveyConfig || {}) };
      if (Array.isArray(req.body?.preloadedImages)) {
        surveyConfig.preloadedImages = req.body.preloadedImages;
      }
      const next = {
        ...stored,
        project: { ...stored.project, imageDatasetConfig: dataset, lastModified: now },
        surveyConfig,
        savedAt: now,
        draftUpdatedAt: now,
      };
      const backup = await persistProject(req.params.projectId, next, now);
      res.json({
        success: true,
        savedAt: now,
        draftUpdatedAt: now,
        backup,
        media: sanitizeForAgent({
          preloadedImages: surveyConfig.preloadedImages || [],
          mediaFolderTags: dataset.mediaFolderTags || {},
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/skills', async (req, res) => {
    try {
      if (!skillsPath) {
        return res.json({ success: true, skills: [] });
      }
      await fs.ensureDir(skillsPath);
      const files = (await fs.readdir(skillsPath)).filter((file) => file.endsWith('.json'));
      const skills = [];
      for (const file of files) {
        try {
          skills.push(sanitizeForAgent(JSON.parse(await fs.readFile(path.join(skillsPath, file), 'utf8'))));
        } catch (error) {
          console.warn(`Skipping invalid skill file ${file}:`, error.message);
        }
      }
      res.json({ success: true, skills });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/skills', async (req, res) => {
    try {
      if (!skillsPath) {
        return res.status(400).json({ success: false, error: 'Local skill storage is not configured.' });
      }
      const skill = req.body?.skill;
      if (!skill || typeof skill !== 'object') {
        return res.status(400).json({ success: false, error: 'skill object is required.' });
      }
      const secretFields = findSecretFields(skill);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      if (skill.skillHtml || skill.sourceHtml) {
        const html = String(skill.skillHtml || skill.sourceHtml);
        if (!html.includes('SPSkill.setAnswer')) {
          return res.status(400).json({
            success: false,
            error: 'Skill HTML must call SPSkill.setAnswer(object).',
          });
        }
      }
      const now = new Date().toISOString();
      const id = skill.id || `skill_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const row = {
        ...skill,
        id,
        created_at: skill.created_at || now,
        updated_at: now,
      };
      await fs.ensureDir(skillsPath);
      await fs.writeFile(path.join(skillsPath, `${id}.json`), JSON.stringify(row, null, 2), 'utf8');
      res.json({ success: true, skill: sanitizeForAgent(row) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/export', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      res.json({
        success: true,
        package: {
          project: sanitizeForAgent({
            ...stored.project,
            imageDatasetConfig: stored.project?.imageDatasetConfig || {},
            templateId: stored.project?.templateId || null,
          }),
          surveyConfig: sanitizeForAgent(stored.surveyConfig || {}),
          metadata: sanitizeForAgent(stored.project || {}),
          exportedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/:projectId/duplicate', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const secretFields = findSecretFields(req.body);
      if (secretFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Do not send credentials through the agent API.',
          secretFields,
        });
      }
      const name = String(req.body?.name || `${stored.project?.name || 'Project'} (Copy)`).trim().slice(0, 160);
      const surveyConfig = sanitizeForAgent(JSON.parse(JSON.stringify(stored.surveyConfig || {})));
      if (req.body?.copyMedia !== true && surveyConfig.preloadedImages) {
        surveyConfig.preloadedImages = [];
      }
      const validation = validateSurveyConfig(surveyConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'Source survey validation failed.', validation });
      }
      const created = await writeNewProject({
        name,
        description: req.body?.description != null
          ? String(req.body.description)
          : (stored.project?.description || ''),
        surveyConfig,
        templateId: stored.project?.templateId || null,
      });
      res.status(201).json({
        success: true,
        project: sanitizeForAgent(created.project),
        surveyConfig: sanitizeForAgent(created.surveyConfig),
        savedAt: created.savedAt,
        draftUpdatedAt: created.draftUpdatedAt,
        validation,
        mediaCopy: req.body?.copyMedia === true
          ? { files: (surveyConfig.preloadedImages || []).length }
          : null,
        urls: buildProjectUrls(created.project.id, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/:projectId/save-as-template', async (req, res) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({
          success: false,
          error: 'Set confirm:true to submit as template.',
        });
      }
      if (!userTemplatesPath) {
        return res.status(400).json({ success: false, error: 'Local template storage is not configured.' });
      }
      const stored = await readProject(req.params.projectId);
      const name = String(req.body?.name || stored.project?.name || 'Untitled').trim();
      const author = String(req.body?.author || stored.project?.author || 'User').trim();
      const year = String(req.body?.year || stored.project?.year || new Date().getFullYear()).trim();
      const baseId = buildTemplateIdBase({ name, author, year });
      let templateId = baseId;
      await fs.ensureDir(userTemplatesPath);
      for (let n = 0; n < 8; n += 1) {
        const attempt = n === 0 ? baseId : `${baseId}-${n + 1}`;
        if (!await fs.pathExists(path.join(userTemplatesPath, `${attempt}.json`))) {
          templateId = attempt;
          break;
        }
      }
      const now = new Date().toISOString();
      const surveyConfig = sanitizeForAgent(stored.surveyConfig || {});
      const preloaded = Array.isArray(surveyConfig.preloadedImages) ? surveyConfig.preloadedImages : [];
      const tpl = {
        id: templateId,
        name,
        description: String(req.body?.description ?? stored.project?.description ?? '').trim(),
        author,
        year,
        category: String(req.body?.category || stored.project?.category || 'Custom').trim(),
        tags: Array.isArray(req.body?.tags) ? req.body.tags : (stored.project?.tags || []),
        website: req.body?.website || stored.project?.website || null,
        huggingfaceDataset: req.body?.huggingfaceDataset || stored.project?.huggingfaceDataset || null,
        config: surveyConfig,
        surveyConfig,
        preloadedImages: preloaded,
        isApproved: false,
        createdAt: now,
        updatedAt: now,
      };
      await fs.writeFile(
        path.join(userTemplatesPath, `${templateId}.json`),
        JSON.stringify(sanitizeForAgent(tpl), null, 2),
        'utf8',
      );
      res.json({
        success: true,
        templateId,
        status: 'saved',
        mediaCopy: { files: preloaded.length },
        message: 'Template saved locally. Sensitive fields were stripped. There is no hosted review queue.',
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/agent/projects/:projectId', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      await readProject(projectId);
      await fs.remove(projectFile(projectId));
      const siliconFile = path.join(projectsPath, `${projectId}.silicon.json`);
      if (await fs.pathExists(siliconFile)) await fs.remove(siliconFile);
      res.json({ success: true, projectId, deleted: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/responses', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const payload = await listResponses(fs, {
        responsesPath,
        projectsPath,
        surveyConfig: stored.surveyConfig,
        projectName: stored.project?.name,
      }, req.params.projectId, req.query || {});
      res.json(payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/responses/export', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const payload = await exportResponses(fs, {
        responsesPath,
        projectsPath,
        surveyConfig: stored.surveyConfig,
        projectName: stored.project?.name,
      }, req.params.projectId, req.query || {});
      res.json(payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/results/summary', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const payload = await summarizeResponses(fs, {
        responsesPath,
        projectsPath,
        surveyConfig: stored.surveyConfig,
        projectName: stored.project?.name,
      }, req.params.projectId, req.query || {});
      res.json(payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/projects/:projectId/results', async (req, res) => {
    try {
      const stored = await readProject(req.params.projectId);
      const payload = await listResponses(fs, {
        responsesPath,
        projectsPath,
        surveyConfig: stored.surveyConfig,
        projectName: stored.project?.name,
      }, req.params.projectId, req.query || {});
      res.json({
        ...payload,
        note: payload.note || 'Self-hosted results stay in local response files or the researcher\'s own Supabase. This endpoint never returns credentials.',
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/projects/:projectId/release', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const stored = await readProject(projectId);
      const expectedStamp = req.body?.expectedDraftUpdatedAt || req.body?.expectedSavedAt;
      const currentStamp = stored.draftUpdatedAt || stored.savedAt;
      if (expectedStamp && currentStamp && expectedStamp !== currentStamp) {
        return res.status(409).json({
          success: false,
          error: 'Draft changed after it was read. Read the project again before releasing.',
          savedAt: stored.savedAt,
          draftUpdatedAt: currentStamp,
        });
      }
      if (req.body?.confirm !== true) {
        return res.status(400).json({
          success: false,
          error: 'Pass confirm: true to release the current draft as the local participant snapshot.',
        });
      }
      const now = new Date().toISOString();
      const history = Array.isArray(stored.releaseHistory) ? stored.releaseHistory.slice() : [];
      const config = JSON.parse(JSON.stringify(stored.surveyConfig || { pages: [] }));
      const media = {
        preloadedImages: config.preloadedImages || [],
        imageDatasetConfig: stored.project?.imageDatasetConfig || {},
      };
      const nextVersion = Number(stored.publishedVersion || 0) + 1;
      const next = {
        ...stored,
        releaseManaged: true,
        publishedVersion: nextVersion,
        publishedSurveyConfig: config,
        publishedMedia: media,
        releaseHistory: [{
          version: nextVersion,
          releasedAt: now,
          summary: String(req.body?.summary || '').trim(),
          config,
          media_snapshot: media,
        }, ...history].slice(0, 50),
        lastReleasedAt: now,
      };
      const backup = await persistProject(projectId, next, now);
      res.json({
        success: true,
        publishedVersion: nextVersion,
        releaseManaged: true,
        releasedAt: now,
        backup,
        note: 'Local participant snapshot updated. Deploy the participant site yourself; there is no hosted research_releases URL.',
      });
    } catch (error) {
      sendError(res, error);
    }
  });
};

module.exports = {
  buildProjectUrls,
  createDefaultSurveyConfig,
  createProjectIo,
  findSecretFields,
  isLoopbackAddress,
  isSafeProjectId,
  registerAgentProjectApi,
  restoreStoredSecrets,
  sanitizeForAgent,
  validateSurveyConfig,
  applyOperations,
  normalizeOperationsArg,
};
