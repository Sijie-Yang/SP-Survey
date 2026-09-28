import React, { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget,
  registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import ParticipantSurveySurface from '../ParticipantSurveySurface';
import SurveyProgressBridge from '../SurveyProgressBridge';
import { SurveyTrialNavProvider } from '../../contexts/SurveyTrialNavContext';
import { applyAdminThemeToSurveyModel } from '../../lib/surveyStorage';
import { applySurveyLocale, resolveSurveyUiLanguage } from '../../lib/surveyLocale';
import { handleSurveyMediaError } from '../../lib/mediaRecovery';
import { clearInjectedMediaStore, syncInjectedMediaOntoSurveyModel } from '../../lib/surveyMediaInjection';
import { clearTrialsAnswerStore } from '../../lib/trialNavigation';
import { isPreviewMessage, PREVIEW_READY, PREVIEW_UPDATE, PREVIEW_RENDERED, PREVIEW_FAILED } from '../../lib/questionPreviewProtocol';

let registered = false;
export function createQuestionPreviewModel({ surveyJson, appearance }) {
  if (!registered) {
    registerImageRankingWidget();
    registerImageRatingWidget();
    registerImageBooleanWidget();
    registerImageMatrixWidget();
    registerAllExtendedWidgets();
    registered = true;
  }
  clearInjectedMediaStore();
  clearTrialsAnswerStore();
  const json = { ...appearance?.displaySettings, ...surveyJson };
  if (typeof json.showQuestionNumbers === 'boolean') json.showQuestionNumbers = json.showQuestionNumbers ? 'on' : 'off';
  const model = new Model(json);
  applySurveyLocale(model, appearance);
  model.mode = 'edit';
  model.showPreviewBeforeComplete = false;
  // Single-question builders hide completion for practice; the editor needs a
  // visible end state instead of an empty frame after the final trial.
  model.showCompletedPage = true;
  model.completedHtml = resolveSurveyUiLanguage(model) === 'zh'
    ? '<h3>本次试答已完成</h3><p>点击预览工具栏的“重置预览”可重新开始。试答结果不会保存。</p>'
    : '<h3>Preview complete</h3><p>Use “Reset preview” in the preview toolbar to try again. Preview answers are not saved.</p>';
  applyAdminThemeToSurveyModel(model, appearance);
  syncInjectedMediaOntoSurveyModel(model, surveyJson);
  return model;
}

/** Runs in its own window so CSS, matchMedia, galleries and Skills see the chosen viewport. */
export default function QuestionPreviewPage() {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (window.parent === window) return undefined;
    let activeModel;
    let activeRevision;
    const receive = (event) => {
      if (!isPreviewMessage(event, window.parent, PREVIEW_UPDATE)) return;
      if (activeModel && activeRevision === event.data.revision) return;
      try {
        const payload = event.data.payload;
        const model = createQuestionPreviewModel(payload);
        activeModel?.dispose();
        activeModel = model;
        activeRevision = event.data.revision;
        setPreview({ model, theme: payload.appearance?.theme, revision: event.data.revision });
        setError('');
      } catch {
        setError('Preview could not load. Please edit the question or reopen the preview.');
        window.parent.postMessage({ type: PREVIEW_FAILED, revision: event.data.revision }, window.location.origin);
      }
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => {
      window.removeEventListener('message', receive);
      activeModel?.dispose();
    };
  }, []);

  useEffect(() => {
    if (preview) {
      window.scrollTo(0, 0);
      window.parent.postMessage({ type: PREVIEW_RENDERED, revision: preview.revision }, window.location.origin);
    }
  }, [preview]);

  if (window.parent === window) return <Alert severity="info">Open this preview from the question editor.</Alert>;
  if (error) return <Alert severity="warning">{error}</Alert>;
  if (!preview) return <Box sx={{ p: 3 }}><CircularProgress aria-label="Loading preview" /></Box>;
  return (
    <SurveyTrialNavProvider key={preview.revision}>
      <ParticipantSurveySurface onErrorCapture={(event) => handleSurveyMediaError(event, resolveSurveyUiLanguage(preview.model))}>
        <SurveyProgressBridge surveyModel={preview.model} progressEnabled={false} theme={preview.theme} />
        <Survey model={preview.model} />
      </ParticipantSurveySurface>
    </SurveyTrialNavProvider>
  );
}
