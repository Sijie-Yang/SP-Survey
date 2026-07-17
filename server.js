require('dotenv').config();

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const OpenAI = require('openai');
const { resolveAiRequest, aiChat, formatAiError } = require('./aiClient');
const { registerAgentProjectApi } = require('./src/server/agentProjectApi');

// Import multi-agent review system
const {
  AGENTS,
  REVIEW_CONFIG,
  getAgentSystemPrompt,
  generate1v1ReviewPrompt,
  generateGroupDiscussionPrompt,
  consolidateReviews,
  generateRevisionPrompt,
  shouldTerminateReview,
  formatReviewForChat,
  formatConsolidatedFeedback
} = require('./src/lib/multiAgentReview');

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

// Enable CORS for React app
app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true
}));

app.use(express.json({ limit: '100mb' }));

const TEMPLATES_PATH = path.join(__dirname, 'public', 'project_templates');
const PROJECTS_PATH = path.join(__dirname, 'public', 'projects');
const DEPLOYMENTS_PATH = path.join(__dirname, 'deployments');
const SKILLS_PATH = path.join(__dirname, 'public', 'skills');

// Ensure directories exist
fs.ensureDirSync(TEMPLATES_PATH);
fs.ensureDirSync(PROJECTS_PATH);
fs.ensureDirSync(DEPLOYMENTS_PATH);
fs.ensureDirSync(SKILLS_PATH);

