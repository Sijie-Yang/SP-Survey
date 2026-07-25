/**
 * Credential / secret field helpers for agent + MCP surfaces.
 * Pure module — no I/O.
 */

const SECRET_FIELDS = new Set([
  'supabaseconfig',
  'supabasekey',
  'supabaseanonkey',
  'servicerolekey',
  'anonkey',
  'huggingfacetoken',
  'falapikey',
  'falkey',
  'openaiapikey',
  'openrouterapikey',
  'apikey',
  'accesstoken',
  'accesskeyid',
  'secretkey',
  'secretaccesskey',
  'password',
]);

export const isSecretField = (key) => SECRET_FIELDS.has(String(key || '').toLowerCase());

export const sanitizeForAgent = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeForAgent);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((cleaned, [key, child]) => {
    if (!isSecretField(key)) cleaned[key] = sanitizeForAgent(child);
    return cleaned;
  }, {});
};

export const findSecretFields = (value, currentPath = '') => {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findSecretFields(child, `${currentPath}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    return isSecretField(key) ? [childPath] : findSecretFields(child, childPath);
  });
};

/** Keep credentials already stored when an agent replaces surveyConfig. */
export const restoreStoredSecrets = (incoming, stored) => {
  if (Array.isArray(incoming)) {
    return incoming.map((child, index) => restoreStoredSecrets(child, stored?.[index]));
  }
  if (!incoming || typeof incoming !== 'object') return incoming;
  const restored = {};
  Object.entries(incoming).forEach(([key, child]) => {
    restored[key] = isSecretField(key)
      ? stored?.[key]
      : restoreStoredSecrets(child, stored?.[key]);
  });
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    Object.entries(stored).forEach(([key, child]) => {
      if (isSecretField(key) && child !== undefined) restored[key] = child;
    });
  }
  return restored;
};

export { SECRET_FIELDS };
