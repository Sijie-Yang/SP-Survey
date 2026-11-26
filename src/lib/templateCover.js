import { useEffect, useState } from 'react';
import { Box, Chip, Stack, Tooltip } from '@mui/material';
import { filterMediaByType, inferMediaType } from './mediaUtils';
import { listPreviewMedia } from './previewMediaLibrary';
import { supabase } from './supabase';

export const DEFAULT_TEMPLATE_COVER = '/hero/streetscape-poster.jpg';
export const TEMPLATE_COVER_DIR = '/project_templates/cover_images';

/** Stable hash so the same template keeps the same fallback cover across reloads. */
export function hashString(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function collectImageUrls(preloadedImages) {
  if (!Array.isArray(preloadedImages)) return [];
  const urls = [];
  for (const entry of preloadedImages) {
    const url = entry?.url;
    if (!url) continue;
    const type = entry.type || inferMediaType(entry.name || url);
    if (type === 'image') urls.push(url);
  }
  return urls;
}

/**
 * Cover file, then the template's chosen thumbnail, then one image from its
 * own media library, then bundled extras, then the shared preview library.
 * Picks are stable per template id.
 */
export function resolveTemplateCover(template, options) {
  return describeTemplateCover(template, options).url;
}

export const COVER_SOURCE_LABELS = {
  coverFile: '专用封面',
  thumbnail: '已设封面',
  library: '模板图库',
  bundled: '内置图库',
  preset: '预览图库',
  default: '默认图',
};

export function coverFileUrl(coverFile) {
  if (!coverFile) return '';
  const file = String(coverFile);
  return file.startsWith('/') ? file : `${TEMPLATE_COVER_DIR}/${file}`;
}

/** Where the landing cover comes from, in the same order as resolveTemplateCover. */
export function describeTemplateCover(template, {
  coverFile,
  extraLibraryUrls = [],
  presetUrls = [],
} = {}) {
  const id = template?.id || template?.name;
  const own = collectImageUrls(template?.preloaded_images || template?.preloadedImages);
  const bundled = extraLibraryUrls.filter(Boolean);
  const presets = presetUrls.filter(Boolean);
  const stable = (urls) => (urls.length ? urls[hashString(id) % urls.length] : '');
  const dedicated = coverFileUrl(coverFile);
  const thumbnail = template?.thumbnail_url || template?.thumbnailUrl || '';
  let source = 'default';
  let url = DEFAULT_TEMPLATE_COVER;
  if (dedicated) {
    source = 'coverFile';
    url = dedicated;
  } else if (thumbnail) {
    source = 'thumbnail';
    url = thumbnail;
  } else if (own.length) {
    source = 'library';
    url = stable(own);
  } else if (bundled.length) {
    // Own library stays ahead of bundled files. One shared pool let a bundled
    // URL replace a stored library image (id "study" picks index 1).
    source = 'bundled';
    url = stable(bundled);
  } else if (presets.length) {
    source = 'preset';
    url = stable(presets);
  }
  const candidates = uniqueUrls([
    dedicated,
    thumbnail,
    own.length ? stable(own) : '',
    bundled.length ? stable(bundled) : '',
    presets.length ? stable(presets) : '',
    DEFAULT_TEMPLATE_COVER,
  ]);
  return {
    source,
    url: url || candidates[0] || DEFAULT_TEMPLATE_COVER,
    candidates,
    coverFile: coverFile || '',
  };
}

export function coverSourceDetail(status) {
  if (!status?.source) return '';
  if (status.source === 'coverFile') {
    return `落地页使用仓库封面 ${coverFileUrl(status.coverFile)}。媒体库里另选的图片不会替换这张封面。`;
  }
  if (status.source === 'thumbnail') {
    return '落地页使用这里设置的封面。清除后会改用模板图片库，没有图片再用预览媒体库。';
  }
  if (status.source === 'library') {
    return '没有专用封面，也没有单独设置。落地页从该模板自己的图片库取一张。';
  }
  if (status.source === 'bundled') {
    return '没有专用封面。落地页使用仓库里该模板自带的图片。';
  }
  if (status.source === 'preset') {
    return '没有专用封面，模板自己也没有图片。落地页使用预览媒体库。';
  }
  return '没有可用图片。落地页使用默认封面。';
}

let coverIndexPromise;
export function loadCoverIndex() {
  if (!coverIndexPromise) {
    coverIndexPromise = fetch(`${TEMPLATE_COVER_DIR}/index.json`)
      .then((res) => (res.ok ? res.json() : { covers: {} }))
      .then((data) => (data && typeof data.covers === 'object' && data.covers) || {})
      .catch(() => ({}));
  }
  return coverIndexPromise;
}

const manifestCache = new Map();

export async function loadBundledMediaEntries(id) {
  if (!id) return [];
  if (!manifestCache.has(id)) {
    manifestCache.set(id, (async () => {
      try {
        const res = await fetch(`/project_templates/${id}/images.json`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.images)) return [];
        return data.images.filter(Boolean).map((rel) => {
          const parts = String(rel).split('/').filter(Boolean);
          const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          return {
            url: `/project_templates/${id}/${rel}`,
            name: parts[parts.length - 1] || String(rel),
            key: `builtin/${id}/${rel}`,
            type: 'image',
            ...(folder ? { folder } : {}),
          };
        });
      } catch {
        return [];
      }
    })());
  }
  return manifestCache.get(id);
}

