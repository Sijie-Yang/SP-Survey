/**
 * Results pages carry each recorded survey contract once instead of once per row.
 * Rows reference a contract with `_contract_ref`; restoring puts the same contract back in
 * `survey_metadata.survey_response_contract` at the key position Postgres jsonb output uses,
 * so restored rows equal a plain `select=*` row.
 */

export const CONTRACT_KEY = 'survey_response_contract';
export const CONTRACT_REF = '_contract_ref';

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const utf8 = (s) => (encoder ? encoder.encode(s) : Uint8Array.from(String(s), (c) => c.charCodeAt(0)));

/** Postgres jsonb object key order: shorter keys first, then bytewise. */
export function compareJsonbKeys(a, b) {
  const x = utf8(a);
  const y = utf8(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function withKeyInJsonbOrder(obj, key, value) {
  const out = {};
  let placed = false;
  for (const k of Object.keys(obj)) {
    if (!placed && compareJsonbKeys(key, k) < 0) { out[key] = value; placed = true; }
    out[k] = obj[k];
  }
  if (!placed) out[key] = value;
  return out;
}

/** Restore contracts in place; throws instead of returning rows with a missing contract. */
export function restoreResponseContracts(rows, contracts) {
  for (const row of rows || []) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, CONTRACT_REF)) continue;
    const ref = row[CONTRACT_REF];
    delete row[CONTRACT_REF];
    if (ref == null) continue;
    const contract = contracts instanceof Map ? contracts.get(ref) : contracts?.[ref];
    if (contract === undefined) throw new Error('Response page referenced an unknown survey contract. Refresh to reload results.');
    row.survey_metadata = withKeyInJsonbOrder(row.survey_metadata || {}, CONTRACT_KEY, contract);
  }
  return rows;
}

/** Rows from the `survey_response_rows` RPC, with `_contract_ref` set where a contract was split off. */
export function rowsFromSlimResult(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const refs = Array.isArray(result?.refs) ? result.refs : [];
  if (refs.length !== rows.length) throw new Error('Invalid response page');
  rows.forEach((row, i) => { if (refs[i] != null) row[CONTRACT_REF] = refs[i]; });
  return rows;
}

/**
 * Split contracts off full rows (fallback when the RPC is not installed).
 * `keyOf(contractJson)` must be deterministic; identical JSON text shares one key, and null keeps the contract inline.
 */
export async function splitResponseContracts(rows, { known = new Set(), contracts = {}, keyOf }) {
  for (const row of rows) {
    const meta = row?.survey_metadata;
    const contract = meta && typeof meta === 'object' ? meta[CONTRACT_KEY] : undefined;
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) continue;
    const key = await keyOf(JSON.stringify(contract));
    if (!key) continue;
    const { [CONTRACT_KEY]: _omit, ...rest } = meta;
    row.survey_metadata = rest;
    row[CONTRACT_REF] = key;
    if (!known.has(key) && !(key in contracts)) contracts[key] = contract;
  }
  return contracts;
}

export function isMissingRpc(err) {
  const status = Number(err?.status);
  const code = err?.code || err?.details?.code;
  return code === 'PGRST202' || code === '42883' || status === 404;
}
