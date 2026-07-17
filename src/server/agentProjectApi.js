const path = require('path');
const crypto = require('crypto');

const SECRET_FIELDS = new Set([
  'supabaseconfig',
  'supabasekey',
  'supabaseanonkey',
  'servicerolekey',
  'anonkey',
  'huggingfacetoken',
  'falapikey',
  'falkey',
  'openaiapikey',
  'openrouterapikey',
  'apikey',
  'accesstoken',
  'accesskeyid',
  'secretkey',
  'secretaccesskey',
  'password',
]);

const isSecretField = (key) => SECRET_FIELDS.has(String(key).toLowerCase());

const isSafeProjectId = (projectId) => /^[A-Za-z0-9_-]+$/.test(String(projectId || ''));

const isLoopbackAddress = (address) => {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
};

const sanitizeForAgent = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeForAgent);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((cleaned, [key, child]) => {
    if (!isSecretField(key)) cleaned[key] = sanitizeForAgent(child);
    return cleaned;
  }, {});
};

const findSecretFields = (value, currentPath = '') => {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findSecretFields(child, `${currentPath}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    return isSecretField(key) ? [childPath] : findSecretFields(child, childPath);
  });
};

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

const registerAgentProjectApi = (app, { fs, projectsPath, clientOrigin }) => {
  const backupPath = path.join(projectsPath, '.backups');

  app.use('/api/agent', (req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress || req.ip)) {
      return res.status(403).json({ success: false, error: 'The agent API is available only from this machine.' });
    }
    next();
  });

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

  const sendError = (res, error) => {
    res.status(error.status || 500).json({ success: false, error: error.message });
  };

  app.get('/api/agent', (req, res) => {
    res.json({
      success: true,
      name: 'SP-Survey local agent API',
      workflow: 'Create or list projects, update surveyConfig, validate, then open the returned local URLs.',
      endpoints: {
        create: 'POST /api/agent/projects',
        list: 'GET /api/agent/projects',
        read: 'GET /api/agent/projects/:projectId',
        updateSurvey: 'PATCH /api/agent/projects/:projectId/survey',
        validate: 'POST /api/agent/projects/:projectId/validate',
        previewUrls: 'GET /api/agent/projects/:projectId/preview-url',
      },
    });
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
        validation: validateSurveyConfig(stored.surveyConfig),
        urls: buildProjectUrls(req.params.projectId, clientOrigin),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/agent/projects/:projectId/survey', async (req, res) => {
    try {
      const { surveyConfig, expectedSavedAt } = req.body || {};
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
      if (expectedSavedAt && stored.savedAt && expectedSavedAt !== stored.savedAt) {
        return res.status(409).json({
          success: false,
          error: 'Project changed after the agent read it. Read the project again before updating.',
          savedAt: stored.savedAt,
        });
      }

      const now = new Date().toISOString();
      const next = {
        ...stored,
        project: { ...stored.project, lastModified: now },
        surveyConfig: restoreStoredSecrets(surveyConfig, stored.surveyConfig),
        savedAt: now,
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
};

module.exports = {
  buildProjectUrls,
  createDefaultSurveyConfig,
  findSecretFields,
  isLoopbackAddress,
  isSafeProjectId,
  registerAgentProjectApi,
  restoreStoredSecrets,
  sanitizeForAgent,
  validateSurveyConfig,
};