let presetPromise;
function loadPresetUrls() {
  if (!presetPromise) {
    presetPromise = listPreviewMedia()
      .then((items) => filterMediaByType(items, 'image').map((img) => img.url).filter(Boolean))
      .catch(() => []);
  }
  return presetPromise;
}

function uniqueUrls(urls) {
  const seen = new Set();
  const list = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    list.push(url);
  }
  return list;
}

/** Landing cover plus the layer it came from (cover file, thumbnail, library, preset). */
export async function resolveTemplateCoverStatus(template, presetUrls = [], coverIndex = {}) {
  const coverFile = coverIndex?.[template?.id] || '';
  const bundledEntries = coverFile ? [] : await loadBundledMediaEntries(template?.id);
  const bundled = bundledEntries.map((entry) => entry.url);
  const described = describeTemplateCover(template, {
    coverFile,
    extraLibraryUrls: bundled,
    presetUrls,
  });
  return { ...described, bundled, presetUrls: (presetUrls || []).filter(Boolean) };
}

export async function resolveCoverStatuses(templates) {
  const list = (templates || []).filter((template) => template?.id);
  if (!list.length) return {};
  const [coverIndex, presetUrls] = await Promise.all([loadCoverIndex(), loadPresetUrls()]);
  const statuses = {};
  await Promise.all(list.map(async (template) => {
    statuses[template.id] = await resolveTemplateCoverStatus(template, presetUrls, coverIndex);
  }));
  return statuses;
}

/** Ordered covers: dedicated file, saved thumbnail, template library, bundled files, preset. */
export async function coverCandidatesForTemplate(template, presetUrls = [], coverIndex = {}) {
  const status = await resolveTemplateCoverStatus(template, presetUrls, coverIndex);
  return status.candidates;
}

export async function resolveCovers(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const [coverIndex, presetUrls] = await Promise.all([loadCoverIndex(), loadPresetUrls()]);
  const online = {};
  if (supabase && list.length) {
    try {
      const { data, error } = await supabase
        .from('templates')
        .select('id, thumbnail_url, preloaded_images')
        .in('id', list);
      if (!error) {
        for (const row of data || []) online[row.id] = row;
      }
    } catch {
      // Covers still resolve from cover files and the bundled library.
    }
  }
  const covers = {};
  await Promise.all(list.map(async (id) => {
    const row = online[id] || {};
    covers[id] = await coverCandidatesForTemplate({
      id,
      thumbnail_url: row.thumbnail_url,
      preloaded_images: row.preloaded_images,
    }, presetUrls, coverIndex);
  }));
  return covers;
}

export function TemplateCoverImage({ candidates, alt, sx }) {
  const { src, onError } = useCoverCandidate(candidates);
  return <Box component="img" src={src} alt={alt || ''} onError={onError} sx={sx} />;
}

export function TemplateCoverStatus({ status, testId = 'template-cover', compact = false }) {
  const label = COVER_SOURCE_LABELS[status?.source] || '';
  const width = compact ? 72 : 96;
  const height = compact ? 48 : 64;
  if (!status?.url) {
    return (
      <Box
        data-testid={testId}
        sx={{ width, height, borderRadius: 1, bgcolor: 'grey.100', flexShrink: 0 }}
      />
    );
  }
  return (
    <Stack spacing={0.5} alignItems="flex-start" data-testid={testId} data-cover-source={status.source}>
      <TemplateCoverImage
        candidates={status.candidates?.length ? status.candidates : [status.url]}
        alt={label}
        sx={{
          width,
          height,
          objectFit: 'cover',
          borderRadius: 1,
          bgcolor: 'grey.100',
          border: '1px solid',
          borderColor: 'divider',
          display: 'block',
        }}
      />
      {label && (
        <Tooltip title={coverSourceDetail(status) || label}>
          <Chip
            size="small"
            label={label}
            color={status.source === 'coverFile' ? 'success' : status.source === 'thumbnail' ? 'primary' : 'default'}
            variant={status.source === 'coverFile' || status.source === 'thumbnail' ? 'filled' : 'outlined'}
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
          />
        </Tooltip>
      )}
    </Stack>
  );
}

export function useCoverCandidate(candidates) {
  const list = candidates?.length ? candidates : [DEFAULT_TEMPLATE_COVER];
  const key = list.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [key]);
  const src = list[Math.min(index, list.length - 1)];
  const onError = () => setIndex((current) => (current + 1 < list.length ? current + 1 : current));
  return { src, onError };
}

export function useResolvedCovers(ids) {
  const key = (ids || []).filter(Boolean).join('|');
  const [covers, setCovers] = useState({});
  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split('|') : [];
    if (!list.length) return undefined;
    resolveCovers(list).then((next) => { if (!cancelled) setCovers(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [key]);
  return covers;
}
