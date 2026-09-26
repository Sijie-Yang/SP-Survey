import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Card,
  CardContent,
  CardActions,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  CircularProgress,
  LinearProgress,
  TextField,
  Divider,
} from '@mui/material';
import {
  CloudUpload,
  GitHub,
  Language,
  CheckCircle,
  Launch,
  Code,
  Settings,
  Public,
  Security,
  Speed,
  FolderZip,
  Refresh,
  Warning,
  ContentCopy,
  Link as LinkIcon,
  OpenInNew,
} from '@mui/icons-material';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';
import { prepareDeploymentFolder, getDeploymentStatus, testDeployment, uploadToGitHub } from '../../lib/deploymentManager';
import SurveyPreflight from './SurveyPreflight';
import ProjectVersions from './ProjectVersions';
import SurveyQrCode from './SurveyQrCode';
import { getProjectReleaseState } from '../../lib/projectRelease';
import { validateSurveyConfig } from '../../lib/designProtocol/validate';
import { surveyValidationText } from '../../contexts/questionEditorI18n';
import { getTrialCount } from '../../lib/trialNavigation';

export default function WebsiteSetup({ currentProject, surveyConfig, hasUnsavedChanges = false, onReleased }) {
  const { t, language } = useRegion();
  const zh = language === 'zh';
  const report = validateSurveyConfig(surveyConfig);
  const questions = (surveyConfig?.pages || []).flatMap((p) => p.elements || []);
  const answerable = questions.filter((q) => !['html', 'expression', 'image', 'mediadisplay'].includes(q.type));
  const rounds = answerable.reduce((sum, q) => sum + getTrialCount(q), 0);
  const issues = [...(report.errors || []), ...(report.warnings || [])];
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const surveyUrl = currentProject
    ? `${origin}/survey?project=${encodeURIComponent(currentProject.id)}`
    : null;
  const [activeStep, setActiveStep] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState({
    preparing: false,
    prepared: false,
    deploymentPath: null,
    preloadedImageCount: 0,
    error: null
  });
  const [testStatus, setTestStatus] = useState({
    testing: false,
    tested: false,
    error: null,
    output: '',
    previewUrl: null
  });
  const [githubStatus, setGithubStatus] = useState({
    uploading: false,
    uploaded: false,
    repoUrl: '',
    error: null
  });
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [existingDeployments, setExistingDeployments] = useState([]);
  const stepperRef = useRef(null);
  const supabaseUrlForVercel = currentProject?.imageDatasetConfig?.supabaseUrl || 'https://<project-id>.supabase.co';
  const supabaseAnonForVercel = currentProject?.imageDatasetConfig?.supabaseAnonKey || 'your-supabase-anon-key';

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`✅ Copied ${label}`);
    } catch (error) {
      console.error(`Failed to copy ${label}:`, error);
      alert(`❌ Failed to copy ${label}. Please copy it manually.`);
    }
  };

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    // Scroll to the stepper top after a short delay to allow the DOM to update
    setTimeout(() => {
      if (stepperRef.current) {
        stepperRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
    // Scroll to the stepper top after a short delay to allow the DOM to update
    setTimeout(() => {
      if (stepperRef.current) {
        stepperRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleReset = () => {
    setActiveStep(0);
    // Scroll to the stepper top after a short delay to allow the DOM to update
    setTimeout(() => {
      if (stepperRef.current) {
        stepperRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Load existing deployments on component mount
  useEffect(() => {
    loadExistingDeployments();
  }, []);

  const loadExistingDeployments = async () => {
    try {
      const result = await getDeploymentStatus();
      setExistingDeployments(result.deployments || []);
    } catch (error) {
      console.error('Failed to load existing deployments:', error);
    }
  };

  const handlePrepareDeployment = async () => {
    if (!currentProject) {
      setDeploymentStatus(prev => ({
        ...prev,
        error: 'No project selected'
      }));
      return;
    }

    if (!surveyConfig) {
      setDeploymentStatus(prev => ({
        ...prev,
        error: 'No survey configuration found'
      }));
      return;
    }

    setDeploymentStatus(prev => ({
      ...prev,
      preparing: true,
      prepared: false,
      error: null
    }));

    try {
      let deployConfig = surveyConfig;
      try {
        const release = await getProjectReleaseState(currentProject.id);
        if (release.release_managed && release.survey_config_published) {
          deployConfig = release.survey_config_published;
        }
      } catch (error) {
        console.warn('Could not read local release snapshot; deploying current draft.', error);
      }
      // Combine project metadata with survey configuration
      const completeConfig = {
        ...currentProject,
        ...deployConfig
      };
      
      const result = await prepareDeploymentFolder(completeConfig);
      
      if (result.success) {
        setDeploymentStatus({
          preparing: false,
          prepared: true,
          deploymentPath: result.deploymentPath,
          preloadedImageCount: result.preloadedImageCount,
          error: null
        });
        
        // Reload existing deployments
        await loadExistingDeployments();
      } else {
        setDeploymentStatus(prev => ({
          ...prev,
          preparing: false,
          error: result.error
        }));
      }
    } catch (error) {
      setDeploymentStatus(prev => ({
        ...prev,
        preparing: false,
        error: error.message
      }));
    }
  };

  const handleTestDeployment = async () => {
    if (!deploymentStatus.deploymentPath) {
      setTestStatus({ 
        testing: false, 
        tested: false, 
        error: 'No deployment path found',
        output: '',
        previewUrl: null
      });
      return;
    }

    setTestStatus({ 
      testing: true, 
      tested: false, 
      error: null,
      output: '',
      previewUrl: null
    });

    try {
      const result = await testDeployment(deploymentStatus.deploymentPath);
      
      if (result.success) {
        setTestStatus({ 
          testing: false, 
          tested: true, 
          error: null,
          output: result.output || '',
          previewUrl: result.previewUrl || null
        });
      } else {
        setTestStatus({ 
          testing: false, 
          tested: false, 
          error: result.error,
          output: result.output || '',
          previewUrl: null
        });
      }
    } catch (error) {
      setTestStatus({ 
        testing: false, 
        tested: false, 
        error: error.message,
        output: '',
        previewUrl: null
      });
    }
  };

  const handleUploadToGitHub = async () => {
    if (!deploymentStatus.deploymentPath) {
      setGithubStatus(prev => ({ ...prev, error: 'No deployment path found' }));
      return;
    }

    if (!githubRepoUrl || !githubRepoUrl.trim()) {
      setGithubStatus(prev => ({ ...prev, error: 'Please enter a GitHub repository URL' }));
      return;
    }

    setGithubStatus({ uploading: true, uploaded: false, repoUrl: '', error: null });

    try {
      const result = await uploadToGitHub(
        deploymentStatus.deploymentPath, 
        githubRepoUrl,
        `Deploy ${currentProject?.name || 'survey'}`
      );
      
      if (result.success) {
        setGithubStatus({ 
          uploading: false, 
          uploaded: true, 
          repoUrl: result.repoUrl,
          error: null 
        });
      } else {
        setGithubStatus({ 
          uploading: false, 
          uploaded: false, 
          repoUrl: '',
          error: result.error 
        });
      }
    } catch (error) {
      setGithubStatus({ 
        uploading: false, 
        uploaded: false, 
        repoUrl: '',
        error: error.message 
      });
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const steps = [
    {
      label: zh ? '准备仓库' : 'Prepare Your Repository',
      description: zh ? '为部署准备 GitHub 仓库' : 'Set up GitHub repository for deployment',
      icon: <GitHub />
    },
    {
      label: zh ? '连接到 Vercel' : 'Connect to Vercel',
      description: zh ? '将仓库导入 Vercel' : 'Import repository to Vercel',
      icon: <CloudUpload />
    },
    {
      label: zh ? '配置并部署' : 'Configure & Deploy',
      description: zh ? '简单配置（通常无需环境变量）' : 'Simple setup (no env vars needed!)',
      icon: <Settings />
    },
    {
      label: zh ? '发布并测试' : 'Deploy & Test',
      description: zh ? '上线参与者站点' : 'Launch your survey online',
      icon: <Language />
    }
  ];

  const copySurveyLink = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(zh ? '请手动复制链接。' : 'Please copy the link manually.');
    }
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              {zh ? '📂 步骤 1：准备 GitHub 仓库' : '📂 Step 1: Prepare Your GitHub Repository'}
            </Typography>
            
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2">
                {zh
                  ? '点击「准备部署文件夹」自动生成可上传到 GitHub 的完整项目文件夹。'
                  : 'Click "Prepare Deployment Folder" to automatically create a complete project folder ready for GitHub upload.'}
              </Typography>
            </Alert>

            {/* One-click deployment preparation */}
            <Card sx={{ mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FolderZip />
                  {zh ? '🚀 一键准备部署包' : '🚀 One-Click Deployment Preparation'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {zh ? '将会自动完成：' : 'This will automatically:'}
                </Typography>
                <List dense>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '复制全部源码和资源' : 'Copy all source code and assets'} 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '预加载 Hugging Face 图片以加快访问' : 'Pre-load all Hugging Face images for faster loading'} 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '生成部署配置文件' : 'Generate deployment configuration files'} 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '生成 README 和部署说明' : 'Create README and deployment instructions'} 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                </List>
              </CardContent>
              <CardActions>
                <Button 
                  variant="contained" 
                  size="large"
                  startIcon={deploymentStatus.preparing ? <CircularProgress size={20} color="inherit" /> : <FolderZip />}
                  onClick={handlePrepareDeployment}
                  disabled={deploymentStatus.preparing || !currentProject}
                  sx={{ bgcolor: 'white', color: 'primary.main', '&:hover': { bgcolor: 'grey.100' } }}
                >
                  {deploymentStatus.preparing
                    ? (zh ? '正在准备…' : 'Preparing...')
                    : (zh ? '准备部署文件夹' : 'Prepare Deployment Folder')}
                </Button>
              </CardActions>
            </Card>

            {/* Deployment Status */}
            {deploymentStatus.preparing && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {zh ? '🔄 正在准备部署…' : '🔄 Preparing deployment...'}
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    {zh ? '如果需要预加载大量图片，可能需要几分钟。' : 'This may take a few minutes if pre-loading many images from Hugging Face...'}
                  </Typography>
                </CardContent>
              </Card>
            )}

            {deploymentStatus.prepared && (
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {zh ? '✅ 部署文件夹已准备好！' : '✅ Deployment folder ready!'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>{zh ? '位置：' : 'Location:'}</strong> {deploymentStatus.deploymentPath}<br/>
                  {deploymentStatus.preloadedImageCount > 0 && (
                    <>
                      <strong>{zh ? '已预加载图片：' : 'Preloaded Images:'}</strong>{' '}
                      {zh
                        ? `来自 Hugging Face 的 ${deploymentStatus.preloadedImageCount} 张`
                        : `${deploymentStatus.preloadedImageCount} images from Hugging Face`}
                      <br/>
                    </>
                  )}
                </Typography>
              </Alert>
            )}

            {/* Test Build Section */}
            <Card sx={{ mb: 3, bgcolor: 'secondary.light', color: 'secondary.contrastText' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Code />
                  {zh ? '🧪 测试构建' : '🧪 Test Build'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {zh
                    ? '自动运行 npm install 和 npm run build，检查部署包是否能构建成功。'
                    : 'Test your deployment by running npm install and npm run build automatically.'}
                </Typography>
                {!deploymentStatus.prepared && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    {zh ? '请先准备部署文件夹' : 'Please prepare the deployment folder first'}
                  </Alert>
                )}
              </CardContent>
              <CardActions>
                <Button 
                  variant="contained" 
                  size="large"
                  startIcon={testStatus.testing ? <CircularProgress size={20} color="inherit" /> : <Code />}
                  onClick={handleTestDeployment}
                  disabled={testStatus.testing || !deploymentStatus.prepared}
                  sx={{ bgcolor: 'white', color: 'secondary.main', '&:hover': { bgcolor: 'grey.100' } }}
                >
                  {testStatus.testing
                    ? (zh ? '正在测试…' : 'Testing...')
                    : (zh ? '测试构建' : 'Test Build')}
                </Button>
              </CardActions>
            </Card>

            {testStatus.testing && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {zh ? '🔄 正在测试部署构建…' : '🔄 Testing deployment build...'}
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    {zh
                      ? '正在运行 npm install 和 npm run build，可能需要几分钟。'
                      : 'Running npm install and npm run build. This may take a few minutes...'}
                  </Typography>
                </CardContent>
              </Card>
            )}

            {(testStatus.tested || testStatus.error) && testStatus.output && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    {zh ? '📋 构建输出' : '📋 Build Output'}
                  </Typography>
                  <Box 
                    component="pre" 
                    sx={{ 
                      bgcolor: 'grey.900', 
                      color: 'white', 
                      p: 2, 
                      borderRadius: 1, 
                      fontSize: '0.75rem',
                      overflow: 'auto',
                      maxHeight: '400px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'monospace'
                    }}
                  >
                    {testStatus.output}
                  </Box>
                </CardContent>
              </Card>
            )}

            {testStatus.tested && (
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {zh ? '✅ 构建测试通过，部署包可用。' : '✅ Build test successful! Your deployment is ready.'}
                </Typography>
                {testStatus.previewUrl && (
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    <strong>{zh ? '🌐 预览地址：' : '🌐 Preview URL:'}</strong>{' '}
                    <a 
                      href={testStatus.previewUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', fontWeight: 'bold' }}
                    >
                      {testStatus.previewUrl}
                    </a>
                    <br/>
                    <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                      {zh ? '点击链接在新标签页预览已部署的问卷' : 'Click the link to preview your deployed survey in a new tab'}
                    </Typography>
                  </Typography>
                )}
              </Alert>
            )}

            {testStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>{zh ? '测试错误：' : 'Test Error:'}</strong> {testStatus.error}
                </Typography>
              </Alert>
            )}

            {/* Upload to GitHub Section */}
            <Card sx={{ mb: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GitHub />
                  {zh ? '📤 上传到 GitHub' : '📤 Upload to GitHub'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {zh
                    ? '自动初始化 git 并将部署包推送到 GitHub。'
                    : 'Automatically initialize git and push your deployment to GitHub.'}
                </Typography>
                {!deploymentStatus.prepared && (
                  <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                    {zh ? '请先准备部署文件夹' : 'Please prepare the deployment folder first'}
                  </Alert>
                )}
                <Alert severity="warning" sx={{ mt: 2, mb: 2, bgcolor: 'warning.light' }}>
                  <Typography variant="caption">
                    {zh
                      ? '⚠️ 注意：如果 GitHub 仓库里已有内容（如 README、LICENSE），这次上传会用问卷部署包覆盖它们。请确认仓库为空，或你接受替换现有内容。'
                      : '⚠️ Note: If your GitHub repository already has content (e.g., README, LICENSE), this will overwrite it with your survey deployment. Make sure the repository is empty or you are okay with replacing its contents.'}
                  </Typography>
                </Alert>
                <TextField
                  fullWidth
                  label={zh ? 'GitHub 仓库地址' : 'GitHub Repository URL'}
                  placeholder="https://github.com/yourusername/your-repo.git"
                  value={githubRepoUrl}
                  onChange={(e) => setGithubRepoUrl(e.target.value)}
                  disabled={!deploymentStatus.prepared}
                  sx={{ mb: 2, bgcolor: 'white' }}
                  helperText={zh ? '请先在 GitHub 创建仓库，再把地址粘贴到这里' : 'Create the repository on GitHub first, then paste the URL here'}
                />
              </CardContent>
              <CardActions>
                <Button 
                  variant="contained" 
                  size="large"
                  startIcon={githubStatus.uploading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
                  onClick={handleUploadToGitHub}
                  disabled={githubStatus.uploading || !githubRepoUrl || !deploymentStatus.prepared}
                  sx={{ bgcolor: 'white', color: 'success.main', '&:hover': { bgcolor: 'grey.100' } }}
                >
                  {githubStatus.uploading
                    ? (zh ? '正在上传…' : 'Uploading...')
                    : (zh ? '上传到 GitHub' : 'Upload to GitHub')}
                </Button>
              </CardActions>
            </Card>

            {githubStatus.uploading && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {zh ? '🔄 正在上传到 GitHub…' : '🔄 Uploading to GitHub...'}
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    {zh
                      ? '正在初始化 git、提交文件并推送到 GitHub…'
                      : 'Initializing git, committing files, and pushing to GitHub...'}
                  </Typography>
                </CardContent>
              </Card>
            )}

            {githubStatus.uploaded && (
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {zh ? '✅ 已成功上传到 GitHub！' : '✅ Successfully uploaded to GitHub!'}
                </Typography>
                <Typography variant="body2">
                  {zh ? '部署包现在位于：' : 'Your deployment is now at:'}{' '}
                  <a href={githubStatus.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{githubStatus.repoUrl}</a>
                </Typography>
              </Alert>
            )}

            {githubStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>{zh ? 'GitHub 错误：' : 'GitHub Error:'}</strong> {githubStatus.error}
                </Typography>
              </Alert>
            )}

            {deploymentStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>{zh ? '错误：' : 'Error:'}</strong> {deploymentStatus.error}
                </Typography>
              </Alert>
            )}


            <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {zh ? '💡 手动操作常用命令：' : '💡 Quick Commands for Manual Operation:'}
              </Typography>
              <Box component="pre" sx={{ 
                bgcolor: 'grey.900', 
                color: 'white', 
                p: 2, 
                borderRadius: 1, 
                fontSize: '0.875rem',
                overflow: 'auto'
              }}>
{`# Navigate to your deployment folder
cd deployments/your-project-name-timestamp/

# Test your build locally
npm install
npm run build

# Initialize git (if not already done)
git init
git add .
git commit -m "Initial survey setup"

# Push to GitHub
git remote add origin https://github.com/yourusername/your-survey-repo.git
git branch -M main
git push -u origin main`}
              </Box>
            </Paper>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              {zh ? '☁️ 步骤 2：配置 Vercel 项目' : '☁️ Step 2: Configure Vercel Project'}
            </Typography>
            
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2">
                {zh ? 'Vercel 可为 React 应用提供免费托管和自动部署。' : 'Vercel provides free hosting for React applications with automatic deployments.'}
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '🚀 Vercel 部署步骤：' : '🚀 Vercel Deployment Steps:'}
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <Typography variant="body2" sx={{ 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        borderRadius: '50%', 
                        width: 24, 
                        height: 24, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontSize: '0.75rem'
                      }}>
                        1
                      </Typography>
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '注册 Vercel' : 'Sign up for Vercel'}
                      secondary={zh ? '用 GitHub 账号在 vercel.com 创建免费账户' : 'Create a free account at vercel.com using your GitHub account'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Typography variant="body2" sx={{ 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        borderRadius: '50%', 
                        width: 24, 
                        height: 24, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontSize: '0.75rem'
                      }}>
                        2
                      </Typography>
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '导入项目' : 'Import Project'}
                      secondary={zh ? '点击 New Project 并导入你的 GitHub 仓库' : "Click 'New Project' and import your GitHub repository"}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Typography variant="body2" sx={{ 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        borderRadius: '50%', 
                        width: 24, 
                        height: 24, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontSize: '0.75rem'
                      }}>
                        3
                      </Typography>
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '配置构建和环境变量' : 'Configure Build & Environment Variables'}
                      secondary={zh ? '保持 React 默认设置，然后在 Vercel 项目设置 → Environment Variables 中填写 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY' : 'Keep React defaults, then manually set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in Vercel Project Settings → Environment Variables'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Typography variant="body2" sx={{ 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        borderRadius: '50%', 
                        width: 24, 
                        height: 24, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontSize: '0.75rem'
                      }}>
                        4
                      </Typography>
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '部署' : 'Deploy'}
                      secondary={zh ? '点击 Deploy，Vercel 会自动构建并发布问卷' : "Click 'Deploy' - Vercel will build and deploy your survey automatically"}
                    />
                  </ListItem>
                </List>
              </CardContent>
              <CardActions>
                <Button 
                  variant="contained" 
                  startIcon={<CloudUpload />}
                  href="https://vercel.com/new" 
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {zh ? '部署到 Vercel' : 'Deploy to Vercel'}
                </Button>
                <Button 
                  variant="outlined" 
                  startIcon={<Launch />}
                  href="https://vercel.com/docs" 
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {zh ? '文档' : 'Documentation'}
                </Button>
              </CardActions>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '📋 复制到 Vercel 环境变量' : '📋 Copy These to Vercel Environment Variables'}
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}><strong>{zh ? '名称' : 'Name'}</strong>: REACT_APP_SUPABASE_URL</Typography>
                    <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-all' }}><strong>{zh ? '值' : 'Value'}</strong>: {supabaseUrlForVercel}</Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="outlined" startIcon={<ContentCopy />} onClick={() => copyToClipboard('REACT_APP_SUPABASE_URL', zh ? '变量名' : 'variable name')}>
                        {zh ? '复制名称' : 'Copy Name'}
                      </Button>
                      <Button size="small" variant="contained" startIcon={<ContentCopy />} onClick={() => copyToClipboard(supabaseUrlForVercel, zh ? 'URL 值' : 'URL value')}>
                        {zh ? '复制值' : 'Copy Value'}
                      </Button>
                    </Box>
                  </Box>

                  <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}><strong>{zh ? '名称' : 'Name'}</strong>: REACT_APP_SUPABASE_ANON_KEY</Typography>
                    <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-all' }}><strong>{zh ? '值' : 'Value'}</strong>: {supabaseAnonForVercel}</Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="outlined" startIcon={<ContentCopy />} onClick={() => copyToClipboard('REACT_APP_SUPABASE_ANON_KEY', zh ? '变量名' : 'variable name')}>
                        {zh ? '复制名称' : 'Copy Name'}
                      </Button>
                      <Button size="small" variant="contained" startIcon={<ContentCopy />} onClick={() => copyToClipboard(supabaseAnonForVercel, zh ? '匿名密钥值' : 'anon key value')}>
                        {zh ? '复制值' : 'Copy Value'}
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                {zh ? (
                  <>
                    <strong>重要：</strong>Vercel 不会可靠地从仓库自动填入全部环境变量。部署或重新部署前，请手动确认
                    <strong> REACT_APP_SUPABASE_URL </strong>
                    和
                    <strong> REACT_APP_SUPABASE_ANON_KEY </strong>
                    已正确填写。
                  </>
                ) : (
                  <>
                    <strong>Important:</strong> Vercel will not reliably auto-populate all environment variables from your repository. Always verify
                    <strong> REACT_APP_SUPABASE_URL </strong>
                    and
                    <strong> REACT_APP_SUPABASE_ANON_KEY </strong>
                    manually before deploy/redeploy.
                  </>
                )}
              </Typography>
            </Alert>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              {zh ? '⚙️ 步骤 3：检查 Vercel 配置' : '⚙️ Step 3: Configure Vercel Project'}
            </Typography>
            
            <Alert severity="warning" sx={{ mb: 3 }}>
              <Typography variant="body2">
                {zh
                  ? '⚠️ 需要操作：问卷配置已打包进部署包，但 Vercel 环境变量仍需手动核对。'
                  : '⚠️ Action required: Survey config is embedded, but Vercel environment variables still need manual verification.'}
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '📋 已包含的内容：' : "📋 What's Already Configured:"}
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '问卷配置' : 'Survey Configuration'}
                      secondary={zh ? '全部题目、页面和设置都已包含在部署包中' : 'All survey questions, pages, and settings are included in the deployment'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Warning color="warning" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '数据库连接（需手动检查）' : 'Database Connection (manual check required)'}
                      secondary={zh
                        ? '在 Vercel 中确认 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY 已填写且不是占位符。'
                        : 'In Vercel, confirm REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are present and non-placeholder.'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '图片数据集' : 'Image Dataset'}
                      secondary={zh ? 'Hugging Face 图片已预加载并包含在部署包中' : 'Hugging Face images are preloaded and included in the deployment'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '主题与样式' : 'Theme & Styling'}
                      secondary={zh ? '自定义颜色和品牌样式已预配置' : 'Custom colors and branding are pre-configured'}
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>

            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>{zh ? 'Vercel 简要设置：' : 'Simple Vercel Setup:'}</strong>
              </Typography>
              <Typography variant="body2" component="div">
                {zh ? (
                  <>
                    1. 在 Vercel 点击 <strong>Import Project</strong><br/>
                    2. 选择你的 GitHub 仓库<br/>
                    3. 保持默认设置（框架预设：Create React App）<br/>
                    4. 打开 <strong>Project Settings → Environment Variables</strong><br/>
                    5. 确认 <strong>REACT_APP_SUPABASE_URL</strong> 和 <strong>REACT_APP_SUPABASE_ANON_KEY</strong> 填写正确<br/>
                    6. 点击 <strong>Deploy</strong>（如果刚改过环境变量，请 Redeploy）
                  </>
                ) : (
                  <>
                    1. In Vercel, click <strong>"Import Project"</strong><br/>
                    2. Select your GitHub repository<br/>
                    3. Keep default settings (Framework Preset: Create React App)<br/>
                    4. Open <strong>Project Settings → Environment Variables</strong><br/>
                    5. Ensure <strong>REACT_APP_SUPABASE_URL</strong> and <strong>REACT_APP_SUPABASE_ANON_KEY</strong> are set correctly<br/>
                    6. Click <strong>"Deploy"</strong> (or Redeploy if you updated env vars)
                  </>
                )}
              </Typography>
            </Alert>

            <Alert severity="warning">
              <Typography variant="body2">
                {zh ? (
                  <>
                    <strong>说明：</strong>如果任一环境变量缺失或仍是占位符，已部署问卷会显示：
                    <em> “There was an error saving your responses: Supabase not configured...”</em>
                  </>
                ) : (
                  <>
                    <strong>Note:</strong> If either env var is missing/placeholder, deployed surveys will show:
                    <em> "There was an error saving your responses: Supabase not configured..."</em>
                  </>
                )}
              </Typography>
            </Alert>
          </Box>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              {zh ? '🚀 步骤 4：发布并测试问卷' : '🚀 Step 4: Deploy & Test Your Survey'}
            </Typography>
            
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2">
                {zh
                  ? '问卷已准备发布。按下面几步做完最后检查。'
                  : 'Your survey is ready to go live! Follow these final steps to ensure everything works perfectly.'}
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '✅ 上线前检查清单：' : '✅ Pre-Launch Checklist:'}
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '测试问卷流程' : 'Test Survey Flow'}
                      secondary={zh ? '在已部署站点完整答一遍，确认每道题都能正常作答' : 'Complete the entire survey on your deployed site to ensure all questions work'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '核对图片加载' : 'Verify Image Loading'}
                      secondary={zh ? '确认生产环境中 Hugging Face 图片都能正常显示' : 'Check that all images from Hugging Face load correctly in production'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '测试数据收集' : 'Test Data Collection'}
                      secondary={zh ? '提交一条测试作答，并在 Supabase 中确认已写入' : "Submit a test response and verify it's stored in your Supabase database"}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '移动端适配' : 'Mobile Responsiveness'}
                      secondary={zh ? '在手机上打开问卷，确认阅读和作答体验正常' : 'Test your survey on mobile devices to ensure good user experience'}
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '🌐 问卷地址：' : '🌐 Your Survey URLs:'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {zh ? '部署完成后，问卷将出现在：' : 'After deployment, your survey will be available at:'}
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    <strong>{zh ? '管理后台：' : 'Admin Panel:'}</strong> https://your-project.vercel.app/admin
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    <strong>{zh ? '正式问卷：' : 'Live Survey:'}</strong> https://your-project.vercel.app/survey
                  </Typography>
                  {currentProject && (
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      <strong>{zh ? '项目问卷：' : 'Project Survey:'}</strong> https://your-project.vercel.app/survey?project={currentProject.id}
                    </Typography>
                  )}
                </Paper>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  {zh ? '🔄 自动更新：' : '🔄 Automatic Updates:'}
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <Public color="primary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '持续部署' : 'Continuous Deployment'}
                      secondary={zh ? '每次推送到 main 分支都会自动触发新部署' : 'Every push to your main branch automatically triggers a new deployment'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Speed color="primary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={zh ? '全球 CDN' : 'Global CDN'}
                      secondary={zh ? '问卷由 Vercel 全球节点分发，各地打开更快' : "Your survey is served from Vercel's global network for fast loading worldwide"}
                    />
                  </ListItem>
                </List>
              </CardContent>
              <CardActions>
                <Button 
                  variant="contained" 
                  startIcon={<Launch />}
                  color="success"
                >
                  {zh ? '🎉 问卷已上线！' : '🎉 Survey is Live!'}
                </Button>
              </CardActions>
            </Card>
          </Box>
        );

      default:
        return 'Unknown step';
    }
  };

  return (
    <Box>
      <AdminPageHeader
        icon={<LinkIcon />}
        title={t.shareTitle}
        description={t.shareDescription}
      />

      <Card sx={{ mb: 3, border: '2px solid', borderColor: 'primary.main' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon color="primary" />
            {t.shareYourLink}
          </Typography>
          {surveyUrl ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 232px' }, gap: 3, alignItems: 'start' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'grey.50',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    wordBreak: 'break-all',
                    mb: 2,
                  }}
                >
                  {surveyUrl}
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    startIcon={copied ? <CheckCircle /> : <ContentCopy />}
                    onClick={() => copySurveyLink(surveyUrl)}
                    color={copied ? 'success' : 'primary'}
                  >
                    {copied ? t.shareCopied : t.shareCopyLink}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<OpenInNew />}
                    href={surveyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.shareOpenSurvey}
                  </Button>
                </Box>
                {['localhost', '127.0.0.1', '[::1]'].includes(new URL(surveyUrl).hostname) && (
                  <Alert severity="info" sx={{ mt: 2 }}>{t.shareQrLocalHint}</Alert>
                )}
              </Box>
              <SurveyQrCode key={surveyUrl} surveyUrl={surveyUrl} projectId={currentProject.id} projectName={currentProject.name} />
            </Box>
          ) : (
            <Alert severity="warning">{t.shareNoProject}</Alert>
          )}
        </CardContent>
      </Card>

      <Alert severity={!answerable.length || report.errors?.length ? 'warning' : 'info'} sx={{ mb: 2 }}>
        {zh
          ? `${report.pageCount || 0} 页 · ${answerable.length} 道作答题 · 共 ${rounds} 轮`
          : `${report.pageCount || 0} pages · ${answerable.length} answerable questions · ${rounds} rounds`}
        {!answerable.length && (
          <Typography variant="body2">
            {zh ? '问卷还没有作答题，请先在题目设置中完善。' : 'This survey has no answerable questions. Add questions before inviting participants.'}
          </Typography>
        )}
        {issues.slice(0, 5).map((issue, i) => (
          <Typography key={i} variant="body2">• {surveyValidationText(issue.message, language)}</Typography>
        ))}
      </Alert>
      {hasUnsavedChanges && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {zh ? '当前有未保存的修改。请确认顶部显示已保存，再发送分享链接。' : 'There are unsaved changes. Wait for the toolbar to show saved before sending the share link.'}
        </Alert>
      )}
      <SurveyPreflight surveyConfig={surveyConfig} currentProject={currentProject} />
      <ProjectVersions
        currentProject={currentProject}
        hasUnsavedChanges={hasUnsavedChanges}
        onReleased={onReleased}
      />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
            {t.shareTips}
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip1Primary} secondary={t.shareTip1Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip2Primary} secondary={t.shareTip2Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip3Primary} secondary={t.shareTip3Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip4Primary} secondary={t.shareTip4Secondary} />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {zh ? '参与者站点' : 'Participant site'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {zh
            ? '本地 Live Survey 可直接用上方链接。若要部署独立参与者站，请按下列步骤准备文件夹并发布。'
            : 'The local Live Survey uses the link above. Fold the steps below if you want to deploy a standalone participant site.'}
        </Typography>

        {/* Benefits Overview */}
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {zh ? '为何部署到 Vercel？' : 'Why Deploy to Vercel?'}
          </Typography>
          <Typography variant="body2" component="div">
            {zh ? (
              <>
                • <strong>免费托管：</strong>个人和小项目无需费用<br/>
                • <strong>自动部署：</strong>从 GitHub 推送后自动更新<br/>
                • <strong>全球 CDN：</strong>各地访问更快<br/>
                • <strong>HTTPS：</strong>默认加密连接<br/>
                • <strong>自定义域名：</strong>可选绑定自己的域名
              </>
            ) : (
              <>
                • <strong>Free Hosting:</strong> No cost for personal and small projects<br/>
                • <strong>Automatic Deployments:</strong> Updates deploy automatically from GitHub<br/>
                • <strong>Global CDN:</strong> Fast loading times worldwide<br/>
                • <strong>HTTPS Security:</strong> Secure connections by default<br/>
                • <strong>Custom Domains:</strong> Use your own domain name (optional)
              </>
            )}
          </Typography>
        </Alert>

        {/* Step-by-step Guide */}
        <Paper sx={{ p: 3 }} ref={stepperRef}>
          <Stepper activeStep={activeStep} orientation="vertical">
            {steps.map((step, index) => (
              <Step key={step.label}>
                <StepLabel
                  optional={
                    index === steps.length - 1 ? (
                      <Typography variant="caption">{zh ? '最后一步' : 'Last step'}</Typography>
                    ) : null
                  }
                  icon={step.icon}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {step.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {step.description}
                  </Typography>
                </StepLabel>
                <StepContent>
                  {getStepContent(index)}
                  <Box sx={{ mb: 2, mt: 3 }}>
                    <div>
                      <Button
                        variant="contained"
                        onClick={handleNext}
                        sx={{ mt: 1, mr: 1 }}
                      >
                        {index === steps.length - 1 ? (zh ? '完成' : 'Finish') : (zh ? '继续' : 'Continue')}
                      </Button>
                      <Button
                        disabled={index === 0}
                        onClick={handleBack}
                        sx={{ mt: 1, mr: 1 }}
                      >
                        {zh ? '返回' : 'Back'}
                      </Button>
                    </div>
                  </Box>
                </StepContent>
              </Step>
            ))}
          </Stepper>
          
          {activeStep === steps.length && (
            <Paper square elevation={0} sx={{ p: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {zh ? '🎉 问卷已上线！' : '🎉 Congratulations! Your survey is now live!'}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {zh ? '你已把问卷部署到 Vercel，参与者现在可以在线作答。' : 'You have successfully deployed your survey to Vercel. Participants can now access your survey online.'}
              </Typography>
              <Button onClick={handleReset} sx={{ mt: 1, mr: 1 }} variant="outlined">
                {zh ? '再看一遍步骤' : 'Review Steps Again'}
              </Button>
            </Paper>
          )}
        </Paper>

        {/* Existing Deployments */}
        {existingDeployments.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              📦 Existing Deployment Folders
              <Button 
                size="small" 
                startIcon={<Refresh />} 
                onClick={loadExistingDeployments}
              >
                Refresh
              </Button>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Located in: <code style={{ padding: '2px 6px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>./deployments/</code> folder in your project root
            </Typography>
            <Paper sx={{ p: 2 }}>
              <List dense>
                {existingDeployments.map((deployment, index) => (
                  <ListItem key={index} sx={{ 
                    py: 1, 
                    borderBottom: index < existingDeployments.length - 1 ? '1px solid' : 'none',
                    borderColor: 'divider'
                  }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <CheckCircle color="success" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {deployment.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(deployment.created).toLocaleString()} • {formatFileSize(deployment.size)}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Box>
        )}

        {/* Additional Resources */}
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            📚 Additional Resources
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button 
              variant="outlined" 
              startIcon={<Launch />}
              href="https://vercel.com/docs/concepts/deployments/overview" 
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel Deployment Guide
            </Button>
            <Button 
              variant="outlined" 
              startIcon={<GitHub />}
              href="https://docs.github.com/en/get-started/quickstart/create-a-repo" 
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Repository Guide
            </Button>
            <Button 
              variant="outlined" 
              startIcon={<Code />}
              href="https://create-react-app.dev/docs/deployment/" 
              target="_blank"
              rel="noopener noreferrer"
            >
              React Deployment Docs
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
