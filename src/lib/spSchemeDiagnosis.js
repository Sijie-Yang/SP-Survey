/**
 * Admin diagnosis of projects that run an uploaded page (SP-Scheme): which
 * kind of page it is, what participants are actually served, where the page's
 * images come from, and whether answers are being recorded. Deterministic,
 * no model. Also rebuilds the user's upload (page + media + data files) as a
 * ZIP so the project can be inspected offline.
 */
import { normalizeMediaEntry } from './mediaUtils';
import { shouldInjectMedia } from './surveyMediaInjection';
import {
  SITE_PAGE_FILES,
  buildSiteQuestions,
  checkSiteHtml,
  findImageSlots,
  pageReferencedFiles,
  siteMatchLevel,
  siteMediaFolders,
} from './spSite';

export const SP_SCHEME_KIND_LABELS = {
  site: { label: 'SP-Scheme 页面', color: 'success', hint: '页面按 SP-Scheme 声明了题目，平台按题记录并分析。' },
  asIs: { label: '原样导入', color: 'warning', hint: '页面不符合 SP-Scheme，平台只原样记录页面发出的数据，不做分析。' },
  package: { label: 'SP-Scheme 题目', color: 'info', hint: '用 SP-Scheme 导入的题目，由平台自己的问卷页面展示。' },
};

/** 'site' | 'asIs' | 'package' | null */
export function spSchemeKind(config = {}) {
  const site = config?.spSite?.html ? config.spSite : null;
  if (site) return site.convertedFrom || siteMatchLevel(config).level === 'none' ? 'asIs' : 'site';
  if (config?.spScheme) return 'package';
  return null;
}

/** The config and media library participants get (published when the project is release-managed). */
export function servedProject(project = {}) {
  const published = Boolean(project.releaseManaged && project.publishedConfig);
  return {
    published,
    version: published ? project.publishedVersion || null : null,
    config: (published ? project.publishedConfig : project.config) || {},
    pool: (published ? project.publishedMedia?.preloadedImages : project.preloadedImages) || [],
  };
}

function siteFingerprint(config = {}) {
  const site = config.spSite || {};
  return JSON.stringify([site.html || '', site.mediaFolders || [], site.allowedHosts || []]);
}

