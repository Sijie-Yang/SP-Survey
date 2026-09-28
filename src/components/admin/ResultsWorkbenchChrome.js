import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import FilterList from '@mui/icons-material/FilterList';
import AutoAwesome from '@mui/icons-material/AutoAwesome';

export function ResultsScopeChips({ scope, counts, t, tf }) {
  const sourceLabel = scope.dataSource === 'silicon'
    ? t.resultsSourceSilicon
    : scope.dataSource === 'practice'
      ? t.resultsSourcePractice
      : t.resultsSourceHuman;
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ alignItems: 'center' }}>
      <Chip size="small" label={`${t.resultsScopeNow}: ${sourceLabel}`} />
      {scope.surveyRevision && <Chip size="small" variant="outlined" label={`${t.resultsRevision}: ${scope.surveyRevision === 'historical_unknown' ? t.resultsHistoricalRevision : String(scope.surveyRevision).slice(-12)}`} />}
      {(scope.dateFrom || scope.dateTo) && (
        <Chip size="small" variant="outlined" label={`${scope.dateFrom || '…'} – ${scope.dateTo || '…'}`} />
      )}
      {scope.includePractice && scope.dataSource !== 'practice' && <Chip size="small" variant="outlined" label="practice" />}
      {scope.excludeFlagged && <Chip size="small" variant="outlined" label={t.resultsExcludeFlagged} />}
      {counts && (
        <Typography variant="caption" color="text.secondary">
          {tf(t.resultsScopeHint, { shown: counts.nIncluded ?? counts.nResponses ?? 0, total: counts.nLoaded ?? 0 })}
        </Typography>
      )}
    </Stack>
  );
}

export function ResultsFilterForm({
  t,
  tf,
  dateFrom,
  dateTo,
  timezone,
  sessionFilter,
  sessionOptions,
  revisionFilter,
  revisionOptions,
  includePractice,
  excludeFlagged,
  practiceCount,
  dataSource,
  siliconRunId,
  onChange,
}) {
  return (
    <Stack spacing={2} sx={{ mt: 1 }}>
      <TextField
        select
        label={t.resultsDataSource}
        size="small"
        value={dataSource}
        onChange={(e) => onChange({ dataSource: e.target.value })}
        SelectProps={{ native: true }}
      >
        <option value="human">{t.resultsSourceHuman}</option>
        <option value="practice">{t.resultsSourcePractice}</option>
        <option value="silicon">{t.resultsSourceSilicon}</option>
      </TextField>
      {dataSource === 'silicon' && (
        <TextField
          size="small"
          label={t.resultsSiliconRun}
          value={siliconRunId}
          onChange={(e) => onChange({ siliconRunId: e.target.value })}
        />
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField type="date" label="From" size="small" InputLabelProps={{ shrink: true }} value={dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value })} />
        <TextField type="date" label="To" size="small" InputLabelProps={{ shrink: true }} value={dateTo} onChange={(e) => onChange({ dateTo: e.target.value })} />
      </Stack>
      <Typography variant="caption" color="text.secondary">{tf(t.resultsDateTimezone, { tz: timezone })}</Typography>
      {sessionOptions.length > 0 && (
        <TextField select size="small" label={t.resultsDetailSession} value={sessionFilter} onChange={(e) => onChange({ sessionFilter: e.target.value })} SelectProps={{ native: true }}>
          <option value="">All sessions</option>
          {sessionOptions.map((sid) => <option key={sid} value={sid}>{sid.slice(-8)}</option>)}
        </TextField>
      )}
      {revisionOptions.some((id) => id !== 'historical_unknown') && (
        <TextField select size="small" label={t.resultsRevision} value={revisionFilter} onChange={(e) => onChange({ revisionFilter: e.target.value })} SelectProps={{ native: true }}>
          {revisionOptions.length <= 1 && <option value="">{t.resultsAllRevisions}</option>}
          {revisionOptions.map((id) => <option key={id} value={id}>{id === 'historical_unknown' ? t.resultsHistoricalRevision : id.slice(-12)}</option>)}
        </TextField>
      )}
      <FormControlLabel
        control={<Switch size="small" checked={includePractice} onChange={(e) => onChange({ includePractice: e.target.checked })} />}
        label={practiceCount > 0 ? `Include researcher practice (${practiceCount})` : 'Include researcher practice'}
      />
      <FormControlLabel
        control={<Switch size="small" checked={excludeFlagged} onChange={(e) => onChange({ excludeFlagged: e.target.checked })} />}
        label={t.resultsExcludeFlagged}
      />
      <Typography variant="caption" color="text.secondary">{t.resultsQualityIsInfo}</Typography>
      <Typography variant="caption" color="text.secondary">{t.resultsFormalHuman}</Typography>
    </Stack>
  );
}

