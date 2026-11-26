/* global globalThis */
import { responseCursorFilter } from './responsePagination.js';
import { isMissingRpc, rowsFromSlimResult, splitResponseContracts } from './slimResponses.js';

export const RESPONSE_KEY_PAGE = 40;
export const RESPONSE_HYDRATE_BATCH = 8;
export const RESPONSE_SLIM_KEY_PAGE = 200;
export const RESPONSE_SLIM_BATCH = 50;
export const RESPONSE_HYDRATE_CONCURRENCY = 4;
// Interactive results use a short page. A 50-row slim RPC of map answers
// exceeds the database statement timeout and then starves auth.
export const RESPONSE_INTERACTIVE_KEY_PAGE = 8;
export const RESPONSE_INTERACTIVE_BATCH = 4;
export const RESPONSE_PAGE_MAX_BYTES = 2_500_000;
// Slim rows carry no contract copies, so a page of them is small and cheap to serialize.
export const RESPONSE_SLIM_PAGE_MAX_BYTES = 8_000_000;
// Full rows held in memory per page when the slim RPC is unavailable.
export const RESPONSE_PAGE_MAX_FETCH_BYTES = 16_000_000;

const ORDER = 'created_at.desc.nullslast,id.desc';
const LITE_SELECT = 'id,project_id,participant_id,created_at,responses,displayed_images';
const SLIM_RPC = '/rest/v1/rpc/survey_response_rows';

export function isSerializationFailure(err) {
  const status = Number(err?.status);
  const msg = String(err?.message || err || '');
  if (status === 413) return true;
  return /timeout|too large|payload|memory|unicode|invalid.*json|could not serialize|statement timeout|out of memory|Maximum call stack|Failed to parse/i.test(msg);
}

export function classifyRowFailure(err) {
  const msg = String(err?.message || '');
  if (/unicode|escape sequence/i.test(msg)) return 'malformed_row';
  if (isSerializationFailure(err)) return 'oversized_or_timeout';
  return 'unreadable';
}

export function responseListQuery(projectId, { select, after, offset, limit }) {
  return `?${new URLSearchParams({
    project_id: `eq.${projectId}`,
    select,
    order: ORDER,
    limit: String(limit),
    offset: after ? '0' : String(offset || 0),
    ...(after ? { or: `(${responseCursorFilter(after)})` } : {}),
  })}`;
}

export function responseIdsQuery(projectId, ids, select) {
  return `?${new URLSearchParams({
    project_id: `eq.${projectId}`,
    id: `in.(${ids.map((id) => JSON.stringify(String(id))).join(',')})`,
    select,
  })}`;
}

export function stubUnreadableRow(key, reason) {
  return {
    id: key.id,
    created_at: key.created_at ?? null,
    project_id: key.project_id ?? null,
    participant_id: null,
    responses: {},
    displayed_images: null,
    survey_metadata: {},
    _unreadable: true,
    _unreadableReason: reason || 'unreadable',
  };
}

