import ConfirmDialog from '../components/layout/ConfirmDialog';
import useRouteUnsavedChanges from '../hooks/useRouteUnsavedChanges';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Box, Typography, TextField, Button,
  Alert, Paper, Stack, Chip, Accordion, AccordionSummary, AccordionDetails, MenuItem,
} from '@mui/material';
import { Publish, Save, CheckCircle, ErrorOutline, ExpandMore } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import {
  saveSkill, submitSkillForReview, getSkillById, getSkillStatus,
} from '../lib/skillManager';
import SkillQuestionFrame from '../components/SkillQuestionWidget';
import { listPreviewMedia, pickPreviewMedia } from '../lib/previewMediaLibrary';
import SkillAiPanel from '../components/admin/SkillAiPanel';
import AdminShell from '../components/layout/AdminShell';
import { normalizeSkillSchemaArray } from '../lib/skillAnswerBridge';
import { useRegion } from '../contexts/RegionContext';
import { createSkillStarter, SKILL_STARTERS } from '../lib/skillStarters';
import { SkillResultPreview } from '../components/admin/SkillPreviewPanel';
import { checkAnswerAgainstResultSchema, NATIVE_SKILL_RESULT_TYPE_IDS } from '../lib/skillResultTypes';

const INITIAL = createSkillStarter();

