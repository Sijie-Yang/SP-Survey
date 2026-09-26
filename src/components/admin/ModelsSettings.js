import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  deleteProviderCredential,
  fetchProviderModels,
  getCredentialStatus,
  listProviderModels,
  saveAiSettings,
  storeProviderCredential,
} from '../../lib/agentApi';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/;
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const EFFORTS = ['off', 'low', 'medium', 'high', 'max'];

function emptyModel() {
  return {
    id: '',
    name: '',
    label: '',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text'],
    vision: false,
    reasoningEfforts: false,
    defaultEffort: '',
  };
}

function emptyCustom() {
  return {
    provider: '',
    displayName: '',
    baseUrl: '',
    protocol: 'openai-completions',
    apiKey: '',
    models: [emptyModel()],
  };
}

function discoveryError(t, result) {
  const code = result?.code;
  if (code === 'MISSING_CREDENTIAL') return t.modelsDiscovery401;
  if (code === 'DISCOVERY_UNSUPPORTED') return t.modelsDiscoveryUnsupported;
  if (code === 'RESPONSE_TOO_LARGE') return t.modelsDiscoveryTooLarge;
  if (code === 'MALFORMED_JSON') return t.modelsDiscoveryMalformed;
  return result?.error || t.modelsDiscoveryNetwork;
}

export function routeOptions(directory, { visionOnly = false, configuredOnly = true, userOwnedOnly = false } = {}) {
  const options = [];
  (directory || []).forEach((provider) => {
    if (configuredOnly && !provider.configured) return;
    if (userOwnedOnly && provider.userConfigured === false) return;
    if (provider.authUnsupported) return;
    (provider.models || []).forEach((model) => {
      if (!model.id) return;
      if (model.runtimeSupported === false) return;
      const vision = !!(model.vision || (model.input || []).includes('image'));
      if (visionOnly && !vision) return;
      options.push({
        value: `${provider.id}::${model.id}`,
        provider: provider.id,
        model: model.id,
        label: `${provider.displayName} / ${model.label || model.name || model.id}`,
        vision,
        reasoningEfforts: model.reasoningEfforts || false,
        defaultEffort: model.defaultEffort || '',
      });
    });
  });
  return options;
}

function groupDirectory(directory) {
  const groups = {
    recommended: [],
    configured: [],
    catalog: [],
    custom: [],
  };
  (directory || []).forEach((provider) => {
    if (provider.authUnsupported) return;
    if (provider.custom || provider.group === 'custom') groups.custom.push(provider);
    else if (provider.recommended) groups.recommended.push(provider);
    else if (provider.configured) groups.configured.push(provider);
    else groups.catalog.push(provider);
  });
  return groups;
}

function modelSearchText(model) {
  return `${model?.label || model?.name || ''} ${model?.id || ''}`.toLowerCase();
}

function CatalogModelBrowser({ models, loading, t }) {
  const [query, setQuery] = useState('');
  const parentRef = useRef(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models || [];
    return (models || []).filter((model) => modelSearchText(model).includes(needle));
  }, [models, query]);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 8,
  });

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          {t.modelsModels} ({models?.length || 0})
        </Typography>
        {loading && <CircularProgress size={16} />}
      </Stack>
      <TextField
        fullWidth
        size="small"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        label={t.modelsSearchModels}
        placeholder={t.modelsSearchModelsHint}
        sx={{ mb: 1 }}
      />
      <Box
        ref={parentRef}
        sx={{
          height: Math.min(320, Math.max(72, filtered.length * 58)),
          overflow: 'auto',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        {filtered.length <= 100 ? filtered.map((model) => (
          <Stack
            key={model.id}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ minHeight: 58, px: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap>{model.label || model.name || model.id}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{model.id}</Typography>
            </Box>
            {(model.vision || model.input?.includes('image')) && (
              <Chip size="small" variant="outlined" label={t.modelsInputImage} />
            )}
            {(model.reasoning || model.reasoningEfforts) && (
              <Chip size="small" variant="outlined" label={t.modelsReasoning} />
            )}
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {Number(model.contextWindow || 0).toLocaleString()}
            </Typography>
          </Stack>
        )) : (
          <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const model = filtered[item.index];
              return (
                <Stack
                  key={model.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                    px: 1.25,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap>{model.label || model.name || model.id}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{model.id}</Typography>
                </Box>
                {(model.vision || model.input?.includes('image')) && (
                  <Chip size="small" variant="outlined" label={t.modelsInputImage} />
                )}
                {(model.reasoning || model.reasoningEfforts) && (
                  <Chip size="small" variant="outlined" label={t.modelsReasoning} />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {Number(model.contextWindow || 0).toLocaleString()}
                </Typography>
                </Stack>
              );
            })}
          </Box>
        )}
      </Box>
      {!loading && !filtered.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t.modelsNoMatchingModels}
        </Typography>
      )}
    </Box>
  );
}