/** Folder names the page asks for with SPSite.getMedia('...'); `dynamic` when it passes a variable or nothing. */
export function pageMediaCalls(html) {
  const text = String(html || '');
  const folders = new Set();
  let dynamic = false;
  const re = /SPSite\s*\.\s*getMedia\s*\(\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const arg = m[1].trim();
    const lit = arg.match(/^(['"`])([^'"`]*)\1$/);
    if (lit) folders.add(lit[2].replace(/^\/+|\/+$/g, ''));
    else dynamic = true;
  }
  return { folders: [...folders], dynamic };
}

/** The files a page gets for SPSite.getMedia(folder) from the served folders (as the SDK resolves it). */
export function mediaFor(given, folder) {
  if (given[folder]) return given[folder];
  const hit = Object.keys(given).find((k) => k !== SITE_PAGE_FILES && (k === folder || k.endsWith(`/${folder}`)));
  return hit ? given[hit] : [];
}

const EXTERNAL_IMAGE_RE = /https?:\/\/[^"'\s()<>]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"'\s()<>]*)?/gi;

/**
 * Plain-language checks for one project.
 * @returns {{ kind, served, draftDiffers, checks: Array<{ level: 'ok'|'warn'|'error', title: string, detail: string }>, media }}
 */
export function diagnoseSpSchemeProject(project = {}) {
  const served = servedProject(project);
  const config = served.config;
  const kind = spSchemeKind(config);
  const draftKind = spSchemeKind(project.config || {});
  const draftDiffers = served.published && siteFingerprint(project.config || {}) !== siteFingerprint(config);
  const checks = [];
  const add = (level, title, detail = '') => checks.push({ level, title, detail });

  if (!kind) {
    add(draftKind ? 'error' : 'ok',
      draftKind ? '参与者看到的版本里没有上传的页面' : '不是 SP-Scheme 项目',
      draftKind ? '草稿里有上传的页面，但已发布的版本里没有，需要重新发布。' : '这个项目用平台自己的问卷页面。');
    return { kind, served, draftDiffers, checks, media: { given: {}, total: 0 } };
  }

  add('ok', `类型：${SP_SCHEME_KIND_LABELS[kind].label}`, SP_SCHEME_KIND_LABELS[kind].hint);
  add(draftDiffers ? 'warn' : 'ok',
    served.published ? `参与者看到的是已发布的第 ${served.version || '?'} 版` : '参与者看到的是当前草稿（项目没有用发布管理）',
    draftDiffers ? '草稿里的页面或关联的图库文件夹和已发布版不一样，参与者看不到这些改动，需要重新发布。' : '');

  if (kind === 'package') {
    return { kind, served, draftDiffers, checks, media: { given: {}, total: 0 } };
  }

  const html = config.spSite.html;
  const given = siteMediaFolders(served.pool, config);
  const libraryCount = Object.entries(given).filter(([k]) => k !== SITE_PAGE_FILES).reduce((n, [, list]) => n + list.length, 0);
  const pageFiles = (given[SITE_PAGE_FILES] || []).length;
  const linked = config.spSite.mediaFolders || [];
  const calls = pageMediaCalls(html);
  const slots = findImageSlots(html);
  const referenced = pageReferencedFiles(html).size;
  const external = new Set(String(html).match(EXTERNAL_IMAGE_RE) || []).size;

  // Questions whose images the platform draws itself (e.g. imagepicker with imageCount).
  const drawn = [];
  const walk = (elements) => (elements || []).forEach((el) => { if (el && shouldInjectMedia(el)) drawn.push(el); walk(el?.elements); });
  (config.pages || []).forEach((page) => walk(page.elements));

  add(served.pool.length ? 'ok' : 'warn', `图库里有 ${served.pool.length} 个文件`,
    linked.length ? `页面关联的文件夹：${linked.join('、')}。页面能拿到其中 ${libraryCount} 张。` : '页面没有关联图库文件夹。');

  if (drawn.length) {
    add(served.pool.length || !served.published ? 'ok' : 'error', `${drawn.length} 道题的图片由平台按题抽取`,
      `${drawn.slice(0, 6).map((el) => `${el.name}（每次 ${el.imageCount || 1} 张${el.trialCount > 1 ? `，做 ${el.trialCount} 次` : ''}）`).join('、')}。`
      + (served.pool.length ? '每个参与者从项目图库随机抽。' : (served.published ? '但已发布版本的图库是空的，抽不到图。' : '项目图库是空的，会用平台预览图库里的图片（适合试跑）。')));
  }
  if (!served.pool.length && !served.published && (calls.folders.length || calls.dynamic || slots.some((slot) => !slot.count))) {
    // Same rule as the participant page (SurveyApp): an empty library falls back to the preview library.
    add('warn', '项目图库是空的：参与者会看到平台预览图库里的图片',
      '适合试跑。正式收数据前，请把研究用的图片上传到项目图库（文件夹名和页面要的一致），否则答卷里记的是预览图。');
  } else if (calls.folders.length || calls.dynamic) {
    calls.folders.forEach((folder) => {
      const n = mediaFor(given, folder).length;
      add(n ? 'ok' : 'error', `页面向平台要文件夹「${folder || '根目录'}」的图片：${n} 张`,
        n ? '每个参与者由页面自己的代码决定怎么抽、怎么排。'
          : '平台没有给它任何图片，页面会显示空白或用它自带的图片。检查图库里有没有这个文件夹，并在 Builder 里把它关联到页面，然后重新发布。');
    });
    if (calls.dynamic) add(libraryCount ? 'ok' : 'error', '页面用变量向平台要图片', libraryCount ? `平台给了它 ${libraryCount} 张。` : '平台没有给它任何图片。');
  } else if (slots.length) {
    slots.forEach((slot) => {
      if (slot.count) {
        add('warn', `图片列表 ${slot.name} 里已经写死了 ${slot.count} 个图片`,
          '平台只会填充空列表；这里每个参与者看到的都是这几张，是否随机全看页面自己的代码。想用图库随机，把它改成空列表（如 const photos = []）。');
      } else {
        add(libraryCount ? 'ok' : 'error', `空图片列表 ${slot.name}`,
          libraryCount ? `平台会把 ${libraryCount} 张图库图片按每人不同的随机顺序填进去，并随答卷记录。`
            : '图库里没有可填的图片，列表会一直是空的。在 Builder 里关联图片所在的文件夹并重新发布。');
      }
    });
  } else if (!drawn.length) {
    add('warn', '页面没有向平台要图片',
      '没有调用 SPSite.getMedia，也没有平台能识别的空图片列表（名字含 photo/image/img/pic/media 的 const xxx = []），所以平台不会给它随机图片。'
      + (referenced ? ` 页面自己按文件名引用了 ${referenced} 个媒体文件，其中 ${pageFiles} 个在图库里找到了。` : '')
      + (external ? ` 页面里还直接写了 ${external} 个外部图片网址。` : ''));
  }

  if (kind === 'site') {
    const { errors, warnings } = checkSiteHtml(html, buildSiteQuestions(config).map((q) => q.name), { allowedHosts: config.spSite.allowedHosts || [] });
    if (!errors.length) add('ok', '页面会把回答按题交给平台', '调用了 SPSite.answer 和 SPSite.complete。');
    errors.forEach((e) => add('error', '回答记录有问题', e));
    warnings.forEach((w) => add('warn', '提醒', w));
  } else {
    const completes = /SPSite\s*\.\s*complete\s*\(/.test(html);
    add('ok', '原样记录：平台保存页面发出的请求和页面自己存的进度',
      completes ? '页面会调用 SPSite.complete() 提交。'
        : '页面存的进度里出现 done/finished=true 时自动提交，否则参与者要点页面下方平台条上的提交按钮。');
  }

  return { kind, served, draftDiffers, checks, media: { given, total: libraryCount + pageFiles } };
}

/** What a few stored responses actually hold. */
export function summarizeResponses(rows = []) {
  return (rows || []).map((row) => {
    const answers = row?.responses && typeof row.responses === 'object' ? row.responses : {};
    const state = answers.__sp_page_state && typeof answers.__sp_page_state === 'object' ? answers.__sp_page_state : {};
    const questionKeys = Object.keys(answers).filter((k) => !k.startsWith('__'));
    const trialsWithImages = questionKeys.reduce((n, k) => n + (Array.isArray(answers[k]?.trials)
      ? answers[k].trials.filter((t) => (t?.shown_images || []).length || (t?.shown_media_ids || []).length).length : 0), 0);
    return {
      id: row?.id || null,
      createdAt: row?.created_at || null,
      questions: questionKeys,
      requests: Array.isArray(answers.__sp_requests) ? answers.__sp_requests.length : 0,
      pageState: Object.keys(state),
      mediaLists: Object.keys(state).filter((k) => k.startsWith('sp-media:')),
      trialsWithImages,
      displayedImages: Array.isArray(row?.displayed_images) ? row.displayed_images.length : 0,
    };
  });
}

function responseLine(s) {
  const parts = [
    `${s.questions.length} 个题目有答案${s.questions.length ? `（${s.questions.slice(0, 8).join(', ')}${s.questions.length > 8 ? '…' : ''}）` : ''}`,
    s.requests ? `${s.requests} 条页面请求` : null,
    s.pageState.length ? `页面存储 ${s.pageState.length} 项` : null,
    s.mediaLists.length ? `平台填入的图片列表 ${s.mediaLists.join(', ')}` : null,
    s.trialsWithImages ? `${s.trialsWithImages} 条带展示图片的记录` : null,
    s.displayedImages ? `displayed_images ${s.displayedImages} 张` : null,
  ].filter(Boolean);
  return `- ${s.createdAt || '?'}：${parts.join('；')}`;
}

const LEVEL_MARK = { ok: '✓', warn: '!', error: '✗' };

export function diagnosisText(project, diagnosis, { responseCount = null, samples = [], mediaReport = null } = {}) {
  const lines = [
    `# 项目诊断：${project.name || '未命名'}`,
    '',
    `项目 ID：${project.id}`,
    `用户 ID：${project.user_id || '—'}`,
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 检查结果',
    '',
    ...diagnosis.checks.map((c) => `${LEVEL_MARK[c.level]} ${c.title}${c.detail ? `\n  ${c.detail}` : ''}`),
    '',
    '## 答卷',
    '',
    responseCount == null ? '答卷数量：读取失败' : `答卷数量：${responseCount}`,
    ...(samples.length ? ['', '最近几份答卷里记下了什么：', ...samples.map(responseLine)] : []),
  ];
  if (mediaReport) {
    lines.push('', '## 包里的图片', '', `已打包 ${mediaReport.saved} 个文件${mediaReport.skipped ? `，超出上限未打包 ${mediaReport.skipped} 个（见 media.csv）` : ''}${mediaReport.failed.length ? `，下载失败 ${mediaReport.failed.length} 个` : ''}。`);
    mediaReport.failed.slice(0, 20).forEach((f) => lines.push(`- 失败：${f.path}（${f.error}）`));
  }
  lines.push('', '## 文件说明', '',
    '- index.html：参与者实际看到的上传页面（原样，未经平台注入）',
    '- index.draft.html：草稿里的页面（只有和已发布版不同时才有）',
    '- 其他 json/csv：页面里嵌入的数据文件，放回上传时的路径',
    '- media/：页面能拿到的图库文件，按图库文件夹放',
    '- media.csv：图库全部文件及是否给到页面',
    '- config.json / config.draft.json：项目设置（页面 html 已拿出来单独存）',
    '- responses-sample.json：最近几份答卷原文');
  return lines.join('\n');
}

function withoutHtml(config = {}) {
  if (!config?.spSite?.html) return config;
  return { ...config, spSite: { ...config.spSite, html: '(见 index.html)' } };
}

/** JSON / CSV files embedded in the page (<script id="sp-data">). */
export function embeddedDataFiles(html) {
  const m = String(html || '').match(/<script\b[^>]*\bid=["']sp-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[1]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safePath(p) {
  return String(p || '').split('/').filter((s) => s && s !== '.' && s !== '..').map((s) => s.replace(/[\\:*?"<>|]/g, '_')).join('/');
}

const RESERVED_PATHS = new Set(['README.md', 'index.html', 'index.draft.html', 'config.json', 'config.draft.json', 'media.csv', 'responses-sample.json']);

export const PACKAGE_MEDIA_MAX_FILES = 300;
export const PACKAGE_MEDIA_MAX_BYTES = 150 * 1024 * 1024;

/**
 * Files for the diagnosis ZIP. `fetchBytes(url)` downloads one media file.
 * @returns {Promise<{ files: Array<{ path, content }>, mediaReport }>}
 */
export async function buildDiagnosisFiles(project, {
  responseCount = null,
  responses = [],
  fetchBytes = null,
  onProgress = () => {},
} = {}) {
  const diagnosis = diagnoseSpSchemeProject(project);
  const { config, pool } = diagnosis.served;
  const files = [];
  const html = config?.spSite?.html || '';
  if (html) files.push({ path: 'index.html', content: html });
  const draftHtml = project.config?.spSite?.html || '';
  if (draftHtml && draftHtml !== html) files.push({ path: 'index.draft.html', content: draftHtml });
  Object.entries(embeddedDataFiles(html)).forEach(([name, text]) => {
    // Back at the path it had in the upload, unless that clashes with this package's own files.
    const path = safePath(name);
    if (path) files.push({ path: RESERVED_PATHS.has(path) || path.startsWith('media/') ? `data/${path}` : path, content: typeof text === 'string' ? text : JSON.stringify(text, null, 2) });
  });
  files.push({ path: 'config.json', content: JSON.stringify(withoutHtml(config), null, 2) });
  if (diagnosis.served.published && project.config) {
    files.push({ path: 'config.draft.json', content: JSON.stringify(withoutHtml(project.config), null, 2) });
  }

  const givenUrls = new Set(Object.values(diagnosis.media.given).flat().map((m) => m.url));
  const rows = [['folder', 'name', 'url', 'given_to_page']];
  const wanted = [];
  const seen = new Set();
  (Array.isArray(pool) ? pool : []).forEach((item) => {
    if (!item?.url) return;
    const folder = String(normalizeMediaEntry(item)?.folder || '').replace(/^\/+|\/+$/g, '');
    const name = item.name || String(item.url).split('?')[0].split('/').pop();
    const given = givenUrls.has(item.url);
    rows.push([folder, name, item.url, given ? 'yes' : 'no']);
    const path = `media/${safePath(folder ? `${folder}/${name}` : name)}`;
    if (given && !seen.has(path)) { seen.add(path); wanted.push({ path, url: item.url }); }
  });
  files.push({ path: 'media.csv', content: rows.map((r) => r.map(csvCell).join(',')).join('\n') });

  const mediaReport = { saved: 0, skipped: 0, failed: [] };
  if (fetchBytes) {
    let bytes = 0;
    for (let i = 0; i < wanted.length; i += 1) {
      const item = wanted[i];
      if (mediaReport.saved >= PACKAGE_MEDIA_MAX_FILES || bytes >= PACKAGE_MEDIA_MAX_BYTES) {
        mediaReport.skipped = wanted.length - i;
        break;
      }
      onProgress({ done: i, total: wanted.length });
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchBytes(item.url);
        bytes += data.length;
        files.push({ path: item.path, content: data });
        mediaReport.saved += 1;
      } catch (err) {
        mediaReport.failed.push({ path: item.path, error: err?.message || String(err) });
      }
    }
    onProgress({ done: wanted.length, total: wanted.length });
  } else {
    mediaReport.skipped = wanted.length;
  }

  const samples = summarizeResponses(responses);
  if (responses.length) files.push({ path: 'responses-sample.json', content: JSON.stringify(responses, null, 2) });
  files.unshift({ path: 'README.md', content: diagnosisText(project, diagnosis, { responseCount, samples, mediaReport }) });
  return { files, mediaReport, diagnosis };
}

export function diagnosisZipName(project) {
  const base = String(project?.name || project?.id || 'project').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  return `${base}-sp-scheme-diagnosis.zip`;
}
