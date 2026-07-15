import React, { useEffect, useMemo, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';

let widgetsRegistered = false;
function ensureWidgets() {
  if (widgetsRegistered) return;
  registerImageRankingWidget();
  registerImageRatingWidget();
  registerImageBooleanWidget();
  registerAllExtendedWidgets();
  widgetsRegistered = true;
}

/**
 * Live single-question SurveyJS preview for the question editor (non-skill types).
 */
export default function QuestionParticipantPreview({ question, currentProject }) {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  const previewKey = useMemo(() => {
    try {
      return JSON.stringify({
        type: question?.type,
        title: question?.title,
        description: question?.description,
        imageSelectionMode: question?.imageSelectionMode,
        selectedImageUrls: question?.selectedImageUrls,
        imageCount: question?.imageCount,
        mediaType: question?.mediaType,
        displayMode: question?.displayMode,
        rateMin: question?.rateMin,
        rateMax: question?.rateMax,
        labelTrue: question?.labelTrue,
        labelFalse: question?.labelFalse,
        multiSelect: question?.multiSelect,
        choices: question?.choices,
        rows: question?.rows,
        columns: question?.columns,
        dimensions: question?.dimensions,
        scaleMin: question?.scaleMin,
        scaleMax: question?.scaleMax,
        budget: question?.budget,
        allowedTools: question?.allowedTools,
        annotationLabels: question?.annotationLabels,
        minAnnotations: question?.minAnnotations,
        maxAnnotations: question?.maxAnnotations,
        beforeLabel: question?.beforeLabel,
        afterLabel: question?.afterLabel,
        exposureSeconds: question?.exposureSeconds,
        isRequired: question?.isRequired,
        maxLength: question?.maxLength,
        minRateDescription: question?.minRateDescription,
        maxRateDescription: question?.maxRateDescription,
      });
    } catch {
      return String(Date.now());
    }
  }, [question]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      try {
        ensureWidgets();
        if (!question?.type) {
          setModel(null);
          return;
        }
        const { surveyJson } = buildSingleQuestionSurvey({
          question,
          projectImages: currentProject?.preloadedImages || [],
          randomMedia: false,
          showNavigationButtons: false,
        });
        const m = new Model(surveyJson);
        m.mode = 'display';
        m.showPreviewBeforeComplete = false;
        if (!cancelled) {
          setError(null);
          setModel(m);
        }
      } catch (err) {
        console.error('Question preview failed:', err);
        if (!cancelled) {
          setError(err.message || 'Preview failed');
          setModel(null);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, currentProject?.preloadedImages]);

  if (error) {
    return <Alert severity="warning" sx={{ py: 0.5 }}>{error}</Alert>;
  }
  if (!model) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'white',
        p: 1,
        '& .sd-root-modern': { ['--sjs-font-size']: '14px' },
        '& .sd-body': { padding: '8px !important' },
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Live preview — uses curated files when set, otherwise a sample from the project media pool.
      </Typography>
      <Survey model={model} />
    </Box>
  );
}
