import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  CheckCircle,
  Close,
  Download,
  ExpandMore,
  RestartAlt,
  Save,
} from '@mui/icons-material';
import AgentsEditor from './AgentsEditor';
import {
  isAssistantEnabled,
  isSiliconExperimentalEnabled,
  setAssistantEnabled,
  setSiliconExperimentalEnabled,
} from '../../lib/featureFlags';

export default function AssistantSettingsDialog({
  open,
  onClose,
  t,
  isPlatformMode,
  assistantMode,
  onAssistantModeChange,
  onCredentialsChange,
  codexConnected,
  codexStatusLoading,
  onOpenIntegrations,
  apiKeyValid,
  openaiApiKey,
  onApiKeyChange,
  onValidateApiKey,
  contextEnabled,
  onContextToggle,
  researchContext,
  setResearchContext,
  predefinedScenarios,
  newScenario,
  setNewScenario,
  onAddCustomScenario,
  multiAgentReviewEnabled,
  onMultiAgentReviewToggle,
  reviewMode,
  onReviewModeChange,
  maxReviewRounds,
  onMaxReviewRoundsChange,
  currentProject,
  prompts,
  promptsModified,
  onPromptChange,
  onSavePrompts,
  onResetPrompts,
  onDownloadHistory,
  onClearHistory,
}) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [section, setSection] = React.useState(0);
  const [assistantFlag, setAssistantFlag] = React.useState(() => isAssistantEnabled());
  const [siliconFlag, setSiliconFlag] = React.useState(() => isSiliconExperimentalEnabled());

  React.useEffect(() => {
    if (!open) setSection(0);
  }, [open]);

  const removeScenario = (scenario) => {
    setResearchContext({
      ...researchContext,
      customScenarios: researchContext.customScenarios.filter((item) => item !== scenario),
      scenario: researchContext.scenario === scenario ? 'street view' : researchContext.scenario,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          height: { xs: 'min(760px, calc(100vh - 24px))', sm: 'min(760px, calc(100vh - 48px))' },
          m: { xs: 1.5, sm: 3 },
          borderRadius: 4,
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle sx={{ px: 2.5, py: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{t.aiSettingsTitle}</Typography>
          <IconButton size="small" onClick={onClose} aria-label={t.aiSidebarClose}>
            <Close fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          minHeight: 0,
          p: 0,
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: compact ? '100%' : 184,
            p: compact ? 1 : 1.5,
            borderRight: compact ? 0 : '1px solid',
            borderBottom: compact ? '1px solid' : 0,
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={section}
            onChange={(_, value) => setSection(value)}
            orientation={compact ? 'horizontal' : 'vertical'}
            variant={compact ? 'fullWidth' : 'standard'}
            sx={{
              minHeight: 0,
              '& .MuiTabs-indicator': { display: 'none' },
              '& .MuiTab-root': {
                minHeight: 40,
                alignItems: compact ? 'center' : 'flex-start',
                borderRadius: 2.5,
                px: 1.5,
                textTransform: 'none',
                color: 'text.primary',
              },
              '& .Mui-selected': { bgcolor: 'action.selected' },
            }}
          >
            <Tab label={t.aiSettingsModels} />
            <Tab label={t.aiSettingsContext} />
            <Tab label={t.aiSettingsAdvanced} />
          </Tabs>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
          {section === 0 && (
            <Box sx={{ maxWidth: 680 }}>
              <Box sx={{ mb: 2.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{t.aiSidebarMode}</Typography>
                <TextField
                  select
                  fullWidth
                  size="small"
                  value={assistantMode || 'agent'}
                  onChange={(event) => onAssistantModeChange?.(event.target.value)}
                  inputProps={{ 'aria-label': t.aiSidebarMode }}
                >
                  {[
                    ['agent', t.aiSidebarModeAgent],
                    ['generate', t.aiSidebarModeGenerate],
                    ['adjust', t.aiSidebarModeAdjust],
                    ['question', t.aiSidebarModeQuestion],
                  ].map(([value, label]) => (
                    <MenuItem key={value} value={value}>{label}</MenuItem>
                  ))}
                </TextField>
              </Box>
              <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>{t.modelsTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t.aiSettingsLocalKeyIntro}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label={t.modelsKeyInput}
                  value={openaiApiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  InputProps={{
                    endAdornment: apiKeyValid ? (
                      <InputAdornment position="end"><CheckCircle color="success" /></InputAdornment>
                    ) : null,
                  }}
                />
                <Button variant="contained" onClick={onValidateApiKey} disabled={!openaiApiKey}>
                  {t.aiSettingsValidate}
                </Button>
              </Stack>
            </Box>
          )}

          {section === 1 && (
            <Box sx={{ maxWidth: 680 }}>
              <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>{t.aiSettingsContextTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                {t.aiSettingsContextIntro}
              </Typography>

              <Box sx={{ p: 2, mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                {isPlatformMode ? (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.aiSettingsMemory}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.aiSettingsMemoryAutomatic}
                    </Typography>
                  </Box>
                ) : (
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={contextEnabled}
                        onChange={(event) => onContextToggle(event.target.checked)}
                      />
                    )}
                    label={(
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.aiSettingsMemory}</Typography>
                        <Typography variant="caption" color="text.secondary">{t.aiSettingsMemoryHint}</Typography>
                      </Box>
                    )}
                  />
                )}
              </Box>

              <Stack spacing={2}>
                <TextField
                  fullWidth
                  size="small"
                  label={t.aiSettingsResearchTopic}
                  value={researchContext.topic}
                  onChange={(event) => setResearchContext({ ...researchContext, topic: event.target.value })}
                />
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label={t.aiSettingsResearchRequirements}
                  value={researchContext.requirements}
                  onChange={(event) => setResearchContext({ ...researchContext, requirements: event.target.value })}
                />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t.aiSettingsScenario}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {[...predefinedScenarios, ...researchContext.customScenarios].map((scenario) => (
                      <Chip
                        key={scenario}
                        label={scenario}
                        size="small"
                        clickable
                        onClick={() => setResearchContext({ ...researchContext, scenario })}
                        color={researchContext.scenario === scenario ? 'primary' : 'default'}
                        variant={researchContext.scenario === scenario ? 'filled' : 'outlined'}
                        onDelete={researchContext.customScenarios.includes(scenario)
                          ? () => removeScenario(scenario)
                          : undefined}
                      />
                    ))}
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder={t.aiSettingsCustomScenario}
                      value={newScenario}
                      onChange={(event) => setNewScenario(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onAddCustomScenario();
                        }
                      }}
                    />
                    <Button variant="outlined" onClick={onAddCustomScenario} disabled={!newScenario.trim()}>
                      {t.aiSettingsAdd}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          )}

          {section === 2 && (
            <Box sx={{ maxWidth: 680 }}>
              <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>{t.aiSettingsAdvancedTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                {t.aiSettingsAdvancedIntro}
              </Typography>

              <Box sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{t.featureAssistant}</Typography>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={assistantFlag}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setAssistantFlag(enabled);
                        setAssistantEnabled(enabled);
                        window.dispatchEvent(new Event('sp-feature-flags'));
                      }}
                    />
                  )}
                  label={<Typography variant="body2" color="text.secondary">{t.featureAssistantHint}</Typography>}
                />
                <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 1 }}>{t.featureSilicon}</Typography>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={siliconFlag}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setSiliconFlag(enabled);
                        setSiliconExperimentalEnabled(enabled);
                        window.dispatchEvent(new Event('sp-feature-flags'));
                      }}
                    />
                  )}
                  label={<Typography variant="body2" color="text.secondary">{t.featureSiliconHint}</Typography>}
                />
              </Box>

              <Box sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2">{t.aiSettingsMultiAgent}</Typography>
                  <Chip size="small" variant="outlined" label={t.aiSettingsExperimental} />
                </Stack>
                {isPlatformMode ? (
                  <Typography variant="body2" color="text.secondary">
                    {t.aiSettingsMultiAgentUnavailable}
                  </Typography>
                ) : (
                  <>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={multiAgentReviewEnabled}
                          onChange={(event) => onMultiAgentReviewToggle?.(event.target.checked)}
                        />
                      )}
                      label={t.aiSettingsMultiAgentToggle}
                    />
                    {multiAgentReviewEnabled && (
                      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button
                            fullWidth
                            size="small"
                            variant={reviewMode === '1v1' ? 'contained' : 'outlined'}
                            onClick={() => onReviewModeChange?.('1v1')}
                          >
                            {t.aiSettingsIndependentReview}
                          </Button>
                          <Button
                            fullWidth
                            size="small"
                            variant={reviewMode === 'group' ? 'contained' : 'outlined'}
                            onClick={() => onReviewModeChange?.('group')}
                          >
                            {t.aiSettingsGroupReview}
                          </Button>
                        </Stack>
                        <TextField
                          size="small"
                          type="number"
                          label={t.aiSettingsReviewRounds}
                          value={maxReviewRounds}
                          inputProps={{ min: 1, max: 10 }}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (value >= 1 && value <= 10) onMaxReviewRoundsChange?.(value);
                          }}
                        />
                        <Accordion disableGutters elevation={0} sx={{ '&::before': { display: 'none' } }}>
                          <AccordionSummary expandIcon={<ExpandMore />}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.aiSettingsEditAgents}</Typography>
                          </AccordionSummary>
                          <AccordionDetails sx={{ px: 0 }}>
                            <AgentsEditor currentProject={currentProject} />
                          </AccordionDetails>
                        </Accordion>
                      </Stack>
                    )}
                  </>
                )}
              </Box>

              {!isPlatformMode && (
                <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', mb: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 2 }}>
                    <Box>
                      <Typography variant="subtitle2">{t.aiSettingsPrompts}</Typography>
                      <Typography variant="caption" color="text.secondary">{t.aiSettingsPromptsHint}</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 2 }}>
                    <Stack spacing={1.5}>
                      {[
                        ['generate', t.aiSettingsPromptGenerate],
                        ['adjust', t.aiSettingsPromptAdjust],
                        ['intentDetection', t.aiSettingsPromptIntent],
                        ['question', t.aiSettingsPromptQuestion],
                      ].map(([key, label]) => (
                        <TextField
                          key={key}
                          fullWidth
                          multiline
                          minRows={4}
                          maxRows={10}
                          label={label}
                          value={prompts[key]}
                          onChange={(event) => onPromptChange(key, event.target.value)}
                          inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.78rem' } }}
                        />
                      ))}
                      <Stack direction="row" justifyContent="flex-end" spacing={1}>
                        <Button size="small" startIcon={<RestartAlt />} onClick={onResetPrompts}>
                          {t.aiSettingsReset}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Save />}
                          onClick={onSavePrompts}
                          disabled={!promptsModified}
                        >
                          {t.aiSettingsSave}
                        </Button>
                      </Stack>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )}

              <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                <Typography variant="subtitle2">{t.aiSettingsConversationData}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 1.25 }}>
                  {t.aiSettingsConversationDataHint}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<Download />} onClick={onDownloadHistory}>
                    {t.aiSidebarDownload}
                  </Button>
                  <Button size="small" color="error" startIcon={<RestartAlt />} onClick={onClearHistory}>
                    {t.aiSidebarClear}
                  </Button>
                </Stack>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
