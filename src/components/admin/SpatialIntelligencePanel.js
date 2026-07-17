import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Button, TextField, Typography,
  Alert, Chip, Stack,
} from '@mui/material';
import { testFalKey } from '../../lib/falInference';
import { testHuggingFaceToken } from '../../lib/huggingface';
import {
  loadUserSpatialSettings,
  saveUserSpatialSettings,
  coalesceSpatialSettings,
  mergeSpatialIntoConfig,
  pickSpatialSettings,
} from '../../lib/spatialSettingsStore';
import { LOCAL_USER_ID } from '../../lib/appMode';
import FeatureExtractionJobs from './FeatureExtractionJobs';

function keyHint(key) {
  if (!key || key.length < 4) return '';
  return key.slice(-4);
}

const cardSx = (borderColor) => ({
  p: 2.5,
  borderRadius: 1.5,
  border: '2px solid',
  borderColor,
  bgcolor: (t) => (t.palette.mode === 'dark' ? 'background.paper' : 'action.hover'),
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
});

/**
 * Spatial intelligence: HF + fal keys (researcher) + L0/Seg jobs.
 * SAM is for Media Dataset pre-annotation only — never live surveys.
 */
export default function SpatialIntelligencePanel({
  currentProject,
  onProjectUpdate,
  onConfigChange,
  onFeaturesUpdated,
}) {
  const user = { id: LOCAL_USER_ID };
  const cfg = currentProject?.imageDatasetConfig || {};
  const savedFalKey = cfg.falApiKey || '';
  const savedHfToken = cfg.huggingFaceToken || '';
  const [falKey, setFalKey] = useState(savedFalKey);
  const [hfKey, setHfKey] = useState(savedHfToken);
  const [editingFal, setEditingFal] = useState(!savedFalKey);
  const [editingHf, setEditingHf] = useState(!savedHfToken);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [userSettingsLoaded, setUserSettingsLoaded] = useState(false);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;
  const hydratedProjectRef = useRef(null);

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const r2Prefix = projectId ? `${userId}/${projectId}/` : '';

  useEffect(() => {
    setFalKey(cfg.falApiKey || '');
    setHfKey(cfg.huggingFaceToken || '');
    setEditingFal(!(cfg.falApiKey));
    setEditingHf(!(cfg.huggingFaceToken));
  }, [cfg.falApiKey, cfg.huggingFaceToken, currentProject?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !currentProject?.id) {
        setUserSettingsLoaded(true);
        return;
      }
      if (hydratedProjectRef.current === currentProject.id) {
        setUserSettingsLoaded(true);
        return;
      }
      const userSettings = await loadUserSpatialSettings(user.id);
      if (cancelled) return;
      setUserSettingsLoaded(true);
      hydratedProjectRef.current = currentProject.id;
      if (!userSettings) return;

      const merged = coalesceSpatialSettings(cfgRef.current, userSettings);
      const projectHadGaps = !cfgRef.current?.falApiKey || !cfgRef.current?.huggingFaceToken;
      setFalKey(merged.falApiKey);
      setHfKey(merged.huggingFaceToken);
      setEditingFal(!merged.falApiKey);
      setEditingHf(!merged.huggingFaceToken);

      if (projectHadGaps && (merged.falApiKey || merged.huggingFaceToken)) {
        const nextCfg = mergeSpatialIntoConfig(cfgRef.current, {
          ...merged,
          enableSamAssist: false,
        });
        const latest = cfgRef.current || {};
        const { imageFeatures: _drop, ...rest } = latest;
        const full = { ...rest, ...nextCfg, enableSamAssist: false };
        const base = projectRef.current;
        const updated = { ...base, imageDatasetConfig: full };
        cfgRef.current = full;
        projectRef.current = updated;
        onProjectUpdate?.(updated);
        onConfigChange?.(true, full);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentProject?.id]);

  const persistConfig = (nextCfg) => {
    const latest = cfgRef.current || {};
    const { imageFeatures: _drop, ...rest } = latest;
    const merged = { ...rest, ...nextCfg, enableSamAssist: false };
    delete merged.imageFeatures;
    const base = projectRef.current || currentProject;
    const updated = { ...base, imageDatasetConfig: merged };
    cfgRef.current = merged;
    projectRef.current = updated;
    onProjectUpdate?.(updated);
    onConfigChange?.(true, merged);
    return merged;
  };

  const saveAllSettings = async (overrides = {}) => {
    setBusy('save-settings');
    setError(null);
    const spatial = pickSpatialSettings({
      falApiKey: overrides.falApiKey !== undefined ? overrides.falApiKey : falKey,
      huggingFaceToken: overrides.huggingFaceToken !== undefined ? overrides.huggingFaceToken : hfKey,
      enableSamAssist: false,
    });
    setFalKey(spatial.falApiKey);
    setHfKey(spatial.huggingFaceToken);
    const next = mergeSpatialIntoConfig(cfgRef.current, spatial);
    persistConfig(next);
    const userResult = await saveUserSpatialSettings(user?.id, spatial);
    setEditingFal(!spatial.falApiKey);
    setEditingHf(!spatial.huggingFaceToken);
    setBusy(null);
    if (userResult.success) {
      setMessage('Settings saved to this project and this browser.');
    } else if (user?.id) {
      setMessage('Settings saved to this project. Browser defaults could not be saved.');
    } else {
      setMessage('Settings saved to this project.');
    }
  };

  const clearFalKey = async () => {
    setFalKey('');
    setEditingFal(true);
    await saveAllSettings({ falApiKey: '' });
  };

  const clearHfKey = async () => {
    setHfKey('');
    setEditingHf(true);
    await saveAllSettings({ huggingFaceToken: '' });
  };

  const handleTestFal = async () => {
    setBusy('test-fal');
    setError(null);
    try {
      await testFalKey(falKey);
      setMessage('Fal API key looks valid.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleTestHf = async () => {
    setBusy('test-hf');
    setError(null);
    try {
      const info = await testHuggingFaceToken(hfKey);
      setMessage(info.name
        ? `HuggingFace token valid (user: ${info.name}).`
        : 'HuggingFace token looks valid.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        Spatial intelligence (Optional)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        API keys for feature extraction. Live surveys never use SAM — SAM3 is only under Media library → Pre-annotate.
        {!userSettingsLoaded ? ' Loading account settings…' : ''}
      </Typography>

      {(message || error) && (
        <Stack spacing={1} sx={{ mb: 1.5 }}>
          {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignItems: 'stretch',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        {/* HF token */}
        <Box sx={cardSx('info.light')}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700 }}>
            HuggingFace token
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Needed for SegFormer streetscape segmentation.
          </Typography>
          {!editingHf && (savedHfToken || hfKey) ? (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
              <Chip label={`HF saved · …${keyHint(savedHfToken || hfKey)}`} color="success" size="small" />
              <Button size="small" onClick={() => setEditingHf(true)}>Replace</Button>
            </Box>
          ) : (
            <TextField
              type="password"
              size="small"
              fullWidth
              label="HF_TOKEN"
              value={hfKey}
              onChange={(e) => setHfKey(e.target.value)}
              helperText="huggingface.co/settings/tokens"
              sx={{ mb: 1.5 }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 'auto' }}>
            <Button size="small" variant="outlined" disabled={!hfKey || busy === 'test-hf'} onClick={handleTestHf}>
              Test HF
            </Button>
            <Button size="small" color="error" variant="text" disabled={!savedHfToken && !hfKey} onClick={clearHfKey}>
              Clear
            </Button>
          </Box>
        </Box>

        {/* fal key */}
        <Box sx={cardSx('success.light')}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700 }}>
            fal.ai API key
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            For SAM3 pre-annotation in Media library only (not surveys).
          </Typography>
          {!editingFal && (savedFalKey || falKey) ? (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
              <Chip label={`fal saved · …${keyHint(savedFalKey || falKey)}`} color="success" size="small" />
              <Button size="small" onClick={() => setEditingFal(true)}>Replace</Button>
            </Box>
          ) : (
            <TextField
              type="password"
              size="small"
              fullWidth
              label="FAL_KEY"
              value={falKey}
              onChange={(e) => setFalKey(e.target.value)}
              helperText="fal.ai/dashboard/keys — key_id:secret"
              sx={{ mb: 1.5 }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 'auto' }}>
            <Button
              size="small"
              variant="contained"
              disabled={busy === 'save-settings'}
              onClick={() => saveAllSettings()}
            >
              Save settings
            </Button>
            <Button size="small" variant="outlined" disabled={!falKey || busy === 'test-fal'} onClick={handleTestFal}>
              Test fal
            </Button>
            <Button size="small" color="error" variant="text" disabled={!savedFalKey && !falKey} onClick={clearFalKey}>
              Clear
            </Button>
          </Box>
          {busy === 'save-settings' && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>Saving…</Typography>
          )}
        </Box>

        {/* Feature jobs */}
        <Box sx={cardSx('primary.light')}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
            Feature extraction
          </Typography>
          <FeatureExtractionJobs
            compact
            r2Prefix={r2Prefix}
            images={currentProject?.preloadedImages || []}
            hfToken={hfKey || savedHfToken}
            onFeaturesUpdated={onFeaturesUpdated}
          />
        </Box>
      </Box>
    </Box>
  );
}
