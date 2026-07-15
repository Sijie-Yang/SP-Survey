/**
 * Survey question `name` uniqueness helpers.
 * SurveyJS stores answers by element.name — duplicates corrupt responses/analysis.
 */

function walkElements(elements, pageIndex, page, pathPrefix, out) {
  (elements || []).forEach((element, elementIndex) => {
    if (!element || typeof element !== 'object') return;
    const path = [...pathPrefix, elementIndex];

    if (element.name) {
      out.push({
        name: element.name,
        title: element.title || element.name,
        pageIndex,
        pageName: page.name || `page_${pageIndex + 1}`,
        pageTitle: page.title || page.name,
        path,
        element,
      });
    }

    // Recurse into any nested element lists SurveyJS / builder may use.
    if (Array.isArray(element.elements) && element.elements.length) {
      walkElements(element.elements, pageIndex, page, [...path, 'elements'], out);
    }
    if (Array.isArray(element.templateElements) && element.templateElements.length) {
      walkElements(element.templateElements, pageIndex, page, [...path, 'templateElements'], out);
    }
  });
}

/** Resolve a nested element by path from a page.elements root. */
function getElementByPath(page, path) {
  if (!page || !Array.isArray(path) || path.length === 0) return null;
  let cursor = page.elements;
  let el = null;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i];
    if (key === 'elements' || key === 'templateElements') {
      if (!el) return null;
      cursor = el[key];
      continue;
    }
    if (!Array.isArray(cursor)) return null;
    el = cursor[key];
    if (!el) return null;
    // Next iteration may read el.elements / templateElements via string key.
  }
  return el;
}

/** Walk all pages/elements (nested panels included) and return every named element. */
export function listSurveyQuestions(config) {
  const out = [];
  const pages = config?.pages || [];
  pages.forEach((page, pageIndex) => {
    walkElements(page.elements || [], pageIndex, page, [], out);
  });
  return out;
}

export function collectUsedQuestionNames(config, { exclude } = {}) {
  const used = new Set();
  listSurveyQuestions(config).forEach((q) => {
    if (
      exclude
      && q.name === exclude.name
      && q.pageIndex === exclude.pageIndex
      && JSON.stringify(q.path) === JSON.stringify(exclude.path)
    ) {
      return;
    }
    if (q.name) used.add(q.name);
  });
  return used;
}

/**
 * @returns {Array<{ name: string, count: number, occurrences: Array }>}
 */
export function findDuplicateQuestionNames(config) {
  const byName = new Map();
  listSurveyQuestions(config).forEach((q) => {
    if (!byName.has(q.name)) byName.set(q.name, []);
    byName.get(q.name).push(q);
  });
  return [...byName.entries()]
    .filter(([, occ]) => occ.length > 1)
    .map(([name, occurrences]) => ({
      name,
      count: occurrences.length,
      occurrences,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function hasDuplicateQuestionNames(config) {
  return findDuplicateQuestionNames(config).length > 0;
}

/**
 * Allocate a name not present in `used` (Set). Mutates `used` by adding the result.
 * Prefers base, then base_1, base_2, …
 */
export function allocateUniqueName(baseName, used) {
  const base = String(baseName || 'question').trim() || 'question';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const m = base.match(/^(.*)_(\d+)$/);
  const stem = m ? m[1] : base;
  let n = m ? parseInt(m[2], 10) + 1 : 1;
  let candidate = `${stem}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}_${n}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Rename later duplicates so every question name is unique.
 * Keeps the FIRST occurrence's name. Later copies get new names.
 *
 * NOTE: Historical answers already stored under a shared name cannot be split.
 *
 * @returns {{ config: object, renames: Array, remainingDuplicates: Array }}
 */
export function repairDuplicateQuestionNames(config) {
  if (!config?.pages) {
    return { config, renames: [], remainingDuplicates: [] };
  }
  const next = JSON.parse(JSON.stringify(config));
  const listed = listSurveyQuestions(next);
  const byName = new Map();
  listed.forEach((q, idx) => {
    if (!byName.has(q.name)) byName.set(q.name, []);
    byName.get(q.name).push(idx);
  });

  const toRenameIdx = new Set();
  byName.forEach((indexes) => {
    if (indexes.length < 2) return;
    indexes.slice(1).forEach((i) => toRenameIdx.add(i));
  });

  if (toRenameIdx.size === 0) {
    return { config: next, renames: [], remainingDuplicates: [] };
  }

  const used = new Set(
    listed.filter((_, idx) => !toRenameIdx.has(idx)).map((q) => q.name),
  );
  const renames = [];

  listed.forEach((q, idx) => {
    if (!toRenameIdx.has(idx)) return;
    const page = next.pages[q.pageIndex];
    const el = getElementByPath(page, q.path);
    if (!el) return;
    const from = el.name;
    const to = allocateUniqueName(from, used);
    el.name = to;
    renames.push({
      from,
      to,
      pageIndex: q.pageIndex,
      title: el.title || from,
      path: q.path,
    });
  });

  const remainingDuplicates = findDuplicateQuestionNames(next);
  return { config: next, renames, remainingDuplicates };
}

/** Suggest a unique page name given existing page names. */
export function allocateUniquePageName(baseName, config) {
  const used = new Set((config?.pages || []).map((p) => p?.name).filter(Boolean));
  return allocateUniqueName(baseName, used);
}
