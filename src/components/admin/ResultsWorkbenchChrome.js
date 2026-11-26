import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hasReportContent } from '../../lib/resultsReportStore';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { AdminActionBar, AdminActionButton } from './AdminPageLayout';
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
import Download from '@mui/icons-material/Download';
import ExpandMore from '@mui/icons-material/ExpandMore';

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

/** Filters, export and the AI analysis button (only when `onAnalyze` is given). */
export function ResultsToolbar({
  t,
  onOpenFilters,
  onAnalyze,
  analyzeDisabled,
  analyzeBusy,
  exportItems,
  exportHelp,
  refreshAction,
  citeAction = null,
}) {
  const [anchor, setAnchor] = React.useState(null);
  return (
    <>
      <AdminActionBar
        label={t.resultsTitle}
        primaryAction={onAnalyze ? (
          <Button size="small" variant="contained" startIcon={<AutoAwesome />} disabled={analyzeDisabled} onClick={onAnalyze}>
            {analyzeBusy ? t.resultsPreparingExport : t.resultsAnalyze}
          </Button>
        ) : null}
      >
        <AdminActionButton startIcon={<FilterList />} onClick={onOpenFilters}>{t.resultsFilters}</AdminActionButton>
        <AdminActionButton id="results-export-button" startIcon={<Download />} endIcon={<ExpandMore />}
          aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? 'results-export-menu' : undefined}
          onClick={(e) => setAnchor(e.currentTarget)}>{t.resultsExportMenu}</AdminActionButton>
        {citeAction}
        {refreshAction}
      </AdminActionBar>
      <Menu id="results-export-menu" anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} MenuListProps={{ 'aria-labelledby': 'results-export-button' }}>
        <Box component="li" role="presentation" sx={{ px: 2, py: 1, maxWidth: 300 }}>
          <Typography variant="caption" color="text.secondary">{exportHelp || t.resultsExportHelp}</Typography>
        </Box>
        {exportItems.map((item) => (
          <MenuItem key={item.id} disabled={item.disabled} onClick={() => { setAnchor(null); item.onClick(); }}>
            <Download fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />{item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function ResultsViewTabs({ t, value, onChange }) {
  return (
    <Tabs
      value={value}
      onChange={(_, next) => onChange(next)}
      variant="scrollable"
      allowScrollButtonsMobile
      aria-label={t.resultsViews}
    >
      <Tab value="overview" label={t.resultsViewOverview} />
      <Tab value="questions" label={t.resultsViewQuestions} />
      <Tab value="records" label={t.resultsResponseRecords} />
      <Tab value="quality" label={t.resultsDataQuality} />
    </Tabs>
  );
}

export function ResultsReportCard({ t, report, staleness, onViewEvidence, onUpdate, updateDisabled, onDelete }) {
  const [viewOpen, setViewOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  if (!report) return null;
  const hasContent = hasReportContent(report);
  const incomplete = !hasContent || (report.status && report.status !== 'completed');
  const title = incomplete ? t.resultsIncompleteReport : t.resultsLatestReport;
  const findings = Array.isArray(report.findings) ? report.findings.filter((finding) => typeof finding?.text === 'string') : [];
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <AdminActionButton startIcon={<VisibilityOutlined />} onClick={() => setViewOpen(true)}>{t.resultsViewReport}</AdminActionButton>
          {onDelete && <AdminActionButton startIcon={<DeleteOutline />} onClick={() => setDeleteOpen(true)}>{t.resultsDeleteReport}</AdminActionButton>}
        </Stack>
      </Stack>
      {incomplete && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t.resultsReportIncompleteHelp}</Typography>}
      {staleness?.stale && !incomplete && (
        <Alert severity="warning" sx={{ mt: 1 }} action={onUpdate ? <Button color="inherit" size="small" disabled={updateDisabled} onClick={onUpdate}>{t.resultsAnalyze}</Button> : null}>
          {staleness.reason === 'scope_changed' ? t.resultsReportStaleScope : t.resultsReportStaleData}
        </Alert>
      )}
      <Dialog open={viewOpen} onClose={() => setViewOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers>
          {incomplete && <Alert severity="warning" sx={{ mb: 2 }}>{t.resultsReportIncompleteHelp}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {[report.savedAt, report.provider, report.model].filter(Boolean).join(' · ')}
          </Typography>
          {typeof report.narrative === 'string' && report.narrative.trim() && (
            <Box sx={{ overflowWrap: 'anywhere', '& pre': { overflowX: 'auto' }, '& table': { display: 'block', overflowX: 'auto' } }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.narrative}</ReactMarkdown>
            </Box>
          )}
          {findings.map((finding, index) => (
            <Box key={finding.id || index} sx={{ mb: 1 }}>
              <Typography variant="body2">{finding.text}</Typography>
              {onViewEvidence && <Button size="small" onClick={() => { setViewOpen(false); onViewEvidence(finding); }}>{t.resultsViewEvidence}</Button>}
            </Box>
          ))}
        </DialogContent>
        <DialogActions><Button onClick={() => setViewOpen(false)}>{t.resultsClose}</Button></DialogActions>
      </Dialog>
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t.resultsDeleteReport}</DialogTitle>
        <DialogContent><Typography variant="body2">{t.resultsDeleteReportConfirm}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>{t.resultsCancel}</Button>
          <Button color="error" variant="contained" onClick={() => { setDeleteOpen(false); setViewOpen(false); onDelete?.(); }}>{t.resultsDeleteReport}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export function ResultsFilterShell({ open, onClose, t, children, onReset }) {
  const mobile = useMediaQuery('(max-width:600px)');
  if (mobile) {
    return (
      <Drawer anchor="bottom" open={open} onClose={onClose} slotProps={{ paper: { sx: { maxHeight: '90dvh', borderRadius: '16px 16px 0 0' } } }}>
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
