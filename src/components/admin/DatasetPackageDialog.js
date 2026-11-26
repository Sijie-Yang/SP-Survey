import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { uiPair } from '../../lib/uiLanguages';
import {
  DATASET_LICENSES, formatAuthorLines, parseAuthorLines, readDatasetMeta,
} from '../../lib/datasetPackage';

/**
 * Form for a citable dataset package: who made it, how it may be reused and
 * what is removed before it leaves the platform. `onBuild(meta)` builds and
 * downloads the ZIP; the caller saves the form with the project.
 */
export default function DatasetPackageDialog({
  open, onClose, onBuild, project, language, nSubmissions = 0, siteConverted = false, freeTextNames = [], reuseQuestions = [],
}) {
  const L = (en, zh) => uiPair(language, en, zh);
  const [meta, setMeta] = useState(() => readDatasetMeta(project));
  const [authorText, setAuthorText] = useState('');
  const [keywordText, setKeywordText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!open) return;
    const next = readDatasetMeta(project);
    setMeta(next);
    setAuthorText(formatAuthorLines(next.authors));
    setKeywordText(next.keywords.join(', '));
    setError('');
    setDone('');
    setProgress('');
  }, [open, project]);

  const set = (patch) => setMeta((m) => ({ ...m, ...patch }));
  const setAnon = (patch) => setMeta((m) => ({ ...m, anonymize: { ...m.anonymize, ...patch } }));
  const authors = parseAuthorLines(authorText);
  const gate = reuseQuestions.find((q) => q.name === meta.onlyAgreedTo) || null;
  const nPacked = gate ? gate.yes : nSubmissions;
  const canBuild = !busy && meta.title.trim() && authors.length && nPacked > 0;

  const build = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const full = {
        ...meta,
        title: meta.title.trim(),
        authors,
        keywords: keywordText.split(/[,，;；]/).map((k) => k.trim()).filter(Boolean),
        doi: meta.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
      };
      const n = await onBuild(full, (step) => setProgress(step));
      setDone(L(`Downloaded the package (${n} files).`, `数据集包已下载（${n} 个文件）。`));
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{L('Citable dataset package', '可引用的数据集包')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {L(
            `Packs the ${nSubmissions} submissions in the current filter with a README, data dictionary, license, CITATION.cff and datapackage.json, ready to upload to Zenodo, OSF or a journal. Nothing is published by this step.`,
            `把当前筛选下的 ${nSubmissions} 份回答打包，附带说明、数据字典、许可证、CITATION.cff 和 datapackage.json，可以直接上传到 Zenodo、OSF 或期刊。这一步不会公开任何东西。`,
          )}
        </Typography>
        <Stack spacing={2}>
          <TextField label={L('Dataset title', '数据集标题')} value={meta.title} onChange={(e) => set({ title: e.target.value })} required fullWidth />
          <TextField
            label={L('Authors, one per line', '作者，每行一位')}
            value={authorText}
            onChange={(e) => setAuthorText(e.target.value)}
            required
            multiline
            minRows={2}
            fullWidth
            placeholder={L('Sijie Yang; 0000-0002-1825-0097; National University of Singapore', 'Sijie Yang; 0000-0002-1825-0097; National University of Singapore')}
            helperText={L('Name; ORCID (optional); affiliation (optional)', '姓名; ORCID（可选）; 单位（可选）')}
          />
          <TextField label={L('Description', '简介')} value={meta.description} onChange={(e) => set({ description: e.target.value })} multiline minRows={3} fullWidth
            helperText={L('What was asked, of whom, where and when.', '问了什么、问了谁、在哪里、什么时候。')} />
          <TextField label={L('Keywords (comma separated)', '关键词（逗号分隔）')} value={keywordText} onChange={(e) => setKeywordText(e.target.value)} fullWidth />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label={L('License', '许可证')} value={meta.license} onChange={(e) => set({ license: e.target.value })} sx={{ flex: 2 }}>
              {Object.entries(DATASET_LICENSES).map(([id, lic]) => <MenuItem key={id} value={id}>{id} · {lic.name}</MenuItem>)}
            </TextField>
            <TextField label={L('Version', '版本')} value={meta.version} onChange={(e) => set({ version: e.target.value })} sx={{ flex: 1 }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>{L(DATASET_LICENSES[meta.license]?.summary, DATASET_LICENSES[meta.license]?.summaryZh)}</Typography>
          <TextField label={L('DOI (if you already have one)', 'DOI（如果已经有）')} value={meta.doi} onChange={(e) => set({ doi: e.target.value })} fullWidth placeholder="10.5281/zenodo.1234567" />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{L('Before it leaves the platform', '导出前处理')}</Typography>
            <FormControlLabel control={<Checkbox checked={!!meta.anonymize.pseudonymizeIds} onChange={(e) => setAnon({ pseudonymizeIds: e.target.checked })} />}
              label={L('Replace participant IDs with P0001…; remove completion codes, browser and device details, URL parameters', '参与者编号换成 P0001…；去掉完成码、浏览器和设备信息、链接参数')} />
            <FormControlLabel control={<Checkbox checked={!!meta.anonymize.dateOnly} onChange={(e) => setAnon({ dateOnly: e.target.checked })} />}
              label={L('Keep only the date of each submission, not the time', '提交时间只保留日期')} />
            <FormControlLabel control={<Checkbox checked={!!meta.anonymize.dropFreeText} onChange={(e) => setAnon({ dropFreeText: e.target.checked })} />}
              label={freeTextNames.length
                ? L(`Remove typed free-text answers (${freeTextNames.join(', ')})`, `去掉文字填空题的回答（${freeTextNames.join('、')}）`)
                : L('Remove typed free-text answers (none in this survey)', '去掉文字填空题的回答（本问卷没有）')} />
            {reuseQuestions.length ? (
              <TextField select fullWidth size="small" sx={{ mt: 1.5 }}
                label={L('Which submissions', '包含哪些回答')}
                value={gate ? gate.name : ''}
                onChange={(e) => set({ onlyAgreedTo: e.target.value })}
                helperText={gate ? L(`${gate.yes} of ${nSubmissions} answered yes.`, `${nSubmissions} 份里有 ${gate.yes} 份回答「是」。`) : ''}>
                <MenuItem value="">{L(`All ${nSubmissions} submissions`, `全部 ${nSubmissions} 份回答`)}</MenuItem>
                {reuseQuestions.map((q) => (
                  <MenuItem key={q.name} value={q.name}>{L(`Only those answering yes to: ${q.title}`, `只要对这题回答「是」的：${q.title}`)}</MenuItem>
                ))}
              </TextField>
            ) : (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {L('To publish only the people who agreed to reuse, add an optional yes/no question to the survey, e.g. "May your anonymised answers be shared for research and used to train perception models?" It will appear here as a choice.',
                  '想只公开同意再利用的人？在问卷里加一道非必答的「是/否」题，例如「是否同意你的匿名回答公开用于研究和训练感知模型？」，这里就能按它筛选。')}
              </Typography>
            )}
            {siteConverted && <Alert severity="warning" sx={{ mt: 1 }}>
              {L('This survey is an uploaded page. What the page stored itself is kept as recorded; check responses_raw.json before publishing.', '这份问卷是上传的页面，页面自己保存的内容会原样保留。公开前请检查 responses_raw.json。')}
            </Alert>}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{L('Contents', '包含内容')}</Typography>
            <FormControlLabel control={<Checkbox checked={meta.includeSurvey !== false} onChange={(e) => set({ includeSurvey: e.target.checked })} />}
              label={L('The survey definition, so others can rerun the study', '问卷定义，别人可以导入后复现研究')} />
            <FormControlLabel control={<Checkbox checked={!!meta.includeImages} onChange={(e) => set({ includeImages: e.target.checked })} />}
              label={L('The stimulus image files', '刺激图片文件')} />
            {meta.includeImages
              ? <Alert severity="warning" sx={{ mt: 1 }}>{L('Only include images you may redistribute. Street View and most map imagery may not be republished; the manifest alone is enough to cite them.', '只放你有权再分发的图片。Google 街景和大多数地图影像不允许再发布，只给清单就够了。')}</Alert>
              : <Typography variant="caption" color="text.secondary" display="block">{L('Without images, stimuli/manifest.csv still lists every image shown, its source and how often it was shown.', '不放图片时，stimuli/manifest.csv 仍会列出每张图的文件名、来源和展示次数。')}</Typography>}
          </Box>
        </Stack>
        {progress && <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mt: 2 }}>{progress}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {done && <Alert severity="success" sx={{ mt: 2 }}>
          {done} {L('Next: upload the ZIP to zenodo.org (New upload → Dataset) to get a DOI, then paste the DOI above and download again so the README and CITATION.cff carry it.', '下一步：把 ZIP 上传到 zenodo.org（New upload → Dataset）拿到 DOI，再把 DOI 填回上面重新下载一次，README 和 CITATION.cff 就会带上它。')}
        </Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{L('Close', '关闭')}</Button>
        <Button variant="contained" onClick={build} disabled={!canBuild} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}>
          {L('Download package', '下载数据集包')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
