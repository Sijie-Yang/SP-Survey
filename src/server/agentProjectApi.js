const path = require('path');
const crypto = require('crypto');
const { applyOperations, normalizeOperationsArg } = require('./surveyOperations.cjs');

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

const registerAgentProjectApi = (app, { fs, projectsPath, skillsPath, clientOrigin }) => {
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
        capabilities: 'GET /api/agent/capabilities',
        create: 'POST /api/agent/projects',
        list: 'GET /api/agent/projects',
        read: 'GET /api/agent/projects/:projectId',
        updateSurvey: 'PATCH /api/agent/projects/:projectId/survey',
        applyOperations: 'POST /api/agent/projects/:projectId/operations',
        media: 'GET|PATCH /api/agent/projects/:projectId/media',
        skills: 'GET /api/agent/skills  POST /api/agent/skills',
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
        'media_list',
        'survey_update_media_dataset',
        'skill_list',
        'skill_save',
        'survey_list_responses',
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

  const persistProject = async (projectId, stored, now) => {
    await fs.ensureDir(backupPath);
    const safeTimestamp = now.replace(/[:.]/g, '-');
    const backupFile = path.join(backupPath, `${projectId}-${safeTimestamp}.json`);
    if (await fs.pathExists(projectFile(projectId))) {
      await fs.copy(projectFile(projectId), backupFile, { overwrite: false });
    }
    const temporaryFile = `${projectFile(projectId)}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(stored, null, 2), 'utf8');
    await fs.move(temporaryFile, projectFile(projectId), { overwrite: true });
    return path.relative(projectsPath, backupFile);
  };

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

  app.get('/api/agent/projects/:projectId/results', async (req, res) => {
    try {
      await readProject(req.params.projectId);
      res.json({
        success: true,
        responses: [],
        note: 'Self-hosted results stay in the researcher\'s own Supabase or local response files. Use the Results tab, or configure Supabase and query survey_responses for this project_id. This endpoint never returns credentials.',
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
