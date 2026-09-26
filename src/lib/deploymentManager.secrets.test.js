import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { copyParticipantPublicAssets, shouldCopyPublicEntry } from '../server/deploymentPublicFilter';
import {
  buildParticipantDeploymentConfig,
  generateDeploymentFiles,
  isPrivilegedSupabaseKey,
  prepareDeploymentFolder,
  resolveParticipantSourceConfig,
} from './deploymentManager';

const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fakeJwt = (role) => `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ role, ref: 'fakeproject' })}.FAKE_SIGNATURE_${role}`;

const SERVICE_ROLE_KEY = fakeJwt('service_role');
const ANON_KEY = fakeJwt('anon');

const SECRETS = {
  serviceRole: SERVICE_ROLE_KEY,
  supabaseConfigServiceRole: 'FAKE_SUPABASE_CONFIG_SERVICE_ROLE_7f3a',
  huggingFace: 'hf_FAKEHuggingFaceToken0123456789',
  fal: 'FAKE_FAL_KEY_1a2b3c:4d5e6f',
  falApi: 'FAKE_FAL_API_KEY_9z8y7x',
  openai: 'sk-FAKEopenaiKey0123456789abcdef',
  openrouter: 'sk-or-v1-FAKEopenrouterKey0123456789',
  nestedApiKey: 'FAKE_NESTED_ELEMENT_API_KEY',
  password: 'FAKE_PASSWORD_hunter2',
  accessKeyId: 'FAKE_ACCESS_KEY_ID_AKIA000',
  secretAccessKey: 'FAKE_SECRET_ACCESS_KEY_wJalr',
};

const MEDIA_URL = 'https://fakeproject.supabase.co/storage/v1/object/public/media/image_000001.jpg';

const buildProjectWithSecrets = () => ({
  id: 'proj_fake',
  name: 'Secret Leak Probe',
  description: 'Researcher notes',
  createdAt: '2026-01-01T00:00:00.000Z',
  supabaseConfig: {
    url: 'https://fakeproject.supabase.co',
    serviceRoleKey: SECRETS.supabaseConfigServiceRole,
  },
  imageDatasetConfig: {
    enabled: true,
    datasetName: 'someone/private-dataset',
    huggingFaceToken: SECRETS.huggingFace,
    supabaseUrl: 'https://fakeproject.supabase.co',
    supabaseKey: SECRETS.serviceRole,
    supabaseAnonKey: ANON_KEY,
    falApiKey: SECRETS.falApi,
  },
  falKey: SECRETS.fal,
  openaiApiKey: SECRETS.openai,
  openRouterApiKey: SECRETS.openrouter,
  storage: { accessKeyId: SECRETS.accessKeyId, secretAccessKey: SECRETS.secretAccessKey },
  includeResearcherPractice: true,
  preloadedImages: [{ name: 'image_000001.jpg', url: MEDIA_URL, folder: 'set-a' }],
  title: 'Street perception',
  showProgressBar: 'top',
  completedHtml: '<h3>Thanks</h3>',
  theme: { primaryColor: '#123456' },
  pages: [{
    name: 'page1',
    elements: [
      { type: 'imagerating', name: 'safety', randomImageSelection: true, imageCount: 1, apiKey: SECRETS.nestedApiKey },
      { type: 'text', name: 'code', inputType: 'password', password: SECRETS.password },
    ],
  }],
});

const listFiles = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
};

const findLeaks = async (root) => {
  const leaks = [];
  for (const file of await listFiles(root)) {
    const content = await fs.readFile(file, 'utf8');
    Object.entries(SECRETS).forEach(([label, secret]) => {
      if (content.includes(secret)) leaks.push(`${label} in ${path.relative(root, file)}`);
    });
  }
  return leaks;
};

const readDeploymentConfig = (files) => {
  const source = files['src/config/deploymentConfig.js'];
  const json = source.match(/export const deploymentConfig = ([\s\S]*?);\n\nexport const getPreloadedImages/)[1];
  return JSON.parse(json);
};

