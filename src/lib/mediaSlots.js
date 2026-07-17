/**
 * Multi-slot media resolution for media* question types.
 * Legacy questions without mediaSlots are handled by the caller via pickRandomMediaForQuestion.
 */

import {
  filterMediaByType, inferMediaType, normalizeMediaEntry,
  getEligibleMediaSets, getRecursiveMedia, normalizeFolderPath,
  buildMediaByFolderCategory,
} from './mediaUtils';

/** All media* types that participate in slots + random injection. */
export const MEDIA_STAR_TYPES = [
  'mediadisplay',
  'mediapicker',
  'mediaranking',
  'mediarating',
  'mediaboolean',
  'mediamatrix',
  'mediaslidergroup',
  'mediapointallocation',
];

export function isMediaStarType(type) {
  return MEDIA_STAR_TYPES.includes(type);
}

export function hasMediaSlots(element) {
  return Array.isArray(element?.mediaSlots) && element.mediaSlots.length > 0;
}

function getImageKey(image) {
  return image?.media_id || image?.key || image?.name || image?.url;
}

function getGroupTrackingKey(group) {
  return group?.setKey || group?.groupKey || group?.setId || group?.groupId || null;
}

function basenameKey(nameOrUrl = '') {
  const name = String(nameOrUrl).split('?')[0].split('/').pop() || '';
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

function findByRef(pool, ref) {
  if (!ref) return null;
  const key = ref.key || ref.media_id || '';
  const url = ref.url || '';
  const name = ref.name || '';
  return (pool || []).find((m) => {
    const e = normalizeMediaEntry(m);
    if (!e) return false;
    if (key && (e.key === key || e.media_id === key)) return true;
    if (url && e.url === url) return true;
    if (name && e.name === name) return true;
    return false;
  }) || null;
}

function scopePool(pool, mediaFolders) {
  const folders = Array.isArray(mediaFolders)
    ? mediaFolders.map(normalizeFolderPath).filter(Boolean)
    : [];
  if (!folders.length) return [...(pool || [])];
  const scoped = [];
  const seen = new Set();
  folders.forEach((folder) => {
    getRecursiveMedia(pool, folder).forEach((img) => {
      const k = getImageKey(img);
      if (!k || seen.has(k)) return;
      seen.add(k);
      scoped.push(img);
    });
  });
  return scoped;
}

function pickRandomFromPool(pool, count, mediaType, excludeKeys) {
  let candidates = filterMediaByType(pool, mediaType || 'any');
  if (excludeKeys?.size) {
    const filtered = candidates.filter((img) => {
      const k = getImageKey(img);
      return k && !excludeKeys.has(k);
    });
    if (filtered.length >= count) candidates = filtered;
  }
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.max(0, count));
}

