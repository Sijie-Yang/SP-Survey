import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Alert, CircularProgress, Divider,
} from '@mui/material';
import { Save, Refresh, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import { applySupabaseConfigFromProject } from '../../lib/supabase';

const defaultFields = {
  supabaseProjectId: '',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseAnonKey: '',
};

export default function SupabaseStorageConfig({ currentProject, onProjectUpdate, onConfigChange }) {
  const [config, setConfig] = useState(defaultFields);
  const [initialConfig, setInitialConfig] = useState(null);
  const [status, setStatus] = useState({
    loading: false, connected: false, error: null, success: null, projectInfo: null,
  });

  useEffect(() => {
    if (currentProject?.imageDatasetConfig) {
      const c = { ...defaultFields, ...currentProject.imageDatasetConfig };
      if (!c.supabaseProjectId && c.supabaseUrl) {
        try {
          c.supabaseProjectId = new URL(c.supabaseUrl).hostname.replace('.supabase.co', '');
        } catch (_) { /* ignore */ }
      }
      setConfig(c);
      setInitialConfig(JSON.parse(JSON.stringify(c)));
      if (c.supabaseConnectionStatus?.connected) {
        setStatus({
          loading: false,
          connected: true,
          error: null,
          success: 'Connection verified (from saved state)',
          projectInfo: c.supabaseConnectionStatus.projectInfo || null,
        });
      }
    } else {
      setConfig(defaultFields);
      setInitialConfig(JSON.parse(JSON.stringify(defaultFields)));
    }
  }, [currentProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialConfig || !onConfigChange) return;
    const hasChanges = JSON.stringify(config) !== JSON.stringify(initialConfig);
    onConfigChange(hasChanges, {
      ...currentProject?.imageDatasetConfig,
      ...config,
    });
  }, [config, initialConfig, onConfigChange, currentProject?.imageDatasetConfig]);

  const handleField = (field, value) => {
    if (field === 'supabaseProjectId') {
      const id = (value || '').trim();
      setConfig((prev) => ({
        ...prev,
        supabaseProjectId: id,
        supabaseUrl: id ? `https://${id}.supabase.co` : '',
      }));
      return;
    }
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const saveConfig = () => {
    if (!currentProject) return;
    const imageDatasetConfig = {
      ...currentProject.imageDatasetConfig,
      ...config,
    };
    const updatedProject = { ...currentProject, imageDatasetConfig };
    applySupabaseConfigFromProject(imageDatasetConfig);
    onProjectUpdate(updatedProject);
    setInitialConfig(JSON.parse(JSON.stringify(config)));
    if (onConfigChange) onConfigChange(false, imageDatasetConfig);
  };

  const testConnection = async () => {
    if (!config.supabaseUrl || !config.supabaseKey) {
      setStatus((prev) => ({ ...prev, error: 'Provide Supabase URL and Service Role Key first.' }));
      return;
    }
    setStatus({ loading: true, connected: false, error: null, success: null, projectInfo: null });
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(config.supabaseUrl, config.supabaseKey);
      const { data: buckets, error } = await client.storage.listBuckets();
      if (error) throw error;
      const projectInfo = {
        url: config.supabaseUrl,
        bucketsCount: buckets?.length || 0,
        surveyBucketExists: buckets?.some((b) => b.name === 'survey-images'),
        buckets: buckets?.map((b) => b.name) || [],
      };
      const connectionStatus = {
        connected: true,
        projectInfo,
        lastTested: new Date().toISOString(),
      };
      setConfig((prev) => ({ ...prev, supabaseConnectionStatus: connectionStatus }));
      setStatus({
        loading: false,
        connected: true,
        error: null,
        success: 'Supabase connection successful. Click Save Configuration to persist.',
        projectInfo,
      });
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        error: err.message,
        success: null,
        projectInfo: null,
      });
    }
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
        Supabase Storage Configuration
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Configure Supabase for image/media storage and survey response collection.
        Use the <strong>service_role</strong> key here for admin uploads; use the <strong>anon</strong> key for Vercel deployment (Step 4).
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Supabase Dashboard → Project Settings → API → copy Project URL, anon key, and service_role key.
        Create a public bucket named <code>survey-images</code> (or let the app create it on first upload).
      </Alert>

      {(status.connected || status.error) && (
        <Alert severity={status.connected ? 'success' : 'error'} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {status.loading ? <CircularProgress size={18} /> : status.connected ? <CheckCircle /> : <ErrorIcon />}
            <Typography variant="body2">{status.connected ? status.success : status.error}</Typography>
          </Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <TextField
          label="Supabase Project ID"
          value={config.supabaseProjectId || ''}
          onChange={(e) => handleField('supabaseProjectId', e.target.value)}
          placeholder="abcdefghijklmnopqrst"
          helperText="Auto-builds https://&lt;id&gt;.supabase.co"
        />
        <TextField
          label="Supabase Project URL"
          value={config.supabaseUrl || ''}
          InputProps={{ readOnly: true }}
        />
        <TextField
          label="Anon Key (for deployed survey / Vercel)"
          type="password"
          value={config.supabaseAnonKey || ''}
          onChange={(e) => handleField('supabaseAnonKey', e.target.value)}
          helperText="Public anon key — embedded in deployment .env"
        />
        <TextField
          label="Service Role Key (admin uploads only)"
          type="password"
          value={config.supabaseKey || ''}
          onChange={(e) => handleField('supabaseKey', e.target.value)}
          helperText="Keep secret — never commit or deploy this key"
        />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<Save />} onClick={saveConfig} disabled={!config.supabaseUrl || !config.supabaseKey}>
            Save Configuration
          </Button>
          <Button
            variant="outlined"
            startIcon={status.loading ? <CircularProgress size={18} /> : <Refresh />}
            onClick={testConnection}
            disabled={!config.supabaseUrl || !config.supabaseKey || status.loading}
          >
            Test Connection
          </Button>
        </Box>
      </Box>
      <Divider sx={{ mt: 3 }} />
    </Box>
  );
}