// Template endpoints
app.post('/api/templates', async (req, res) => {
  try {
    const { template } = req.body;
    const filename = `${template.id}.json`;
    const filePath = path.join(TEMPLATES_PATH, filename);
    
    await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf8');
    
    console.log(`✅ Template "${template.name}" saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const filename = `${templateId}.json`;
    const filePath = path.join(TEMPLATES_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
      console.log(`✅ Template file ${filename} deleted from ${filePath}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Project endpoints
app.post('/api/projects', async (req, res) => {
  try {
    const { project, surveyConfig, supabaseConfig } = req.body;
    const filename = `${project.id}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    const projectData = {
      project,
      surveyConfig,
      supabaseConfig,
      savedAt: new Date().toISOString(),
      version: '2.0'
    };
    
    await fs.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf8');
    
    console.log(`✅ Project "${project.name}" saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single project data
app.get('/api/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const filename = `${projectId}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      const data = await fs.readFile(filePath, 'utf8');
      const projectData = JSON.parse(data);
      console.log(`✅ Loaded project data for ${projectId}`);
      res.json({ success: true, project: projectData.project, surveyConfig: projectData.surveyConfig });
    } else {
      res.status(404).json({ success: false, error: 'Project not found' });
    }
  } catch (error) {
    console.error('Error loading project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const filename = `${projectId}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
      console.log(`✅ Project file ${filename} deleted from ${filePath}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List files endpoints
app.get('/api/templates', async (req, res) => {
  try {
    const files = await fs.readdir(TEMPLATES_PATH);
    const jsonFiles = files.filter(file => file.endsWith('.json') && file !== 'index.json');
    res.json({ files: jsonFiles });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const files = await fs.readdir(PROJECTS_PATH);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    res.json({ files: jsonFiles });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Local Codex/IDE agents can update surveyConfig directly without receiving credentials.
registerAgentProjectApi(app, {
  fs,
  projectsPath: PROJECTS_PATH,
  clientOrigin: CLIENT_ORIGIN,
});

// Deployment endpoints
app.post('/api/create-deployment', async (req, res) => {
  try {
    const { projectName, files } = req.body;
    
    if (!projectName || !files) {
      return res.status(400).json({ success: false, error: 'Project name and files are required' });
    }
    
    // Create deployment folder with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deploymentFolderName = `${projectName}-${timestamp}`;
    const deploymentPath = path.join(DEPLOYMENTS_PATH, deploymentFolderName);
    
    // Ensure deployment folder exists
    await fs.ensureDir(deploymentPath);
    
    // Copy source files (excluding admin components and original SurveyApp)
    const srcPath = path.join(__dirname, 'src');
    const publicPath = path.join(__dirname, 'public');
    
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, path.join(deploymentPath, 'src'), {
        filter: (src) => {
          // Exclude admin-related files and original SurveyApp (using SurveyAppClean instead)
          const relativePath = path.relative(srcPath, src);
          const excludePaths = [
            'AdminApp.js',
            'SurveyApp.js',
            'components/admin'
          ];
          return !excludePaths.some(excludePath => relativePath.includes(excludePath));
        }
      });
    }
    
    if (await fs.pathExists(publicPath)) {
      await fs.copy(publicPath, path.join(deploymentPath, 'public'));
    }
    
    // Write deployment-specific files (this will overwrite src/App.js with survey-only version)
    for (const [fileName, content] of Object.entries(files)) {
      const filePath = path.join(deploymentPath, fileName);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, 'utf8');
    }
    
    console.log(`✅ Deployment folder created: ${deploymentPath}`);
    
    res.json({ 
      success: true, 
      deploymentPath: deploymentPath,
      deploymentName: deploymentFolderName
    });
  } catch (error) {
    console.error('Error creating deployment folder:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deployment-status', async (req, res) => {
  try {
    const deployments = [];
    
    if (await fs.pathExists(DEPLOYMENTS_PATH)) {
      const items = await fs.readdir(DEPLOYMENTS_PATH);
      
      for (const item of items) {
        const itemPath = path.join(DEPLOYMENTS_PATH, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          deployments.push({
            name: item,
            path: itemPath,
            created: stats.birthtime,
            size: await getFolderSize(itemPath)
          });
        }
      }
    }
    
    // Sort by creation date (newest first)
    deployments.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({ deployments });
  } catch (error) {
    console.error('Error getting deployment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test deployment build
app.post('/api/test-deployment', async (req, res) => {
  try {
    const { deploymentPath } = req.body;
    
    if (!deploymentPath) {
      return res.status(400).json({ success: false, error: 'Deployment path is required' });
    }
    
    if (!await fs.pathExists(deploymentPath)) {
      return res.status(404).json({ success: false, error: 'Deployment folder not found' });
    }
    
    console.log(`🧪 Testing deployment at: ${deploymentPath}`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    let fullOutput = '';
    
    // Run npm install
    fullOutput += '📦 Running npm install...\n';
    fullOutput += '─'.repeat(80) + '\n';
    console.log('📦 Running npm install...');
    try {
      const { stdout: installStdout, stderr: installStderr } = await execPromise('npm install', { 
        cwd: deploymentPath, 
        maxBuffer: 10 * 1024 * 1024 
      });
      fullOutput += installStdout || '';
      if (installStderr) fullOutput += installStderr;
      fullOutput += '\n✅ npm install completed\n\n';
      console.log('✅ npm install completed');
    } catch (error) {
      console.error('❌ npm install failed:', error.message);
      fullOutput += `\n❌ npm install failed:\n${error.message}\n`;
      return res.json({ 
        success: false, 
        error: 'npm install failed: ' + error.message,
        step: 'install',
        output: fullOutput
      });
    }
    
    // Run npm run build
    fullOutput += '🏗️  Running npm run build...\n';
    fullOutput += '─'.repeat(80) + '\n';
    console.log('🏗️  Running npm run build...');
    try {
      const { stdout: buildStdout, stderr: buildStderr } = await execPromise('npm run build', { 
        cwd: deploymentPath,
        maxBuffer: 10 * 1024 * 1024
      });
      fullOutput += buildStdout || '';
      if (buildStderr) fullOutput += buildStderr;
      fullOutput += '\n✅ npm run build completed\n\n';
      console.log('✅ npm run build completed');
      
      // Find an available port for preview server
      const findAvailablePort = async (startPort) => {
        const net = require('net');
        return new Promise((resolve) => {
          const server = net.createServer();
          server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
          });
          server.on('error', () => {
            resolve(findAvailablePort(startPort + 1));
          });
        });
      };
      
      const previewPort = await findAvailablePort(3100);
      
      // Start preview server in background
      const buildPath = path.join(deploymentPath, 'build');
      if (await fs.pathExists(buildPath)) {
        // Use serve to start preview server
        const serveProcess = exec(`npx serve -s build -l ${previewPort} --no-clipboard`, { 
          cwd: deploymentPath 
        });
        
        fullOutput += `\n🌐 Preview server started at: http://localhost:${previewPort}\n`;
        fullOutput += '─'.repeat(80) + '\n';
        fullOutput += '\n✅ Build test completed successfully!\n';
        
        res.json({ 
          success: true, 
          message: 'Deployment test completed successfully!',
          output: fullOutput,
          previewUrl: `http://localhost:${previewPort}`,
          previewPort: previewPort
        });
      } else {
        res.json({ 
          success: true, 
          message: 'Build completed but no build folder found',
          output: fullOutput
        });
      }
    } catch (error) {
      console.error('❌ npm run build failed:', error.message);
      fullOutput += `\n❌ npm run build failed:\n${error.message}\n`;
      return res.json({ 
        success: false, 
        error: 'npm run build failed: ' + error.message,
        step: 'build',
        output: fullOutput
      });
    }
  } catch (error) {
    console.error('Error testing deployment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload to GitHub
app.post('/api/upload-to-github', async (req, res) => {
  try {
    const { deploymentPath, githubRepoUrl, commitMessage } = req.body;
    
    if (!deploymentPath || !githubRepoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Deployment path and GitHub repo URL are required' 
      });
    }
    
    const repoRoot = path.resolve(deploymentPath);
    if (!await fs.pathExists(repoRoot)) {
      return res.status(404).json({ success: false, error: 'Deployment folder not found' });
    }
    
    console.log(`📤 Uploading to GitHub: ${githubRepoUrl}`);
    
    const { execFile } = require('child_process');
    const util = require('util');
    const execFileAsync = util.promisify(execFile);
    
    const gitOpts = {
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true
    };
    
    const runGit = (args) =>
      execFileAsync('git', args, { ...gitOpts, cwd: repoRoot });
    
    try {
      // Isolated repo under deployments/ must have its own .git. If git walks up to the
      // parent repo, "git add" tries to stage deployments/... which is ignored by the root .gitignore.
      console.log('🔧 Initializing git repository in deployment folder...');
      await runGit(['init']);
      await runGit(['branch', '-M', 'main']);
      
      const gitDotPath = path.join(repoRoot, '.git');
      if (!await fs.pathExists(gitDotPath)) {
        return res.json({
          success: false,
          error:
            'git init did not create a .git directory in the deployment folder. Check disk permissions.'
        });
      }
      
      const { stdout: topRaw } = await runGit(['rev-parse', '--show-toplevel']);
      const gitTop = path.resolve(String(topRaw).trim());
      if (gitTop !== repoRoot) {
        return res.json({
          success: false,
          error:
            `Git is using the parent repository (${gitTop}) instead of the deployment folder (${repoRoot}). ` +
            'The parent project ignores /deployments/*, so uploads must use a separate git repository inside the deployment folder. ' +
            'Remove any stray .git file in that folder if present, then try again.'
        });
      }
      
      // Add all files
      console.log('📝 Adding files to git...');
      await runGit(['add', '.']);
      
      // Commit with --quiet flag to reduce output
      console.log('💾 Committing changes...');
      const message = commitMessage || 'Initial deployment setup';
      try {
        await runGit(['commit', '--quiet', '-m', message]);
      } catch (commitErr) {
        const msg = commitErr.message || '';
        if (/nothing to commit|no changes added to commit/i.test(msg)) {
          console.log('ℹ️  No new changes to commit; continuing with push.');
        } else {
          throw commitErr;
        }
      }
      
      let originMissing = false;
      try {
        await runGit(['remote', 'get-url', 'origin']);
      } catch (_) {
        originMissing = true;
      }
      if (originMissing) {
        console.log('🔗 Adding remote origin...');
        await runGit(['remote', 'add', 'origin', githubRepoUrl]);
      } else {
        try {
          await runGit(['remote', 'set-url', 'origin', githubRepoUrl]);
        } catch (e) {
          console.log('Remote already set correctly');
        }
      }
      
      // Push to GitHub with --quiet flag
      console.log('🚀 Pushing to GitHub...');
      try {
        await runGit(['push', '--quiet', '-u', 'origin', 'main']);
        console.log('✅ Successfully uploaded to GitHub!');
      } catch (pushError) {
        // If push fails due to remote having changes, force push
        if (pushError.message.includes('rejected') || pushError.message.includes('fetch first')) {
          console.log('⚠️  Remote has changes, force pushing...');
          await runGit(['push', '--quiet', '--force', '-u', 'origin', 'main']);
          console.log('✅ Force push successful!');
        } else {
          throw pushError;
        }
      }
      
      res.json({ 
        success: true, 
        message: 'Successfully uploaded to GitHub!',
        repoUrl: githubRepoUrl
      });
    } catch (error) {
      console.error('❌ Git operation failed:', error.message);
      
      // Provide helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('Permission denied')) {
        errorMessage = 'Git push failed: Permission denied. Please make sure you have set up SSH keys or use a personal access token.';
      } else if (error.message.includes('remote: Repository not found')) {
        errorMessage = 'GitHub repository not found. Please create the repository first on GitHub.';
      } else if (error.message.includes('ignored by one of your .gitignore')) {
        errorMessage =
          'Git tried to add files using the parent project repository, and those paths are listed in the root .gitignore. ' +
          'Upload again after restarting the dev server so the deployment folder gets its own .git. ' +
          'If it keeps happening, open the deployment folder in a terminal, run "git init" and "git rev-parse --show-toplevel" — it must print that folder path, not the parent repo.';
      }
      
      return res.json({ 
        success: false, 
        error: errorMessage
      });
    }
  } catch (error) {
    console.error('Error uploading to GitHub:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to get folder size
async function getFolderSize(folderPath) {
  let totalSize = 0;
  
  try {
    const items = await fs.readdir(folderPath);
    
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      const stats = await fs.stat(itemPath);
      
      if (stats.isDirectory()) {
        totalSize += await getFolderSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.warn(`Could not calculate size for ${folderPath}:`, error.message);
  }
  
  return totalSize;
}

// ✅ List all local response files (for Results Analysis fallback)
app.get('/api/responses', async (req, res) => {
  try {
    const RESPONSES_PATH = path.join(__dirname, 'public', 'responses');
    await fs.ensureDir(RESPONSES_PATH);
    const files = (await fs.readdir(RESPONSES_PATH))
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    const responses = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(RESPONSES_PATH, file), 'utf8');
        responses.push(JSON.parse(content));
      } catch (e) {
        console.error(`Error reading response file ${file}:`, e);
      }
    }

    res.json({ success: true, responses, count: responses.length });
  } catch (error) {
    console.error('Error listing responses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Local skill library (self-hosted, no auth)
app.get('/api/skills', async (req, res) => {
  try {
    const files = (await fs.readdir(SKILLS_PATH)).filter((f) => f.endsWith('.json'));
    const skills = [];
    for (const file of files) {
      try {
        skills.push(await fs.readJson(path.join(SKILLS_PATH, file)));
      } catch (e) {
        console.error(`Error reading skill ${file}:`, e);
      }
    }
    res.json({ success: true, skills });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/skills', async (req, res) => {
  try {
    const { skill } = req.body;
    if (!skill?.id) {
      return res.status(400).json({ success: false, error: 'Skill id is required' });
    }
    const filePath = path.join(SKILLS_PATH, `${skill.id}.json`);
    await fs.writeJson(filePath, skill, { spaces: 2 });
    res.json({ success: true, skill });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/skills/:skillId', async (req, res) => {
  try {
    const filePath = path.join(SKILLS_PATH, `${req.params.skillId}.json`);
    if (await fs.pathExists(filePath)) await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/responses/:filename — remove a local response JSON file
app.delete('/api/responses/:filename', async (req, res) => {
  try {
    const RESPONSES_PATH = path.join(__dirname, 'public', 'responses');
    const filePath = path.join(RESPONSES_PATH, req.params.filename);
    if (await fs.pathExists(filePath)) await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Survey response endpoint (saves to file instead of localStorage!)
app.post('/api/responses', async (req, res) => {
  try {
    const responseData = req.body;
    const RESPONSES_PATH = path.join(__dirname, 'public', 'responses');
    
    // Ensure responses directory exists
    await fs.ensureDir(RESPONSES_PATH);
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `response_${responseData.participant_id}_${timestamp}.json`;
    const filePath = path.join(RESPONSES_PATH, filename);
    
    await fs.writeFile(filePath, JSON.stringify(responseData, null, 2), 'utf8');
    
    console.log(`✅ Survey response saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving survey response:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Backend restart endpoint
app.post('/api/restart', async (req, res) => {
  try {
    console.log('🔄 Backend restart requested...');
    
    // Send response first
    res.json({ 
      success: true, 
      message: 'Server restart initiated. Please wait 5-10 seconds for the server to restart.' 
    });
    
    // Gracefully restart after sending response
    setTimeout(() => {
      console.log('🔄 Restarting server...');
      process.exit(0); // Exit with success code, process manager should restart
    }, 1000);
  } catch (error) {
    console.error('Error restarting server:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ OpenAI API endpoints for AI-powered survey generation

// Validate OpenAI / OpenRouter API key
app.post('/api/openai/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }
    const ai = resolveAiRequest(apiKey);
    await aiChat(ai, 'fast', { messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });
    console.log(`✅ API key validated (${ai.provider})`);
    res.json({ success: true, valid: true, provider: ai.provider });
  } catch (error) {
    console.error('❌ API key validation failed:', error.message);
    res.status(400).json({ success: false, valid: false, error: 'Invalid API key' });
  }
});

// Generate or revise a custom question skill (HTML + config schemas)
app.post('/api/openai/generate-skill', async (req, res) => {
  try {
    const { message, apiKey, currentSkill, conversationHistory = [] } = req.body;
    if (!apiKey || !message) {
      return res.status(400).json({ success: false, error: 'API key and message are required' });
    }

    const ai = resolveAiRequest(apiKey);
    const skillContext = currentSkill
      ? `\n\nCurrent skill JSON (revise this):\n${JSON.stringify({
        name: currentSkill.name,
        description: currentSkill.description,
        configSchema: currentSkill.configSchema,
        defaultConfig: currentSkill.defaultConfig,
        resultSchema: currentSkill.resultSchema,
        sourceHtml: currentSkill.sourceHtml,
      }, null, 2).slice(0, 12000)}`
      : '';

    const systemPrompt = `You are an expert at building custom survey question types ("skills") for the SP Survey Platform.

Each skill is HTML/CSS/JS running in a sandboxed iframe with this SDK:
- document.addEventListener('spskill-init', function(e) { var cfg = e.detail.config; var images = e.detail.images; ... })
- SPSkill.setAnswer(object) — submit participant answer
- SPSkill.ready() — call when UI is ready
- spSetImg(imgEl, 'image'|'video'|'audio', index, alt) — bind injected media
- spUrl('image', index, label) — media URL helper
- cfg.prompt, cfg.mediaCount, cfg.mediaType from defaultConfig

Return JSON only:
{
  "message": "brief explanation of what you built/changed",
  "skill": {
    "name": "string",
    "description": "string",
    "configSchema": [{ "key": "prompt", "label": "Prompt", "type": "string" }, ...],
    "defaultConfig": { "mediaCount": 1, "mediaType": "image", "prompt": "...", ... },
    "resultSchema": [{ "key": "score", "label": "Score", "type": "number" }],
    "sourceHtml": "<full HTML document with inline script using spskill-init>"
  }
}

configSchema field types: string, text, number, boolean, select (with options array), dimensions (array of {id,left,right}), stringList (array of strings), json.
Keep HTML self-contained (inline styles OK).`;

    const messages = [
      { role: 'system', content: systemPrompt + skillContext },
      ...conversationHistory.slice(-6),
      { role: 'user', content: message },
    ];

    const completion = await aiChat(ai, 'strong', {
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 8000,
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    if (!parsed.skill?.sourceHtml) {
      return res.status(500).json({ success: false, error: 'AI did not return valid skill HTML' });
    }

    res.json({
      success: true,
      message: parsed.message || 'Skill generated',
      skill: parsed.skill,
    });
  } catch (error) {
    console.error('generate-skill error:', error);
    res.status(500).json({ success: false, error: formatAiError(error) });
  }
});

// [DEPRECATED] Old API routes - no longer used, replaced by /api/openai/chat

/*
// Generate survey from natural language description
app.post('/api/openai/generate-survey', async (req, res) => {
  try {
    const { description, apiKey } = req.body;
    
    if (!apiKey || !description) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key and description are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Generate a complete survey configuration in JSON format based on the user's description.

The survey must follow this structure:
{
  "title": "Survey Title",
  "description": "Survey description",
  "logo": "",
  "logoPosition": "right",
  "showQuestionNumbers": "off",
  "showProgressBar": "aboveheader",
  "progressBarType": "questions",
  "autoGrowComment": true,
  "theme": {
    "primaryColor": "#474747",
    "primaryLight": "#6a6a6a",
    "primaryDark": "#2e2e2e",
    "secondaryColor": "#ff9814",
    "accentColor": "#e50a3e",
    "successColor": "#19b394",
    "backgroundColor": "#ffffff",
    "cardBackground": "#f8f8f8",
    "headerBackground": "#f3f3f3",
    "textColor": "#000000",
    "secondaryText": "#737373",
    "disabledText": "#737373",
    "borderColor": "#292929",
    "focusBorder": "#437fd9"
  },
  "pages": [...]
}

Available question types:

TEXT-BASED QUESTIONS:
- text: Single-line text input
- comment: Multi-line text area
- radiogroup: Single choice (radio buttons) - needs "choices" array
- checkbox: Multiple choice (checkboxes) - needs "choices" array
- dropdown: Dropdown selection - needs "choices" array
- boolean: Yes/No question
- rating: Rating scale - needs "rateMin" (default 1) and "rateMax" (default 5)
- ranking: Rank items in order - needs "choices" array
- matrix: Matrix/grid question - needs "rows" and "columns" arrays

IMAGE-BASED QUESTIONS (for visual perception surveys):
- imageranking: Rank multiple images in order of preference
  Example:
  {
    "type": "imageranking",
    "name": "street_preference_ranking",
    "title": "Rank these street scenes from most to least appealing",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imagerating: Rate a single or multiple images on a scale
  Example:
  {
    "type": "imagerating",
    "name": "thermal_comfort_rating",
    "title": "How thermally comfortable does this street look?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "rateMin": 1,
    "rateMax": 5,
    "minRateDescription": "Very uncomfortable",
    "maxRateDescription": "Very comfortable",
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imageboolean: Yes/No question about an image
  Example:
  {
    "type": "imageboolean",
    "name": "walkability_assessment",
    "title": "Would you feel safe walking here at night?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imagepicker: Choose one or multiple images from a set
  Example:
  {
    "type": "imagepicker",
    "name": "preferred_street_type",
    "title": "Which street scene do you prefer?",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset
  NOTE: For multiple selection, add "multiSelect": true

- imagematrix: Matrix/grid with images displayed above
  Example:
  {
    "type": "imagematrix",
    "name": "multi_attribute_rating",
    "title": "Rate the following aspects of these street scenes",
    "isRequired": true,
    "imageCount": 3,
    "imageSelectionMode": "huggingface_random",
    "imageLinks": [],
    "rows": [
      {"value": "safety", "text": "Safety"},
      {"value": "aesthetics", "text": "Aesthetics"},
      {"value": "walkability", "text": "Walkability"}
    ],
    "columns": [
      {"value": "1", "text": "Poor"},
      {"value": "2", "text": "Fair"},
      {"value": "3", "text": "Good"},
      {"value": "4", "text": "Excellent"}
    ]
  }
  IMPORTANT: imageLinks array is empty [], images will be randomly selected from Hugging Face dataset

IMPORTANT GUIDELINES FOR STREETSCAPE SURVEYS:

**CRITICAL RULE: No standalone text questions about streetscapes!**
All streetscape-related questions MUST be paired with images. Only socioeconomic/demographic questions can be pure text.

**PAGE COMPOSITION RULES:**
Each page can contain ONE OR MORE of the following combinations:

1. **Socioeconomic questions** (one or more)
   - Pure text questions: text, comment, radiogroup, checkbox, dropdown, rating, ranking, matrix
   - Examples: age, gender, income, education, occupation, background
   - Can have multiple socioeconomic questions on same page

2. **Image-based streetscape questions** (one or more)
   - Use: imagerating, imagepicker, imageranking, imageboolean, imagematrix
   - Examples: "Rate this street's comfort", "Pick your preferred street", "Rank these streets by safety"
   - Can have multiple image-based questions on same page

3. **Image display + text questions** (one image + one or more text questions)
   - Structure: {"type": "image", ...} followed by one or MORE text questions
   - The image and its associated text questions form a BINDING GROUP
   - Example:
   [
     {"type": "image", "name": "street_1", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []},
     {"type": "comment", "name": "description", "title": "Describe this street"},
     {"type": "text", "name": "impression", "title": "What is your first impression?"},
     {"type": "radiogroup", "name": "walkability", "title": "Is this street walkable?", "choices": ["Yes", "No"]}
   ]

**FLEXIBLE MIXING:**
- Combinations 2 and 3 can be intermixed on the same page (both are streetscape questions)
- Example valid page:
  [imagerating question, image display + 2 text questions, imagepicker question, image display + 1 text question]
- Combination 1 (socioeconomic) typically forms separate pages, but can mix with 2/3 if contextually appropriate

**CRITICAL BINDING RULE:**
- Every "image" display MUST be followed by at least ONE text question
- ALL text questions about streets MUST have an "image" display before them
- ❌ WRONG: [image] alone - missing text questions
- ❌ WRONG: [text about street] alone - missing image display
- ❌ WRONG: [image, imagerating, text] - breaks binding
- ✓ CORRECT: [image, text, text] or [image, text, text, imagerating]

**CRITICAL: What type of text question is this?**
- Is it socioeconomic (age, gender, education, occupation, income)? → NO image needed
- Is it about streets/visual perception? → MUST have "image" display before it!

**TECHNICAL REQUIREMENTS:**
- All image questions MUST include: imageSelectionMode: "huggingface_random", imageCount, choices: []
- For imagematrix: use imageLinks: [] instead of choices
- For imagerating: include rateMin, rateMax, minRateDescription, maxRateDescription
- NEVER use "manual" mode

**IMPORTANT: USE DIVERSE QUESTION TYPES!**
Don't always use the same question types. Mix different types to create engaging surveys:

TEXT-BASED OPTIONS (for socioeconomic):
- text, comment, radiogroup, checkbox, dropdown, ranking, rating, boolean, matrix

IMAGE-BASED OPTIONS (for streetscape assessment):
- imagepicker (choice), imageranking (ranking), imagerating (rating), imageboolean (yes/no), imagematrix (multi-criteria)

EXAMPLES OF VARIETY:
- Instead of only imagerating, also use: imagepicker (preference), imageranking (ordering), imageboolean (safety)
- For demographics: mix radiogroup (age), dropdown (education), text (occupation)
- For streetscape text: use comment (description), text (impression), radiogroup (walkability)

**DECISION TREE:**
- Socioeconomic text question? → Pure text (no image needed) - USE VARIETY
- Streetscape rating/ranking/selection? → Image-based question types - USE VARIETY (not just imagerating!)
- Streetscape text question (description/opinion)? → MUST use: image display + text question(s) - USE VARIETY
- ❌ NEVER: Text question about streets without image display in front!

Generate a professional, well-structured survey with appropriate question types. Return ONLY valid JSON, no markdown or explanations.`;

    console.log('🤖 Generating survey with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let surveyConfig = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: description }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 4000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        surveyConfig = JSON.parse(jsonText);
        
        // Validate that it has the expected structure
        if (!surveyConfig.pages || !Array.isArray(surveyConfig.pages)) {
          throw new Error('Invalid survey structure: missing pages array');
        }
        
        // Convert SurveyJS format (questions) to Survey Builder format (elements)
        surveyConfig.pages = surveyConfig.pages.map((page, index) => ({
          name: page.name || `page_${index + 1}`,
          title: page.title || `Page ${index + 1}`,
          description: page.description || "",
          elements: page.questions || page.elements || []
        }));
        
        console.log('✅ Survey generated successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!surveyConfig) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, surveyConfig });
  } catch (error) {
    console.error('❌ Error generating survey:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate survey' 
    });
  }
});

// Adjust existing survey based on instructions
app.post('/api/openai/adjust-survey', async (req, res) => {
  try {
    const { currentConfig, instruction, apiKey } = req.body;
    
    if (!apiKey || !currentConfig || !instruction) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key, current config, and instruction are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Modify the provided survey configuration according to the user's instructions.

**CRITICAL RULE: No standalone streetscape text questions!**

**PAGE COMPOSITION (each page can have one or more):**
1. Socioeconomic text questions (multiple allowed): age, gender, education, occupation - NO image needed
2. Image-based streetscape questions (multiple allowed): imagerating, imagepicker, imageranking, imageboolean, imagematrix
3. Image display + text questions (multiple groups allowed): "image" + one or MORE text questions

**CRITICAL: ALL non-socioeconomic text questions MUST have "image" display before them!**
- Socioeconomic text (age, gender, education, occupation) → NO image needed
- Streetscape text (description, opinion, observation) → MUST have "image" before it

**FLEXIBLE MIXING:**
- Types 2 and 3 can intermix on same page
- Example: [imagerating, image+text+text, imagepicker, image+text]

**BINDING RULE:**
- Every "image" MUST be followed by at least ONE text question
- ❌ WRONG: [image] alone or [text about street] alone or [image, imagerating, text]
- ✓ CORRECT: [image, text, text, imagerating]

**TECHNICAL:**
- All image questions: imageSelectionMode: "huggingface_random", imageCount, choices: []
- imagerating: rateMin, rateMax, minRateDescription, maxRateDescription

**USE DIVERSE QUESTION TYPES:**
- Don't always use imagerating - also consider: imagepicker, imageranking, imageboolean, imagematrix
- For text questions: mix radiogroup, dropdown, text, comment, checkbox
- Create variety to keep survey engaging

Return COMPLETE modified survey. ONLY valid JSON, no markdown.`;

    const userPrompt = `Current survey configuration:
${JSON.stringify(currentConfig, null, 2)}

User instruction: ${instruction}

Please return the complete modified survey configuration.`;

    console.log('🤖 Adjusting survey with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let surveyConfig = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.5,
          max_tokens: 4000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        surveyConfig = JSON.parse(jsonText);
        
        // Validate that it has the expected structure
        if (!surveyConfig.pages || !Array.isArray(surveyConfig.pages)) {
          throw new Error('Invalid survey structure: missing pages array');
        }
        
        // Convert SurveyJS format (questions) to Survey Builder format (elements)
        surveyConfig.pages = surveyConfig.pages.map((page, index) => ({
          name: page.name || `page_${index + 1}`,
          title: page.title || `Page ${index + 1}`,
          description: page.description || "",
          elements: page.questions || page.elements || []
        }));
        
        console.log('✅ Survey adjusted successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!surveyConfig) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, surveyConfig });
  } catch (error) {
    console.error('❌ Error adjusting survey:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to adjust survey' 
    });
  }
});

// Generate questions for a page
app.post('/api/openai/generate-questions', async (req, res) => {
  try {
    const { pageDescription, apiKey } = req.body;
    
    if (!apiKey || !pageDescription) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key and page description are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Generate survey questions in JSON array format based on the description.

**CRITICAL RULE: No standalone streetscape text questions!**

**QUESTION COMBINATIONS (can generate one or more):**
1. Socioeconomic text questions (multiple allowed): age, gender, education, occupation - NO image needed
2. Image-based streetscape questions (multiple allowed): imagerating, imagepicker, imageranking, imageboolean, imagematrix
3. Image display + text questions (multiple groups allowed): "image" + one or MORE text questions

**CRITICAL: ALL non-socioeconomic text questions MUST have "image" before them!**
- Text about age/gender/education/occupation → NO image needed
- Text about streets (description, opinion, observation) → MUST have "image" before it

**FLEXIBLE MIXING:**
- Types 2 and 3 can be mixed in same array
- Example: [imagerating, image, text, text, imagepicker, image, text]

**BINDING RULE:**
- Every "image" MUST be followed by at least ONE text question
- ❌ WRONG: [image] alone or [text about street] alone
- ✓ CORRECT: [image, text] or [image, text, text]

**USE DIVERSE QUESTION TYPES:**
- Mix different types: imagepicker, imageranking, imagerating, imageboolean, imagematrix
- Don't generate only imagerating questions
- For text: vary between comment, text, radiogroup, checkbox, dropdown
- Create engaging variety in your questions

═══════════════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════════════

IMAGE-BASED QUESTION EXAMPLES:
[
  {
    "type": "imagepicker",
    "name": "street_preference",
    "title": "Which street scene do you prefer?",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imagerating",
    "name": "street_comfort",
    "title": "How comfortable does this street look?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "rateMin": 1,
    "rateMax": 5,
    "minRateDescription": "Not comfortable",
    "maxRateDescription": "Very comfortable",
    "choices": []
  },
  {
    "type": "imageranking",
    "name": "preference_rank",
    "title": "Rank these streets by preference",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imageboolean",
    "name": "safe_to_walk",
    "title": "Would you feel safe walking here?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imagematrix",
    "name": "multi_assessment",
    "title": "Rate these aspects",
    "isRequired": true,
    "imageCount": 2,
    "imageSelectionMode": "huggingface_random",
    "imageLinks": [],
    "rows": [
      {"value": "safety", "text": "Safety"},
      {"value": "comfort", "text": "Comfort"}
    ],
    "columns": [
      {"value": "1", "text": "Low"},
      {"value": "2", "text": "Medium"},
      {"value": "3", "text": "High"}
    ]
  }
]

SHOW IMAGE + TEXT QUESTION EXAMPLE:
⚠️ CRITICAL: Both questions MUST be returned together (for same page)
[
  {
    "type": "image",
    "name": "street_ref_1",
    "imageSelectionMode": "huggingface_random",
    "imageCount": 1,
    "choices": []
  },
  {
    "type": "comment",
    "name": "describe_street",
    "title": "Describe what you see in this street scene",
    "isRequired": true
  }
]
CRITICAL: When generating streetscape descriptions, ALWAYS return BOTH "image" and text question together!

RULES:
- ALL image questions MUST include: imageSelectionMode: "huggingface_random", imageCount, randomImageSelection: true, choices: []
- imagerating MUST include: rateMin, rateMax, minRateDescription, maxRateDescription
- For imagematrix: use imageLinks: [] instead of choices
- NEVER use "manual" mode or provide imageLink URLs
- NEVER generate streetscape text questions without paired images

DECISION TREE:
- Demographics (age, gender, education)? → Pure text questions
- Streetscape visual assessment? → Image-based question types (imagerating, imagepicker, etc.)
- Streetscape description needed? → "image" display + text question (BOTH together!)
- ❌ NEVER: Text question about streets without showing street images

Return ONLY a JSON array of questions, no markdown.`;

    console.log('🤖 Generating questions with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let questions = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Generate questions for: ${pageDescription}. Return a JSON object with a "questions" array.` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 2000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        const parsed = JSON.parse(jsonText);
        
        // Handle both array and object with questions array
        if (Array.isArray(parsed)) {
          questions = parsed;
        } else if (parsed.questions && Array.isArray(parsed.questions)) {
          questions = parsed.questions;
        } else {
          throw new Error('Invalid questions structure: expected array or object with questions array');
        }
        
        console.log('✅ Questions generated successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!questions) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, questions });
  } catch (error) {
    console.error('❌ Error generating questions:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate questions' 
    });
  }
});
*/

/**
 * Multi-Agent Review with SSE (Server-Sent Events) for streaming output
 * Allows real-time display of each agent's feedback as it's generated
 */
app.get('/api/openai/multi-agent-review-stream', async (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendEvent = (eventType, data) => {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  try {
    const { surveyConfig, apiKey, mode = '1v1', maxRounds: maxRoundsParam, customAgents: customAgentsParam, userRequest, researchContext: researchContextParam } = req.query;
    
    if (!apiKey || !surveyConfig) {
      sendEvent('error', { message: 'Missing required parameters' });
      res.end();
      return;
    }
    
    // Parse research context if provided
    const researchContext = researchContextParam ? JSON.parse(researchContextParam) : null;
    
    // Use custom maxRounds or default to REVIEW_CONFIG.maxRounds
    const maxRounds = maxRoundsParam ? parseInt(maxRoundsParam, 10) : REVIEW_CONFIG.maxRounds;
    
    // Use custom agents if provided, otherwise use default AGENTS
    const agentsConfig = customAgentsParam ? JSON.parse(customAgentsParam) : AGENTS;
    
    const config = JSON.parse(surveyConfig);
    const openai = new OpenAI({ apiKey });
    const agentIds = Object.keys(agentsConfig);
    const reviewHistory = [];
    let currentRound = 1;
    let currentConfig = config;
    
    // Decode and store user's original request for reference throughout review rounds
    const userOriginalRequest = userRequest ? decodeURIComponent(userRequest) : null;
    
    sendEvent('start', { totalAgents: agentIds.length, mode, maxRounds });
    
    while (currentRound <= maxRounds) {
      sendEvent('round-start', { round: currentRound });
      
      const roundReviews = [];
      
      // Stream each agent's review
      for (const agentId of agentIds) {
        const agent = agentsConfig[agentId];
        sendEvent('agent-start', { agentId, name: agent.name, emoji: agent.emoji });
        
        try {
          const systemPrompt = getAgentSystemPrompt(agentId, currentConfig, mode === 'group' ? 'group' : 'individual', agentsConfig);
          const userPrompt = mode === '1v1' 
            ? generate1v1ReviewPrompt(agentId, currentConfig, currentRound, agentsConfig, userOriginalRequest, researchContext)
            : generateGroupDiscussionPrompt(currentConfig, roundReviews, currentRound, agentsConfig, userOriginalRequest, researchContext);
          
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: mode === 'group' ? 0.8 : 0.7,
            max_tokens: mode === 'group' ? 800 : 1000
          });
          
          const review = JSON.parse(completion.choices[0].message.content.trim());
          review.agentId = agentId;
          roundReviews.push(review);
          
          // Stream the formatted review immediately
          const formattedReview = formatReviewForChat(agentId, review, currentRound);
          sendEvent('agent-review', {
            agentId,
            name: agent.name,
            emoji: agent.emoji,
            review,
            formatted: formattedReview,
            round: currentRound
          });
          
        } catch (error) {
          sendEvent('agent-error', { agentId, name: agent.name, error: error.message });
        }
      }
      
      // Consolidate and stream feedback
      const consolidated = consolidateReviews(roundReviews);
      reviewHistory.push({ round: currentRound, reviews: roundReviews, consolidated });
      
      const consolidatedFormatted = formatConsolidatedFeedback(consolidated, currentRound);
      sendEvent('round-summary', {
        round: currentRound,
        consolidated,
        formatted: consolidatedFormatted
      });
      
      // Check termination
      const termination = shouldTerminateReview(currentRound, consolidated, reviewHistory.map(h => h.consolidated), maxRounds);
      
      if (termination.terminate) {
        sendEvent('complete', {
          reason: termination.reason,
          totalRounds: currentRound,
          finalRating: consolidated.averageRating,
          finalVerdict: consolidated.overallVerdict,
          approved: consolidated.overallVerdict === 'approve',
          surveyConfig: currentConfig
        });
        res.end();
        return;
      }
      
      // Need revision
      if (consolidated.needsRevision) {
        sendEvent('revision-start', { round: currentRound });
        
        console.log('🧠 Starting Chain of Thoughts revision...');
        
        // Step 1: Understand expert feedback
        console.log('📋 Step 1: Understanding expert feedback...');
        const feedbackSummary = roundReviews.map(r => `${agentsConfig[r.agentId].name}: ${r.verdict}`).join(', ');
        
        const revStep1Prompt = `Analyze the expert feedback from multi-agent review:

Experts: ${feedbackSummary}
Top Concerns: ${consolidated.topConcerns.join('; ')}
Top Suggestions: ${consolidated.topSuggestions.join('; ')}

Summarize:
1. What are the critical issues that multiple experts identified?
2. What are the priorities for revision?
3. What should be the revision strategy?`;

        const revStep1Completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a survey revision strategist. Analyze expert feedback." },
            { role: "user", content: revStep1Prompt }
          ],
          temperature: 0.7,
          max_tokens: 500
        });
        
        const revStep1Analysis = revStep1Completion.choices[0].message.content.trim();
        sendEvent('revision-thinking', { step: 1, content: revStep1Analysis });
        console.log('✅ Revision Step 1 complete');
        
        // Step 2: Plan specific changes
        console.log('📐 Step 2: Planning specific changes...');
        const revStep2Prompt = `Based on this feedback analysis:

${revStep1Analysis}

Plan specific changes:
1. Which pages/questions need modification?
2. What specific changes to make?
3. What is the priority order?`;

        const revStep2Completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a survey revision planner. Plan specific changes." },
            { role: "user", content: revStep2Prompt }
          ],
          temperature: 0.7,
          max_tokens: 800
        });
        
        const revStep2Plan = revStep2Completion.choices[0].message.content.trim();
        sendEvent('revision-thinking', { step: 2, content: revStep2Plan });
        console.log('✅ Revision Step 2 complete');
        
        // Step 3: Execute revision
        console.log('🔨 Step 3: Executing revision...');
        const revisionPrompt = generateRevisionPrompt(consolidated, roundReviews, agentsConfig, userOriginalRequest, researchContext);
        const revStep3Prompt = `Based on this analysis and plan:

FEEDBACK ANALYSIS:
${revStep1Analysis}

REVISION PLAN:
${revStep2Plan}

DETAILED EXPERT FEEDBACK:
${revisionPrompt}

Now revise the survey configuration.`;
        
        try {
          // Load prompts configuration
          const { PROMPTS } = require('./prompts.config.js');
          
          const revisionCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: PROMPTS.revision },
              { role: "system", content: `Current survey:\n${JSON.stringify(currentConfig, null, 2)}` },
              { role: "user", content: revStep3Prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.6,
            max_tokens: 4000
          });
          
          const revisedConfig = JSON.parse(revisionCompletion.choices[0].message.content.trim());
          
          if (revisedConfig.pages) {
            revisedConfig.pages = revisedConfig.pages.map((page, index) => ({
              name: page.name || `page_${index + 1}`,
              title: page.title || `Page ${index + 1}`,
              description: page.description || "",
              elements: page.questions || page.elements || []
            }));
          }
          
          currentConfig = revisedConfig;
          
          console.log('✅ Revision Step 3 complete');
          sendEvent('revision-complete', { 
            round: currentRound, 
            surveyConfig: currentConfig,
            chainOfThoughts: {
              step1_understanding: revStep1Analysis,
              step2_planning: revStep2Plan,
              step3_execution: 'Survey revised based on expert feedback'
            }
          });
          
        } catch (error) {
          sendEvent('revision-error', { error: error.message });
          sendEvent('complete', {
            reason: 'Revision failed',
            totalRounds: currentRound,
            error: error.message,
            surveyConfig: currentConfig
          });
          res.end();
          return;
        }
      }
      
      currentRound++;
    }
    
    // Max rounds reached
    const lastConsolidated = reviewHistory[reviewHistory.length - 1]?.consolidated;
    sendEvent('complete', {
      reason: 'Maximum rounds reached',
      totalRounds: currentRound - 1,
      finalRating: lastConsolidated?.averageRating,
      finalVerdict: lastConsolidated?.overallVerdict,
      approved: false,
      surveyConfig: currentConfig
    });
    
  } catch (error) {
    sendEvent('error', { message: error.message });
  }
  
  res.end();
});

// Intelligent routing for chat-style interaction
app.post('/api/openai/chat', async (req, res) => {
  try {
    const { message, currentConfig, conversationHistory, apiKey, customPrompts, researchContext } = req.body;
    
    if (!apiKey || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key and message are required'
      });
    }
    
    // Load default prompts from shared config
    const { PROMPTS: defaultPrompts } = require('./prompts.config.js');
    
    // Merge custom prompts with defaults
    const prompts = customPrompts ? { ...defaultPrompts, ...customPrompts } : defaultPrompts;
    
    // Build research context section if available
    let researchContextSection = '';
    if (researchContext && (researchContext.topic || researchContext.requirements || researchContext.scenario)) {
      researchContextSection = '\n\n**RESEARCH CONTEXT:**\n';
      if (researchContext.topic) {
        researchContextSection += `Research Topic: ${researchContext.topic}\n`;
      }
      if (researchContext.requirements) {
        researchContextSection += `Research Requirements: ${researchContext.requirements}\n`;
      }
      if (researchContext.scenario) {
        researchContextSection += `Survey Scenario Type: ${researchContext.scenario}\n`;
      }
      researchContextSection += '\n**CRITICAL: The survey MUST align with this research context!**\n';
      console.log('🔬 Research context will be included:', researchContext);
    }
    
    const openai = new OpenAI({ apiKey });
    
    // Step 1: Determine user intent using configured prompt
    console.log('🧠 Analyzing user intent...');
    
    // Add context information to the intent detection
    const contextInfo = `\n\nCurrent context:
- User ${currentConfig && currentConfig.pages ? 'HAS' : 'DOES NOT HAVE'} an existing survey configuration
- Existing survey has ${currentConfig?.pages?.length || 0} pages`;
    
    const intentCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompts.intentDetection + contextInfo },
        { role: "user", content: message }
      ],
      temperature: 0.3,
      max_tokens: 10
    });
    
    const intent = intentCompletion.choices[0].message.content.trim().toLowerCase();
    console.log(`🎯 Detected intent: ${intent}`);
    
    // Step 1.5: Extract/Update Research Context from user message
    console.log('🔬 Extracting research context...');
    let updatedResearchContext = researchContext || {};
    
    try {
      const extractPrompt = `Analyze this user message and extract research context information:

User Message: "${message}"
${researchContext && researchContext.topic ? `\nCurrent Research Topic: ${researchContext.topic}` : ''}
${researchContext && researchContext.requirements ? `\nCurrent Research Requirements: ${researchContext.requirements}` : ''}
${researchContext && researchContext.scenario ? `\nCurrent Survey Scenario: ${researchContext.scenario}` : ''}

Extract or update:
1. Research Topic (main research subject, 1 sentence)
2. Research Requirements (key requirements for survey design, 1-2 sentences)
3. Survey Scenario (one of: general purpose, street view, building facade, window view, aerial view, or identify a new scenario type)

Return JSON:
{
  "topic": "...",
  "requirements": "...",
  "scenario": "...",
  "hasResearchInfo": true/false
}

If the user message doesn't contain research information, set hasResearchInfo to false and keep existing values.`;

      const extractCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an expert at extracting research context from user requests. Be concise and accurate." },
          { role: "user", content: extractPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 300
      });
      
      const extractedContext = JSON.parse(extractCompletion.choices[0].message.content.trim());
      
      if (extractedContext.hasResearchInfo) {
        // Update research context
        updatedResearchContext = {
          topic: extractedContext.topic || updatedResearchContext.topic || '',
          requirements: extractedContext.requirements || updatedResearchContext.requirements || '',
          scenario: extractedContext.scenario || updatedResearchContext.scenario || 'street view',
          customScenarios: updatedResearchContext.customScenarios || []
        };
        console.log('✅ Research context extracted:', updatedResearchContext);
        
        // Rebuild research context section with updated info
        researchContextSection = '\n\n**RESEARCH CONTEXT:**\n';
        if (updatedResearchContext.topic) {
          researchContextSection += `Research Topic: ${updatedResearchContext.topic}\n`;
        }
        if (updatedResearchContext.requirements) {
          researchContextSection += `Research Requirements: ${updatedResearchContext.requirements}\n`;
        }
        if (updatedResearchContext.scenario) {
          researchContextSection += `Survey Scenario Type: ${updatedResearchContext.scenario}\n`;
        }
        researchContextSection += '\n**CRITICAL: The survey MUST align with this research context!**\n';
      } else {
        console.log('ℹ️  No new research information in this message');
      }
    } catch (extractError) {
      console.warn('⚠️  Research context extraction failed:', extractError.message);
    }
    
    // Step 2: Route based on intent
    if (intent === 'generate') {
      // Generate new survey with Chain of Thoughts (3 steps)
      console.log('🧠 Starting Chain of Thoughts generation...');
      
      // Step 1: Think about research topic and questions
      console.log('📋 Step 1: Analyzing research topic and questions...');
      const step1Prompt = `Based on the user's request, first analyze:
1. What is the core research topic?
2. What are the main research questions to answer?
3. What is the target audience?

User request: "${message}"

Provide a brief analysis (2-3 sentences for each point).`;

      const step1Completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompts.generate },
          { role: "user", content: step1Prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      const step1Analysis = step1Completion.choices[0].message.content.trim();
      console.log('✅ Step 1 complete');
      
      // Step 2: Plan survey structure
      console.log('📐 Step 2: Planning survey structure...');
      const step2Prompt = `Based on this research analysis:

${step1Analysis}

Now plan the survey structure:
1. How many pages should the survey have?
2. What is the purpose of each page?
3. What types of questions should be on each page?
4. How many questions per page?

Provide a structured plan with page-by-page breakdown.`;

      const step2Completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompts.generate },
          { role: "user", content: step2Prompt }
        ],
        temperature: 0.7,
        max_tokens: 800
      });
      
      const step2Plan = step2Completion.choices[0].message.content.trim();
      console.log('✅ Step 2 complete');
      
      // Step 3: Generate actual survey configuration
      console.log('🔨 Step 3: Generating survey configuration...');
      const step3Prompt = `Based on this research analysis and survey plan:

RESEARCH ANALYSIS:
${step1Analysis}

SURVEY STRUCTURE PLAN:
${step2Plan}

USER REQUEST:
${message}

Now generate the complete survey configuration following all the rules and examples provided.`;

      const systemPrompt = prompts.generate + researchContextSection;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: step3Prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4000
      });
      
      const responseText = completion.choices[0].message.content.trim();
      let surveyConfig = JSON.parse(responseText);
      
      // Convert SurveyJS format (questions) to Survey Builder format (elements)
      if (surveyConfig.pages) {
        surveyConfig.pages = surveyConfig.pages.map((page, index) => ({
          name: page.name || `page_${index + 1}`,
          title: page.title || `Page ${index + 1}`,
          description: page.description || "",
          elements: page.questions || page.elements || []
        }));
      }
      
      console.log('✅ Step 3 complete - Survey generated');
      
      res.json({ 
        success: true, 
        intent: 'generate',
        surveyConfig,
        message: `Generated new survey with ${surveyConfig.pages?.length || 0} pages`,
        researchContext: updatedResearchContext,
        chainOfThoughts: {
          step1_research: step1Analysis,
          step2_structure: step2Plan,
          step3_generation: 'Survey configuration generated'
        }
      });
      
    } else if (intent === 'adjust') {
      // Adjust existing survey with Chain of Thoughts (3 steps)
      if (!currentConfig || !currentConfig.pages) {
        return res.json({
          success: true,
          intent: 'question',
          message: "You don't have an existing survey yet. Would you like me to generate one? Please describe what kind of survey you need.",
          requiresGenerate: true
        });
      }
      
      console.log('🧠 Starting Chain of Thoughts adjustment...');
      
      // Step 1: Understand adjustment goal
      console.log('📋 Step 1: Understanding adjustment goal...');
      const currentSummary = `Current survey has ${currentConfig.pages.length} pages with ${currentConfig.pages.reduce((sum, p) => sum + (p.elements?.length || 0), 0)} total questions.`;
      
      const step1Prompt = `Analyze the user's adjustment request for an existing survey:

Current Survey Summary: ${currentSummary}

User Request: "${message}"

Analyze:
1. What is the user trying to achieve with this adjustment?
2. What aspects of the survey need to change (structure, questions, content)?
3. What should be preserved from the current survey?

Provide a brief analysis.`;

      const step1Completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompts.adjust },
          { role: "user", content: step1Prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      const step1Analysis = step1Completion.choices[0].message.content.trim();
      console.log('✅ Step 1 complete');
      
      // Step 2: Plan the adjustments
      console.log('📐 Step 2: Planning adjustments...');
      const step2Prompt = `Based on this analysis:

${step1Analysis}

Current Survey: ${currentConfig.pages.length} pages

Plan the specific adjustments:
1. Which pages need to be modified, added, or removed?
2. Which questions need to be changed, added, or removed?
3. What is the new structure after adjustments?
4. How many pages and questions in the final version?

Provide a detailed adjustment plan.`;

      const step2Completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompts.adjust },
          { role: "user", content: step2Prompt }
        ],
        temperature: 0.7,
        max_tokens: 800
      });
      
      const step2Plan = step2Completion.choices[0].message.content.trim();
      console.log('✅ Step 2 complete');
      
      // Step 3: Execute the adjustments
      console.log('🔨 Step 3: Executing adjustments...');
      const step3Prompt = `Based on this analysis and adjustment plan:

ADJUSTMENT ANALYSIS:
${step1Analysis}

ADJUSTMENT PLAN:
${step2Plan}

USER REQUEST:
${message}

Now adjust the survey configuration following all the rules and maintaining consistency.`;

      const systemPrompt = prompts.adjust + researchContextSection;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "system", content: `Current survey configuration:\n${JSON.stringify(currentConfig, null, 2)}` },
          { role: "user", content: step3Prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 4000
      });
      
      const responseText = completion.choices[0].message.content.trim();
      let surveyConfig = JSON.parse(responseText);
      
      // Convert SurveyJS format (questions) to Survey Builder format (elements)
      if (surveyConfig.pages) {
        surveyConfig.pages = surveyConfig.pages.map((page, index) => ({
          name: page.name || `page_${index + 1}`,
          title: page.title || `Page ${index + 1}`,
          description: page.description || "",
          elements: page.questions || page.elements || []
        }));
      }
      
      console.log('✅ Step 3 complete - Survey adjusted');
      
      res.json({ 
        success: true, 
        intent: 'adjust',
        surveyConfig,
        message: `Adjusted survey based on your request`,
        researchContext: updatedResearchContext,
        chainOfThoughts: {
          step1_understanding: step1Analysis,
          step2_planning: step2Plan,
          step3_execution: 'Survey adjustments applied'
        }
      });
      
    } else {
      // Answer question
      const systemPrompt = prompts.question + researchContextSection;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...(conversationHistory || []),
          { role: "user", content: message }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      const answer = completion.choices[0].message.content.trim();
      
      res.json({ 
        success: true, 
        intent: 'question',
        message: answer,
        researchContext: updatedResearchContext
      });
    }
    
  } catch (error) {
    console.error('❌ Error in chat routing:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to process chat message' 
    });
  }
});

