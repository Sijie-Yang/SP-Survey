// Shared by the Node server (require) and the browser bundle (import), so this
// file stays CommonJS and avoids syntax that makes Babel inject ESM helper imports.

var SECRET_FIELDS = new Set([
  'supabaseconfig',
  'supabasekey',
  'supabaseanonkey',
  'servicerolekey',
  'anonkey',
  'huggingfacetoken',
  'modelscopetoken',
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

function isSecretField(key) {
  return SECRET_FIELDS.has(String(key).toLowerCase());
}

function stripSecretFields(value) {
  if (Array.isArray(value)) return value.map(stripSecretFields);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce(function (cleaned, key) {
    if (!isSecretField(key)) cleaned[key] = stripSecretFields(value[key]);
    return cleaned;
  }, {});
}

function findSecretFields(value, currentPath) {
  var basePath = currentPath || '';
  if (Array.isArray(value)) {
    return value.reduce(function (found, child, index) {
      return found.concat(findSecretFields(child, basePath + '[' + index + ']'));
    }, []);
  }
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value).reduce(function (found, key) {
    var childPath = basePath ? basePath + '.' + key : key;
    return found.concat(isSecretField(key) ? [childPath] : findSecretFields(value[key], childPath));
  }, []);
}

module.exports = {
  SECRET_FIELDS: SECRET_FIELDS,
  isSecretField: isSecretField,
  stripSecretFields: stripSecretFields,
  findSecretFields: findSecretFields,
};
