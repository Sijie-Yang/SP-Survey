import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Alert, CircularProgress, Divider,
} from '@mui/material';
import { Save, Refresh, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import { applySupabaseConfigFromProject } from '../../lib/supabase';
import { useRegion } from '../../contexts/RegionContext';

const defaultFields = {
  supabaseProjectId: '',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseAnonKey: '',
};

export default function SupabaseStorageConfig({ currentProject, onProjectUpdate, onConfigChange, compact = false }) {
  const { language } = useRegion();
  const zh = language === 'zh';
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
          success: zh ? '连接已验证（来自已保存状态）' : 'Connection verified (from saved state)',
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
      setStatus((prev) => ({
        ...prev,
        error: zh ? '请先填写 Supabase 网址和服务角色密钥。' : 'Provide Supabase URL and Service Role Key first.',
      }));
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
        success: zh
          ? 'Supabase 连接成功。请点击保存以写入项目。'
          : 'Supabase connection successful. Click Save Configuration to persist.',
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
    <Box sx={compact ? { display: 'flex', flexDirection: 'column', height: '100%' } : { mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
        {compact
          ? (zh ? 'Supabase 存储' : 'Supabase Storage')
          : (zh ? 'Supabase 存储配置' : 'Supabase Storage Configuration')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {compact ? (
          zh
            ? <>连接你自己的项目。管理端上传用 <strong>service_role</strong>；已部署问卷用 <strong>anon</strong>。</>
            : <>Connect your own project. Admin uploads use <strong>service_role</strong>; deployed surveys use <strong>anon</strong>.</>
        ) : (
          zh
            ? <>配置 Supabase 用于媒体存储和答卷收集。管理端上传使用 <strong>service_role</strong>；参与者站点使用 <strong>anon</strong>。</>
            : <>Configure Supabase for image/media storage and survey response collection.
            Use the <strong>service_role</strong> key here for admin uploads; use the <strong>anon</strong> key for Vercel deployment (Step 4).</>
        )}
      </Typography>

      {!compact && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {zh
            ? <>在 Supabase 控制台 → Project Settings → API 复制 Project URL、anon 和 service_role。公开桶名为 <code>survey-images</code>（也可在首次上传时自动创建）。</>
            : <>Supabase Dashboard → Project Settings → API → copy Project URL, anon key, and service_role key.
          Create a public bucket named <code>survey-images</code> (or let the app create it on first upload).</>}
        </Alert>
      )}

      {(status.connected || status.error) && (
        <Alert severity={status.connected ? 'success' : 'error'} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {status.loading ? <CircularProgress size={18} /> : status.connected ? <CheckCircle /> : <ErrorIcon />}
            <Typography variant="body2">{status.connected ? status.success : status.error}</Typography>
          </Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: compact ? 1 : 2, flex: 1 }}>
        <TextField
          size={compact ? 'small' : 'medium'}
          label={zh ? 'Supabase 项目 ID' : 'Supabase Project ID'}
          value={config.supabaseProjectId || ''}
          onChange={(e) => handleField('supabaseProjectId', e.target.value)}
          placeholder="abcdefghijklmnopqrst"
          helperText={zh ? '自动生成 https://<id>.supabase.co' : 'Auto-builds https://<id>.supabase.co'}
        />
        <TextField
          size={compact ? 'small' : 'medium'}
          label={zh ? 'Supabase 项目网址' : 'Supabase Project URL'}
          value={config.supabaseUrl || ''}
          InputProps={{ readOnly: true }}
        />
        <TextField
          size={compact ? 'small' : 'medium'}
          label={zh ? 'Anon 密钥（已部署问卷使用）' : 'Anon Key (for deployed survey / Vercel)'}
          type="password"
          value={config.supabaseAnonKey || ''}
          onChange={(e) => handleField('supabaseAnonKey', e.target.value)}
          helperText={zh ? '公开 anon 密钥，写入部署环境变量' : 'Public anon key — embedded in deployment .env'}
        />
        <TextField
          size={compact ? 'small' : 'medium'}
          label={zh ? 'Service Role 密钥（仅管理端上传）' : 'Service Role Key (admin uploads only)'}
          type="password"
          value={config.supabaseKey || ''}
          onChange={(e) => handleField('supabaseKey', e.target.value)}
          helperText={zh ? '保密，不要提交或打进参与者站点' : 'Keep secret — never commit or deploy this key'}
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: compact ? 'auto' : 0 }}>
          <Button size={compact ? 'small' : 'medium'} variant="contained" startIcon={<Save />} onClick={saveConfig} disabled={!config.supabaseUrl || !config.supabaseKey}>
            {compact ? (zh ? '保存' : 'Save') : (zh ? '保存配置' : 'Save Configuration')}
          </Button>
          <Button
            size={compact ? 'small' : 'medium'}
            variant="outlined"
            startIcon={status.loading ? <CircularProgress size={18} /> : <Refresh />}
            onClick={testConnection}
            disabled={!config.supabaseUrl || !config.supabaseKey || status.loading}
          >
            {compact ? (zh ? '测试' : 'Test') : (zh ? '测试连接' : 'Test Connection')}
          </Button>
        </Box>
      </Box>
      {!compact && <Divider sx={{ mt: 3 }} />}
    </Box>
  );
}
