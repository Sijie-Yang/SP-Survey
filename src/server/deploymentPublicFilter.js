const path = require('path');
const { findSecretFields } = require('../lib/secretFields');

// Local researcher data that must never reach the participant site or its GitHub repo.
const EXCLUDED_PUBLIC_DIRS = new Set(['projects', 'responses', 'project_templates']);
const EXCLUDED_FILE_PATTERN = /\.(bak|backup|tmp|temp|log|pem|key)$/i;

const shouldCopyPublicEntry = (relativePath) => {
  const normalized = String(relativePath || '').split(path.sep).join('/');
  if (!normalized) return true;
  const segments = normalized.split('/');
  if (EXCLUDED_PUBLIC_DIRS.has(segments[0])) return false;
  if (segments.some((segment) => segment.startsWith('.'))) return false;
  return !EXCLUDED_FILE_PATTERN.test(segments[segments.length - 1]);
};

const jsonHoldsCredentials = async (fs, filePath) => {
  try {
    return findSecretFields(JSON.parse(await fs.readFile(filePath, 'utf8'))).length > 0;
  } catch (error) {
    return false;
  }
};

const copyParticipantPublicAssets = async (fs, publicPath, destinationPath) => {
  const skipped = [];
  await fs.copy(publicPath, destinationPath, {
    filter: async (src) => {
      const relativePath = path.relative(publicPath, src);
      if (!shouldCopyPublicEntry(relativePath)) {
        skipped.push(relativePath);
        return false;
      }
      if (src.toLowerCase().endsWith('.json') && await jsonHoldsCredentials(fs, src)) {
        skipped.push(relativePath);
        return false;
      }
      return true;
    },
  });
  return skipped;
};

module.exports = {
  copyParticipantPublicAssets,
  shouldCopyPublicEntry,
};
