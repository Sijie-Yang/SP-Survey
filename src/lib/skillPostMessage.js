/** Clone skill iframe init payload — postMessage requires structured-clone-safe data only. */
import { buildFallbackDemoImages, inlineDemoSvgDataUri } from './presetSkills';

function absUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}

function normImage(img) {
  if (!img || typeof img !== 'object') return null;
  const url = absUrl(img.url);
  if (!url) return null;
  return {
    name: String(img.name || ''),
    url,
    type: img.type || 'image',
  };
}

function toPlainArray(maybeArray) {
  if (!maybeArray) return [];
  if (Array.isArray(maybeArray)) return maybeArray;
  if (typeof maybeArray.length === 'number') {
    try {
      return Array.from(maybeArray);
    } catch {
      const out = [];
      for (let i = 0; i < maybeArray.length; i += 1) {
        if (maybeArray[i] !== undefined) out.push(maybeArray[i]);
      }
      return out;
    }
  }
  return [];
}

function safeJsonClone(data, fallback) {
  if (data === undefined || data === null) return fallback;
  try {
    if (typeof data === 'string') return JSON.parse(data);
    if (typeof data.toJSON === 'function') return JSON.parse(JSON.stringify(data.toJSON()));
    return JSON.parse(JSON.stringify(data));
  } catch {
    return fallback;
  }
}

/** Build init payload for skill iframe postMessage. */
export function toSkillInitPayload(config, images, value) {
  const safeConfig = safeJsonClone(config, {}) || {};

  if (Array.isArray(safeConfig.demoImages)) {
    safeConfig.demoImages = safeConfig.demoImages.map(normImage).filter(Boolean);
  }
  if (Array.isArray(safeConfig.injectedImages)) {
    safeConfig.injectedImages = safeConfig.injectedImages.map(normImage).filter(Boolean);
  }

  let safeImages = toPlainArray(images).map(normImage).filter(Boolean);
  // Injected project media (carried inside skillConfig to survive SurveyJS
  // deserialization) takes priority over whatever arrived via skillImages.
  if (safeConfig.injectedImages?.length) {
    safeImages = safeConfig.injectedImages;
  }
  if (!safeImages.length && safeConfig.demoImages?.length) {
    safeImages = safeConfig.demoImages;
  }
  if (!safeImages.length) {
    safeImages = buildFallbackDemoImages(
      safeConfig.mediaCount || 1,
      safeConfig.mediaType || 'image',
      safeConfig.skillId,
    ).map(normImage).filter(Boolean);
  }
  if (!safeImages.length) {
    safeImages = [{ name: 'demo.svg', url: inlineDemoSvgDataUri(0), type: 'image' }];
  }

  const safeValue = safeJsonClone(value, null);

  return {
    config: safeConfig,
    images: safeImages,
    value: safeValue,
  };
}

/** Read plain skill fields from a SurveyJS question model. */
export function readSkillQuestionFields(question) {
  const config = safeJsonClone(question?.skillConfig, {}) || {};
  if (question?.skillId && !config.skillId) config.skillId = question.skillId;

  let images = toPlainArray(question?.skillImages).map(normImage).filter(Boolean);
  if (!images.length && config.demoImages?.length) {
    images = config.demoImages.map(normImage).filter(Boolean);
  }

  const payload = toSkillInitPayload(config, images, question?.value);
  return payload;
}
