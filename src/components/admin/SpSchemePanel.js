import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { AutoAwesome, CheckCircle, ContentCopy, Link as LinkIcon, Download, FactCheck, FolderZip, UploadFile, Web } from '@mui/icons-material';
import { strToU8 } from 'fflate';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import {
  SP_SCHEME_VERSION,
  buildExampleZip,
  buildSpSchemeText,
  readSpSchemeUpload,
} from '../../lib/spScheme';
import { SITE_MEDIA_ROOT, extractEmbeddedScheme, findImageSlots } from '../../lib/spSite';
import { listAllKnownFolders } from '../../lib/mediaUtils';
import { fetchSurveyPage } from '../../lib/agentApi';
import {
  bundleSpSchemeFiles,
  finalizeSpSchemeImport,
  mediaPlanFolders,
  prepareSpSchemeUpload,
  revalidateSpSchemeUpload,
  spSchemeMediaPlan,
  spSchemeProblems,
  spSchemeProblemsText,
} from '../../lib/spSchemeImport';
import { uploadPlannedMedia } from '../../lib/spSchemeMediaImport';
import { uploadImageToR2 } from '../../lib/r2';
import { useOptionalAuth } from '../../contexts/AuthContext';

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBytes(filename, bytes, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function IssueList({ items, max = 8 }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {items.slice(0, max).map((item, i) => (
        <Typography component="li" variant="body2" key={`${item.path}-${i}`} sx={{ overflowWrap: 'anywhere' }}>
          {item.message}
          {item.path ? <Typography component="span" variant="caption" color="text.secondary"> · {item.path}</Typography> : null}
        </Typography>
      ))}
      {items.length > max ? <Typography component="li" variant="caption">+ {items.length - max}</Typography> : null}
    </Box>
  );
}

