import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';

const ASSISTANT_FLOW_META = [
  { n: 1, titleKey: 'introFlow1Title', bodyKey: 'introFlow1Body', action: 'assistant' },
  {
    n: 2,
    titleKey: 'introFlow2Title',
    bodyKey: 'introFlow2Body',
    example:
      'Create a survey about <your topic description>.\nAdd question types <question type description>.\nI have media datasets <description> ready to upload.',
    action: 'builder',
  },
  {
    n: 3,
    titleKey: 'introFlow3Title',
    bodyKey: 'introFlow3Body',
    example: 'I have media datasets <description> ready to upload.',
    action: 'media',
  },
  {
    n: 4,
    titleKey: 'introFlow4Title',
    bodyKey: 'introFlow4Body',
    example: 'Give me the live survey link for this project.',
    action: 'share',
  },
  {
    n: 5,
    titleKey: 'introFlow5Title',
    bodyKey: 'introFlow5Body',
    example: 'Summarize and export results for this project, then tell me the main findings.',
    action: 'results',
  },
];

function AssistantFlowStep({ step, t, onGoToTab, onOpenAssistant }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 2.5 }}>
      <Box
        sx={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {step.n}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={700} sx={{ mb: 0.5 }}>
          {t[step.titleKey]}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: step.example ? 1 : 0 }}>
          {t[step.bodyKey]}
        </Typography>
        {step.example && (
          <Box
            component="pre"
            sx={{
              m: 0,
              mb: 1,
              p: 1.5,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {step.example}
          </Box>
        )}
        {step.action === 'assistant' && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AutoAwesome />}
            onClick={onOpenAssistant}
            sx={{ textTransform: 'none', mt: 0.5 }}
          >
            {t.connectCodex}
          </Button>
        )}
        {step.action === 'builder' && (
          <Button size="small" variant="outlined" onClick={() => onGoToTab(2)} sx={{ textTransform: 'none', mt: 0.5 }}>
            {t.openSurveyBuilder}
          </Button>
        )}
        {step.action === 'media' && (
          <Button size="small" variant="outlined" onClick={() => onGoToTab(1)} sx={{ textTransform: 'none', mt: 0.5 }}>
            {t.openMediaDataset}
          </Button>
        )}
        {step.action === 'share' && (
          <Button size="small" variant="outlined" onClick={() => onGoToTab(4)} sx={{ textTransform: 'none', mt: 0.5 }}>
            {t.openShareSurvey}
          </Button>
        )}
        {step.action === 'results' && (
          <Button size="small" variant="outlined" onClick={() => onGoToTab(5)} sx={{ textTransform: 'none', mt: 0.5 }}>
            {t.openResultsAnalysis}
          </Button>
        )}
      </Box>
    </Stack>
  );
}

/**
 * Introduction tab: in-browser AI Assistant workflow for self-hosted Admin.
 */
export default function AdminIntroduction({ onGoToTab, onOpenAssistant }) {
  const { t } = useRegion();

  const stepBlurbs = [
    { index: 1, title: t.introStep1Title, blurb: t.introStep1Blurb },
    { index: 2, title: t.introStep2Title, blurb: t.introStep2Blurb },
    { index: 3, title: t.tabServer || 'Server', blurb: t.serverDescription },
    { index: 4, title: t.introStep3Title, blurb: t.introStep3Blurb },
    { index: 5, title: t.introStep4Title, blurb: t.introStep4Blurb },
    { index: 6, title: t.introAddonTitle, blurb: t.introAddonBlurb },
  ];

  return (
    <Box>
      <AdminPageHeader
        icon={<AutoAwesome />}
        title={t.introTitle}
        description={t.introBody}
      />

      <Stack spacing={1} sx={{ mb: 3 }}>
        {stepBlurbs.map((step) => (
          <Typography key={step.index} variant="body2">
            <Box
              component="button"
              type="button"
              onClick={() => onGoToTab(step.index)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                fontWeight: 700,
                color: 'primary.main',
                '&:hover': { textDecoration: 'underline' },
                '&:focus-visible': {
                  outline: '3px solid',
                  outlineColor: 'primary.light',
                  outlineOffset: 2,
                  borderRadius: 0.5,
                },
              }}
            >
              {step.title}
            </Box>
            <Box component="span" color="text.secondary">
              {' — '}
              {step.blurb}
            </Box>
          </Typography>
        ))}
      </Stack>

      <Accordion
        defaultExpanded={false}
        disableGutters
        elevation={0}
        sx={{
          border: '2px solid',
          borderColor: 'primary.main',
          borderRadius: '12px !important',
          bgcolor: 'background.paper',
          overflow: 'hidden',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMore />}
          sx={{ px: 2.5, py: 0.5, '& .MuiAccordionSummary-content': { my: 1.25 } }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesome color="primary" fontSize="small" />
            <Typography variant="h6" fontWeight={700}>
              {t.introFlowTitle}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 2.5, pt: 0, pb: 2.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {t.introFlowLead}
          </Typography>
          {ASSISTANT_FLOW_META.map((step) => (
            <AssistantFlowStep
              key={step.n}
              step={step}
              t={t}
              onGoToTab={onGoToTab}
              onOpenAssistant={onOpenAssistant}
            />
          ))}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
