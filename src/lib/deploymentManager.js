import { getImagesFromHuggingFace } from './huggingface';
import { API_ROOT } from './apiConfig';

export const prepareDeploymentFolder = async (currentProject) => {
  try {
    console.log('🚀 Preparing deployment folder...');
    
    // 1. Create deployment folder structure
    const deploymentData = {
      projectName: currentProject?.name || 'survey-project',
      timestamp: new Date().toISOString(),
      config: currentProject,
      preloadedImages: null
    };

    // 2. Pre-fetch all Hugging Face images only when Supabase images are not already available.
    // If the user already transferred images to Supabase Storage (preloadedImages contains
    // Supabase URLs), skip the HuggingFace fetch so the deployment uses those stable URLs.
    const hasSupabaseImages = currentProject?.preloadedImages?.length > 0;
    if (!hasSupabaseImages && currentProject?.imageDatasetConfig?.enabled && currentProject?.imageDatasetConfig?.datasetName) {
      console.log('📸 Pre-fetching Hugging Face images (no Supabase images found)...');
      deploymentData.preloadedImages = await preloadHuggingFaceImages(currentProject.imageDatasetConfig);
    } else if (hasSupabaseImages) {
      console.log(`📦 Using ${currentProject.preloadedImages.length} existing Supabase images for deployment (skipping HuggingFace fetch)`);
    }

    // 3. Generate deployment files
    const deploymentFiles = await generateDeploymentFiles(deploymentData);
    
    // 4. Create the deployment folder
    const response = await fetch(`${API_ROOT}/create-deployment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: deploymentData.projectName,
        files: deploymentFiles
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create deployment folder: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      success: true,
      deploymentPath: result.deploymentPath,
      preloadedImageCount: deploymentData.preloadedImages?.length || 0,
      message: `Deployment folder created successfully at: ${result.deploymentPath}`
    };

  } catch (error) {
    console.error('❌ Deployment preparation failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

const preloadHuggingFaceImages = async (imageDatasetConfig) => {
  try {
    const { huggingFaceToken, datasetName } = imageDatasetConfig;
    
    console.log(`🔄 Loading all images from dataset: ${datasetName}`);
    
    // Load ALL images from the dataset
    const allImages = [];
    let offset = 0;
    const batchSize = 100;
    let hasMore = true;
    
    while (hasMore) {
      const result = await getImagesFromHuggingFace(huggingFaceToken, datasetName, batchSize, offset);
      
      if (result.success && result.images.length > 0) {
        allImages.push(...result.images);
        offset += batchSize;
        
        console.log(`📥 Loaded batch: ${result.images.length} images (total: ${allImages.length})`);
        
        // Check if we've reached the end
        if (result.images.length < batchSize || (result.total && offset >= result.total)) {
          hasMore = false;
        }
      } else {
        hasMore = false;
        if (allImages.length === 0) {
          throw new Error(`Failed to load images: ${result.error}`);
        }
      }
    }
    
    // Normalize image names for deployment so response records are stable and readable.
    // This avoids inconsistent provider-specific names like dataset_row_column variants.
    const normalizedImages = allImages.map((image, index) => {
      const normalizedName = `image_${String(index).padStart(6, '0')}.jpg`;
      return {
        ...image,
        originalName: image.name || null,
        name: normalizedName
      };
    });

    console.log(`✅ Successfully preloaded ${normalizedImages.length} images from Hugging Face`);
    return normalizedImages;
    
  } catch (error) {
    console.error('❌ Failed to preload Hugging Face images:', error);
    throw error;
  }
};

const generateDeploymentFiles = async (deploymentData) => {
  const files = {};
  const projectSupabase = deploymentData?.config?.supabaseConfig || {};
  const imageDatasetSupabaseUrl = deploymentData?.config?.imageDatasetConfig?.supabaseUrl || '';
  const imageDatasetSupabaseAnonKey = deploymentData?.config?.imageDatasetConfig?.supabaseAnonKey || '';
  const resolvedSupabaseUrl = projectSupabase.url || imageDatasetSupabaseUrl || 'your-supabase-project-url';
  const resolvedAnonKey =
    imageDatasetSupabaseAnonKey ||
    projectSupabase.anonKey ||
    projectSupabase.publicKey ||
    'your-supabase-anon-key';
  
  // 1. Package.json for deployment (survey-only, minimal dependencies)
  files['package.json'] = JSON.stringify({
    "name": deploymentData.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    "version": "1.0.0",
    "private": true,
    "dependencies": {
      "@dnd-kit/core": "^6.0.8",
      "@dnd-kit/sortable": "^7.0.2",
      "@dnd-kit/utilities": "^3.2.1",
      "@emotion/react": "^11.11.1",
      "@emotion/styled": "^11.11.0",
      "@mui/material": "^5.14.20",
      "@supabase/supabase-js": "^2.38.4",
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "react-scripts": "5.0.1",
      "survey-core": "^1.9.131",
      "survey-react-ui": "^1.9.131"
    },
    "devDependencies": {
      "cross-env": "^7.0.3"
    },
    "scripts": {
      "start": "react-scripts start",
      "build": "cross-env CI=false react-scripts build",
      "test": "react-scripts test",
      "eject": "react-scripts eject"
    },
    "eslintConfig": {
      "extends": [
        "react-app",
        "react-app/jest"
      ]
    },
    "browserslist": {
      "production": [
        ">0.2%",
        "not dead",
        "not op_mini all"
      ],
      "development": [
        "last 1 chrome version",
        "last 1 firefox version",
        "last 1 safari version"
      ]
    }
  }, null, 2);

  // 2. Vercel configuration (survey-only SPA)
  files['vercel.json'] = JSON.stringify({
    "buildCommand": "npm run build",
    "build": {
      "env": {
        "REACT_APP_SUPABASE_URL": resolvedSupabaseUrl,
        "REACT_APP_SUPABASE_ANON_KEY": resolvedAnonKey
      }
    },
    "env": {
      "REACT_APP_SUPABASE_URL": resolvedSupabaseUrl,
      "REACT_APP_SUPABASE_ANON_KEY": resolvedAnonKey
    },
    "rewrites": [
      {
        "source": "/(.*)",
        "destination": "/index.html"
      }
    ]
  }, null, 2);

  // 3. Environment template
  files['.env.example'] = `# Supabase Configuration
REACT_APP_SUPABASE_URL=your-supabase-project-url
REACT_APP_SUPABASE_ANON_KEY=your-supabase-anon-key

# Hugging Face Configuration (Optional)
REACT_APP_HUGGINGFACE_TOKEN=your-huggingface-token

# Production Settings
REACT_APP_ENVIRONMENT=production
GENERATE_SOURCEMAP=false`;

  // 3b. Generate .env directly to reduce deployment setup errors.
  // Important: frontend builds should use ANON/public key, never service_role key.
  files['.env'] = `# Auto-generated from deployment setup
# Please verify values before publishing.
REACT_APP_SUPABASE_URL=${resolvedSupabaseUrl}
REACT_APP_SUPABASE_ANON_KEY=${resolvedAnonKey}

# Hugging Face Configuration (Optional)
REACT_APP_HUGGINGFACE_TOKEN=your-huggingface-token

# Production Settings
REACT_APP_ENVIRONMENT=production
GENERATE_SOURCEMAP=false`;

  // 4. README for deployment
  files['README.md'] = `# ${deploymentData.projectName}

This is a survey application built with React and deployed on Vercel.

## Quick Start

1. Clone this repository
2. Install dependencies: \`npm install\`
3. Copy \`.env.example\` to \`.env\` and fill in your configuration
4. Start development server: \`npm start\`
5. Build for production: \`npm run build\`

## Deployment

This project is configured for easy deployment on Vercel:

1. Push to GitHub
2. Connect your repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically

## Configuration

- **Supabase**: Database for storing survey responses
- **Hugging Face**: Image datasets for survey questions
- **Vercel**: Hosting and deployment platform

Generated on: ${new Date(deploymentData.timestamp).toLocaleString()}
`;

  // 5. Project configuration with preloaded images
  if (deploymentData.config) {
    const configWithPreloadedImages = { ...deploymentData.config };
    
    // Add preloaded images to the configuration.
    // deploymentData.preloadedImages is set only when images were re-fetched from HuggingFace.
    // Otherwise, configWithPreloadedImages.preloadedImages already carries the Supabase URLs
    // from currentProject, so we just stamp the deployment timestamp.
    if (deploymentData.preloadedImages) {
      configWithPreloadedImages.preloadedImages = deploymentData.preloadedImages;
      configWithPreloadedImages.imagePreloadTimestamp = deploymentData.timestamp;
    } else if (configWithPreloadedImages.preloadedImages?.length > 0) {
      configWithPreloadedImages.imagePreloadTimestamp = deploymentData.timestamp;
    }
    
    files['src/config/deploymentConfig.js'] = `// Auto-generated deployment configuration
// Generated on: ${new Date(deploymentData.timestamp).toLocaleString()}

export const deploymentConfig = ${JSON.stringify(configWithPreloadedImages, null, 2)};

export const getPreloadedImages = () => {
  return deploymentConfig.preloadedImages || [];
};

export const isImagePreloaded = () => {
  return deploymentConfig.preloadedImages && deploymentConfig.preloadedImages.length > 0;
};
`;
  }

  // 6. Generate simplified App.js for deployment (Survey only, no Admin)
  files['src/App.js'] = `import React from "react";
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import SurveyAppClean from "./SurveyAppClean";

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SurveyAppClean />
    </ThemeProvider>
  );
}
`;

  // 7. Generate clean SurveyApp without navigation buttons (deployment-only)
  files['src/SurveyAppClean.js'] = `import React, { useState, useEffect } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import { Box, Alert, CircularProgress, Typography } from '@mui/material';
import { saveSurveyResponse } from './lib/supabase';
import { deploymentConfig, getPreloadedImages } from './config/deploymentConfig';
import { applyAdminThemeToSurveyModel, buildSurveyHostStyle } from './lib/surveyStorage';
import registerImageRankingWidget, { registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget } from './components/SurveyCustomComponents';

export default function SurveyAppClean() {
  const [surveyModel, setSurveyModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    initializeSurvey();
  }, []);

  const initializeSurvey = async () => {
    try {
      setLoading(true);
      console.log('Starting survey initialization...');
      const imageTracker = {};
      const globallyUsedImageKeys = new Set();
      const getImageKey = (image) => image?.name || image?.url;
      const shouldExcludePreviouslyUsedImages = (element) => element.excludePreviouslyUsedImages !== false;
      const pickRandomImagesFromPool = (pool, imageCount, excludeUsed) => {
        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        if (!excludeUsed) {
          return shuffled.slice(0, imageCount);
        }
        const filtered = shuffled.filter((image) => {
          const key = getImageKey(image);
          return key && !globallyUsedImageKeys.has(key);
        });
        return filtered.slice(0, imageCount);
      };
      const trackGloballyUsedImages = (selectedImages, excludeUsed) => {
        if (!excludeUsed) return;
        selectedImages.forEach((image) => {
          const key = getImageKey(image);
          if (key) globallyUsedImageKeys.add(key);
        });
      };
      
      // Register custom components
      registerImageRankingWidget();
      registerImageRatingWidget();
      registerImageBooleanWidget();
      registerImageMatrixWidget();
      console.log('Custom widgets registered');
      
      // Deep clone deployment configuration to avoid mutations
      const surveyConfig = JSON.parse(JSON.stringify(deploymentConfig));
      
      if (!surveyConfig) {
        throw new Error('Deployment configuration not found');
      }
      
      if (!surveyConfig.pages || surveyConfig.pages.length === 0) {
        throw new Error('No pages found in survey configuration');
      }
      
      console.log(\`Survey config loaded: \${surveyConfig.pages.length} pages\`);

      // Process preloaded images if available
      const preloadedImages = getPreloadedImages();
      
      if (preloadedImages && preloadedImages.length > 0) {
        console.log(\`Using \${preloadedImages.length} preloaded images from deployment\`);
        
        // Replace image URLs in survey config with preloaded ones
        if (surveyConfig.pages) {
          for (const page of surveyConfig.pages) {
            if (page.elements) {
              for (const element of page.elements) {
                // Handle different image question types
                if (element.randomImageSelection && preloadedImages.length > 0) {
                  // Use type-specific defaults if imageCount is not set
                  const defaultCount = (element.type === 'imagerating' || element.type === 'imagematrix' || element.type === 'imageboolean' || element.type === 'image') ? 1 : 4;
                  const imageCount = element.imageCount || defaultCount;
                  const excludeUsed = shouldExcludePreviouslyUsedImages(element);
                  const selectedImages = pickRandomImagesFromPool(preloadedImages, imageCount, excludeUsed);
                  trackGloballyUsedImages(selectedImages, excludeUsed);
                  
                  if (element.type === 'image') {
                    element.imageLink = selectedImages[0].url;
                    element.imageName = selectedImages[0].name || selectedImages[0].url;
                  } else if (element.type === 'imageboolean' || element.type === 'imagerating' || element.type === 'imagematrix') {
                    // For imageboolean, imagerating, and imagematrix questions, store imageHtml.
                    // The .sp-image-gallery class is picked up by
                    // src/lib/imagePickerLayout.js for uniform per-question
                    // image heights at natural aspect ratio.
                    let imagesHtml = '<div class="sp-image-gallery">';
                    selectedImages.forEach((image) => {
                      imagesHtml += \`<div class="sp-image-gallery__item"><div class="sp-image-gallery__image-container"><img src="\${image.url}" alt="\${image.name || ''}" /></div></div>\`;
                    });
                    imagesHtml += '</div>';
                    
                    element.imageHtml = imagesHtml;
                    element.imageNames = selectedImages.map((img) => img.name || img.url);
                  } else {
                    element.choices = selectedImages.map((image, index) => ({
                      value: \`image_\${index}\`,
                      imageLink: image.url,
                      imageName: image.name || image.url
                    }));
                    element.imageNames = selectedImages.map((img) => img.name || img.url);
                  }
                  imageTracker[element.name] = selectedImages.map((img) => img.name || img.url);
                  // Default to "contain" so images keep their natural aspect ratio.
                  if (!element.imageFit) {
                    element.imageFit = "contain";
                  }
                }
              }
            }
          }
        }
      } else {
        console.warn('No preloaded images available');
      }
      
      // Keep custom image widgets as-is (no "See below images:" panel split).
      // trial=1 and trial>1 both use the same React question components.

      // Create survey model
      console.log('Creating survey model...');
      const model = new Model(surveyConfig);
      console.log('Survey model created successfully');
      
      // Keep standalone deployments identical to both admin previews and Live Survey.
      applyAdminThemeToSurveyModel(model, surveyConfig);
      
      // Apply survey configuration
      model.title = surveyConfig.title || '';
      model.description = surveyConfig.description || '';
      model.logo = surveyConfig.logo || '';
      model.logoPosition = surveyConfig.logoPosition || 'right';

      // Handle survey completion
      model.onComplete.add(async (survey, options) => {
        const responses = survey.data;
        const mapImageChoiceAnswerToNames = (answerValue, shownImages) => {
          if (!shownImages || shownImages.length === 0) return answerValue;
          const mapSingleValue = (value) => {
            if (typeof value !== 'string') return value;
            const match = value.match(/^image_(\\d+)$/);
            if (!match) return value;
            const imageIndex = parseInt(match[1], 10);
            return shownImages[imageIndex] || value;
          };
          if (Array.isArray(answerValue)) return answerValue.map(mapSingleValue);
          return mapSingleValue(answerValue);
        };
        const surveyQuestionTypeMap = {};
        survey.getAllQuestions().forEach((question) => {
          surveyQuestionTypeMap[question.name] = question.getType();
        });
        const enrichedResponses = Object.entries(responses).reduce((acc, [questionName, answerValue]) => {
          const shownImages = imageTracker[questionName] || [];
          acc[questionName] = {
            type: surveyQuestionTypeMap[questionName] || null,
            answer: mapImageChoiceAnswerToNames(answerValue, shownImages),
            shown_images: shownImages
          };
          return acc;
        }, {});
        
        const completeData = {
          responses: enrichedResponses,
          raw_responses: responses,
          displayed_images: imageTracker,
          survey_metadata: {
            completion_time: new Date().toISOString(),
            user_agent: navigator.userAgent,
            screen_resolution: \`\${window.screen.width}x\${window.screen.height}\`,
            survey_version: deploymentConfig.name || 'deployment',
            project_id: deploymentConfig.id || 'unknown'
          }
        };
        
        console.log("Survey completed:", completeData);
        
        // Save to Supabase
        const result = await saveSurveyResponse(completeData);
        
        if (result.success) {
          const storageMessage = result.storage === 'supabase'
            ? "Thank you for completing the survey! Your responses have been saved to the database."
            : "Thank you for completing the survey! Your responses have been saved locally.";
          alert(storageMessage);
        } else {
          console.error("Failed to save survey response:", result.error);
          const errorMessage = result?.error?.message || result?.error || 'Unknown error';
          alert(\`There was an error saving your responses: \${errorMessage}\`);
        }
      });

      setSurveyModel(model);
      setError(null);
    } catch (err) {
      console.error('Error initializing survey:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Loading survey...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3, maxWidth: 800, mx: 'auto', mt: 4 }}>
        <Alert severity="error">
          <strong>Error loading survey:</strong><br/>
          {error}
          <br/><br/>
          Please check the browser console (F12) for more details.
        </Alert>
      </Box>
    );
  }

  if (!surveyModel) {
    return (
      <Box sx={{ p: 3, maxWidth: 800, mx: 'auto', mt: 4 }}>
        <Alert severity="warning">
          Survey model not initialized. Please refresh the page.
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      className="sp-survey-theme-host"
      style={buildSurveyHostStyle(surveyConfig.theme || {})}
      sx={{ minHeight: '100vh' }}
    >
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: 3 }}>
        <Survey model={surveyModel} />
      </Box>
    </Box>
  );
}
`;

  // 7. .gitignore file for deployment
  files['.gitignore'] = `# Dependencies
node_modules/
/.pnp
.pnp.js

# Testing
/coverage

# Production build
/build

# Misc
.DS_Store
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
Thumbs.db

# Optional: Uncomment if you want to exclude the deployment config
# src/config/deploymentConfig.js
`;

  // 8. Deployment instructions
  files['DEPLOYMENT.md'] = `# Deployment Instructions

## Step 1: Prepare Repository

This folder contains all the files needed for deployment.

**IMPORTANT: Run these commands from THIS deployment folder, not the source directory!**

### 📁 Files Included

- ✅ Source code (src/)
- ✅ Public assets (public/)
- ✅ Package configuration (package.json)
- ✅ Deployment config with preloaded images
- ✅ .gitignore (excludes node_modules/, build/, etc.)

**Note:** The \`.gitignore\` file is configured to exclude:
- \`node_modules/\` - Will be reinstalled on Vercel
- \`build/\` - Will be rebuilt on Vercel
- IDE and OS temporary files

This keeps your repository clean and avoids uploading large files to GitHub.

\`\`\`bash
# Make sure you're in the deployment folder
pwd  # Should show: .../deployments/your-project-name-timestamp

# Install dependencies and test build
npm install
npm run build

# Initialize git repository
git init
git add .
git commit -m "Initial survey deployment setup"

# Add remote repository (replace with your GitHub repo URL)
git remote add origin https://github.com/yourusername/your-survey-repo.git
git branch -M main
git push -u origin main
\`\`\`

## Step 2: Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Configure environment variables:
   - Copy values from \`.env.example\`
   - Use Supabase **anon/public** key for \`REACT_APP_SUPABASE_ANON_KEY\` (never service_role key)
   - Set them in Vercel dashboard under Settings → Environment Variables
4. Deploy!

## Step 3: Test Your Survey

- Live Survey: \`https://your-project.vercel.app/\`

**Note:** This deployment is survey-only. No admin panel is included in the deployed version.

## Preloaded Images

${deploymentData.preloadedImages
  ? `✅ This deployment includes ${deploymentData.preloadedImages.length} preloaded images fetched from Hugging Face.\nThey are embedded in deploymentConfig.js and served from Hugging Face URLs.`
  : deploymentData.config?.preloadedImages?.length > 0
    ? `✅ This deployment includes ${deploymentData.config.preloadedImages.length} preloaded images from Supabase Storage.\nThese are permanent, stable URLs — no HuggingFace dependency at runtime.`
    : `ℹ️ No images were preloaded. Images will be loaded dynamically during the survey.`}

---
Generated on: ${new Date(deploymentData.timestamp).toLocaleString()}
`;

  return files;
};

export const getDeploymentStatus = async () => {
  try {
    const response = await fetch(`${API_ROOT}/deployment-status`);
    if (!response.ok) {
      throw new Error('Failed to get deployment status');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to get deployment status:', error);
    return { deployments: [] };
  }
};

export const testDeployment = async (deploymentPath) => {
  try {
    console.log('🧪 Testing deployment build...');
    
    const response = await fetch(`${API_ROOT}/test-deployment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deploymentPath })
    });

    if (!response.ok) {
      throw new Error(`Failed to test deployment: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('❌ Deployment test failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

export const uploadToGitHub = async (deploymentPath, githubRepoUrl, commitMessage = 'Initial deployment setup') => {
  try {
    console.log('📤 Uploading to GitHub...');
    
    const response = await fetch(`${API_ROOT}/upload-to-github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        deploymentPath,
        githubRepoUrl,
        commitMessage
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to upload to GitHub: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('❌ GitHub upload failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