export function ResultsToolbar({
  t,
  onOpenFilters,
  onAnalyze,
  analyzeDisabled,
  analyzeBusy,
  exportItems,
}) {
  const [anchor, setAnchor] = React.useState(null);
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <Button size="small" variant="outlined" startIcon={<FilterList />} onClick={onOpenFilters}>{t.resultsFilters}</Button>
      <Button size="small" variant="contained" startIcon={<AutoAwesome />} disabled={analyzeDisabled} onClick={onAnalyze}>
        {analyzeBusy ? t.resultsPreparingExport : t.resultsAnalyze}
      </Button>
      <Button size="small" variant="outlined" onClick={(e) => setAnchor(e.currentTarget)}>{t.resultsExportMenu}</Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {exportItems.map((item) => (
          <MenuItem key={item.id} disabled={item.disabled} onClick={() => { setAnchor(null); item.onClick(); }}>
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}

export function ResultsViewTabs({ t, value, onChange }) {
  return (
    <Tabs
      value={value}
      onChange={(_, next) => onChange(next)}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ mb: 2 }}
    >
      <Tab value="overview" label={t.resultsViewOverview} />
      <Tab value="questions" label={t.resultsViewQuestions} />
      <Tab value="data" label={t.resultsViewData} />
    </Tabs>
  );
}

export function ResultsReportCard({ t, report, staleness, onViewEvidence, onUpdate }) {
  if (!report) {
    return <Alert severity="info">{t.resultsNoReport}</Alert>;
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{t.resultsLatestReport}</Typography>
      {staleness?.stale && (
        <Alert severity="warning" sx={{ mb: 1 }} action={onUpdate ? <Button color="inherit" size="small" onClick={onUpdate}>{t.resultsAnalyze}</Button> : null}>
          {staleness.reason === 'scope_changed' ? t.resultsReportStaleScope : t.resultsReportStaleData}
        </Alert>
      )}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {report.savedAt} · {report.provider || ''} {report.model || ''} · {report.algorithmVersion}
      </Typography>
      {report.narrative && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>{report.narrative}</Typography>}
      {(report.findings || []).map((finding) => (
        <Box key={finding.id} sx={{ mb: 1 }}>
          <Typography variant="body2">{finding.text}</Typography>
          {onViewEvidence && (
            <Button size="small" onClick={() => onViewEvidence(finding)}>{t.resultsViewEvidence}</Button>
          )}
        </Box>
      ))}
    </Paper>
  );
}

export function ResultsFilterShell({ open, onClose, t, children, onReset }) {
  const mobile = useMediaQuery('(max-width:600px)');
  if (mobile) {
    return (
      <Drawer anchor="bottom" open={open} onClose={onClose}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6">{t.resultsFilters}</Typography>
          {children}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button onClick={onReset}>{t.resultsResetFilters}</Button>
            <Button variant="contained" onClick={onClose}>{t.resultsApplyFilters}</Button>
          </Stack>
        </Box>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t.resultsFilters}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onReset}>{t.resultsResetFilters}</Button>
        <Button variant="contained" onClick={onClose}>{t.resultsApplyFilters}</Button>
      </DialogActions>
    </Dialog>
  );
}