function RouteAutocomplete({ label, options, value, onChange, placeholder, t }) {
  const selected = options.find((option) => option.value === value) || null;
  return (
    <Autocomplete
      fullWidth
      size="small"
      options={options}
      value={selected}
      onChange={(_event, next) => next && onChange(next.value)}
      getOptionLabel={(option) => option.label || ''}
      isOptionEqualToValue={(option, current) => option.value === current.value}
      filterOptions={(items, state) => {
        const needle = state.inputValue.trim().toLowerCase();
        const matches = needle
          ? items.filter((item) => `${item.label} ${item.model}`.toLowerCase().includes(needle))
          : items;
        return matches.slice(0, 100);
      }}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.value}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap>{option.label}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{option.model}</Typography>
          </Box>
          {option.vision && <Chip size="small" variant="outlined" label={t.modelsInputImage} />}
          {option.reasoningEfforts && <Chip size="small" variant="outlined" label={t.modelsReasoning} />}
        </Box>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} />
      )}
    />
  );
}

function ProviderEditor({ t, provider, requiredKey, onClose, onSaved }) {
  const catalogEndpointOverride = ['cloudflare-ai-gateway', 'cloudflare-workers-ai'].includes(provider.id);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(catalogEndpointOverride ? (provider.baseUrl || '') : (provider.baseUrl || provider.defaultBaseUrl || ''));
  const [displayName, setDisplayName] = useState(provider.displayName || '');
  const [protocol, setProtocol] = useState(provider.protocol || 'openai-completions');
  const [models, setModels] = useState(!provider.catalog && provider.models?.length ? provider.models.map((model) => ({
    ...emptyModel(),
    ...model,
    name: model.name || model.label || model.id,
    input: model.input || (model.vision ? ['text', 'image'] : ['text']),
  })) : [emptyModel()]);
  const [catalogModels, setCatalogModels] = useState(provider.catalog ? (provider.models || []) : []);
  const [catalogLoading, setCatalogLoading] = useState(Boolean(provider.catalog && !provider.models?.length));
  const [customized, setCustomized] = useState(!provider.catalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetched, setFetched] = useState([]);
  const [picked, setPicked] = useState([]);
  const [retryMax, setRetryMax] = useState(provider.retryPolicy?.maxRetries ?? 5);

  useEffect(() => {
    let active = true;
    if (!provider.catalog || provider.models?.length) return undefined;
    setCatalogLoading(true);
    listProviderModels(provider.id)
      .then((result) => {
        if (active && result?.success !== false) setCatalogModels(result.models || []);
      })
      .catch((loadError) => {
        if (active) setError(loadError?.message || t.modelsLoadFailed);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => { active = false; };
  }, [provider.catalog, provider.id, provider.models, t.modelsLoadFailed]);

  const updateModel = (index, patch) => {
    const next = [...models];
    next[index] = { ...next[index], ...patch };
    setModels(next);
  };

  const payloadModels = () => models.filter((model) => String(model.id || '').trim()).map((model) => ({
    id: String(model.id).trim(),
    name: (model.name || model.label || model.id).trim(),
    label: (model.label || model.name || model.id).trim(),
    contextWindow: Number(model.contextWindow || 128000),
    maxTokens: Number(model.maxTokens || 8192),
    input: model.input?.includes('image') || model.vision ? ['text', 'image'] : ['text'],
    vision: !!(model.vision || model.input?.includes('image')),
    reasoningEfforts: model.reasoningEfforts || false,
    defaultEffort: model.defaultEffort || null,
    compat: model.compat || {},
  }));

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      if (requiredKey && !apiKey.trim()) {
        setError(t.modelsKeyRequired);
        return;
      }
      if (!provider.catalog) {
        if (!baseUrl.trim()) {
          setError(t.modelsCustomNeedsBaseUrl);
          return;
        }
        if (!payloadModels().length) {
          setError(t.modelsCustomNeedsModels);
          return;
        }
      }
      const stored = await storeProviderCredential({
        apiKey: apiKey.trim() || undefined,
        provider: provider.id,
        baseUrl: (!provider.catalog || catalogEndpointOverride) ? (baseUrl.trim() || undefined) : undefined,
        displayName: provider.catalog ? undefined : (displayName.trim() || undefined),
        protocol: provider.catalog ? undefined : protocol,
        models: provider.catalog ? undefined : payloadModels(),
        retryPolicy: { maxRetries: Number(retryMax) || 5 },
        custom: !provider.catalog,
      });
      if (!stored.success) {
        setError(stored.error || t.modelsLoadFailed);
        return;
      }
      setApiKey('');
      onSaved();
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!baseUrl.trim() && !provider.catalog) {
      setError(t.modelsFetchNeedsBaseUrl);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await fetchProviderModels({
        provider: provider.id,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        protocol,
      });
      if (!result.success) {
        setError(discoveryError(t, result));
        return;
      }
      const list = result.models || [];
      if (!list.length) {
        setError(t.modelsFetchEmpty);
        return;
      }
      setFetched(list);
      setPicked(list.map((model) => model.id));
      setFetchOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const adoptFetched = () => {
    const selected = fetched.filter((model) => picked.includes(model.id)).map((model) => ({
      ...emptyModel(),
      ...model,
      name: model.name || model.label || model.id,
    }));
    setModels(selected.length ? selected : models);
    setFetchOpen(false);
  };

  return (
    <Box sx={{ p: 2, borderRadius: 3, bgcolor: 'action.hover' }}>
      <Typography fontWeight={700} sx={{ mb: 0.25 }}>{provider.displayName}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {provider.id} · {provider.protocol || 'openai-completions'}
      </Typography>
      <TextField
        fullWidth
        type="password"
        size="small"
        label={t.modelsKeyInput}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={provider.configured ? t.modelsKeyStored : t.modelsKeyPlaceholder}
        autoFocus
        sx={{ mb: 1.5 }}
      />
      {provider.catalog && (
        <CatalogModelBrowser models={catalogModels} loading={catalogLoading} t={t} />
      )}
      {(!provider.catalog || catalogEndpointOverride) && (
        <Button size="small" onClick={() => setCustomized((cur) => !cur)} endIcon={<ExpandMoreIcon />}>
          {t.modelsCustomized}
        </Button>
      )}
      <Collapse in={customized && (!provider.catalog || catalogEndpointOverride)}>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {!provider.catalog && (
            <>
              <TextField
                size="small"
                label={t.modelsCustomDisplayName}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <FormControl size="small">
                <InputLabel>{t.modelsCustomApi}</InputLabel>
                <Select
                  label={t.modelsCustomApi}
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value)}
                >
                  {PROTOCOLS.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
          <TextField
            size="small"
            label={t.modelsBaseUrl}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={provider.catalog ? t.modelsBaseUrlDefault : t.modelsCustomBaseUrlPlaceholder}
          />
          <TextField
            size="small"
            type="number"
            label={t.modelsRetry}
            value={retryMax}
            onChange={(event) => setRetryMax(event.target.value)}
          />
          {!provider.catalog && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle2">{t.modelsModels}</Typography>
                <Button size="small" onClick={fetchModels} disabled={busy}>
                  {busy ? t.modelsFetching : t.modelsFetchModels}
                </Button>
              </Stack>
              {models.map((model, index) => (
                <Box key={`${model.id}-${index}`} sx={{ p: 1.25, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  label={t.modelsModelId}
                  value={model.id}
                  onChange={(event) => updateModel(index, { id: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t.modelsModelName}
                  value={model.name || model.label || ''}
                  placeholder={t.modelsModelNamePlaceholder}
                  onChange={(event) => updateModel(index, { name: event.target.value, label: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <Button color="error" onClick={() => setModels(models.filter((_, i) => i !== index))}>
                  {t.modelsRemoveModel}
                </Button>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  type="number"
                  label={t.modelsContextWindow}
                  value={model.contextWindow || ''}
                  onChange={(event) => updateModel(index, { contextWindow: event.target.value })}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t.modelsMaxOutput}
                  value={model.maxTokens || ''}
                  onChange={(event) => updateModel(index, { maxTokens: event.target.value })}
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>{t.modelsDefaultEffort}</InputLabel>
                  <Select
                    label={t.modelsDefaultEffort}
                    value={model.defaultEffort || ''}
                    onChange={(event) => updateModel(index, { defaultEffort: event.target.value })}
                  >
                    <MenuItem value="">{t.modelsReasoningOff}</MenuItem>
                    {EFFORTS.map((effort) => (
                      <MenuItem key={effort} value={effort}>{effort}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction="row" spacing={2}>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={(model.input || []).includes('text') || true}
                      disabled
                    />
                  )}
                  label={t.modelsInputText}
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={!!(model.vision || (model.input || []).includes('image'))}
                      onChange={(event) => updateModel(index, {
                        vision: event.target.checked,
                        input: event.target.checked ? ['text', 'image'] : ['text'],
                      })}
                    />
                  )}
                  label={t.modelsInputImage}
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={Boolean(model.reasoningEfforts)}
                      onChange={(event) => updateModel(index, {
                        reasoningEfforts: event.target.checked
                          ? { off: 'off', low: 'low', high: 'high', max: 'max' }
                          : false,
                      })}
                    />
                  )}
                  label={t.modelsReasoning}
                />
              </Stack>
                </Box>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={() => setModels([...models, emptyModel()])}>
                {t.modelsAddModel}
              </Button>
            </>
          )}
        </Stack>
      </Collapse>
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button onClick={() => onClose(false)} disabled={busy}>{t.modelsCancel}</Button>
        <Button variant="contained" onClick={apply} disabled={busy}>
          {busy ? t.modelsApplying : t.modelsApply}
        </Button>
      </Stack>

      <Dialog open={fetchOpen} onClose={() => setFetchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t.modelsFetchTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.modelsFetchDescription}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button size="small" onClick={() => setPicked(fetched.map((model) => model.id))}>{t.modelsFetchSelectAll}</Button>
            <Button size="small" onClick={() => setPicked([])}>{t.modelsFetchDeselectAll}</Button>
          </Stack>
          {fetched.map((model) => (
            <Stack key={model.id} direction="row" alignItems="center">
              <Checkbox
                checked={picked.includes(model.id)}
                onChange={(event) => {
                  setPicked((cur) => (event.target.checked ? [...cur, model.id] : cur.filter((id) => id !== model.id)));
                }}
              />
              <Typography variant="body2">{model.label || model.name || model.id}</Typography>
            </Stack>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFetchOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={adoptFetched}>{t.modelsFetchAdopt}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function ModelsSettings({ onConfiguredChange }) {
  const { t } = useRegion();
  const [directory, setDirectory] = useState([]);
  const [settings, setSettings] = useState({});
  const [editing, setEditing] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(emptyCustom());
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState([]);

  const onConfiguredChangeRef = useRef(onConfiguredChange);
  onConfiguredChangeRef.current = onConfiguredChange;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getCredentialStatus();
      if (status.success === false) {
        setMessage({ severity: 'error', text: status.error || t.modelsLoadFailed });
        return;
      }
      if (!Array.isArray(status.directory)) {
        setMessage({ severity: 'error', text: t.modelsLoadFailed });
        return;
      }
      setDirectory(status.directory || []);
      setSettings(status.settings || {});
      setMessage((current) => (current?.severity === 'error' ? null : current));
      onConfiguredChangeRef.current?.(status);
    } catch (error) {
      setMessage({ severity: 'error', text: error?.message || t.modelsLoadFailed });
    } finally {
      setLoading(false);
    }
  }, [t.modelsLoadFailed]);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => {
    const configured = new Set((directory || []).filter((item) => item.configured || item.custom).map((item) => item.id));
    return (directory || []).filter((item) => (
      !item.authUnsupported && (
        item.recommended
      || item.configured
      || item.custom
      || addedIds.includes(item.id)
      || configured.has(item.id)
      )
    ));
  }, [directory, addedIds]);
  const unusedCatalog = (directory || []).filter((item) => (
    item.catalog && !item.authUnsupported && !visible.some((shown) => shown.id === item.id)
  ));
  const groups = groupDirectory(visible);
  const configuredRoutes = routeOptions(directory, { configuredOnly: true });
  const visionRoutes = routeOptions(directory, { configuredOnly: true, visionOnly: true, userOwnedOnly: true });
  const assistantValue = settings.assistant_provider && settings.assistant_model
    ? `${settings.assistant_provider}::${settings.assistant_model}`
    : '';
  const siliconValue = settings.silicon_provider && settings.silicon_model
    ? `${settings.silicon_provider}::${settings.silicon_model}`
    : '';

  const persistRoute = async (kind, value) => {
    const hit = (kind === 'silicon' ? visionRoutes : configuredRoutes).find((route) => route.value === value);
    if (!hit) return;
    const patch = kind === 'assistant'
      ? {
        default_provider: hit.provider,
        assistant_provider: hit.provider,
        assistant_model: hit.model,
        assistant_reasoning_effort: hit.defaultEffort || null,
        expectedRevision: settings.settings_revision,
      }
      : {
        silicon_provider: hit.provider,
        silicon_model: hit.model,
        silicon_reasoning_effort: hit.defaultEffort || null,
        expectedRevision: settings.settings_revision,
      };
    const saved = await saveAiSettings(patch);
    if (saved.code === 'SETTINGS_CONFLICT') {
      setMessage({ severity: 'error', text: t.modelsSettingsConflict });
      refresh();
      return;
    }
    if (saved.success !== false) refresh();
    else setMessage({ severity: 'error', text: saved.error || t.modelsLoadFailed });
  };

  const addCatalogProvider = () => {
    if (!addProvider) return;
    setAddedIds((cur) => (cur.includes(addProvider) ? cur : [...cur, addProvider]));
    setAddOpen(false);
    setEditing(addProvider);
  };

  const createCustom = async () => {
    if (!PROVIDER_ID_RE.test(custom.provider)) {
      setMessage({ severity: 'error', text: t.modelsCustomRouteInvalid });
      return;
    }
    if ((directory || []).some((item) => item.id === custom.provider)) {
      setMessage({ severity: 'error', text: t.modelsCustomRouteTaken });
      return;
    }
    if (!custom.baseUrl.trim()) {
      setMessage({ severity: 'error', text: t.modelsCustomNeedsBaseUrl });
      return;
    }
    const models = custom.models.filter((model) => model.id.trim());
    if (!models.length) {
      setMessage({ severity: 'error', text: t.modelsCustomNeedsModels });
      return;
    }
    if (!custom.apiKey.trim()) {
      setMessage({ severity: 'error', text: t.modelsKeyRequired });
      return;
    }
    setBusy(true);
    try {
      const storedResult = await storeProviderCredential({
        apiKey: custom.apiKey.trim(),
        provider: custom.provider,
        baseUrl: custom.baseUrl.trim(),
        displayName: custom.displayName.trim() || custom.provider,
        protocol: custom.protocol,
        models,
        custom: true,
      });
      if (!storedResult.success) {
        setMessage({ severity: 'error', text: storedResult.error || t.modelsLoadFailed });
        return;
      }
      setCustomOpen(false);
      setCustom(emptyCustom());
      setMessage({ severity: 'success', text: tf(t.modelsSavedProvider, { provider: custom.displayName || custom.provider }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async (id) => {
    if (!window.confirm(tf(t.modelsDeleteDescriptionWithCredential, { provider: id }))) return;
    setBusy(true);
    try {
      await deleteProviderCredential(id);
      setAddedIds((cur) => cur.filter((item) => item !== id));
      if (editing === id) setEditing(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const renderGroup = (title, items) => {
    if (!items.length) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{title}</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {items.map((provider) => {
            return (
              <Box
                key={provider.id}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 3,
                  px: 1.75,
                  py: 1.5,
                  transition: 'border-color 120ms ease, background-color 120ms ease',
                  '&:hover': {
                    borderColor: 'text.disabled',
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Box
                        role="img"
                        aria-label={provider.configured ? t.modelsCredentialConfigured : t.modelsCredentialMissing}
                        title={provider.configured ? t.modelsCredentialConfigured : t.modelsCredentialMissing}
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: provider.configured ? 'success.main' : 'text.disabled',
                          flexShrink: 0,
                        }}
                      />
                      <Typography fontWeight={600}>{provider.displayName}</Typography>
                      {provider.recommended && <Chip size="small" variant="outlined" label={t.integRecommended} />}
                      {provider.custom && <Chip size="small" variant="outlined" label={t.modelsCustomTag} />}
                    </Stack>
                    {(provider.custom || provider.configured) && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                        {provider.id}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button
                      size="small"
                      variant={provider.configured ? 'text' : 'outlined'}
                      onClick={() => setEditing(editing === provider.id ? null : provider.id)}
                      sx={{ borderRadius: 999, textTransform: 'none' }}
                    >
                      {t.modelsEdit}
                    </Button>
                    {provider.id !== 'deepseek' && (
                      <IconButton size="small" color="error" onClick={() => removeProvider(provider.id)} disabled={busy}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </Stack>
                {editing === provider.id && (
                  <Box sx={{ mt: 1.5 }}>
                    <ProviderEditor
                      t={t}
                      provider={provider}
                      requiredKey={!provider.configured}
                      onClose={(changed) => {
                        setEditing(null);
                        if (changed) {
                          setMessage({ severity: 'success', text: tf(t.modelsSavedProvider, { provider: provider.displayName }) });
                        }
                      }}
                      onSaved={refresh}
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>{t.modelsTitle}</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>{t.modelsIntro}</Typography>

      {message && (
        <Alert
          severity={message.severity}
          onClose={() => setMessage(null)}
          action={message.severity === 'error' ? (
            <Button color="inherit" size="small" onClick={refresh} disabled={loading}>
              {t.modelsReload}
            </Button>
          ) : undefined}
          sx={{ mb: 2 }}
        >
          {message.text}
        </Alert>
      )}

      {configuredRoutes.length > 0 && (
        <Box sx={{ p: 1.5, mb: 2.5, borderRadius: 3, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t.modelsDefaults}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <RouteAutocomplete
              label={t.integAssistantModel}
              options={configuredRoutes}
              value={assistantValue}
              onChange={(value) => persistRoute('assistant', value)}
              placeholder={t.modelsSelectModel}
              t={t}
            />
            <RouteAutocomplete
              label={t.integSiliconModel}
              options={visionRoutes}
              value={siliconValue}
              onChange={(value) => persistRoute('silicon', value)}
              placeholder={t.modelsSelectVision}
              t={t}
            />
          </Stack>
        </Box>
      )}

      {renderGroup(t.modelsGroupRecommended, groups.recommended)}
      {renderGroup(t.modelsGroupConfigured, groups.configured)}
      {renderGroup(t.modelsGroupCatalog, groups.catalog)}
      {renderGroup(t.modelsGroupCustom, groups.custom)}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
          onClick={() => setAddOpen(true)}
          disabled={loading || !unusedCatalog.length}
          sx={{ borderRadius: 999, textTransform: 'none' }}
        >
          {t.modelsAdd}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCustomOpen(true)}
          sx={{ borderRadius: 999, textTransform: 'none' }}
        >
          {t.modelsCustomAdd}
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ mt: 1.5 }}>
        {t.integGetKey}{' '}
        <Link href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek</Link>
        {' / '}
        <Link href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</Link>
        {' / '}
        <Link href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</Link>
      </Typography>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
        <DialogTitle>{t.modelsAdd}</DialogTitle>
        <DialogContent sx={{ pt: 1, minWidth: 320 }}>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel id="add-provider-label">{t.modelsProvider}</InputLabel>
            <Select
              labelId="add-provider-label"
              label={t.modelsProvider}
              value={unusedCatalog.some((item) => item.id === addProvider) ? addProvider : (unusedCatalog[0]?.id || '')}
              onChange={(event) => setAddProvider(event.target.value)}
            >
              {unusedCatalog.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.displayName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={addCatalogProvider} disabled={!unusedCatalog.length}>{t.modelsAdd}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t.modelsCustomTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t.modelsCustomRoute}
              value={custom.provider}
              onChange={(event) => setCustom({ ...custom, provider: event.target.value.trim() })}
              helperText={t.modelsCustomRouteHint}
            />
            <TextField
              size="small"
              label={t.modelsCustomDisplayName}
              value={custom.displayName}
              onChange={(event) => setCustom({ ...custom, displayName: event.target.value })}
            />
            <TextField
              size="small"
              label={t.modelsBaseUrl}
              value={custom.baseUrl}
              onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
              placeholder={t.modelsCustomBaseUrlPlaceholder}
            />
            <FormControl size="small">
              <InputLabel>{t.modelsCustomApi}</InputLabel>
              <Select
                label={t.modelsCustomApi}
                value={custom.protocol}
                onChange={(event) => setCustom({ ...custom, protocol: event.target.value })}
              >
                {PROTOCOLS.map((id) => (
                  <MenuItem key={id} value={id}>{id}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="password"
              label={t.modelsKeyInput}
              value={custom.apiKey}
              onChange={(event) => setCustom({ ...custom, apiKey: event.target.value })}
              placeholder={t.modelsKeyPlaceholder}
            />
            {custom.models.map((model, index) => (
              <Stack key={index} direction="row" spacing={1}>
                <TextField
                  size="small"
                  label={t.modelsModelId}
                  value={model.id}
                  onChange={(event) => {
                    const next = [...custom.models];
                    next[index] = { ...model, id: event.target.value };
                    setCustom({ ...custom, models: next });
                  }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t.modelsModelName}
                  value={model.name || model.label || ''}
                  onChange={(event) => {
                    const next = [...custom.models];
                    next[index] = { ...model, name: event.target.value, label: event.target.value };
                    setCustom({ ...custom, models: next });
                  }}
                  sx={{ flex: 1 }}
                />
              </Stack>
            ))}
            <Button size="small" onClick={() => setCustom({ ...custom, models: [...custom.models, emptyModel()] })}>
              {t.modelsAddModel}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={createCustom} disabled={busy}>
            {busy ? t.modelsCreating : t.modelsCreate}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
