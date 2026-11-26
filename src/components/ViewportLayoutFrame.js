import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { bindSelectedTextStyles } from '../lib/selectedTextStyles';
import { applyQuestionTypography, typographySlot, typographyStyles } from '../lib/viewportTypography';
import { applyContentWidthToModel, resolvePublishedFrame } from '../lib/viewportLayout';

/**
 * Applies the saved desktop/mobile content width and media cap.
 * Preview passes forcedViewport plus the slider values. The participant
 * survey passes the published config and follows the window width.
 */
export default function ViewportLayoutFrame({
  config = null,
  forcedViewport = null,
  contentWidth = null,
  questionWidth = null,
  mediaMaxHeight = null,
  surveyModel = null,
  children,
}) {
  const frameRef = useRef(null);
  const [windowWidth, setWindowWidth] = useState(() => (
    typeof window === 'undefined' ? 1280 : window.innerWidth
  ));

  useEffect(() => {
    if (forcedViewport) return undefined;
    const onResize = () => setWindowWidth(window.innerWidth || 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [forcedViewport]);

  const published = forcedViewport ? null : resolvePublishedFrame(config, windowWidth);
  const viewport = forcedViewport || published?.viewport || 'desktop';
  const resolvedContentWidth = contentWidth > 0 ? contentWidth : (published?.contentWidth || null);
  const resolvedQuestionWidth = questionWidth > 0 ? questionWidth : (published?.questionWidth || null);
  const resolvedMedia = mediaMaxHeight > 0 ? mediaMaxHeight : (published?.mediaMaxHeight || null);
  const viewportWidth = forcedViewport === 'mobile' ? (resolvedContentWidth || 390) : forcedViewport === 'desktop' ? 1280 : windowWidth;

  useEffect(() => {
    if (!surveyModel || !resolvedContentWidth) return undefined;
    const original = { width: surveyModel.width, widthMode: surveyModel.widthMode };
    applyContentWidthToModel(surveyModel, resolvedContentWidth);
    return () => {
      surveyModel.width = original.width;
      surveyModel.widthMode = original.widthMode;
    };
  }, [surveyModel, resolvedContentWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('resize'));
  }, [resolvedMedia, viewportWidth, resolvedContentWidth, resolvedQuestionWidth]);

  useEffect(() => {
    const slot = config?.viewportLayout?.[viewport] || {};
    const applyQuestion = (root, question) => {
      if (!root || !question) return;
      const saved = slot.questions?.[question.name] || {};
      if (saved.mediaLayout) {
        const serialized = JSON.stringify(saved.mediaLayout);
        if (root.getAttribute('data-sp-media-layout') !== serialized) root.setAttribute('data-sp-media-layout', serialized);
        root.dataset.spImageLayoutMode = saved.mediaLayout.mode;
      } else { root.removeAttribute('data-sp-media-layout'); delete root.dataset.spImageLayoutMode; }
      applyQuestionTypography(root, typographySlot(config, viewport, question.name).resolved);
      const width = saved.questionWidth > 0 ? Math.min(saved.questionWidth, resolvedContentWidth || Infinity) : resolvedQuestionWidth;
      const media = saved.mediaMaxHeight > 0 ? saved.mediaMaxHeight : resolvedMedia;
      root.style.setProperty('--sp-question-width', width ? `${width}px` : '100%');
      if (width) root.setAttribute('data-sp-layout-question', '');
      else root.removeAttribute('data-sp-layout-question');
      if (media) {
        root.style.setProperty('--sp-media-max-height', `${media}px`);
        root.setAttribute('data-sp-media-max-height', String(media));
      } else {
        root.style.removeProperty('--sp-media-max-height');
        root.removeAttribute('data-sp-media-max-height');
      }
      root.style.setProperty('--sp-media-width', `${saved.mediaWidth || 100}%`);
    };
    const sync = () => surveyModel?.getAllQuestions?.().forEach((q) => applyQuestion(q.react?.rootRef?.current, q));
    const rendered = (_sender, options) => applyQuestion(options.htmlElement, options.question);
    surveyModel?.onAfterRenderQuestion?.add(rendered);
    sync();
    const observer = new MutationObserver(sync);
    if (frameRef.current) observer.observe(frameRef.current, { childList: true, subtree: true });
    window.dispatchEvent(new Event('resize'));
    return () => { observer.disconnect(); surveyModel?.onAfterRenderQuestion?.remove(rendered); };
  }, [config, viewport, surveyModel, resolvedContentWidth, resolvedQuestionWidth, resolvedMedia]);

  const textStyles = config?.viewportLayout?.[viewport]?.textStyles;
  const textStylesRef = useRef(textStyles);
  textStylesRef.current = textStyles;
  useEffect(() => bindSelectedTextStyles(surveyModel, () => textStylesRef.current), [surveyModel]);
  useEffect(() => { surveyModel?.locStrsChanged?.(); }, [surveyModel, textStyles]);

  const savedSlot = config?.viewportLayout?.[viewport] || {};
  return (
    <Box
      ref={frameRef}
      data-sp-viewport-layout=""
      data-sp-viewport={viewport}
      data-sp-viewport-width={String(viewportWidth)}
      {...(resolvedContentWidth ? { 'data-sp-content-width': String(resolvedContentWidth) } : {})}
      {...(resolvedQuestionWidth ? { 'data-sp-question-width': String(resolvedQuestionWidth) } : {})}
      {...(resolvedMedia ? { 'data-sp-media-max-height': String(resolvedMedia) } : {})}
      sx={{
        ...typographyStyles(config, viewport),
        width: '100%',
        maxWidth: '100%',
        mx: 'auto',
        boxSizing: 'border-box',
        ...(forcedViewport === 'mobile' ? {
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'auto',
          bgcolor: 'background.paper',
        } : {}),
        '& .sd-imagepicker, & .sp-image-gallery, & .sd-image, & .sp-media-player': { maxWidth: 'var(--sp-media-width, 100%)', marginInline: 'auto' },
        ...(savedSlot.questionGap != null ? { '& .sd-row + .sd-row': { marginTop: `${savedSlot.questionGap}px` } } : {}),
        ...(savedSlot.cardPadding != null ? { '& .sd-question.sd-element--with-frame': { padding: `${savedSlot.cardPadding}px` } } : {}),
        ...(resolvedMedia ? { '--sp-media-max-height': `${resolvedMedia}px` } : {}),
        ...(resolvedQuestionWidth ? { '--sp-question-width': `${resolvedQuestionWidth}px` } : {}),
        ...((resolvedQuestionWidth || savedSlot.questions) ? {
          '& [data-sp-layout-question]': {
            width: 'var(--sp-question-width)',
            maxWidth: '100%',
            flex: '0 0 auto',
            marginLeft: 'auto',
            marginRight: 'auto',
          },
        } : {}),
      }}
    >
      <Box data-sp-content-column="" sx={{ width: '100%', maxWidth: resolvedContentWidth || 'none', mx: 'auto' }}>
        {children}
      </Box>
    </Box>
  );
}
