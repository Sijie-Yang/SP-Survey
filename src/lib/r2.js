/** Re-export Supabase-backed media storage with R2-compatible names. */
export {
  isR2Configured,
  isMediaStorageConfigured,
  uploadImageToR2,
  deleteImagesFromR2,
  listImagesFromR2,
  copyImagesInR2,
  moveImagesInR2,
  projectR2Prefix,
  checkR2Status,
  uploadBase64ToStorage,
  getMediaStoragePublicUrl,
  downloadStorageText,
  isTemplateR2Key,
  filterDeletableR2Keys,
} from './mediaStorage';