function extractFalMaskUrl(result) {
  if (!result) return null;
  if (typeof result.image?.url === 'string') return result.image.url;
  if (typeof result.mask?.url === 'string') return result.mask.url;
  if (Array.isArray(result.masks) && result.masks[0]?.url) return result.masks[0].url;
  if (Array.isArray(result.images) && result.images[0]?.url) return result.images[0].url;
  if (typeof result.url === 'string') return result.url;
  return null;
}

// POST /api/inference/test
app.post('/api/inference/test', async (req, res) => {
  try {
    const falKey = String(req.body?.falKey || '').trim();
    if (!falKey) return res.status(400).json({ success: false, error: 'falKey is required' });

    // Lightweight auth check (does not run a model / spend credits)
    const falRes = await fetch('https://api.fal.ai/v1/models?limit=1', {
      headers: { Authorization: `Key ${falKey}` },
    });
    const text = await falRes.text();
    let detail = '';
    try {
      const body = JSON.parse(text);
      detail = body?.detail || body?.error || body?.message || '';
      if (Array.isArray(detail)) detail = detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
    } catch {
      detail = text.slice(0, 300);
    }

    if (falRes.status === 401) {
      return res.status(401).json({
        success: false,
        error: detail || 'Invalid fal API key (401). Use the full key from fal.ai/dashboard/keys (id:secret).',
      });
    }
    if (falRes.status === 403) {
      // Key may be valid but lack platform-API scope — still try a tiny model ping
      const ping = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'ping', model: 'google/gemini-flash-1.5' }),
      });
      if (ping.status === 401) {
        return res.status(401).json({
          success: false,
          error: 'Invalid fal API key. Check you copied the full key (key_id:key_secret).',
        });
      }
      // 400/422/402/etc. mean the key authenticated
      return res.json({ success: true, status: ping.status, note: 'Key accepted by fal.run' });
    }
    if (!falRes.ok && falRes.status >= 500) {
      return res.status(502).json({ success: false, error: detail || `fal server error (${falRes.status})` });
    }
    return res.json({ success: true, status: falRes.status });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/inference/sam3
