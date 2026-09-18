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
  TextField
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
  ContentCopy
} from '@mui/icons-material';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';
import { prepareDeploymentFolder, getDeploymentStatus, testDeployment, uploadToGitHub } from '../../lib/deploymentManager';
import SurveyPreflight from './SurveyPreflight';
import ProjectVersions from './ProjectVersions';
import { getProjectReleaseState } from '../../lib/projectRelease';

export default function WebsiteSetup({ currentProject, surveyConfig, hasUnsavedChanges = false, onReleased }) {
  const { t } = useRegion();
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
      label: 'Prepare Your Repository',
      description: 'Set up GitHub repository for deployment',
      icon: <GitHub />
    },
    {
      label: 'Connect to Vercel',
      description: 'Import repository to Vercel',
      icon: <CloudUpload />
    },
    {
      label: 'Configure & Deploy',
      description: 'Simple setup (no env vars needed!)',
      icon: <Settings />
    },
    {
      label: 'Deploy & Test',
      description: 'Launch your survey online',
      icon: <Language />
    }
  ];

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              📂 Step 1: Prepare Your GitHub Repository
            </Typography>
            
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2">
                Click "Prepare Deployment Folder" to automatically create a complete project folder ready for GitHub upload.
              </Typography>
            </Alert>

            {/* One-click deployment preparation */}
            <Card sx={{ mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FolderZip />
                  🚀 One-Click Deployment Preparation
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  This will automatically:
                </Typography>
                <List dense>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Copy all source code and assets" 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Pre-load all Hugging Face images for faster loading" 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Generate deployment configuration files" 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem sx={{ py: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircle sx={{ color: 'primary.contrastText' }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Create README and deployment instructions" 
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
                  {deploymentStatus.preparing ? 'Preparing...' : 'Prepare Deployment Folder'}
                </Button>
              </CardActions>
            </Card>

            {/* Deployment Status */}
            {deploymentStatus.preparing && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    🔄 Preparing deployment...
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    This may take a few minutes if pre-loading many images from Hugging Face...
                  </Typography>
                </CardContent>
              </Card>
            )}

            {deploymentStatus.prepared && (
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  ✅ Deployment folder ready!
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>Location:</strong> {deploymentStatus.deploymentPath}<br/>
                  {deploymentStatus.preloadedImageCount > 0 && (
                    <>
                      <strong>Preloaded Images:</strong> {deploymentStatus.preloadedImageCount} images from Hugging Face<br/>
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
                  🧪 Test Build
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  Test your deployment by running npm install and npm run build automatically.
                </Typography>
                {!deploymentStatus.prepared && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    Please prepare the deployment folder first
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
                  {testStatus.testing ? 'Testing...' : 'Test Build'}
                </Button>
              </CardActions>
            </Card>

            {testStatus.testing && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    🔄 Testing deployment build...
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    Running npm install and npm run build. This may take a few minutes...
                  </Typography>
                </CardContent>
              </Card>
            )}

            {(testStatus.tested || testStatus.error) && testStatus.output && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    📋 Build Output
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
                  ✅ Build test successful! Your deployment is ready.
                </Typography>
                {testStatus.previewUrl && (
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    <strong>🌐 Preview URL:</strong>{' '}
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
                      Click the link to preview your deployed survey in a new tab
                    </Typography>
                  </Typography>
                )}
              </Alert>
            )}

            {testStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>Test Error:</strong> {testStatus.error}
                </Typography>
              </Alert>
            )}

            {/* Upload to GitHub Section */}
            <Card sx={{ mb: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GitHub />
                  📤 Upload to GitHub
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  Automatically initialize git and push your deployment to GitHub.
                </Typography>
                {!deploymentStatus.prepared && (
                  <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                    Please prepare the deployment folder first
                  </Alert>
                )}
                <Alert severity="warning" sx={{ mt: 2, mb: 2, bgcolor: 'warning.light' }}>
                  <Typography variant="caption">
                    ⚠️ <strong>Note:</strong> If your GitHub repository already has content (e.g., README, LICENSE), 
                    this will overwrite it with your survey deployment. Make sure the repository is empty or you're okay with replacing its contents.
                  </Typography>
                </Alert>
                <TextField
                  fullWidth
                  label="GitHub Repository URL"
                  placeholder="https://github.com/yourusername/your-repo.git"
                  value={githubRepoUrl}
                  onChange={(e) => setGithubRepoUrl(e.target.value)}
                  disabled={!deploymentStatus.prepared}
                  sx={{ mb: 2, bgcolor: 'white' }}
                  helperText="Create the repository on GitHub first, then paste the URL here"
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
                  {githubStatus.uploading ? 'Uploading...' : 'Upload to GitHub'}
                </Button>
              </CardActions>
            </Card>

            {githubStatus.uploading && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    🔄 Uploading to GitHub...
                  </Typography>
                  <LinearProgress />
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    Initializing git, committing files, and pushing to GitHub...
                  </Typography>
                </CardContent>
              </Card>
            )}

            {githubStatus.uploaded && (
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  ✅ Successfully uploaded to GitHub!
                </Typography>
                <Typography variant="body2">
                  Your deployment is now at: <a href={githubStatus.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{githubStatus.repoUrl}</a>
                </Typography>
              </Alert>
            )}

            {githubStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>GitHub Error:</strong> {githubStatus.error}
                </Typography>
              </Alert>
            )}

            {deploymentStatus.error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>Error:</strong> {deploymentStatus.error}
                </Typography>
              </Alert>
            )}


            <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                💡 Quick Commands for Manual Operation:
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
              ☁️ Step 2: Configure Vercel Project
            </Typography>
            
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2">
                Vercel provides free hosting for React applications with automatic deployments.
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  🚀 Vercel Deployment Steps:
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
                      primary="Sign up for Vercel" 
                      secondary="Create a free account at vercel.com using your GitHub account"
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
                      primary="Import Project" 
                      secondary="Click 'New Project' and import your GitHub repository"
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
                      primary="Configure Build & Environment Variables" 
                      secondary="Keep React defaults, then manually set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in Vercel Project Settings → Environment Variables"
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
                      primary="Deploy" 
                      secondary="Click 'Deploy' - Vercel will build and deploy your survey automatically"
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
                  Deploy to Vercel
                </Button>
                <Button 
                  variant="outlined" 
                  startIcon={<Launch />}
                  href="https://vercel.com/docs" 
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Documentation
                </Button>
              </CardActions>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  📋 Copy These to Vercel Environment Variables
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}><strong>Name</strong>: REACT_APP_SUPABASE_URL</Typography>
                    <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-all' }}><strong>Value</strong>: {supabaseUrlForVercel}</Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="outlined" startIcon={<ContentCopy />} onClick={() => copyToClipboard('REACT_APP_SUPABASE_URL', 'variable name')}>
                        Copy Name
                      </Button>
                      <Button size="small" variant="contained" startIcon={<ContentCopy />} onClick={() => copyToClipboard(supabaseUrlForVercel, 'URL value')}>
                        Copy Value
                      </Button>
                    </Box>
                  </Box>

                  <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}><strong>Name</strong>: REACT_APP_SUPABASE_ANON_KEY</Typography>
                    <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-all' }}><strong>Value</strong>: {supabaseAnonForVercel}</Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="outlined" startIcon={<ContentCopy />} onClick={() => copyToClipboard('REACT_APP_SUPABASE_ANON_KEY', 'variable name')}>
                        Copy Name
                      </Button>
                      <Button size="small" variant="contained" startIcon={<ContentCopy />} onClick={() => copyToClipboard(supabaseAnonForVercel, 'anon key value')}>
                        Copy Value
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Important:</strong> Vercel will not reliably auto-populate all environment variables from your repository. Always verify
                <strong> REACT_APP_SUPABASE_URL </strong>
                and
                <strong> REACT_APP_SUPABASE_ANON_KEY </strong>
                manually before deploy/redeploy.
              </Typography>
            </Alert>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              ⚙️ Step 3: Configure Vercel Project
            </Typography>
            
            <Alert severity="warning" sx={{ mb: 3 }}>
              <Typography variant="body2">
                ⚠️ <strong>Action required:</strong> Survey config is embedded, but Vercel environment variables still need manual verification.
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  📋 What's Already Configured:
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Survey Configuration" 
                      secondary="All survey questions, pages, and settings are included in the deployment"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Warning color="warning" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Database Connection (manual check required)" 
                      secondary="In Vercel, confirm REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are present and non-placeholder."
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Image Dataset" 
                      secondary="Hugging Face images are preloaded and included in the deployment"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Theme & Styling" 
                      secondary="Custom colors and branding are pre-configured"
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>

            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Simple Vercel Setup:</strong>
              </Typography>
              <Typography variant="body2" component="div">
                1. In Vercel, click <strong>"Import Project"</strong><br/>
                2. Select your GitHub repository<br/>
                3. Keep default settings (Framework Preset: Create React App)<br/>
                4. Open <strong>Project Settings → Environment Variables</strong><br/>
                5. Ensure <strong>REACT_APP_SUPABASE_URL</strong> and <strong>REACT_APP_SUPABASE_ANON_KEY</strong> are set correctly<br/>
                6. Click <strong>"Deploy"</strong> (or Redeploy if you updated env vars)
              </Typography>
            </Alert>

            <Alert severity="warning">
              <Typography variant="body2">
                <strong>Note:</strong> If either env var is missing/placeholder, deployed surveys will show:
                <em> "There was an error saving your responses: Supabase not configured..."</em>
              </Typography>
            </Alert>
          </Box>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
              🚀 Step 4: Deploy & Test Your Survey
            </Typography>
            
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2">
                Your survey is ready to go live! Follow these final steps to ensure everything works perfectly.
              </Typography>
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  ✅ Pre-Launch Checklist:
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Test Survey Flow" 
                      secondary="Complete the entire survey on your deployed site to ensure all questions work"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Verify Image Loading" 
                      secondary="Check that all images from Hugging Face load correctly in production"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Test Data Collection" 
                      secondary="Submit a test response and verify it's stored in your Supabase database"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Mobile Responsiveness" 
                      secondary="Test your survey on mobile devices to ensure good user experience"
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  🌐 Your Survey URLs:
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  After deployment, your survey will be available at:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    <strong>Admin Panel:</strong> https://your-project.vercel.app/admin
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    <strong>Live Survey:</strong> https://your-project.vercel.app/survey
                  </Typography>
                  {currentProject && (
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      <strong>Project Survey:</strong> https://your-project.vercel.app/survey?project={currentProject.id}
                    </Typography>
                  )}
                </Paper>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  🔄 Automatic Updates:
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <Public color="primary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Continuous Deployment" 
                      secondary="Every push to your main branch automatically triggers a new deployment"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Speed color="primary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Global CDN" 
                      secondary="Your survey is served from Vercel's global network for fast loading worldwide"
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
                  🎉 Survey is Live!
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
      <SurveyPreflight surveyConfig={surveyConfig} currentProject={currentProject} />
      <ProjectVersions
        currentProject={currentProject}
        hasUnsavedChanges={hasUnsavedChanges}
        onReleased={onReleased}
      />
      <Box sx={{ mb: 4 }}>
        <AdminPageHeader
          icon={<Language />}
          title={t.shareTitle}
          description={t.shareDescription}
        />

        {/* Benefits Overview */}
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            🚀 Why Deploy to Vercel?
          </Typography>
          <Typography variant="body2" component="div">
            • <strong>Free Hosting:</strong> No cost for personal and small projects<br/>
            • <strong>Automatic Deployments:</strong> Updates deploy automatically from GitHub<br/>
            • <strong>Global CDN:</strong> Fast loading times worldwide<br/>
            • <strong>HTTPS Security:</strong> Secure connections by default<br/>
            • <strong>Custom Domains:</strong> Use your own domain name (optional)
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
                      <Typography variant="caption">Last step</Typography>
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
                        {index === steps.length - 1 ? 'Finish' : 'Continue'}
                      </Button>
                      <Button
                        disabled={index === 0}
                        onClick={handleBack}
                        sx={{ mt: 1, mr: 1 }}
                      >
                        Back
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
                🎉 Congratulations! Your survey is now live!
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                You have successfully deployed your survey to Vercel. Participants can now access your survey online.
              </Typography>
              <Button onClick={handleReset} sx={{ mt: 1, mr: 1 }} variant="outlined">
                Review Steps Again
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
