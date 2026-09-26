import { Serializer } from 'survey-core';
import { getImagesFromHuggingFace } from './huggingface';
import { API_ROOT } from './apiConfig';
import { stripSecretFields } from './secretFields';

// SP-Survey fields the participant bundle reads in addition to SurveyJS survey properties.
const SP_SURVEY_PARTICIPANT_FIELDS = [
  'id',
  'name',
  'theme',
  'settings',
  'preloadedImages',
  'completionMessage',
  'responseQuota',
  'mediaFolderTags',
  'publishedVersion',
  'locale',
];

export const PARTICIPANT_DEPENDENCIES = [
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@emotion/react',
  '@emotion/styled',
  '@mui/icons-material',
  '@mui/material',
  '@supabase/supabase-js',
  'polygon-clipping',
  'react',
  'react-dom',
  'react-scripts',
  'survey-core',
  'survey-react-ui',
];

export const PARTICIPANT_DEV_DEPENDENCIES = ['cross-env'];

const toDependencyPlaceholders = (names) => names.reduce((deps, name) => {
  deps[name] = '*';
  return deps;
}, {});

export const getParticipantConfigFields = () => new Set([
  ...Serializer.getProperties('survey').map((property) => property.name),
  ...SP_SURVEY_PARTICIPANT_FIELDS,
]);

const resolveMediaFolderTagsFromProject = (config) => (
  config?.mediaFolderTags
  || config?.imageDatasetConfig?.mediaFolderTags
  || config?.publishedMedia?.imageDatasetConfig?.mediaFolderTags
  || null
);

// Prefer the released snapshot when one exists; otherwise the current draft/project merge.
export const resolveParticipantSourceConfig = (currentProject) => {
  const released = currentProject?.publishedSurveyConfig;
  const sourceConfig = (currentProject?.releaseManaged && released) ? released : currentProject;
  const mediaFolderTags = resolveMediaFolderTagsFromProject(currentProject)
    || resolveMediaFolderTagsFromProject(sourceConfig);
  const publishedVersion = currentProject?.publishedVersion ?? sourceConfig?.publishedVersion;
  return {
    ...(sourceConfig || {}),
    id: currentProject?.id || sourceConfig?.id,
    name: currentProject?.name || sourceConfig?.name,
    preloadedImages: currentProject?.preloadedImages
      || currentProject?.publishedMedia?.preloadedImages
      || sourceConfig?.preloadedImages,
    ...(mediaFolderTags ? { mediaFolderTags } : {}),
    ...(publishedVersion != null ? { publishedVersion } : {}),
  };
};

// Only allowlisted fields reach deploymentConfig.js; secret-named keys are stripped at any depth.
export const buildParticipantDeploymentConfig = (config, { preloadedImages, timestamp } = {}) => {
  const allowed = getParticipantConfigFields();
  const participantConfig = {};
  Object.keys(config || {}).forEach((key) => {
    if (allowed.has(key) && config[key] !== undefined) participantConfig[key] = config[key];
  });
  if (preloadedImages) participantConfig.preloadedImages = preloadedImages;
  if (participantConfig.mediaFolderTags == null) {
    const tags = resolveMediaFolderTagsFromProject(config);
    if (tags) participantConfig.mediaFolderTags = tags;
  }
  if (participantConfig.preloadedImages?.length > 0 && timestamp) {
    participantConfig.imagePreloadTimestamp = timestamp;
  }
  return stripSecretFields(participantConfig);
};

const decodeJwtPayload = (token) => {
  try {
    const segment = String(token).split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')));
  } catch (error) {
    return null;
  }
};

export const isPrivilegedSupabaseKey = (key) => {
  const value = String(key || '').trim();
  if (!value) return false;
  if (value.startsWith('sb_secret_')) return true;
  return decodeJwtPayload(value)?.role === 'service_role';
};