function formatKb(bytes) {
  return `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
}

/**
 * SP-Scheme: copy the platform contract to any external LLM, then upload the
 * page it builds. Nothing changes until the researcher confirms import.
 */
export default function SpSchemePanel({ config, onChange, currentProject = null, onProjectUpdate = null }) {
  const { language } = useRegion();
  const user = useOptionalAuth()?.user || null;
  const [mediaProgress, setMediaProgress] = useState(null);
  const L = (en, zh) => uiPair(language, en, zh);
  const schemeText = useMemo(() => buildSpSchemeText(), []);
  const fileRef = useRef(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [report, setReport] = useState(null);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [upload, setUpload] = useState(null);
  // Domains the page may reach at run time, ticked by the researcher.
  const [hosts, setHosts] = useState([]);
  const [allowed, setAllowed] = useState([]);

  const copyScheme = async () => {
    try {
      await navigator.clipboard.writeText(schemeText);
      setNotice({ severity: 'success', text: L('SP-Scheme copied. Paste it into any LLM together with your study idea.', 'SP-Scheme 已复制。把它和你的研究想法一起发给任意大模型。') });
    } catch {
      downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown');
      setNotice({ severity: 'info', text: L('Clipboard unavailable; downloaded the file instead.', '无法写入剪贴板，已改为下载文件。') });
    }
  };

  // What an upload becomes (an SP-Scheme page as uploaded, or any other page
  // as it is) is decided in spSchemeImport.js, shared with Studio and the MCP.
  const settle = (read, name, { sourceHost = null } = {}) => {
    const prepared = prepareSpSchemeUpload(read, { name, sourceHost });
    setHosts(prepared.hosts);
    setAllowed(prepared.allowed);
    setUpload(prepared.upload);
    setReport(prepared.report);
  };

  const check = (bytes, name = '') => {
    setReport(null);
    setParseError('');
    setUpload(null);
    try {
      settle(readSpSchemeUpload(bytes), name);
    } catch (err) {
      setParseError(err.message);
    }
  };

  const toggleHost = (host) => {
    const next = allowed.includes(host) ? allowed.filter((h) => h !== host) : [...allowed, host];
    setAllowed(next);
    if (upload) setReport(revalidateSpSchemeUpload(upload, next));
  };

  // Why the page uses a domain: its own site for a link import, else what it loads from there.
  const hostWhy = (h) => (h.source ? L('the page\'s own site (images, data)', '页面原站点（图片、数据）') : (h.kinds || []).join(', '));

  const [pageUrl, setPageUrl] = useState('');
  const [fetchingPage, setFetchingPage] = useState(false);
  const fetchPage = async () => {
    setParseError('');
    setReport(null);
    setFetchingPage(true);
    try {
      const res = await fetchSurveyPage(pageUrl.trim());
      if (!res?.success) throw new Error(res?.error || L('The page could not be fetched.', '无法抓取这个页面。'));
      const read = { siteHtml: res.html, siteFile: 'index.html', pkg: extractEmbeddedScheme(res.html), dataFiles: res.dataFiles || [], mediaFiles: [], files: [], fromZip: false, sourceUrl: res.url };
      settle(read, res.url, { sourceHost: res.host });
    } catch (err) {
      setParseError(err?.message || String(err));
    } finally {
      setFetchingPage(false);
    }
  };

  // One file is read as is; several (index.html plus its config or CSV files) are
  // read as if they came in one zip.
  const readFiles = async (list) => {
    const files = Array.from(list || []).filter(Boolean);
    if (!files.length) return;
    const contents = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    })));
    setPasted('');
    setOpen(true);
    const bundled = bundleSpSchemeFiles(files.map((file, i) => ({ name: file.name, bytes: contents[i] })));
    check(bundled.bytes, bundled.name);
  };

  const onFile = (event) => {
    const list = event.target.files;
    readFiles(list).catch((err) => setParseError(err?.message || String(err)));
    event.target.value = '';
  };

  const [dragging, setDragging] = useState(false);
  const dropProps = {
    onDragOver: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    },
    onDrop: (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      // The dialog renders in a portal, but React still bubbles its events to the panel.
      e.stopPropagation();
      setDragging(false);
      if (importing) return;
      readFiles(e.dataTransfer.files).catch((err) => setParseError(err?.message || String(err)));
    },
  };

  const [copied, setCopied] = useState(false);
  const copyForFix = async () => {
    const errorsText = spSchemeProblemsText(spSchemeProblems(report, upload));
    try {
      await navigator.clipboard.writeText(schemeText + errorsText);
    } catch {
      downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText + errorsText, 'text/markdown');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const closeDialog = () => {
    if (importing) return;
    setOpen(false);
  };

  const mediaPlan = spSchemeMediaPlan(upload);
  const canUploadMedia = Boolean(currentProject?.id && onProjectUpdate && user?.id);

  const doImport = async () => {
    setImporting(true);
    try {
      if (mediaPlan) {
        // Stimuli first: the imported questions draw from these folders.
        setMediaProgress({ done: 0, total: mediaPlan.files.length });
        const result = await uploadPlannedMedia({
          plan: mediaPlan,
          project: currentProject,
          userId: user?.id,
          upload: uploadImageToR2,
          onProjectUpdate,
          onProgress: setMediaProgress,
        });
        if (result.saveError || result.failures.length) {
          throw new Error(result.saveError
            ? L(`Media uploaded, but saving the media list failed: ${result.saveError}`, `媒体已上传，但保存媒体清单失败：${result.saveError}`)
            : L(`${result.failures.length} file(s) failed to upload (e.g. ${result.failures[0].name}: ${result.failures[0].error}). Nothing was imported; try again.`, `${result.failures.length} 个文件上传失败（如 ${result.failures[0].name}：${result.failures[0].error}）。问卷尚未导入，请重试。`));
        }
      }
      const next = finalizeSpSchemeImport(report, upload, config);
      onChange(next);
      setOpen(false);
      setReport(null);
      setPasted('');
      setUpload(null);
      setHosts([]);
      setAllowed([]);
      setNotice({
        severity: 'success',
        text: next.spSite?.convertedFrom
          ? L('Imported as it is. The platform records what participants do on this page and analyses nothing. Try it in Preview, then Save and publish.', '已原样导入。平台只记录参与者在这个页面上的作答，不做分析。请在预览里试一遍，再保存并发布。')
          : (next.spSite
            ? L('Imported. Preview and the survey link now use this page. Check it in Preview, then Save.', '已导入。预览和问卷链接现在都使用这个页面。请在预览里确认后点保存。')
            : L('Imported into the Builder. Review it, preview, then Save.', '已导入 Builder。检查并预览后再点保存。')),
      });
    } catch (err) {
      setParseError(err.message || String(err));
    } finally {
      setImporting(false);
      setMediaProgress(null);
    }
  };

  const hasQuestions = (config?.pages || []).some((p) => (p.elements || []).length);
  const activeSite = config?.spSite?.html ? config.spSite : null;
  const removeSite = () => {
    const { spSite: _site, ...rest } = config;
    onChange(rest);
    setNotice({ severity: 'info', text: L('The model-built page was removed; the survey uses the standard platform style again. Save to apply.', '已移除大模型页面，问卷恢复平台标准样式。点保存后生效。') });
  };
  const siteSlots = useMemo(() => (activeSite ? findImageSlots(activeSite.html) : []), [activeSite]);
  const siteReadsMedia = Boolean(activeSite && /SPSite\s*\.\s*getMedia\s*\(/.test(activeSite.html));
  const siteFolders = useMemo(() => activeSite?.mediaFolders || [], [activeSite]);
  const folderOptions = useMemo(() => [SITE_MEDIA_ROOT, ...[...new Set([
    ...listAllKnownFolders(currentProject?.preloadedImages || [], {}, null, currentProject?.imageDatasetConfig?.mediaFolders || []),
    ...siteFolders,
  ])].filter((f) => f && f !== SITE_MEDIA_ROOT).sort()], [currentProject, siteFolders]);
  const folderLabel = (f) => (f === SITE_MEDIA_ROOT ? L('Root (files not in a folder)', '根目录（不在文件夹里的文件）') : f);
  const setSiteFolders = (folders) => onChange({ ...config, spSite: { ...config.spSite, mediaFolders: folders } });
  const summary = report?.summary;

  return (
    <Paper
      variant="outlined"
      data-testid="sp-scheme-panel"
      {...dropProps}
      sx={{
        mb: 2,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderWidth: 2,
        borderColor: 'primary.main',
        borderStyle: dragging ? 'dashed' : 'solid',
        outline: dragging ? '3px solid' : 'none',
        outlineColor: 'primary.light',
        background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}14, transparent 60%)`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
        <AutoAwesome color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>SP-Scheme</Typography>
        <Chip size="small" label={`v${SP_SCHEME_VERSION}`} variant="outlined" color="primary" />
        <Typography variant="body2" color="text.secondary" sx={{ flexBasis: { xs: '100%', md: 'auto' } }}>
          {L('Design any survey interface with an external LLM, within the platform contract.', '用外部大模型设计任意问卷界面，同时保持平台的数据规范。')}
        </Typography>
      </Box>

      <Box component="ol" sx={{ m: '8px 0 12px', pl: 2.5, color: 'text.secondary', '& li': { mb: 0.25 } }}>
        <Typography component="li" variant="body2">
          {L('Copy SP-Scheme into any LLM and describe your study.', '复制 SP-Scheme 发给任意大模型，并描述你的研究。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Let it build the survey as a web page and refine it until you are happy.', '让它把问卷做成网页，试到满意为止。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Upload the zip it hands over (page plus images) to go live; the platform handles images and answers. Any other page is imported as it is and only recorded.', '上传它交付的 zip（页面加图片）即可上线，抽图和记录答案由平台负责。其它页面会原样导入，平台只记录。')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<ContentCopy />} onClick={copyScheme}>
          {L('Copy SP-Scheme', '复制 SP-Scheme')}
        </Button>
        <Button variant="outlined" startIcon={<Download />} onClick={() => downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown')}>
          {L('Download .md', '下载 .md')}
        </Button>
        <input ref={fileRef} type="file" accept=".html,.htm,.zip,.json,.txt,.md,.csv,.tsv,text/html,application/zip,application/json" multiple hidden onChange={onFile} data-testid="sp-scheme-file" />
        <Button variant="contained" color="secondary" startIcon={<UploadFile />} onClick={() => fileRef.current?.click()}>
          {L('Upload or drop index.html / zip', '上传或拖入 index.html / zip')}
        </Button>
        <Button variant="text" startIcon={<FolderZip />} onClick={() => downloadBytes('sp-scheme-example.zip', buildExampleZip(), 'application/zip')}>
          {L('Example', '示例')}
        </Button>
        <Button variant="text" startIcon={<FactCheck />} onClick={() => { setUpload(null); setReport(null); setParseError(''); setHosts([]); setAllowed([]); setOpen(true); }}>
          {L('Paste code or link', '粘贴代码或链接')}
        </Button>
      </Box>

      {activeSite ? (
        <Alert
          severity="success"
          icon={<Web />}
          sx={{ mt: 1.5 }}
          data-testid="sp-site-active"
          action={<Button color="inherit" size="small" onClick={removeSite}>{L('Remove', '移除')}</Button>}
        >
          {L(`This survey runs on the page built with SP-Scheme (${formatKb(activeSite.html.length)}). Preview and the survey link show it; editing questions here changes what it records.`,
            `这份问卷使用 SP-Scheme 导入的大模型页面（${formatKb(activeSite.html.length)}）。预览和问卷链接都显示这个页面；在这里修改题目会改变它记录的内容。`)}
        </Alert>
      ) : null}

      {activeSite ? (
        <Box sx={{ mt: 1.5 }} data-testid="sp-site-media">
          <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            options={folderOptions}
            value={siteFolders}
            onChange={(_, next) => setSiteFolders(next)}
            getOptionLabel={folderLabel}
            noOptionsText={L('No media folders yet: upload media to the media library first.', '媒体库里还没有文件夹，请先上传媒体。')}
            renderOption={(props, option, { selected }) => (
              <li {...props} key={option}><Checkbox checked={selected} size="small" sx={{ mr: 1 }} />{folderLabel(option)}</li>
            )}
            renderInput={(params) => (
              <TextField {...params} label={L('Media library folders for this page', '这个页面使用的媒体库文件夹')} placeholder={siteFolders.length ? '' : L('None linked', '未链接')} />
            )}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} data-testid="sp-site-media-help">
            {L('The media library counts as the page\'s own folder: an image the page names by relative path (images/a.jpg) is that library file. ', '媒体库视为页面所在的文件夹：页面用相对路径写的图（如 images/a.jpg）就是媒体库里同路径的文件。')}
            {siteReadsMedia && L('The page reads these folders itself (SPSite.getMedia).', '页面会自己读取这些文件夹里的媒体（SPSite.getMedia）。')}
            {!siteReadsMedia && siteSlots.length > 0 && L(
              `The page keeps its own image list (${siteSlots.map((x) => x.name).join(', ')}). An empty list is filled with the images of the linked folders (the library root when none is linked), in a random order for each participant, and the images used are recorded with each response; the page never shows pictures it draws itself.`,
              `页面代码里有自己的图片列表（${siteSlots.map((x) => x.name).join('、')}）。空列表会填入链接文件夹里的图片（没链接时用媒体库根目录），每位参与者顺序随机，并在每份回答里记录用了哪些图；不会显示页面自己画的图。`,
            )}
            {!siteReadsMedia && !siteSlots.length && L(
              'This page does not load images from outside its own code, so linking folders does not change what it shows: what it draws itself is what participants see. Ask the model that built it to use image files by relative path or an empty image list.',
              '这个页面不从外部读取图片，链接文件夹不会改变它显示的内容，参与者看到的就是它自己画的图。可以让生成页面的大模型改成用相对路径引用图片文件，或留一个空的图片列表。',
            )}
          </Typography>
        </Box>
      ) : null}

      {notice ? <Alert severity={notice.severity} sx={{ mt: 1.5 }} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}

      <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{L('Check an uploaded page', '检查上传的页面')}</DialogTitle>
        <DialogContent dividers {...dropProps} sx={dragging ? { outline: '3px dashed', outlineColor: 'primary.main', outlineOffset: -6 } : undefined}>
          {upload?.name ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {upload.name}
              {upload.fromZip ? ` · ${L(`${upload.files.length} file(s) read.`, `已读取 ${upload.files.length} 个文件。`)}` : ''}
            </Alert>
          ) : null}
          {!upload?.name ? (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && pageUrl.trim() && !fetchingPage) fetchPage(); }}
                placeholder={L('Survey web address, e.g. https://name.github.io/my-survey/', '问卷网址，例如 https://name.github.io/my-survey/')}
                inputProps={{ 'aria-label': 'Survey web address' }}
              />
              <Button variant="outlined" startIcon={<LinkIcon />} onClick={fetchPage} disabled={!pageUrl.trim() || fetchingPage} sx={{ whiteSpace: 'nowrap' }} data-testid="sp-scheme-fetch-url">
                {fetchingPage ? L('Fetching…', '抓取中…') : L('Import link', '导入链接')}
              </Button>
            </Box>
          ) : null}
          {!upload?.name ? (
          <TextField
            fullWidth
            multiline
            minRows={6}
            maxRows={14}
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); setReport(null); setParseError(''); }}
            placeholder={L('Paste a whole index.html (or a sp-scheme.json).', '把完整的 index.html 代码粘贴到这里（也可以是 sp-scheme.json）。')}
            inputProps={{ 'aria-label': 'SP-Scheme package', style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          ) : null}
          {!upload?.name ? (
          <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<FactCheck />} onClick={() => check(strToU8(pasted))} disabled={!pasted.trim()}>
              {L('Check format', '检查格式')}
            </Button>
          </Box>
          ) : null}

          {parseError ? <Alert severity="error" sx={{ mt: 2 }}>{parseError}</Alert> : null}

          {report ? (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Alert
                severity={upload?.asIs ? (report.ok ? 'warning' : 'error') : (report.ok ? 'success' : 'error')}
                data-testid="sp-scheme-verdict"
                action={report.ok && !upload?.asIs ? null : (
                  <Button color="inherit" size="small" startIcon={copied ? <CheckCircle /> : <ContentCopy />} onClick={copyForFix} sx={{ whiteSpace: 'nowrap' }}>
                    {copied ? L('Copied', '已复制') : L('Copy SP-Scheme', '复制 SP-Scheme')}
                  </Button>
                )}
              >
                <Typography variant="subtitle2">
                  {upload?.asIs
                    ? L('This page does not match SP-Scheme, so it is imported as it is: participants see this page unchanged; the platform records what it saves and sends, analyses nothing, and exports the records.',
                      '这个页面不符合 SP-Scheme，将原样导入：参与者看到的就是这个页面；平台记录它保存和发出的数据，不做分析，可以导出记录。')
                    : (report.ok
                      ? L('Format aligned with the platform. Ready to import.', '格式与平台对齐，可以导入。')
                      : L(`${report.errors.length} problem(s) to fix: copy SP-Scheme (with the problems) to your model to fix it.`, `有 ${report.errors.length} 个问题需要修正：复制 SP-Scheme（附带问题列表）让大模型修正。`))}
                </Typography>
                {upload?.asIs ? (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {L('It submits when the page calls SPSite.complete() or saves {"done": true}; otherwise participants click “Finish and submit” under the page. To get the platform\'s analysis, have the model that built it follow SP-Scheme (copy it on the right).',
                      '页面调用 SPSite.complete() 或保存 {"done": true} 时自动提交；否则参与者点页面下方的「完成并提交」。想让平台做分析，请让生成页面的模型按 SP-Scheme 重做（右侧复制）。')}
                  </Typography>
                ) : null}
                {upload?.asIs?.declared && upload.asIs.errors.length ? (
                  <Box sx={{ mt: 0.5 }} data-testid="sp-scheme-asis-declared">
                    <Typography variant="body2">
                      {L('The page declares SP-Scheme questions with problems; an as-is import ignores that declaration. To keep it, fix these and upload again:', '页面里声明的 SP-Scheme 题目有问题，原样导入会忽略这份声明。要保留它，请修正后重新上传：')}
                    </Typography>
                    <IssueList items={upload.asIs.errors} />
                  </Box>
                ) : null}
                {summary && !upload?.asIs ? (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {summary.title ? `「${summary.title}」 · ` : ''}
                    {L(`${summary.pageCount} pages · ${summary.questionCount} questions`, `${summary.pageCount} 页 · ${summary.questionCount} 题`)}
                  </Typography>
                ) : null}
              </Alert>
              {summary?.hasSite && report.ok && !upload?.asIs ? (
                <Alert severity={summary.match === 'full' ? 'success' : 'warning'} data-testid="sp-scheme-match">
                  <Typography variant="subtitle2">
                    {summary.match === 'full' && L(`All ${summary.nativeCount} questions use platform types: results can be analysed on the Results page.`, `全部 ${summary.nativeCount} 道题都是平台题型：结果可以在结果页分析。`)}
                    {summary.match === 'partial' && L(`${summary.nativeCount} question(s) can be analysed; ${summary.customCount} are recorded as the page sends them (custom) and you analyse those yourself from the export.`, `${summary.nativeCount} 道题可以分析；另外 ${summary.customCount} 道题按页面自己的格式原样记录（custom），平台不分析，需要你导出后自行处理。`)}
                    {summary.match === 'custom' && L(`All ${summary.customCount} questions are recorded as the page sends them (custom): the platform stores and exports them but does not analyse them.`, `全部 ${summary.customCount} 道题按页面自己的格式原样记录（custom）：平台只保存和导出，不做分析，需要你自行处理。`)}
                    {summary.match === 'none' && L('No questions are declared: the platform records every request the page sends, as it is, and exports it. Nothing is analysed; you process the export yourself.', '没有声明任何题目：平台会原样记录页面发出的每个请求并导出，不做任何分析，需要你自行处理导出的数据。')}
                  </Typography>
                </Alert>
              ) : null}
              {summary?.hasSite ? (
                <Alert severity="info" icon={<Web />} data-testid="sp-scheme-site">
                  {L(`Includes the page (${upload?.siteFile || 'index.html'}, ${formatKb(summary.siteBytes)}). After import, Preview and the survey link show this page.`,
                    `包含页面（${upload?.siteFile || 'index.html'}，${formatKb(summary.siteBytes)}）。导入后，预览和问卷链接都直接显示这个页面。`)}
                </Alert>
              ) : null}
              {mediaPlan ? (
                <Alert severity={canUploadMedia ? 'info' : 'warning'} data-testid="sp-scheme-media-plan">
                  {canUploadMedia
                    ? L(`On import, the ${mediaPlan.files.length} stimulus files from the zip are uploaded to this project's media library:`, `导入时会把 zip 里的 ${mediaPlan.files.length} 个刺激文件上传到本项目的媒体库：`)
                    : L('Open this survey inside a project to upload the zip\'s stimulus files on import.', '请在项目里打开这份问卷，导入时才能上传 zip 里的刺激文件。')}
                  <Box component="ul" sx={{ m: '4px 0 0', pl: 2.5 }}>
                    {mediaPlanFolders(mediaPlan).map((f) => (
                      <Typography component="li" variant="body2" key={f.full}>{f.full} · {f.count}</Typography>
                    ))}
                  </Box>
                  {mediaProgress ? (
                    <Box sx={{ mt: 1 }}>
                      <LinearProgress variant="determinate" value={(mediaProgress.done / Math.max(1, mediaProgress.total)) * 100} />
                      <Typography variant="caption">{L(`Uploading ${mediaProgress.done} / ${mediaProgress.total}`, `正在上传 ${mediaProgress.done} / ${mediaProgress.total}`)}</Typography>
                    </Box>
                  ) : null}
                </Alert>
              ) : null}
              {hosts.length ? (
                <Box data-testid="sp-scheme-hosts" sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="subtitle2">{L('Network access', '联网放行')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {L('The page uses these domains. Tick only the ones it must load from; results sent anywhere else stay on the platform. Your choice is saved with the survey.', '页面用到了这些域名。只勾选它运行时必须加载内容的域名；发往其他地方的结果会留在平台内。勾选结果会随问卷保存。')}
                  </Typography>
                  {hosts.map((h) => (
                    <FormControlLabel
                      key={h.host}
                      sx={{ display: 'flex' }}
                      control={<Checkbox size="small" checked={allowed.includes(h.host)} onChange={() => toggleHost(h.host)} />}
                      label={<Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{h.host}{hostWhy(h) ? <Typography component="span" variant="caption" color="text.secondary"> · {hostWhy(h)}</Typography> : null}</Typography>}
                    />
                  ))}
                </Box>
              ) : null}
              {report.errors.length && (summary || upload?.asIs) ? <Box><Typography variant="subtitle2" color="error">{L('Errors', '错误')}</Typography><IssueList items={report.errors} max={20} /></Box> : null}
              {report.warnings.length ? <Box><Typography variant="subtitle2" color="warning.main">{L('Warnings', '提醒')}</Typography><IssueList items={report.warnings} /></Box> : null}
              {summary && !upload?.asIs ? (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {Object.entries(summary.types).map(([type, n]) => <Chip key={type} size="small" label={`${type} × ${n}`} />)}
                </Box>
              ) : null}
              {report.ok && hasQuestions ? (
                <Alert severity="warning">
                  {L('Importing replaces the current pages, questions and page design. Theme and logo are kept. Collected responses are not changed; publish only after reviewing.', '导入会替换当前的页面、题目和页面设计，主题和 Logo 保留。已收集的答卷不受影响；请检查后再发布。')}
                </Alert>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={importing} color="inherit">{L('Cancel', '取消')}</Button>
          <Button variant="contained" onClick={doImport} disabled={!report?.ok || importing || Boolean(mediaPlan && !canUploadMedia)}>
            {importing ? L('Importing…', '导入中…') : L('Import into Builder', '导入 Builder')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
