import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { resolveSurveyUiLanguage } from '../lib/surveyLocale';

const failedQuestions = new WeakSet();
export const questionMediaFailed = (question) => !!question && failedQuestions.has(question);

/** Capture native image/audio/video failures, including SurveyJS image-picker markup. */
export default function QuestionMediaBoundary({ question, children }) {
  const root = useRef(null);
  const failed = useRef(new Map());
  const [status, setStatus] = useState({ errors: 0, loading: false });
  const zh = resolveSurveyUiLanguage(question?.survey) === 'zh';
  const message = zh ? '媒体加载失败，请重试后再继续。' : 'Media failed to load. Retry before continuing.';
  const refresh = () => {
    if (!root.current) return;
    for (const [node, url] of failed.current) {
      if (!root.current.contains(node) || node.getAttribute('src') !== url) failed.current.delete(node);
    }
    const nodes = [...root.current.querySelectorAll('img[src], audio[src], video[src]')];
    // Cached image failures can precede React's event listeners.
    nodes.forEach((node) => {
      if (node.tagName === 'IMG' && node.complete && node.naturalWidth === 0 && node.getAttribute('src')) {
        failed.current.set(node, node.getAttribute('src'));
      }
    });
    const errors = failed.current.size;
    if (question) {
      if (errors) failedQuestions.add(question);
      else failedQuestions.delete(question);
    }
    const loading = nodes.some((node) => !failed.current.has(node)
      && (node.tagName === 'IMG' ? !node.complete : node.readyState < 2));
    setStatus((prev) => prev.errors === errors && prev.loading === loading ? prev : { errors, loading });
  };
  useEffect(() => {
    const element = root.current;
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    return () => { observer.disconnect(); failedQuestions.delete(question); };
    // The observer reads the current DOM and refs, independent of render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);
  useEffect(() => {
    const survey = question?.survey;
    const active = () => questionMediaFailed(question) && question.isVisible !== false
      && survey?.mode !== 'display' && !survey?.isDisplayMode;
    const validate = (_sender, options) => {
      if (options.question === question && active()) options.error = message;
    };
    const navigate = (_sender, options) => {
      if (!options.isPrevPage && active() && survey.currentPage === question.page) options.allow = false;
    };
    const complete = (_sender, options) => { if (active()) options.allow = false; };
    survey?.onValidateQuestion?.add(validate);
    survey?.onCurrentPageChanging?.add(navigate);
    survey?.onCompleting?.add(complete);
    survey?.onShowingPreview?.add(complete);
    return () => {
      survey?.onValidateQuestion?.remove(validate);
      survey?.onCurrentPageChanging?.remove(navigate);
      survey?.onCompleting?.remove(complete);
      survey?.onShowingPreview?.remove(complete);
    };
  }, [question, message]);
  const loaded = (event) => {
    failed.current.delete(event.target);
    refresh();
  };
  const error = (event) => {
    const node = event.target;
    if (!['IMG', 'AUDIO', 'VIDEO'].includes(node.tagName)) return;
    failed.current.set(node, node.getAttribute('src'));
    refresh();
  };
  const retry = () => {
    // Re-request exactly the original URL: query parameters may contain signatures.
    for (const [node, url] of failed.current) {
      if (node.tagName === 'IMG') node.src = url;
      else node.load();
    }
  };
  return <Box ref={root} onErrorCapture={error} onLoadCapture={loaded} onLoadedDataCapture={loaded}>
    {children}
    {status.errors > 0 && <Alert severity="error" sx={{ mt: 1 }}
      action={<Button color="inherit" sx={{ minHeight: 44 }} onClick={retry}>{zh ? '重试' : 'Retry'}</Button>}>
      {message}
    </Alert>}
    {!status.errors && status.loading && <Typography role="status" variant="caption" color="text.secondary">
      {zh ? '正在加载媒体…' : 'Loading media…'}
    </Typography>}
  </Box>;
}
