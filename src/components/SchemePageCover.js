import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import SpSiteFrame from './SpSiteFrame';
import { supabase } from '../lib/supabase';
import { stripOwnResponseSupabase } from '../lib/ownResponseSupabase';
import { buildSiteQuestions, siteMediaFolders, sitePreviewMediaFolders } from '../lib/spSite';
import { resolvePreviewMediaContextCached } from '../lib/previewMediaLibrary';
import { hashString } from '../lib/templateCover';

// The page is laid out at desktop width (tablet width on narrow cards), then
// scaled down to the card.
const pageWidthFor = (cardWidth) => (cardWidth < 480 ? 820 : 1280);
const cache = new Map();

/** survey_config + media pool of a template, fetched once per template id. */
export function loadSchemeTemplate(templateId) {
  if (!cache.has(templateId)) {
    cache.set(templateId, (async () => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('templates')
        .select('survey_config, preloaded_images')
        .eq('id', templateId)
        .single();
      if (error || !data?.survey_config?.spSite?.html) return null;
      const config = stripOwnResponseSupabase(data.survey_config);
      const preloadedImages = Array.isArray(data.preloaded_images) ? data.preloaded_images : [];
      const { images, fromPreviewLibrary } = await resolvePreviewMediaContextCached({ preloadedImages }).catch(() => ({ images: [] }));
      return { config, pool: images || [], previewLibrary: Boolean(fromPreviewLibrary) };
    })().catch(() => null));
  }
  return cache.get(templateId);
}

/**
 * Card cover for an SP-Scheme template: the participant page itself, scaled
 * down and not interactive. Its randomness is seeded by the template id, so
 * the page draws the same images and order on every load and the cover does
 * not change between visits. Loads when the card scrolls into view; shows
 * `fallback` until then, or when the template has no page.
 */
export default function SchemePageCover({ templateId, height = 190, fallback = null }) {
  const boxRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [site, setSite] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resize?.observe(el);
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return () => resize?.disconnect();
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { io.disconnect(); resize?.disconnect(); };
  }, []);

  useEffect(() => {
    if (!visible || !templateId) return undefined;
    let cancelled = false;
    loadSchemeTemplate(templateId).then((res) => { if (!cancelled) setSite(res); });
    return () => { cancelled = true; };
  }, [visible, templateId]);

  const questions = useMemo(() => (site ? buildSiteQuestions(site.config) : []), [site]);
  const media = useMemo(() => {
    if (!site) return {};
    return site.previewLibrary ? sitePreviewMediaFolders(site.pool, site.config) : siteMediaFolders(site.pool, site.config);
  }, [site]);
  const pageWidth = pageWidthFor(width);
  const scale = width ? width / pageWidth : 0;

  return (
    <Box ref={boxRef} aria-hidden="true" sx={{ position: 'relative', height, overflow: 'hidden', bgcolor: 'grey.100' }}>
      {(!site || !ready) && <Box sx={{ position: 'absolute', inset: 0 }}>{fallback}</Box>}
      {site && scale > 0 && (
        <Box
          data-testid={`sp-scheme-cover-${templateId}`}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: pageWidth,
            height: height / scale,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
            opacity: ready ? 1 : 0,
            transition: 'opacity 0.3s',
          }}
        >
          <SpSiteFrame
            html={site.config.spSite.html}
            allowedHosts={site.config.spSite.allowedHosts || []}
            questions={questions}
            media={media}
            survey={{ title: site.config.title || '', description: site.config.description || '', language: site.config.locale || 'en', preview: true }}
            title={site.config.title || 'Survey page'}
            sandbox="allow-scripts"
            randomSeed={hashString(templateId)}
            // Give the page a moment to draw before replacing the placeholder.
            onLoad={() => setTimeout(() => setReady(true), 400)}
          />
        </Box>
      )}
    </Box>
  );
}
