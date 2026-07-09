/** Re-export Supabase-backed media storage with R2-compatible names. */
export {
  isR2Configured,
  isMediaStorageConfigured,
  uploadImageToR2,
  deleteImagesFromR2,
  listImagesFromR2,
  copyImagesInR2,
  checkR2Status,
  uploadBase64ToStorage,
} from './mediaStorage';