function matchByBasename(pool, stem, mediaType, excludeKeys) {
  const candidates = filterMediaByType(pool, mediaType || 'any').filter((img) => {
    const k = getImageKey(img);
    if (excludeKeys?.has(k)) return false;
    return basenameKey(img.name || img.url) === stem;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function pickSharedSet(pool, folderTags, scopeFolders, setSize, globallyUsedSetKeys, excludeUsed) {
  let eligible = getEligibleMediaSets(pool, setSize, folderTags, { scopeFolders });
  if (excludeUsed && globallyUsedSetKeys) {
    eligible = eligible.filter((g) => {
      const key = getGroupTrackingKey(g);
      return key && !globallyUsedSetKeys.has(key);
    });
  }
  if (!eligible.length && setSize != null) {
    // Relax exact size: try any tagged sets in scope
    const allSizes = [1, 2, 3, 4, 5, 6, 8, 10];
    for (const n of allSizes) {
      eligible = getEligibleMediaSets(pool, n, folderTags, { scopeFolders });
      if (excludeUsed && globallyUsedSetKeys) {
        eligible = eligible.filter((g) => {
          const key = getGroupTrackingKey(g);
          return key && !globallyUsedSetKeys.has(key);
        });
      }
      if (eligible.length) break;
    }
  }
  if (!eligible.length) return null;
  const shuffled = [...eligible].sort(() => 0.5 - Math.random());
  return shuffled[0];
}

function memberFromSet(setMembers, mediaType, excludeKeys) {
  const typed = filterMediaByType(setMembers, mediaType || 'any').filter((img) => {
    const k = getImageKey(img);
    return k && !excludeKeys?.has(k);
  });
  if (!typed.length) return null;
  return typed[Math.floor(Math.random() * typed.length)];
}

/**
 * Resolve mediaSlots into structured slots + flat media.
 * Caller must handle legacy (no slots) via pickRandomMediaForQuestion.
 */
export function resolveMediaSlots(
  pool,
  element,
  globallyUsedImageKeys,
  globallyUsedSetKeys,
  folderTags = {},
) {
  const normalizedPool = (pool || []).map((e) => normalizeMediaEntry(e)).filter(Boolean);
  const slotsDef = [...(element.mediaSlots || [])].sort(
    (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0),
  );
  const excludeUsed = element.excludePreviouslyUsedImages !== false;
  const excludeKeys = excludeUsed && globallyUsedImageKeys ? globallyUsedImageKeys : new Set();
  const warnings = [];
  const resolved = [];
  const usedThisQuestion = new Set();

  const sharedSets = new Map();
  const setMemberSlots = slotsDef.filter((s) => s.selection === 'set_member');
  if (setMemberSlots.length) {
    const bindingGroups = new Map();
    setMemberSlots.forEach((s) => {
      const bid = s.setBinding || 'shared';
      if (!bindingGroups.has(bid)) bindingGroups.set(bid, []);
      bindingGroups.get(bid).push(s);
    });
    bindingGroups.forEach((group, bid) => {
      const folders = group.flatMap((s) => (Array.isArray(s.mediaFolders) ? s.mediaFolders : []));
      const scopeFolders = folders.length
        ? folders.map(normalizeFolderPath).filter(Boolean)
        : (Array.isArray(element.mediaFolders)
          ? element.mediaFolders.map(normalizeFolderPath).filter(Boolean)
          : null);
      const setSize = group.length || element.imageCount || 2;
      const picked = pickSharedSet(
        normalizedPool, folderTags, scopeFolders, setSize, globallyUsedSetKeys, excludeUsed,
      );
      if (picked) {
        sharedSets.set(bid, picked);
        const key = getGroupTrackingKey(picked);
        if (key && globallyUsedSetKeys && excludeUsed) globallyUsedSetKeys.add(key);
      } else {
        warnings.push(`No eligible set for binding "${bid}"`);
      }
    });
  }

  let primaryStem = null;
  let setId = null;

  // Pass 1: non-basename slots (establish primaryStem)
  // Pass 2: basename slots
  const pass1 = slotsDef.filter((s) => !(s.matchBy === 'basename' && s.selection === 'random'));
  const pass2 = slotsDef.filter((s) => s.matchBy === 'basename' && s.selection === 'random');

  const resolveOne = (slot) => {
    const slotId = String(slot.id || `slot_${resolved.length}`).trim() || `slot_${resolved.length}`;
    const role = slot.role || 'stimulus';
    const mediaType = slot.mediaType || 'any';
    const count = Math.max(1, parseInt(slot.count, 10) || 1);
    const selection = slot.selection || 'random';
    const scoped = scopePool(normalizedPool, slot.mediaFolders);
    const localExclude = new Set([...excludeKeys, ...usedThisQuestion]);
    const pickedItems = [];

    if (selection === 'fixed') {
      const found = findByRef(normalizedPool, slot.mediaRef);
      if (found) pickedItems.push(normalizeMediaEntry(found));
      else warnings.push(`Slot "${slotId}": fixed media not found`);
    } else if (selection === 'set_member') {
      const bid = slot.setBinding || 'shared';
      const set = sharedSets.get(bid);
      if (set) {
        setId = set.setId || setId;
        for (let i = 0; i < count; i++) {
          const m = memberFromSet(set.members, mediaType, localExclude);
          if (!m) {
            warnings.push(`Slot "${slotId}": no ${mediaType} member in set`);
            break;
          }
          pickedItems.push(normalizeMediaEntry(m));
          const k = getImageKey(m);
          if (k) localExclude.add(k);
        }
      }
    } else if (selection === 'category') {
      const byCat = buildMediaByFolderCategory(scoped, folderTags, {
        scopeFolders: slot.mediaFolders,
      });
      const cats = [...byCat.keys()].sort();
      for (const cat of cats) {
        if (pickedItems.length >= count) break;
        let catPool = filterMediaByType(byCat.get(cat) || [], mediaType);
        catPool = catPool.filter((img) => {
          const k = getImageKey(img);
          return k && !localExclude.has(k);
        });
        if (!catPool.length) continue;
        const one = catPool[Math.floor(Math.random() * catPool.length)];
        pickedItems.push(normalizeMediaEntry(one));
        const k = getImageKey(one);
        if (k) localExclude.add(k);
      }
    } else if (slot.matchBy === 'basename' && primaryStem) {
      for (let i = 0; i < count; i++) {
        const m = matchByBasename(
          scoped.length ? scoped : normalizedPool,
          primaryStem,
          mediaType,
          localExclude,
        );
        if (!m) {
          warnings.push(`Slot "${slotId}": no basename match for "${primaryStem}"`);
          break;
        }
        pickedItems.push(normalizeMediaEntry(m));
        const k = getImageKey(m);
        if (k) localExclude.add(k);
      }
    } else {
      const items = pickRandomFromPool(
        scoped.length ? scoped : normalizedPool,
        count,
        mediaType,
        localExclude,
      );
      if (!items.length) warnings.push(`Slot "${slotId}": empty pool for type ${mediaType}`);
      items.forEach((m) => {
        pickedItems.push(normalizeMediaEntry(m));
        const k = getImageKey(m);
        if (k) localExclude.add(k);
      });
    }

    pickedItems.forEach((img, idx) => {
      const k = getImageKey(img);
      if (k) {
        usedThisQuestion.add(k);
        if (excludeUsed && globallyUsedImageKeys) globallyUsedImageKeys.add(k);
      }
      if (!primaryStem) primaryStem = basenameKey(img.name || img.url);
      resolved.push({
        slotId: count > 1 ? `${slotId}_${idx}` : slotId,
        role,
        type: img.type || inferMediaType(img.name || img.url),
        url: img.url,
        name: img.name,
        media_id: img.media_id || img.key || img.name,
        key: img.key,
        setId: setId || null,
        order: Number(slot.order) || 0,
      });
    });
  };

  pass1.forEach(resolveOne);
  pass2.forEach(resolveOne);

  resolved.sort((a, b) => (a.order || 0) - (b.order || 0));
  const flatMedia = resolved.map((r) => normalizeMediaEntry({
    url: r.url,
    name: r.name,
    type: r.type,
    key: r.key,
    media_id: r.media_id,
  }));

  return {
    images: flatMedia,
    setKey: setId,
    setId,
    groupKey: setId,
    groupId: setId,
    categories: null,
    slots: resolved,
    flatMedia,
    warnings,
  };
}

/** Wrap legacy assignment as slots-shaped result. */
export function legacyAssignmentToSlots(assignment) {
  const images = assignment?.images || [];
  const slots = images.map((img, i) => ({
    slotId: `legacy_${i}`,
    role: 'stimulus',
    type: img.type || inferMediaType(img.name || img.url),
    url: img.url,
    name: img.name,
    media_id: img.media_id || img.key || img.name,
    key: img.key,
    setId: assignment.setId || assignment.groupId || null,
    order: i,
  }));
  return {
    ...assignment,
    slots,
    flatMedia: images,
    warnings: [],
  };
}

export function applyResolvedSlotsToElement(element, slots) {
  if (!element || !slots?.length) return;
  element.mediaSlotsResolved = slots;
  element.slotIds = slots.map((s) => s.slotId);
  element.slotUrls = slots.map((s) => s.url);
  element.slotTypes = slots.map((s) => s.type);
  element.slotRoles = slots.map((s) => s.role);
  element.slotNames = slots.map((s) => s.name);
  if (element.mediaPresentation == null) element.mediaPresentation = 'stack';
}

export function resolveQuestionSlots(question) {
  if (!question) return [];
  if (Array.isArray(question.mediaSlotsResolved) && question.mediaSlotsResolved.length) {
    return question.mediaSlotsResolved;
  }
  const ids = Array.isArray(question.slotIds) ? question.slotIds : [];
  const urls = Array.isArray(question.slotUrls) ? question.slotUrls : [];
  if (!urls.length) return [];
  const types = Array.isArray(question.slotTypes) ? question.slotTypes : [];
  const roles = Array.isArray(question.slotRoles) ? question.slotRoles : [];
  const names = Array.isArray(question.slotNames) ? question.slotNames : [];
  return urls.map((url, i) => ({
    slotId: ids[i] || `slot_${i}`,
    role: roles[i] || 'stimulus',
    type: types[i] || inferMediaType(names[i] || url),
    url,
    name: names[i] || '',
    media_id: names[i] || url,
  }));
}

export function slotsToShownMedia(slots) {
  return (slots || []).map((s) => ({
    slotId: s.slotId,
    role: s.role || 'stimulus',
    type: s.type || inferMediaType(s.name || s.url),
    name: s.name || '',
    media_id: s.media_id || s.key || s.name || '',
    url: s.url || '',
    setId: s.setId || null,
  }));
}

export const MEDIA_SLOT_PRESETS = {
  randomVideoAudio: [
    {
      id: 'stimulus_video', role: 'stimulus', mediaType: 'video',
      selection: 'random', count: 1, order: 0, matchBy: 'none',
    },
    {
      id: 'stimulus_audio', role: 'stimulus', mediaType: 'audio',
      selection: 'random', count: 1, order: 1, matchBy: 'none',
    },
  ],
  fixedVideoRandomAudio: [
    {
      id: 'stimulus_video', role: 'stimulus', mediaType: 'video',
      selection: 'fixed', count: 1, order: 0, matchBy: 'none', mediaRef: {},
    },
    {
      id: 'stimulus_audio', role: 'stimulus', mediaType: 'audio',
      selection: 'random', count: 1, order: 1, matchBy: 'none',
    },
  ],
  basenamePair: [
    {
      id: 'stimulus_video', role: 'stimulus', mediaType: 'video',
      selection: 'random', count: 1, order: 0, matchBy: 'none',
    },
    {
      id: 'stimulus_audio', role: 'stimulus', mediaType: 'audio',
      selection: 'random', count: 1, order: 1, matchBy: 'basename',
    },
  ],
  mixedSet: [
    {
      id: 'set_video', role: 'stimulus', mediaType: 'video',
      selection: 'set_member', setBinding: 'shared', count: 1, order: 0,
    },
    {
      id: 'set_audio', role: 'stimulus', mediaType: 'audio',
      selection: 'set_member', setBinding: 'shared', count: 1, order: 1,
    },
    {
      id: 'set_image', role: 'stimulus', mediaType: 'image',
      selection: 'set_member', setBinding: 'shared', count: 1, order: 2,
    },
  ],
};