describe('participant deployment never ships credentials', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-deploy-secrets-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    delete global.fetch;
  });

  test('generated deployment folder contains no secrets from the project or local public data', async () => {
    const project = buildProjectWithSecrets();

    let postedFiles = null;
    global.fetch = jest.fn(async (url, options) => {
      postedFiles = JSON.parse(options.body).files;
      return { ok: true, json: async () => ({ deploymentPath: path.join(tempDir, 'deployment') }) };
    });
    const result = await prepareDeploymentFolder(project);
    expect(result.success).toBe(true);
    expect(postedFiles).toBeTruthy();

    const publicPath = path.join(tempDir, 'public');
    await fs.outputFile(path.join(publicPath, 'index.html'), '<div id="root"></div>');
    await fs.outputFile(path.join(publicPath, 'manifest.json'), '{"short_name":"Survey"}');
    await fs.outputFile(path.join(publicPath, 'preset_skills', 'demo.svg'), '<svg/>');
    await fs.outputFile(path.join(publicPath, 'skills', 'ok.json'), '{"id":"ok","name":"Safe skill"}');
    await fs.outputFile(path.join(publicPath, 'skills', 'leaky.json'), JSON.stringify({ id: 'leaky', apiKey: SECRETS.openai }));
    await fs.outputJson(path.join(publicPath, 'projects', 'proj_fake.json'), { project, savedAt: 'now' });
    await fs.outputJson(path.join(publicPath, 'projects', '.backups', 'proj_fake-old.json'), { project });
    await fs.outputJson(path.join(publicPath, 'responses', 'proj_fake.json'), [{ key: SECRETS.serviceRole }]);
    await fs.outputJson(path.join(publicPath, 'project_templates', 'mine.json'), { imageDatasetConfig: project.imageDatasetConfig });
    await fs.outputFile(path.join(publicPath, '.env'), `SUPABASE_SERVICE_ROLE_KEY=${SECRETS.serviceRole}`);
    await fs.outputFile(path.join(publicPath, 'notes.bak'), SECRETS.huggingFace);

    const deploymentPath = path.join(tempDir, 'deployment');
    await copyParticipantPublicAssets(fs, publicPath, path.join(deploymentPath, 'public'));
    for (const [fileName, content] of Object.entries(postedFiles)) {
      await fs.outputFile(path.join(deploymentPath, fileName), content);
    }

    expect(await findLeaks(deploymentPath)).toEqual([]);

    const copied = (await listFiles(path.join(deploymentPath, 'public')))
      .map((file) => path.relative(path.join(deploymentPath, 'public'), file).split(path.sep).join('/'))
      .sort();
    expect(copied).toEqual(['index.html', 'manifest.json', 'preset_skills/demo.svg', 'skills/ok.json']);
  });

  test('deploymentConfig keeps only participant fields plus media and the anon key goes to env files', async () => {
    const files = await generateDeploymentFiles({
      projectName: 'probe',
      timestamp: '2026-01-01T00:00:00.000Z',
      config: buildProjectWithSecrets(),
      preloadedImages: null,
    });
    const config = readDeploymentConfig(files);

    expect(Object.keys(config).sort()).toEqual([
      'completedHtml', 'description', 'id', 'imagePreloadTimestamp', 'name', 'pages', 'preloadedImages', 'showProgressBar', 'theme', 'title',
    ]);
    expect(config.preloadedImages).toEqual([{ name: 'image_000001.jpg', url: MEDIA_URL, folder: 'set-a' }]);
    expect(config.pages[0].elements[0]).toEqual({
      type: 'imagerating', name: 'safety', randomImageSelection: true, imageCount: 1,
    });
    expect(config.pages[0].elements[1]).toEqual({ type: 'text', name: 'code', inputType: 'password' });

    expect(files['.env']).toContain(`REACT_APP_SUPABASE_ANON_KEY=${ANON_KEY}`);
    expect(files['.env']).toContain('REACT_APP_SUPABASE_URL=https://fakeproject.supabase.co');
    expect(JSON.parse(files['vercel.json']).env.REACT_APP_SUPABASE_ANON_KEY).toBe(ANON_KEY);
    Object.entries(files)
      .filter(([name]) => !['.env', 'vercel.json'].includes(name))
      .forEach(([, content]) => expect(content).not.toContain(ANON_KEY));
  });

  test('a service_role key entered as the anon key is replaced with a placeholder', async () => {
    const project = buildProjectWithSecrets();
    project.imageDatasetConfig.supabaseAnonKey = SERVICE_ROLE_KEY;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const files = await generateDeploymentFiles({ projectName: 'probe', timestamp: 'now', config: project });
    warn.mockRestore();

    Object.values(files).forEach((content) => expect(content).not.toContain(SERVICE_ROLE_KEY));
    expect(files['.env']).toContain('REACT_APP_SUPABASE_ANON_KEY=your-supabase-anon-key');
    expect(isPrivilegedSupabaseKey('sb_secret_abc')).toBe(true);
    expect(isPrivilegedSupabaseKey('sb_publishable_abc')).toBe(false);
    expect(isPrivilegedSupabaseKey(ANON_KEY)).toBe(false);
  });

  test('generated .gitignore excludes env files and local project data', async () => {
    const files = await generateDeploymentFiles({ projectName: 'probe', timestamp: 'now', config: { pages: [] } });
    const lines = files['.gitignore'].split('\n');
    expect(lines).toEqual(expect.arrayContaining(['.env*', '!.env.example', 'public/projects/', 'public/responses/', '.backups/']));
    expect(files['.env']).not.toMatch(/HUGGINGFACE/);
    expect(files['.env.example']).not.toMatch(/HUGGINGFACE/);
  });

  test('participant App mounts SurveyApp and keeps extra Live Survey fields without secrets', async () => {
    const project = {
      ...buildProjectWithSecrets(),
      releaseManaged: true,
      publishedVersion: 3,
      locale: 'zh',
      completionMessage: '谢谢参与',
      responseQuota: 40,
      mediaFolderTags: { 'set-a': 'category' },
      publishedSurveyConfig: {
        title: 'Released street perception',
        locale: 'zh',
        completionMessage: '谢谢参与',
        responseQuota: 40,
        pages: [{ name: 'page1', elements: [{ type: 'imagerating', name: 'safety', randomImageSelection: true, imageCount: 1 }] }],
      },
    };
    const files = await generateDeploymentFiles({
      projectName: 'probe',
      timestamp: '2026-01-01T00:00:00.000Z',
      config: project,
    });
    expect(files['src/SurveyAppClean.js']).toBeUndefined();
    expect(files['src/App.js']).toContain('import SurveyApp from "./SurveyApp"');
    expect(files['src/App.js']).not.toContain('SurveyAppClean');
    const config = readDeploymentConfig(files);
    expect(config.completionMessage).toBe('谢谢参与');
    expect(config.responseQuota).toBe(40);
    expect(config.mediaFolderTags).toEqual({ 'set-a': 'category' });
    expect(config.locale).toBe('zh');
    expect(config.publishedVersion).toBe(3);
    expect(JSON.stringify(config)).not.toContain(SECRETS.serviceRole);
    expect(JSON.stringify(config)).not.toContain(SECRETS.huggingFace);

    const resolved = resolveParticipantSourceConfig(project);
    expect(resolved.title).toBe('Released street perception');
    expect(resolved.pages[0].elements[0].name).toBe('safety');
    expect(resolved.mediaFolderTags).toEqual({ 'set-a': 'category' });
    expect(resolved.publishedVersion).toBe(3);
  });

  test('HuggingFace-fetched media replaces the project pool without carrying the token', () => {
    const config = buildParticipantDeploymentConfig(buildProjectWithSecrets(), {
      preloadedImages: [{ name: 'image_000000.jpg', url: 'https://huggingface.co/datasets/x/resolve/main/a.jpg' }],
      timestamp: 'ts',
    });
    expect(config.preloadedImages).toHaveLength(1);
    expect(config.imagePreloadTimestamp).toBe('ts');
    expect(JSON.stringify(config)).not.toContain(SECRETS.huggingFace);
  });

  test('public filter rules', () => {
    expect(shouldCopyPublicEntry('index.html')).toBe(true);
    expect(shouldCopyPublicEntry('preset_skills/demo.svg')).toBe(true);
    expect(shouldCopyPublicEntry('projects')).toBe(false);
    expect(shouldCopyPublicEntry('projects/.backups/a.json')).toBe(false);
    expect(shouldCopyPublicEntry('responses/a.json')).toBe(false);
    expect(shouldCopyPublicEntry('.env.local')).toBe(false);
    expect(shouldCopyPublicEntry('skills/.backups/x.json')).toBe(false);
    expect(shouldCopyPublicEntry('old.backup')).toBe(false);
  });
});
