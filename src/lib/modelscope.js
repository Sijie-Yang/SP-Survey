/**
 * ModelScope (魔搭) Dataset Integration
 * Chinese-friendly alternative to HuggingFace for image datasets.
 * API reference: https://modelscope.cn/docs
 */

const MS_API_BASE = 'https://www.modelscope.cn/api/v1';
const MS_CDN_BASE = 'https://modelscope.cn';

// Simple in-memory cache (mirrors huggingface.js pattern)
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500;

const respectRateLimit = async () => {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
};

const cachedFetch = async (url, options = {}) => {
  const key = `${url}_${JSON.stringify(options.headers || {})}`;
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return { ok: true, status: 200, json: async () => cached.data };
  }

  await respectRateLimit();
  const response = await fetch(url, options);
  if (response.ok) {
    const data = await response.json();
    apiCache.set(key, { data, timestamp: Date.now() });
    return { ok: true, status: 200, json: async () => data };
  }
  return response;
};

/** Build authorization headers for ModelScope */
const buildHeaders = (token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Split a "namespace/name" dataset string into parts.
 * ModelScope datasets use the same convention as HuggingFace.
 */
const splitDatasetName = (datasetName) => {
  const parts = datasetName.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid ModelScope dataset name "${datasetName}". Expected format: "namespace/dataset-name"`
    );
  }
  return { namespace: parts[0], name: parts[1] };
};

/**
 * Construct a direct download URL for a file in a ModelScope dataset.
 */
const buildFileUrl = (namespace, name, filePath) =>
  `${MS_CDN_BASE}/datasets/${namespace}/${name}/resolve/master/${filePath}`;

/**
 * Test connection to a ModelScope dataset.
 */
export const testModelScopeConnection = async (token, datasetName) => {
  try {
    const { namespace, name } = splitDatasetName(datasetName);
    const headers = buildHeaders(token);

    const response = await cachedFetch(
      `${MS_API_BASE}/datasets/${namespace}/${name}`,
      { headers }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          token
            ? 'Invalid ModelScope token. Check your access token.'
            : `Dataset "${datasetName}" requires authentication. Please provide a ModelScope token.`
        );
      }
      if (response.status === 404) {
        throw new Error(`Dataset "${datasetName}" not found on ModelScope.`);
      }
      throw new Error(`ModelScope API returned HTTP ${response.status}`);
    }

    const info = await response.json();
    const datasetInfo = info.Data || info;

    // Try to get image count
    let imageCount = 0;
    try {
      const countResult = await getImageCountFromModelScope(token, datasetName);
      imageCount = countResult.imageCount || 0;
    } catch (_) {}

    return {
      success: true,
      datasetInfo: {
        id: datasetName,
        description: datasetInfo.Description || datasetInfo.description || `ModelScope dataset: ${datasetName}`,
        author: namespace,
        lastModified: datasetInfo.UpdatedAt || new Date().toISOString(),
        private: datasetInfo.Private || false,
        imageCount,
      },
    };
  } catch (error) {
    console.error('ModelScope connection test failed:', error);
    return { success: false, error: error.message };
  }
};

/**
 * List all image files in a ModelScope dataset repository.
 * Uses the ModelScope repo files API.
 */
const listImageFiles = async (token, namespace, name) => {
  const headers = buildHeaders(token);
  const url = `${MS_API_BASE}/datasets/${namespace}/${name}/repo/files?Revision=master&Root=&Recursive=true`;

  try {
    const response = await cachedFetch(url, { headers });
    if (!response.ok) return [];

    const data = await response.json();
    const files = data?.Data?.Files || data?.Files || [];

    return files
      .filter((f) => f.Path && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.Path))
      .map((f) => f.Path);
  } catch (error) {
    console.warn('ModelScope file listing failed:', error);
    return [];
  }
};

/**
 * Get the total number of images in a ModelScope dataset.
 */
export const getImageCountFromModelScope = async (token, datasetName) => {
  try {
    const { namespace, name } = splitDatasetName(datasetName);
    const files = await listImageFiles(token, namespace, name);
    return { imageCount: files.length };
  } catch (error) {
    return { imageCount: 0 };
  }
};

/**
 * Get images from a ModelScope dataset with pagination.
 */
export const getImagesFromModelScope = async (token, datasetName, limit = 100, offset = 0) => {
  try {
    const { namespace, name } = splitDatasetName(datasetName);
    const allFiles = await listImageFiles(token, namespace, name);

    if (allFiles.length === 0) {
      throw new Error(
        `No image files found in ModelScope dataset "${datasetName}". ` +
        'Make sure the dataset contains image files (jpg/png/webp/gif).'
      );
    }

    const paged = allFiles.slice(offset, offset + limit);

    const images = paged.map((filePath, i) => ({
      url: buildFileUrl(namespace, name, filePath),
      name: `${namespace}_${name}_${offset + i}_${filePath.replace(/\//g, '_')}`,
      metadata: {
        dataset: datasetName,
        path: filePath,
        rowIndex: offset + i,
        isPermanent: true,
      },
    }));

    return { success: true, images, total: allFiles.length };
  } catch (error) {
    console.error('Failed to get images from ModelScope:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get random images from a ModelScope dataset.
 */
export const getRandomImagesFromModelScope = async (token, datasetName, count = 10) => {
  try {
    const { namespace, name } = splitDatasetName(datasetName);
    const allFiles = await listImageFiles(token, namespace, name);

    if (allFiles.length === 0) {
      return { success: false, error: `No images found in ModelScope dataset "${datasetName}".` };
    }

    // Shuffle and pick
    const shuffled = [...allFiles].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));

    const images = selected.map((filePath, i) => ({
      url: buildFileUrl(namespace, name, filePath),
      name: `${namespace}_${name}_rand${i}_${filePath.replace(/\//g, '_')}`,
      metadata: {
        dataset: datasetName,
        path: filePath,
        isPermanent: true,
      },
    }));

    return { success: true, images };
  } catch (error) {
    console.error('Failed to get random images from ModelScope:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if a ModelScope dataset integration config is valid.
 */
export const isModelScopeConfigured = (config) =>
  !!(config && config.enabled && config.datasetName);
