import { createClient } from '@supabase/supabase-js'
import { API_ROOT } from './apiConfig';

let supabase = null;

// ✅ Function to get Supabase configuration from sessionStorage or environment
function getSupabaseConfig() {
  console.log('=== getSupabaseConfig called ===');
  
  // First try environment variables
  const envUrl = process.env.REACT_APP_SUPABASE_URL;
  const envKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  
  console.log('Environment check:', { envUrl, envKey: envKey ? 'SET' : 'NOT_SET' });
  
  if (envUrl && envKey) {
    console.log('Using environment variables');
    return { url: envUrl, key: envKey, source: 'environment' };
  }

  // ✅ Then try sessionStorage (session-only, no quota issues)
  try {
    const savedConfig = sessionStorage.getItem('supabase_config');
    console.log('sessionStorage raw:', savedConfig);
    
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      console.log('sessionStorage parsed:', parsed);
      
      if (parsed.enabled && parsed.url && (parsed.secretKey || parsed.anonKey)) {
        console.log('Using sessionStorage config');
        // Support both new secretKey and legacy anonKey for backward compatibility
        return { url: parsed.url, key: parsed.secretKey || parsed.anonKey, source: 'sessionStorage' };
      } else {
        console.log('sessionStorage config incomplete or disabled');
      }
    } else {
      console.log('No sessionStorage config found');
    }
  } catch (error) {
    console.error('Error loading Supabase config from sessionStorage:', error);
  }

  console.log('No valid config found, returning null');
  return null;
}

// Validate URL format
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Initialize or re-initialize Supabase client
function initializeSupabase() {
  console.log('=== initializeSupabase called ===');
  const config = getSupabaseConfig();
  console.log('Config result:', config);
  
  if (config) {
    // Validate URL before creating client
    if (!isValidUrl(config.url)) {
      console.error('Invalid URL format:', config.url);
      supabase = null;
      return supabase;
    }

    // Validate API key format (basic check)
    if (!config.key || config.key.length < 20) {
      console.error('Invalid API key format');
      supabase = null;
      return supabase;
    }

    // Only create new client if config changed or no client exists
    if (!supabase || 
        supabase.supabaseUrl !== config.url || 
        supabase.supabaseKey !== config.key) {
      console.log(`Initializing Supabase client from ${config.source}`);
      console.log('URL:', config.url);
      console.log('Key:', config.key ? `${config.key.substring(0, 20)}...` : 'NONE');
      
      try {
        supabase = createClient(config.url, config.key, {
          auth: {
            persistSession: false // Avoid session conflicts
          }
        });
        console.log('Supabase client created successfully');
      } catch (error) {
        console.error('Error creating Supabase client:', error);
        supabase = null;
      }
    } else {
      console.log('Supabase client already initialized with same config');
    }
  } else {
    console.log('No Supabase config found, client disabled');
    supabase = null;
  }
  console.log('Final supabase client:', supabase ? 'INITIALIZED' : 'NULL');
  return supabase;
}

// Initialize on module load
console.log('=== Supabase Module Loading ===');
initializeSupabase();

// Export function to re-initialize (useful after config changes)
export const reinitializeSupabase = initializeSupabase;

/** Persist project Supabase credentials to sessionStorage and refresh the client. */
export function applySupabaseConfigFromProject(imageDatasetConfig) {
  if (!imageDatasetConfig?.supabaseUrl || !imageDatasetConfig?.supabaseKey) return;
  try {
    sessionStorage.setItem('supabase_config', JSON.stringify({
      enabled: true,
      url: imageDatasetConfig.supabaseUrl,
      secretKey: imageDatasetConfig.supabaseKey,
      anonKey: imageDatasetConfig.supabaseAnonKey || null,
    }));
    initializeSupabase();
  } catch (err) {
    console.error('applySupabaseConfigFromProject:', err);
  }
}

// Export the current supabase client
export { supabase };

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return supabase !== null
}