app.post('/api/inference/sam3', async (req, res) => {
  try {
    let { falKey, imageUrl, prompt, points, box, projectId } = req.body || {};
    if (!falKey && projectId) {
      try {
        const projectPath = path.join(PROJECTS_PATH, `${projectId}.json`);
        if (fs.existsSync(projectPath)) {
          const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
          falKey = proj.imageDatasetConfig?.falApiKey || proj.image_dataset_config?.falApiKey;
        }
      } catch (_) { /* ignore */ }
    }
    if (!falKey) return res.status(400).json({ success: false, error: 'falKey is required (or configure falApiKey on the project)' });
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl is required' });
    const input = { image_url: imageUrl };
    if (prompt) input.prompt = prompt;
    if (points?.length) {
      input.point_prompts = points.map((p) => ({
        x: p.x, y: p.y, label: p.label === 0 ? 0 : 1,
      }));
    }
    if (box) {
      input.box_prompts = [{ x_min: box.x1, y_min: box.y1, x_max: box.x2, y_max: box.y2 }];
    }
    const falRes = await fetch('https://fal.run/fal-ai/sam-3/image', {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const text = await falRes.text();
    let result;
    try { result = JSON.parse(text); } catch {
      return res.status(502).json({ success: false, error: text || `fal HTTP ${falRes.status}` });
    }
    if (!falRes.ok) {
      return res.status(falRes.status === 401 ? 401 : 502).json({
        success: false,
        error: result?.detail || result?.error || result?.message || `fal HTTP ${falRes.status}`,
      });
    }
    return res.json({ success: true, maskUrl: extractFalMaskUrl(result), raw: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/inference/streetscape-seg
// SegFormer Cityscapes via HuggingFace Inference (ONE pass per image — not SAM3).
app.post('/api/inference/streetscape-seg', async (req, res) => {
  try {
    let { hfToken, imageUrl, projectId } = req.body || {};
    hfToken = String(hfToken || '').trim();
    if (!hfToken && projectId) {
      try {
        const projectPath = path.join(PROJECTS_PATH, `${projectId}.json`);
        if (fs.existsSync(projectPath)) {
          const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
          const cfg = proj.imageDatasetConfig || proj.image_dataset_config || {};
          hfToken = cfg.huggingFaceToken || cfg.huggingfaceToken || '';
        }
      } catch (_) { /* ignore */ }
    }
    if (!hfToken) {
      return res.status(400).json({
        success: false,
        error: 'HuggingFace token required for SegFormer streetscape seg. Set it in Media Dataset → HuggingFace section.',
      });
    }
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl is required' });

    const HF_MODEL = 'nvidia/segformer-b0-finetuned-cityscapes-1024-1024';
    const endpoints = [
      `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`,
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    ];

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return res.status(400).json({ success: false, error: `Failed to fetch image (${imgRes.status})` });
    }
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

    let lastErr = '';
    let segments = null;
    for (const endpoint of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const hfRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': contentType,
          Accept: 'application/json',
        },
        body: imgBuf,
      });
      const text = await hfRes.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = text.slice(0, 300) || `HF HTTP ${hfRes.status}`;
        continue;
      }
      if (hfRes.status === 503 && parsed?.estimated_time) {
        return res.status(503).json({
          success: false,
          error: `Model is loading on HuggingFace (~${Math.ceil(parsed.estimated_time)}s). Retry in a moment.`,
        });
      }
      if (!hfRes.ok) {
        lastErr = parsed?.error || parsed?.message || `HF HTTP ${hfRes.status}`;
        if (hfRes.status === 401 || hfRes.status === 403) {
          return res.status(401).json({ success: false, error: lastErr || 'Invalid HuggingFace token' });
        }
        continue;
      }
      if (!Array.isArray(parsed)) {
        lastErr = 'Unexpected HF response (expected segment list)';
        continue;
      }
      segments = parsed;
      break;
    }

    if (!segments) {
      return res.status(502).json({ success: false, error: lastErr || 'SegFormer request failed' });
    }

    const masks = {};
    const labels = [];
    for (const seg of segments) {
      const label = seg.label || seg.class || '';
      if (!label) continue;
      labels.push(label);
      const m = seg.mask;
      if (!m) masks[label] = null;
      else if (typeof m === 'string' && m.startsWith('data:')) masks[label] = m;
      else if (typeof m === 'string') masks[label] = `data:image/png;base64,${m}`;
      else masks[label] = null;
    }

    return res.json({
      success: true,
      model: HF_MODEL,
      masks,
      labels,
      vocab: labels,
      compute_runtime: 'hf_segformer_cityscapes',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 File management server running on http://localhost:${PORT}`);
  console.log(`📁 Templates directory: ${TEMPLATES_PATH}`);
  console.log(`📁 Projects directory: ${PROJECTS_PATH}`);
  console.log(`📁 Deployments directory: ${DEPLOYMENTS_PATH}`);
  console.log(`🤖 OpenAI integration enabled`);
});