export default function SkillEditorPage() {
  const navigate = useNavigate();
  const { language } = useRegion();
  const zh = language === 'zh';
  const [starterId, setStarterId] = useState('rating');
  const { id: routeId } = useParams();
  const [skillId, setSkillId] = useState(routeId || null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceHtml, setSourceHtml] = useState(INITIAL.sourceHtml);
  const [configSchema, setConfigSchema] = useState(JSON.stringify(INITIAL.configSchema));
  const [resultSchema, setResultSchema] = useState(JSON.stringify(INITIAL.resultSchema, null, 2));
  const [exampleAnswer, setExampleAnswer] = useState(JSON.stringify(INITIAL.exampleAnswer));
  const [defaultConfig, setDefaultConfig] = useState(JSON.stringify(INITIAL.defaultConfig));
  const [previewConfig, setPreviewConfig] = useState({});
  const [status, setStatus] = useState('draft');
  const [loading, setLoading] = useState(!!routeId);
  const [saving, setSaving] = useState(false);
  const [savedRoute, setSavedRoute] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewImages, setPreviewImages] = useState([]);
  const [previewAnswer, setPreviewAnswer] = useState(null);
  const snapshot = JSON.stringify({ name, description, sourceHtml, configSchema, resultSchema, exampleAnswer, defaultConfig });
  const initialSnapshot = useRef(snapshot);
  const [savedSnapshot, setSavedSnapshot] = useState(initialSnapshot.current);
  const dirty = !loading && snapshot !== savedSnapshot;
  const guard = useRouteUnsavedChanges(dirty);
  useEffect(() => {
    if (savedRoute && !dirty) { navigate(savedRoute, { replace: true }); setSavedRoute(null); }
  }, [savedRoute, dirty, navigate]);
  const [openaiApiKey] = useState(() => localStorage.getItem('openaiApiKey') || sessionStorage.getItem('openai_api_key') || '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pool = await listPreviewMedia();
      if (cancelled) return;
      const count = previewConfig.mediaCount ?? 1;
      const mediaType = previewConfig.mediaType || 'image';
      const picked = count === 0 ? [] : pickPreviewMedia(pool, mediaType, count);
      setPreviewImages(picked);
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
      setSavedSnapshot(JSON.stringify({
        name: skill.name, description: skill.description,
        sourceHtml: skill.sourceHtml || INITIAL.sourceHtml,
        configSchema: JSON.stringify(skill.configSchema || [], null, 2),
        resultSchema: JSON.stringify(skill.resultSchema || [], null, 2),
        exampleAnswer: JSON.stringify(skill.exampleAnswer || {}, null, 2),
        defaultConfig: JSON.stringify(skill.defaultConfig || {}, null, 2),
      }));
      setSkillId(skill.id);
      setName(skill.name);
      setDescription(skill.description);
      setSourceHtml(skill.sourceHtml || INITIAL.sourceHtml);
      setConfigSchema(JSON.stringify(skill.configSchema || [], null, 2));
      setResultSchema(JSON.stringify(skill.resultSchema || [], null, 2));
      setExampleAnswer(JSON.stringify(skill.exampleAnswer || {}, null, 2));
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
    try { return normalizeSkillSchemaArray(JSON.parse(configSchema || '[]')); }
    catch { throw new Error('config_schema must be a valid JSON array'); }
  };

  const parseResultSchema = () => {
    try {
      return normalizeSkillSchemaArray(JSON.parse(resultSchema || '[]'), { defaultType: 'text' });
    } catch { throw new Error('result_schema must be a valid JSON array'); }
  };

  const parseDefaultConfig = () => {
    try { return JSON.parse(defaultConfig || '{}'); }
    catch { throw new Error('default_config must be a valid JSON object'); }
  };

  const parseExampleAnswer = () => {
    try {
      const parsed = JSON.parse(exampleAnswer || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('example_answer must be a JSON object');
      }
      return parsed;
    } catch (err) {
      throw new Error(err.message === 'example_answer must be a JSON object'
        ? err.message
        : 'example_answer must be a valid JSON object');
    }
  };

  const missingSetAnswer = sourceHtml
    && !/SPSkill\s*\.\s*setAnswer\s*\(/.test(sourceHtml);
  const usesAltPostMessage = sourceHtml
    && /postMessage\s*\(/.test(sourceHtml)
    && /(skill-result|skillResult|SP_SURVEY_SKILL_RESULT)/.test(sourceHtml);

  const parsedResultSchemaForCheck = useMemo(() => {
    try {
      return normalizeSkillSchemaArray(JSON.parse(resultSchema || '[]'), { defaultType: 'text' });
    } catch {
      return [];
    }
  }, [resultSchema]);

  const answerCheck = useMemo(
    () => checkAnswerAgainstResultSchema(previewAnswer, parsedResultSchemaForCheck, previewConfig),
    [previewAnswer, parsedResultSchemaForCheck, previewConfig],
  );

  // Reset recorded answer when HTML / config structure changes substantially
  useEffect(() => {
    setPreviewAnswer(null);
  }, [sourceHtml, defaultConfig, resultSchema]);

  const buildPayload = () => ({
    id: skillId || undefined,
    name: name || 'Untitled Skill',
    description,
    sourceHtml,
    analysisHtml: '',
    configSchema: parseSchema(),
    resultSchema: parseResultSchema(),
    exampleAnswer: (previewAnswer && typeof previewAnswer === 'object' && !Array.isArray(previewAnswer))
      ? previewAnswer
      : parseExampleAnswer(),
    contractVersion: 1,
    defaultConfig: parseDefaultConfig(),
  });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveSkill(buildPayload());
      setSavedSnapshot(snapshot);
      setSkillId(result.skill.id);
      setStatus(getSkillStatus(result.skill));
      setPreviewConfig(result.skill.defaultConfig || {});
      const warn = (result.warnings || []).filter(Boolean);
      setSuccess(warn.length
        ? `Saved to your skill library. Note: ${warn.join(' ')}`
        : 'Saved to your skill library');
      if (!routeId) setSavedRoute(`/skill-editor/${result.skill.id}`);
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
      setSavedSnapshot(snapshot);
      setSkillId(result.skill.id);
      await submitSkillForReview(result.skill.id);
      setStatus('pending');
      setSuccess('Submitted for review — it will be public for everyone once approved');
      if (!routeId) setSavedRoute(`/skill-editor/${result.skill.id}`);
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
    if (skill.configSchema) {
      setConfigSchema(JSON.stringify(normalizeSkillSchemaArray(skill.configSchema), null, 2));
    }
    if (skill.resultSchema) {
      setResultSchema(JSON.stringify(
        normalizeSkillSchemaArray(skill.resultSchema, { defaultType: 'text' }),
        null,
        2,
      ));
    }
    if (skill.exampleAnswer && typeof skill.exampleAnswer === 'object') {
      setExampleAnswer(JSON.stringify(skill.exampleAnswer, null, 2));
    }
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
    <AdminShell
      title={zh ? (skillId ? '编辑自定义交互' : '新建自定义交互') : (skillId ? 'Edit custom interaction' : 'New custom interaction')}
      backTo="/skills"
      onBack={() => navigate('/skills')}
      maxWidth="lg"
      actions={statusChip ? (
        <Chip size="small" label={statusChip.label} color={statusChip.color} />
      ) : null}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {zh ? '先选标准输出，再定制交互。内置题型可在问卷编辑器直接使用；这里用于特殊交互。每个交互完成一项任务，平台统一分析与导出。' : 'Choose a standard output, then customize the interaction. Built-in tasks are available directly in Survey Builder. Each custom interaction handles one task; the platform provides analysis and export.'}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
        {missingSetAnswer && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This HTML never calls <code>SPSkill.setAnswer(...)</code>. Answers will not be saved in surveys.
            Replace custom <code>parent.postMessage</code> answer protocols with <code>SPSkill.setAnswer(object)</code>.
          </Alert>
        )}
        {!missingSetAnswer && usesAltPostMessage && (
          <Alert severity="info" sx={{ mb: 2 }}>
            HTML uses alternate <code>postMessage</code> answer types. The platform accepts some of these for
            compatibility, but prefer <code>SPSkill.setAnswer</code> only.
          </Alert>
        )}
        <Alert severity="info" sx={{ mb: 2 }}>{zh ? '自定义交互目前每题保存一次结果。需要多轮记录时请拆题，不要在 HTML 内覆盖前几轮答案。' : 'Custom interactions currently save one result per question. Use separate questions when each round needs its own record.'}</Alert>
        {!skillId && <TextField select fullWidth sx={{ mb: 2 }} label={zh ? '起步模板（切换会重置尚未保存的代码）' : 'Starter (switching resets unsaved code)'} value={starterId}
          onChange={(e) => {
            const selected = e.target.value;
            guard.request(() => {
            const next = createSkillStarter(selected); setStarterId(selected);
            setSourceHtml(next.sourceHtml); setConfigSchema(JSON.stringify(next.configSchema));
            setDefaultConfig(JSON.stringify(next.defaultConfig)); setResultSchema(JSON.stringify(next.resultSchema, null, 2));
            setExampleAnswer(JSON.stringify(next.exampleAnswer)); setPreviewAnswer(null);
            });
          }}>
          {SKILL_STARTERS.map((s) => <MenuItem key={s.id} value={s.id}>{zh ? s.zh : s.en}</MenuItem>)}
        </TextField>}
        <Accordion sx={{ mb: 2 }}><AccordionSummary expandIcon={<ExpandMore />}>{zh ? 'AI 辅助编辑（可选）' : 'AI-assisted editing (optional)'}</AccordionSummary><AccordionDetails>
        <SkillAiPanel
          apiKey={openaiApiKey}
          currentSkill={skillId ? {
            name,
            description,
            sourceHtml,
            configSchema: (() => { try { return JSON.parse(configSchema); } catch { return []; } })(),
            defaultConfig: (() => { try { return JSON.parse(defaultConfig); } catch { return {}; } })(),
            resultSchema: (() => { try { return JSON.parse(resultSchema); } catch { return []; } })(),
            exampleAnswer: (() => { try { return JSON.parse(exampleAnswer); } catch { return {}; } })(),
          } : null}
          onApply={applyAiSkill}
        />
        </AccordionDetails></Accordion>
        <Stack spacing={2}>
          <TextField label="Skill name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline rows={2} />
          {parsedResultSchemaForCheck.length === 1 && <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '标准输出设置' : 'Standard output settings'}</Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>{parsedResultSchemaForCheck[0].type} → {zh ? '平台统一分析与导出' : 'Native analysis and export'}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {['number', 'rating', 'count', 'pairwisePreference', 'timeSeries'].includes(parsedResultSchemaForCheck[0].type) && ['min', 'max'].map((key) => <TextField
                key={key} label={key === 'min' ? (zh ? '最小值' : 'Minimum') : (zh ? '最大值' : 'Maximum')} type="number"
                value={previewConfig[key] ?? parsedResultSchemaForCheck[0][key] ?? ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : Number(e.target.value);
                  setResultSchema(JSON.stringify([{ ...parsedResultSchemaForCheck[0], [key]: value }], null, 2));
                  setDefaultConfig(JSON.stringify({ ...previewConfig, [key]: value }, null, 2));
                }} />)}
            </Stack>
            <Typography variant="caption" color="text.secondary">{zh ? '修改设置后请重新试答；代码中的量程和选项也应相符，可在高级编辑或交给 Codex 修改。' : 'After changing settings, test again. Match the interaction’s controls to these settings in the advanced editor or with Codex.'}</Typography>
          </Paper>}
          <Accordion><AccordionSummary expandIcon={<ExpandMore />}>{zh ? '高级：代码与输出设置' : 'Advanced: code and output settings'}</AccordionSummary><AccordionDetails><Stack spacing={2}>
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
            helperText={`e.g. [{"key":"marks","label":"Marks","type":"points"}] — native types only: ${NATIVE_SKILL_RESULT_TYPE_IDS.join(' / ')}. Include settings such as options/rows/columns/dimensions/min/max/budget.`}
          />
          <TextField
            label="Example Answer (JSON object) — validates the frozen result contract"
            value={exampleAnswer}
            onChange={(e) => setExampleAnswer(e.target.value)}
            fullWidth multiline rows={4}
            helperText="Required for new revisions. A valid object recorded in Live preview is used automatically when saving."
          />
          <TextField
            label="HTML source"
            value={sourceHtml}
            onChange={(e) => setSourceHtml(e.target.value)}
            fullWidth multiline rows={14}
            sx={{ fontFamily: 'monospace' }}
          />
          </Stack></AccordionDetails></Accordion>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Live preview (interactive)</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Try answering below. Confirm SPSkill.setAnswer fires before saving to a survey.
            </Typography>
            <SkillQuestionFrame
              skillHtml={sourceHtml}
              config={previewConfig}
              images={previewImages}
              value={previewAnswer}
              onChange={setPreviewAnswer}
              resultSchema={parsedResultSchemaForCheck}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {previewConfig.mediaCount === 0 ? (zh ? '此交互无需媒体。' : 'This interaction does not require media.') : 'Preview uses the platform preview media library.'}
              {previewConfig.mediaCount !== 0 && previewImages.length === 0
                ? ' No matching media found — add files under Admin → 预览媒体库.'
                : ''}
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: answerCheck.recorded ? 'success.50' : 'warning.50' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Answer test</Typography>
            {!answerCheck.recorded ? (
              <Alert severity="warning" sx={{ mb: 1 }}>
                No answer recorded yet — interact with the preview (click Done / submit) to confirm the skill is answerable.
              </Alert>
            ) : (
              <Alert severity="success" icon={<CheckCircle />} sx={{ mb: 1 }}>
                Answer recorded via SPSkill.setAnswer (or compatible bridge).
              </Alert>
            )}
            {answerCheck.fields.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                {answerCheck.fields.map((f) => (
                  <Chip
                    key={f.key}
                    size="small"
                    icon={f.ok ? <CheckCircle /> : <ErrorOutline />}
                    color={f.ok ? 'success' : 'default'}
                    variant={f.ok ? 'filled' : 'outlined'}
                    label={`${f.label} (${f.type}): ${f.detail}`}
                  />
                ))}
              </Stack>
            )}
            {previewAnswer != null && (
              <Box
                component="pre"
                sx={{
                  m: 0, p: 1.5, borderRadius: 1, bgcolor: 'grey.100',
                  fontSize: 12, overflow: 'auto', maxHeight: 220,
                }}
              >
                {JSON.stringify(previewAnswer, null, 2)}
              </Box>
            )}
          </Paper>
          <SkillResultPreview skill={{ id: skillId, name, resultSchema: parsedResultSchemaForCheck, defaultConfig: previewConfig }} answer={previewAnswer} images={previewImages} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
      <ConfirmDialog open={guard.open} onCancel={guard.cancel} onConfirm={guard.discard}
        title={zh ? '放弃未保存的修改？' : 'Discard unsaved changes?'}
        message={zh ? '此操作会离开编辑器或替换当前模板。继续编辑可保留未保存的内容。' : 'This action leaves the editor or replaces the starter. Keep editing to retain unsaved content.'}
        confirmLabel={zh ? '放弃修改' : 'Discard changes'} cancelLabel={zh ? '继续编辑' : 'Keep editing'} />
    </AdminShell>
  );
}