// Function to save survey response
export async function saveSurveyResponse(completeData) {
  try {
    if (!supabase) {
      // ✅ If Supabase is not configured, save to file as fallback (no localStorage!)
      const participantId = completeData.participant_id || generateParticipantId()
      const responseData = {
        participant_id: participantId,
        project_id: completeData.project_id || null,
        responses: completeData.responses,
        displayed_images: completeData.displayed_images,
        survey_metadata: completeData.survey_metadata,
        saved_at: new Date().toISOString()
      }
      
      // Save to file via API
      try {
        const response = await fetch(`${API_ROOT}/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(responseData)
        });
        
        if (response.ok) {
          console.log('Survey response saved to file:', responseData)
          return { success: true, data: responseData, storage: 'file' }
        } else {
          throw new Error('Failed to save response to file');
        }
      } catch (fileError) {
        console.error('Error saving to file:', fileError);
        // As last resort, return error (don't use localStorage)
        return { success: false, error: 'Supabase not configured and file save failed', storage: 'none' }
      }
    }

    const participantId = completeData.participant_id || generateParticipantId();
    const { data, error } = await supabase
      .from('survey_responses')
      .insert([
        {
          participant_id: participantId,
          project_id: completeData.project_id || null,
          responses: completeData.responses,
          displayed_images: completeData.displayed_images,
          survey_metadata: completeData.survey_metadata
        }
      ])
    
    if (error) throw error
    
    console.log('Survey response saved to Supabase:', data)
    return { success: true, data, storage: 'supabase' }
  } catch (error) {
    console.error('Error saving survey response:', error)
    return { success: false, error }
  }
}

// Function to get street images from database
export async function getStreetImages() {
  try {
    if (!supabase) {
      console.warn('Supabase not configured, returning empty images array')
      return { success: true, data: [] }
    }

    const { data, error } = await supabase
      .from('street_images')
      .select('*')
      .eq('active', true)
    
    if (error) throw error
    
    return { success: true, data }
  } catch (error) {
    console.error('Error fetching street images:', error)
    return { success: false, error }
  }
}

// Generate a unique participant ID
function generateParticipantId() {
  return 'participant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

// Create survey-images bucket if it doesn't exist
async function ensureSurveyImagesBucket() {
  if (!supabase) return false;

  try {
    // Check if survey-images bucket exists
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const imagesBucket = buckets.find(bucket => bucket.name === 'survey-images');
    
    if (!imagesBucket) {
      console.log('Survey-images bucket not found, creating...');
      
      // Create the survey-images bucket with increased limits
      const { data, error: createError } = await supabase.storage.createBucket('survey-images', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        fileSizeLimit: 52428800 // 50MB per file (increased from 10MB)
      });

      if (createError) {
        console.error('Error creating survey-images bucket:', createError);
        return false;
      }

      console.log('Survey-images bucket created successfully:', data);
      return true;
    } else {
      // Bucket exists, try to update its configuration
      console.log('Survey-images bucket exists, updating configuration...');
      
      try {
        const { data: updateData, error: updateError } = await supabase.storage.updateBucket('survey-images', {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
          fileSizeLimit: 52428800 // 50MB per file
        });

        if (updateError) {
          console.warn('Could not update bucket configuration:', updateError.message);
          // Don't fail if update doesn't work, bucket still exists
        } else {
          console.log('Bucket configuration updated successfully');
        }
      } catch (updateErr) {
        console.warn('Bucket update not supported or failed:', updateErr);
      }
    }

    return true; // Bucket exists
  } catch (error) {
    console.error('Error ensuring survey-images bucket:', error);
    return false;
  }
}

// Upload image to Supabase Storage (Cloud Only - No Local Fallback)
export async function uploadImage(file) {
  try {
    if (!supabase) {
      throw { 
        message: 'Supabase is not configured. Cloud storage is required for image uploads.', 
        name: 'ConfigurationError' 
      };
    }

    // Ensure survey-images bucket exists
    const bucketReady = await ensureSurveyImagesBucket();
    if (!bucketReady) {
      throw { message: 'Failed to create or access survey-images bucket', name: 'BucketAccessError' };
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`

    // Upload file to Supabase Storage (directly to bucket root)
    const { data, error } = await supabase.storage
      .from('survey-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) throw error

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('survey-images')
      .getPublicUrl(fileName)

    console.log('Image uploaded to Supabase:', publicUrl)
    return { 
      success: true, 
      url: publicUrl, 
      path: fileName,
      isLocal: false
    }
  } catch (error) {
    console.error('Error uploading image:', error)
    
    // No local fallback - fail completely if cloud upload fails
    return { 
      success: false, 
      error,
      isLocal: false,
      message: `Upload failed: ${error.message}. Cloud storage is required for all images.`
    }
  }
}

// Delete image from Supabase Storage
export async function deleteImage(imagePath) {
  try {
    if (!supabase) {
      throw { 
        message: 'Supabase is not configured. Cannot delete cloud images.', 
        name: 'ConfigurationError' 
      };
    }

    if (!imagePath) {
      throw { 
        message: 'No image path provided for deletion.', 
        name: 'ValidationError' 
      };
    }

    const { data, error } = await supabase.storage
      .from('survey-images')
      .remove([imagePath])

    if (error) throw error

    console.log('Image deleted from Supabase:', imagePath)
    return { success: true, data }
  } catch (error) {
    console.error('Error deleting image:', error)
    return { success: false, error }
  }
}

// Sync/Refresh images from Supabase Storage
export async function syncImagesFromSupabase() {
  try {
    if (!supabase) {
      throw { 
        message: 'Supabase is not configured. Cannot sync images.', 
        name: 'ConfigurationError' 
      };
    }

    // List all files in the survey-images bucket
    const { data: files, error } = await supabase.storage
      .from('survey-images')
      .list('', {
        limit: 10000, // Increased from 1000 to support more images
        sortBy: { column: 'created_at', order: 'desc' }
      })

    if (error) throw error

    // Convert to our image format
    const images = files.map(file => {
      const { data: { publicUrl } } = supabase.storage
        .from('survey-images')
        .getPublicUrl(file.name)

      return {
        id: file.id || Date.now() + Math.random(),
        name: file.name,
        url: publicUrl,
        path: file.name,
        size: file.metadata?.size || 0,
        type: 'cloud',
        uploadDate: file.created_at || new Date().toISOString(),
        tags: [],
        isLocal: false
      }
    })

    console.log('Synced images from Supabase:', images.length)
    return { success: true, images }
  } catch (error) {
    console.error('Error syncing images from Supabase:', error)
    return { success: false, error, images: [] }
  }
}

// Check image folder status - new function for simplified image manager
export async function checkImageFolderStatus() {
  try {
    if (!supabase) {
      throw { 
        message: 'Supabase is not configured. Cannot check folder status.', 
        name: 'ConfigurationError' 
      };
    }

    // Check if survey-images bucket exists
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) throw bucketsError;

    const surveyImagesBucket = buckets.find(bucket => bucket.name === 'survey-images');
    
    if (!surveyImagesBucket) {
      return {
        success: true,
        connected: true,
        bucketExists: false,
        imageCount: 0,
        message: 'Bucket "survey-images" not found. Please create it manually in Supabase Storage.'
      };
    }

    // List files in the survey-images bucket
    const { data: files, error: filesError } = await supabase.storage
      .from('survey-images')
      .list('', {
        limit: 10000 // Increased to support more images
      });

    if (filesError) throw filesError;

    // Filter out folders and count only image files
    const imageFiles = files.filter(file => 
      file.name && 
      !file.name.endsWith('/') && 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
    );

    return {
      success: true,
      connected: true,
      bucketExists: true,
      imageCount: imageFiles.length,
      message: `Found ${imageFiles.length} images in survey-images bucket.`
    };

  } catch (error) {
    console.error('Error checking image folder status:', error);
    return {
      success: false,
      connected: false,
      bucketExists: false,
      imageCount: 0,
      error: error.message,
      message: `Connection failed: ${error.message}`
    };
  }
}

// Get all images from Supabase storage with their URLs
export const getAllImagesFromSupabase = async (bucketPath = 'survey-images', customSupabaseClient = null) => {
  try {
    // Use custom client if provided, otherwise use global client
    const clientToUse = customSupabaseClient || supabase;
    
    if (!customSupabaseClient && !isSupabaseConfigured()) {
      return {
        success: false,
        images: [],
        message: 'Supabase not configured'
      };
    }

    if (!clientToUse) {
      return {
        success: false,
        images: [],
        message: 'No Supabase client available'
      };
    }

    // Parse bucket path (could be "bucket" or "bucket/folder/subfolder")
    const pathParts = bucketPath.split('/');
    const bucketName = pathParts[0];
    const folderPath = pathParts.slice(1).join('/');

    console.log('Getting images from bucket:', bucketName, 'folder:', folderPath);

    // List files in the specified bucket and folder
    const { data: files, error: filesError } = await clientToUse.storage
      .from(bucketName)
      .list(folderPath, {
        limit: 10000, // Increased to support more images
        sortBy: { column: 'name', order: 'asc' }
      });

    if (filesError) {
      console.error('Error listing files:', filesError);
      return {
        success: false,
        images: [],
        message: `Error listing files: ${filesError.message}`
      };
    }

    // Filter image files and get their public URLs
    const imageFiles = files.filter(file => 
      file.name && 
      !file.name.endsWith('/') && 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
    );

    const images = imageFiles.map(file => {
      const filePath = folderPath ? `${folderPath}/${file.name}` : file.name;
      const { data: urlData } = clientToUse.storage
        .from(bucketName)
        .getPublicUrl(filePath);
      
      return {
        name: file.name,
        path: filePath,
        url: urlData.publicUrl,
        size: file.metadata?.size || 0,
        lastModified: file.updated_at || file.created_at
      };
    });

    console.log(`Found ${images.length} images in ${bucketPath}`);

    return {
      success: true,
      images: images,
      message: `Found ${images.length} images`
    };

  } catch (error) {
    console.error('Error getting images from Supabase:', error);
    return {
      success: false,
      images: [],
      message: `Error: ${error.message}`
    };
  }
} 