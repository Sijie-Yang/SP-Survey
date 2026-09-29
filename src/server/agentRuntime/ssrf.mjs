// The local server runs on the researcher's own machine, so loopback and LAN
// endpoints (Ollama, LM Studio, vLLM) are legitimate targets. Cloud metadata
// services stay blocked, and plain HTTP is only accepted on local networks.
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  'fd00:ec2::254',
]);

function isLoopback(host) {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1'
    || /^127\./.test(host);
}

function isPrivateNetwork(host) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
    || host.endsWith('.local')
    || /^(fc|fd)[0-9a-f:]*$/i.test(host);
}

export function assertSafeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw Object.assign(new Error('A custom provider needs a base URL.'), {
      status: 400,
      code: 'BASE_URL_REQUIRED',
    });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error('Base URL is not a valid URL.'), {
      status: 400,
      code: 'BASE_URL_INVALID',
    });
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(host) || /^169\.254\./.test(host) || host === '0.0.0.0') {
    throw Object.assign(new Error('This host is not allowed for model requests.'), {
      status: 400,
      code: 'BASE_URL_BLOCKED',
    });
  }
  const local = isLoopback(host) || isPrivateNetwork(host);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw Object.assign(new Error('Remote endpoints must use HTTPS.'), {
      status: 400,
      code: 'BASE_URL_INSECURE',
    });
  }
  return parsed.toString().replace(/\/$/, '');
}

export function normalizeEndpoint(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

export function assertProviderResponseNotRedirect(response) {
  if (response?.status >= 300 && response.status < 400) {
    throw Object.assign(new Error('Provider redirects are blocked.'), {
      status: 502,
      code: 'PROVIDER_REDIRECT_BLOCKED',
    });
  }
  return response;
}
