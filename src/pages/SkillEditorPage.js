import React, { useEffect, useState } from 'react';
import {
  Box, Container, Typography, AppBar, Toolbar, TextField, Button,
  Alert, Paper, Stack, IconButton, Chip,
} from '@mui/material';
import { ArrowBack, Publish, Save } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import {
  saveSkill, submitSkillForReview, getSkillById, getSkillStatus,
} from '../lib/skillManager';
import SkillQuestionFrame from '../components/SkillQuestionWidget';
import { listSkillPreviewMedia, pickPreviewMedia } from '../lib/skillPreviewMedia';
import SkillAiPanel from '../components/admin/SkillAiPanel';

const DEFAULT_SKILL_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:sans-serif;padding:12px;}
button{padding:8px 16px;margin:4px;}
</style></head><body>
<h3>My Custom Question</h3>
<p>Click to record your answer:</p>
<button onclick="SPSkill.setAnswer('clicked')">Record Answer</button>
<script>
document.addEventListener('spskill-init', function(e) {
  console.log('Skill initialized', e.detail);
  SPSkill.ready();
});
</script>
</body></html>`;

export default function SkillEditorPage() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const [skillId, setSkillId] = useState(routeId || null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceHtml, setSourceHtml] = useState(DEFAULT_SKILL_HTML);
  const [configSchema, setConfigSchema] = useState('[]');
  const [resultSchema, setResultSchema] = useState('[]');
  const [defaultConfig, setDefaultConfig] = useState('{}');
  const [previewConfig, setPreviewConfig] = useState({});
  const [status, setStatus] = useState('draft');
  const [loading, setLoading] = useState(!!routeId);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewImages, setPreviewImages] = useState([]);
  const [openaiApiKey] = useState(() => localStorage.getItem('openaiApiKey') || sessionStorage.getItem('openai_api_key') || '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pool = await listSkillPreviewMedia();
      if (cancelled) return;
      const count = previewConfig.mediaCount || 1;
      const mediaType = previewConfig.mediaType || 'image';
      const picked = pickPreviewMedia(pool, mediaType, count);
      setPreviewImages(picked.length ? picked : (previewConfig.demoImages || []));
    })();
    return () => { cancelled = true; };
  }, [previewConfig]);

  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const skill = await getSkillById(routeId);
      if (cancelled) return;
      if (!skill) {
        setError('Skill not found or you do not have access');
        setLoading(false);
        return;
      }
      setSkillId(skill.id);
      setName(skill.name);
      setDescription(skill.description);
      setSourceHtml(skill.sourceHtml || DEFAULT_SKILL_HTML);
      setConfigSchema(JSON.stringify(skill.configSchema || [], null, 2));
      setResultSchema(JSON.stringify(skill.resultSchema || [], null, 2));
      setDefaultConfig(JSON.stringify(skill.defaultConfig || {}, null, 2));
      setPreviewConfig(skill.defaultConfig || {});
      setStatus(getSkillStatus(skill));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [routeId]);

  useEffect(() => {
    try {
      setPreviewConfig(JSON.parse(defaultConfig || '{}'));
    } catch {
      // ignore invalid JSON while user is typing
    }
  }, [defaultConfig]);

  const parseSchema = () => {
    try { return JSON.parse(configSchema || '[]'); }
    catch { throw new Error('config_schema must be a valid JSON array'); }
  };

  const parseResultSchema = () => {
    try { return JSON.parse(resultSchema || '[]'); }
    catch { throw new Error('result_schema must be a valid JSON array'); }
  };

  const parseDefaultConfig = () => {
    try { return JSON.parse(defaultConfig || '{}'); }
    catch { throw new Error('default_config must be a valid JSON object'); }
  };

  const buildPayload = () => ({
    id: skillId || undefined,
    name: name || 'Untitled Skill',
    description,
    sourceHtml,
    configSchema: parseSchema(),
    resultSchema: parseResultSchema(),
    defaultConfig: parseDefaultConfig(),
  });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveSkill(buildPayload());
      setSkillId(result.skill.id);
      setStatus(getSkillStatus(result.skill));
      setPreviewConfig(result.skill.defaultConfig || {});
      setSuccess('Saved to your skill library');
      if (!routeId) navigate(`/skill-editor/${result.skill.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveSkill(buildPayload());
      setSkillId(result.skill.id);
      await submitSkillForReview(result.skill.id);
      setStatus('pending');
      setSuccess('Submitted for review — it will be public for everyone once approved');
      if (!routeId) navigate(`/skill-editor/${result.skill.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const applyAiSkill = (skill) => {
    if (skill.name) setName(skill.name);
    if (skill.description) setDescription(skill.description);
    if (skill.sourceHtml) setSourceHtml(skill.sourceHtml);
    if (skill.configSchema) setConfigSchema(JSON.stringify(skill.configSchema, null, 2));
    if (skill.resultSchema) setResultSchema(JSON.stringify(skill.resultSchema, null, 2));
    if (skill.defaultConfig) {
      setDefaultConfig(JSON.stringify(skill.defaultConfig, null, 2));
      setPreviewConfig(skill.defaultConfig);
    }
    setSuccess('AI draft applied — review fields and save when ready.');
  };

  const statusChip = {
    draft: { label: 'Draft — private to you', color: 'default' },
    pending: { label: 'In review', color: 'warning' },
    approved: { label: 'Public', color: 'success' },
  }[status];

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate('/skills')}><ArrowBack /></IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {skillId ? 'Edit Skill' : 'New Skill'}
          </Typography>
          {statusChip && <Chip size="small" label={statusChip.label} color={statusChip.color} sx={{ mr: 1 }} />}
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Build a custom question type with HTML/CSS/JS running in a sandboxed iframe.
          Call <code>SPSkill.setAnswer(value)</code> to submit answers and <code>SPSkill.ready()</code> when loaded.
          Save to your library and test it in your own survey before submitting for public review.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
        <SkillAiPanel
          apiKey={openaiApiKey}
          currentSkill={skillId ? {
            name,
            description,
            sourceHtml,
            configSchema: (() => { try { return JSON.parse(configSchema); } catch { return []; } })(),
            defaultConfig: (() => { try { return JSON.parse(defaultConfig); } catch { return {}; } })(),
            resultSchema: (() => { try { return JSON.parse(resultSchema); } catch { return []; } })(),
          } : null}
          onApply={applyAiSkill}
        />
        <Stack spacing={2}>
          <TextField label="Skill name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline rows={2} />
          <TextField
            label="Config Schema (JSON array) — editable fields in Survey Builder"
            value={configSchema}
            onChange={(e) => setConfigSchema(e.target.value)}
            fullWidth multiline rows={3}
            helperText='e.g. [{"key":"prompt","label":"Prompt text","type":"string"}] — types: string / number / boolean / json / select'
          />
          <TextField
            label="Default Config (JSON object) — default values for config fields"
            value={defaultConfig}
            onChange={(e) => setDefaultConfig(e.target.value)}
            fullWidth multiline rows={3}
            helperText='e.g. {"prompt":"Please respond","mediaCount":1,"mediaType":"image"} — mediaCount/mediaType control injected media'
          />
          <TextField
            label="Result Schema (JSON array) — how results appear in analysis"
            value={resultSchema}
            onChange={(e) => setResultSchema(e.target.value)}
            fullWidth multiline rows={3}
            helperText='e.g. [{"key":"score","label":"Score","type":"number"}] — types: number / boolean / choice / text / count / color / scaleGroup; auto-inferred if omitted'
          />
          <TextField
            label="HTML source"
            value={sourceHtml}
            onChange={(e) => setSourceHtml(e.target.value)}
            fullWidth multiline rows={14}
            sx={{ fontFamily: 'monospace' }}
          />
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Live preview</Typography>
            <SkillQuestionFrame
              skillHtml={sourceHtml}
              config={previewConfig}
              images={previewImages}
              readOnly
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Preview uses skill-preview library media when available, otherwise demo images.
            </Typography>
          </Paper>
          <Stack direction="row" spacing={2}>
            <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={saving || submitting}>
              {saving ? 'Saving…' : 'Save to my library'}
            </Button>
            {status !== 'approved' && (
              <Button
                variant="outlined"
                startIcon={<Publish />}
                onClick={handleSubmitForReview}
                disabled={saving || submitting || status === 'pending'}
              >
                {submitting ? 'Submitting…' : status === 'pending' ? 'Submitted for review' : 'Submit for public review'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
