/**
 * Alibaba Cloud OSS Integration
 * Chinese-friendly alternative to Supabase Storage for image uploads.
 *
 * This module provides image upload/list/delete via the SP-Survey backend
 * (server.js), which signs OSS requests server-side to keep credentials safe.
 *
 * Required environment variable on the backend:
 *   ALIYUN_OSS_REGION         e.g. "oss-cn-shanghai"
 *   ALIYUN_OSS_BUCKET         e.g. "my-survey-images"
 *   ALIYUN_OSS_ACCESS_KEY_ID
 *   ALIYUN_OSS_ACCESS_KEY_SECRET
 *
 * Users configure these in the Admin → Image Dataset panel (China mode).
 */

import { API_BASE_URL } from './apiConfig';

const BACKEND = API_BASE_URL;

/** Save OSS config to sessionStorage so the backend can pick it up */
export const saveOssConfig = (config) => {
  try {
    sessionStorage.setItem('aliyun_oss_config', JSON.stringify(config));
  } catch (_) {}
};

export const loadOssConfig = () => {
  try {
    const raw = sessionStorage.getItem('aliyun_oss_config');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

export const isOssConfigured = () => {
  const cfg = loadOssConfig();
  return !!(cfg?.enabled && cfg?.region && cfg?.bucket && cfg?.accessKeyId && cfg?.accessKeySecret);
};

/**
 * Upload a single image file to Alibaba Cloud OSS via the backend.
 */
export const uploadImageToOss = async (file) => {
  if (!isOssConfigured()) {
    return {
      success: false,
      error: 'Alibaba Cloud OSS is not configured. Please set up OSS credentials first.',
    };
  }

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ossConfig', JSON.stringify(loadOssConfig()));

    const response = await fetch(`${BACKEND}/api/oss/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Upload failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    return { success: true, url: result.url, path: result.path, isLocal: false };
  } catch (error) {
    console.error('OSS upload failed:', error);
    return { success: false, error: error.message, isLocal: false };
  }
};

/**
 * List all images in the configured OSS bucket.
 */
export const listImagesFromOss = async () => {
  if (!isOssConfigured()) {
    return { success: false, images: [], error: 'OSS not configured' };
  }

  try {
    const cfg = loadOssConfig();
    const response = await fetch(`${BACKEND}/api/oss/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ossConfig: cfg }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `List failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    return { success: true, images: result.images || [] };
  } catch (error) {
    console.error('OSS list failed:', error);
    return { success: false, images: [], error: error.message };
  }
};

/**
 * Delete an image from OSS by its path/key.
 */
export const deleteImageFromOss = async (imagePath) => {
  if (!isOssConfigured()) {
    return { success: false, error: 'OSS not configured' };
  }

  try {
    const cfg = loadOssConfig();
    const response = await fetch(`${BACKEND}/api/oss/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ossConfig: cfg, path: imagePath }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Delete failed: HTTP ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    console.error('OSS delete failed:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Test connection to Alibaba Cloud OSS.
 */
export const testOssConnection = async (config) => {
  try {
    const response = await fetch(`${BACKEND}/api/oss/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ossConfig: config }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Test failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    return { success: true, message: result.message, imageCount: result.imageCount || 0 };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