function rowBytes(row) {
  try {
    return JSON.stringify(row).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function rememberSkipped(skipped, id, reason) {
  if (id == null) return;
  if (!skipped.some((item) => String(item.id) === String(id))) {
    skipped.push({ id, reason });
  }
}

export async function sha256ContractKey(text) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load one results page. Keys first (tiny), then rows by id in parallel batches.
 *
 * mode 'auto' tries the `survey_response_rows` RPC, which returns each recorded survey
 * contract once per page instead of once per row ('slim' skips the probe once a load
 * knows the RPC exists); 'legacy' (or a missing RPC) reads
 * `select=*` rows and splits the contracts off afterwards. Either way rows carry
 * `_contract_ref` and `contracts` holds the contracts the caller does not already know.
 * A single oversized or malformed row becomes a stub so the rest of the project can still render.
 */
export async function loadSurveyResponsePage(rest, projectId, {
  after = null,
  offset = 0,
  keyLimit = null,
  maxBytes = null,
  maxFetchBytes = RESPONSE_PAGE_MAX_FETCH_BYTES,
  mode = 'auto',
  legacyKeyLimit = RESPONSE_KEY_PAGE,
  legacyBatch = RESPONSE_HYDRATE_BATCH,
  batchSize = null,
  concurrency = RESPONSE_HYDRATE_CONCURRENCY,
  knownContracts = [],
  contractKey = sha256ContractKey,
  onProgress = () => {},
} = {}) {
  let slim = mode !== 'legacy';
  const listed = await rest({
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: responseListQuery(projectId, {
      select: 'id,created_at,project_id',
      after,
      offset,
      limit: keyLimit ?? (slim ? RESPONSE_SLIM_KEY_PAGE : legacyKeyLimit),
    }),
  });
  if (!Array.isArray(listed) || !listed.length) return { responses: [], skipped: [], contracts: {}, mode: slim ? 'slim' : 'legacy' };
  let keys = listed;

  const hydrated = new Map();
  const skipped = [];
  const known = new Set(knownContracts);
  const contracts = {};

  const fetchByIds = (ids, select) => rest({
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: responseIdsQuery(projectId, ids, select),
  });

  const hydrateFull = async (keySlice) => {
    const usable = keySlice.filter((key) => key?.id != null && key.id !== '');
    if (!usable.length) return;
    const ids = usable.map((key) => key.id);
    try {
      for (const row of (await fetchByIds(ids, '*')) || []) {
        hydrated.set(String(row.id), row);
      }
    } catch (err) {
      if (ids.length === 1) {
        const key = usable[0];
        try {
          const lite = await fetchByIds(ids, LITE_SELECT);
          if (lite?.[0]) {
            hydrated.set(String(ids[0]), {
              ...lite[0],
              survey_metadata: {},
              _truncated: true,
              _truncatedReason: 'survey_metadata_omitted',
            });
            rememberSkipped(skipped, ids[0], 'survey_metadata_omitted');
            return;
          }
        } catch (liteErr) {
          if (isSerializationFailure(err) || isSerializationFailure(liteErr)) {
            hydrated.set(String(ids[0]), stubUnreadableRow(key, classifyRowFailure(err)));
            rememberSkipped(skipped, ids[0], classifyRowFailure(err));
            return;
          }
          throw err;
        }
        hydrated.set(String(ids[0]), stubUnreadableRow(key, 'missing'));
        rememberSkipped(skipped, ids[0], 'missing');
        return;
      }
      const mid = Math.ceil(usable.length / 2);
      await hydrateFull(usable.slice(0, mid));
      await hydrateFull(usable.slice(mid));
    }
  };

  const hydrateSlim = async (keySlice) => {
    const usable = keySlice.filter((key) => key?.id != null && key.id !== '');
    if (!usable.length) return;
    let result;
    try {
      result = await rest({
        path: SLIM_RPC,
        method: 'POST',
        serviceRole: true,
        body: { p_project_id: projectId, p_ids: usable.map((key) => String(key.id)), p_known_contracts: [...known, ...Object.keys(contracts)] },
      });
    } catch (err) {
      if (isMissingRpc(err)) throw err;
      if (usable.length === 1) return hydrateFull(usable);
      const mid = Math.ceil(usable.length / 2);
      await hydrateSlim(usable.slice(0, mid));
      await hydrateSlim(usable.slice(mid));
      return;
    }
    for (const row of rowsFromSlimResult(result)) hydrated.set(String(row.id), row);
    for (const [key, contract] of Object.entries(result?.contracts || {})) {
      if (!(key in contracts)) contracts[key] = contract;
    }
  };

  const batchesOf = (size) => {
    const out = [];
    for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size));
    return out;
  };

  const slimBatch = batchSize || RESPONSE_SLIM_BATCH;
  const rowBatch = batchSize || legacyBatch;
  const probe = slim && mode === 'auto';
  if (probe) {
    try {
      await hydrateSlim(keys.slice(0, slimBatch));
    } catch (err) {
      if (!isMissingRpc(err)) throw err;
      slim = false;
      keys = keys.slice(0, keyLimit ?? legacyKeyLimit);
    }
  }
  const batches = batchesOf(slim ? slimBatch : rowBatch);
  const hydrate = slim ? hydrateSlim : hydrateFull;
  const budget = maxBytes ?? (slim ? RESPONSE_SLIM_PAGE_MAX_BYTES : RESPONSE_PAGE_MAX_BYTES);
  const firstBatchDone = probe && slim;

  const responses = [];
  const sentContracts = {};
  let bytes = 40;
  let fetchedBytes = 0;
  // Rows past the byte budget are never returned, so stop hydrating once it is reached.
  page: for (let wave = 0; wave < batches.length; wave += concurrency) {
    const group = batches.slice(wave, wave + concurrency);
    await Promise.all(group.map((batch, i) => (firstBatchDone && wave === 0 && i === 0 ? null : hydrate(batch))));
    for (const batch of group) {
      const fullRows = [];
      for (const key of batch) {
        const row = hydrated.get(String(key.id)) || stubUnreadableRow(key, 'missing');
        hydrated.delete(String(key.id));
        const size = rowBytes(row);
        fullRows.push({ key, row: Number.isFinite(size) ? row : stubUnreadableRow(key, 'oversized_or_timeout'), size });
      }
      if (!slim) await splitResponseContracts(fullRows.map((item) => item.row), { known, contracts, keyOf: contractKey });
      for (const { row, size } of fullRows) {
        const ref = row._contract_ref;
        const newContract = ref != null && !known.has(ref) && !(ref in sentContracts) ? contracts[ref] : undefined;
        if (ref != null && !known.has(ref) && newContract === undefined && !(ref in sentContracts)) {
          throw new Error('Response page is missing a survey contract');
        }
        const rowSize = rowBytes(row) + (newContract === undefined ? 0 : rowBytes(newContract));
        if (responses.length && (bytes + rowSize > budget || (!slim && fetchedBytes + size > maxFetchBytes))) {
          onProgress(responses.length);
          break page;
        }
        if (row._unreadable) rememberSkipped(skipped, row.id, row._unreadableReason);
        if (newContract !== undefined) sentContracts[ref] = newContract;
        responses.push(row);
        bytes += rowSize;
        if (Number.isFinite(size)) fetchedBytes += size;
      }
      onProgress(responses.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!slim && fetchedBytes >= maxFetchBytes) break;
  }

  return {
    responses,
    skipped: skipped.filter((item) => responses.some((row) => String(row.id) === String(item.id))),
    contracts: sentContracts,
    mode: slim ? 'slim' : 'legacy',
  };
}