export const prepareDeploymentFolder = async (currentProject) => {
  try {
    console.log('🚀 Preparing deployment folder...');
    
    // 1. Create deployment folder structure from the released snapshot when present.
    const sourceConfig = resolveParticipantSourceConfig(currentProject);
    const deploymentData = {
      projectName: currentProject?.name || sourceConfig?.name || 'survey-project',
      timestamp: new Date().toISOString(),
      config: sourceConfig,
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

export const generateDeploymentFiles = async (deploymentData) => {
  const files = {};
  const projectSupabase = deploymentData?.config?.supabaseConfig || {};
  const imageDatasetSupabaseUrl = deploymentData?.config?.imageDatasetConfig?.supabaseUrl || '';
  const imageDatasetSupabaseAnonKey = deploymentData?.config?.imageDatasetConfig?.supabaseAnonKey || '';
  const resolvedSupabaseUrl = projectSupabase.url || imageDatasetSupabaseUrl || 'your-supabase-project-url';
  const candidateAnonKey =
    imageDatasetSupabaseAnonKey ||
    projectSupabase.anonKey ||
    projectSupabase.publicKey ||
    '';
  if (isPrivilegedSupabaseKey(candidateAnonKey)) {
    console.warn('⚠️ The configured Supabase anon key is a service_role/secret key; it was not written to the deployment.');
  }
  const resolvedAnonKey = candidateAnonKey && !isPrivilegedSupabaseKey(candidateAnonKey)
    ? candidateAnonKey
    : 'your-supabase-anon-key';
  
  // 1. Package.json for deployment (survey-only, minimal dependencies).
  // Versions are placeholders; /api/create-deployment pins them from the repo's package.json.
  files['package.json'] = JSON.stringify({
    "name": deploymentData.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    "version": "1.0.0",
    "private": true,
    "dependencies": toDependencyPlaceholders(PARTICIPANT_DEPENDENCIES),
    "devDependencies": toDependencyPlaceholders(PARTICIPANT_DEV_DEPENDENCIES),
    "scripts": {
      "start": "react-scripts start",
      "build": "cross-env CI=false react-scripts build",
      "test": "react-scripts test",
      "eject": "react-scripts eject"
    },
    // root stops ESLint from inheriting the parent repo's config when built under deployments/.
    "eslintConfig": {
      "root": true,
      "extends": [
        "react-app"
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

# Production Settings
REACT_APP_ENVIRONMENT=production
GENERATE_SOURCEMAP=false`;

  // 3b. Generate .env directly to reduce deployment setup errors.
  // Important: frontend builds should use ANON/public key, never service_role key.
  files['.env'] = `# Auto-generated from deployment setup
# Please verify values before publishing.
REACT_APP_SUPABASE_URL=${resolvedSupabaseUrl}
REACT_APP_SUPABASE_ANON_KEY=${resolvedAnonKey}

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
    // deploymentData.preloadedImages is set only when images were re-fetched from HuggingFace;
    // otherwise the project's own preloadedImages (Supabase URLs) are kept.
    const configWithPreloadedImages = buildParticipantDeploymentConfig(deploymentData.config, {
      preloadedImages: deploymentData.preloadedImages,
      timestamp: deploymentData.timestamp,
    });
    
    files['src/config/deploymentConfig.js'] = `// Auto-generated deployment configuration
// Generated on: ${new Date(deploymentData.timestamp).toLocaleString()}

export const deploymentConfig = ${JSON.stringify(configWithPreloadedImages, null, 2)};

export const getPreloadedImages = () => {
  return deploymentConfig.preloadedImages || [];
};

export const isImagePreloaded = () => {
  return deploymentConfig.preloadedImages && deploymentConfig.preloadedImages.length > 0;
};

export const isDeployedParticipant = () => true;
`;
  }

  // 6. Participant App.js mounts the same SurveyApp as local Live Survey (no Admin).
  files['src/App.js'] = `import React from "react";
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { RegionProvider } from "./contexts/RegionContext";
import SurveyApp from "./SurveyApp";

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
      <RegionProvider>
        <SurveyApp />
      </RegionProvider>
    </ThemeProvider>
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

# Environment files and local researcher data (may hold credentials)
.env*
!.env.example
public/projects/
public/responses/
.backups/

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
- \`.env*\` and local project/response data - Set Supabase URL and anon key in Vercel instead
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

- Participant Live Survey: \`https://your-project.vercel.app/\` (same SurveyApp as local Live Survey)
- Chinese UI: \`https://your-project.vercel.app/?locale=zh\`

The package embeds the released snapshot. Participants use only the Supabase URL and anon key.

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
