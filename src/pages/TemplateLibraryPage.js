import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment,
  Link, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { Search } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import AdminShell from '../components/layout/AdminShell';
import { createProject, setActiveProject } from '../lib/projectManager';
import {
  CATALOG_URL, STIMULUS_LABELS, TASK_LABELS, facetOptions, filterCatalog, locationLabel, paperCitation,
} from '../lib/templateCatalog';

const PAGE_SIZE = 50;

function FacetSelect({ label, value, options, labelOf, onChange }) {
  return (
    <TextField select size="small" label={label} value={value} onChange={(event) => onChange(event.target.value)} sx={{ minWidth: 170 }}>
      <MenuItem value="">All</MenuItem>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>{labelOf(option.value)} ({option.count})</MenuItem>
      ))}
    </TextField>
  );
}

/** Every template that ships in public/project_templates, with search, filters and "Use". */
export default function TemplateLibraryPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', stimulus: '', task: '', location: '' });
  const [shown, setShown] = useState(PAGE_SIZE);
  const [picked, setPicked] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(CATALOG_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (alive) setCatalog(data); })
      .catch((err) => { if (alive) setError(`The template list could not be loaded (${err.message}).`); });
    return () => { alive = false; };
  }, []);

  const templates = useMemo(() => catalog?.templates || [], [catalog]);
  const rows = useMemo(() => filterCatalog(templates, filters), [templates, filters]);
  const setFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setShown(PAGE_SIZE); };

  const openUse = (entry) => { setPicked(entry); setProjectName(entry.name); setCreateError(''); };

  const useTemplate = async () => {
    if (!picked || !projectName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`/project_templates/${encodeURIComponent(picked.id)}.json`);
      if (!res.ok) throw new Error('This template file is not in your copy yet. Run "node scripts/sync-templates.mjs" and try again.');
      const template = await res.json();
      if (!template.config) throw new Error('This template file has no survey in it.');
      const media = Array.isArray(template.preloadedImages) ? template.preloadedImages : [];
      const result = await createProject({
        name: projectName.trim(),
        description: `Based on ${template.name}`,
        templateId: template.id,
        surveyConfig: template.config,
        preloadedImages: media,
        preloadedAt: template.preloadedAt || (media.length ? new Date().toISOString() : null),
        preloadedSource: template.preloadedSource || (media.length ? 'template' : null),
      });
      if (!result.success) throw new Error(result.error || 'The project could not be created.');
      setActiveProject(result.project.id);
      navigate('/admin');
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AdminShell
      title="Template Library"
      subtitle={catalog ? `${templates.length} ready-to-run studies · snapshot of ${catalog.snapshot}` : 'Ready-to-run studies'}
      backTo="/admin"
      maxWidth="lg"
    >
      {error && <Alert severity="error">{error}</Alert>}
      {!catalog && !error && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}
      {catalog && (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              size="small" fullWidth placeholder="Search study, author, journal, city or concept"
              value={filters.q} onChange={(event) => setFilter('q', event.target.value)}
              inputProps={{ 'aria-label': 'Search templates' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            />
            <FacetSelect label="Stimulus" value={filters.stimulus} options={facetOptions(templates, 'stimulus')} labelOf={(v) => STIMULUS_LABELS[v] || v} onChange={(v) => setFilter('stimulus', v)} />
            <FacetSelect label="Task" value={filters.task} options={facetOptions(templates, 'task')} labelOf={(v) => TASK_LABELS[v] || v} onChange={(v) => setFilter('task', v)} />
            <FacetSelect label="Location" value={filters.location} options={facetOptions(templates, 'location')} labelOf={locationLabel} onChange={(v) => setFilter('location', v)} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {rows.length} of {templates.length} templates. Want yours here?{' '}
            <Link href="https://github.com/Sijie-Yang/SP-Survey#add-your-study" target="_blank" rel="noopener noreferrer">Add your study</Link>.
          </Typography>
          <Paper variant="outlined">
            {rows.slice(0, shown).map((entry, index) => (
              <Stack
                key={entry.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}
                sx={{ px: 2, py: 1.25, borderTop: index ? '1px solid' : 'none', borderColor: 'divider' }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{entry.paper?.title || entry.name}</Typography>
                  {(entry.paper || entry.contributor) && (
                    <Typography variant="body2" color="text.secondary">
                      {entry.paper && <Link href={entry.paper.url} target="_blank" rel="noopener noreferrer">{paperCitation(entry.paper)}</Link>}
                      {entry.paper && entry.contributor ? ' · ' : ''}
                      {entry.contributor ? `contributed by @${entry.contributor}` : ''}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                    {(entry.stimulus || []).map((v) => <Chip key={`s-${v}`} size="small" label={STIMULUS_LABELS[v] || v} />)}
                    {(entry.task || []).map((v) => <Chip key={`t-${v}`} size="small" variant="outlined" label={TASK_LABELS[v] || v} />)}
                    {[...(entry.city || []), ...(entry.location || []).map(locationLabel)].slice(0, 3).map((v) => (
                      <Chip key={`p-${v}`} size="small" variant="outlined" label={v} />
                    ))}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                  <Button size="small" href={`https://sp-survey.org/templates?q=${encodeURIComponent(entry.id)}`} target="_blank" rel="noopener noreferrer">
                    Preview online
                  </Button>
                  <Button size="small" variant="contained" onClick={() => openUse(entry)}>Use</Button>
                </Stack>
              </Stack>
            ))}
            {!rows.length && <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>No template matches. Clear a filter or shorten the search.</Typography>}
          </Paper>
          {rows.length > shown && (
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Button onClick={() => setShown(shown + PAGE_SIZE)}>Show more ({rows.length - shown} left)</Button>
            </Box>
          )}
        </>
      )}
      <Dialog open={!!picked} onClose={() => !creating && setPicked(null)} fullWidth maxWidth="sm">
        <DialogTitle>Start a project from this template</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You get a copy of the survey that you can edit freely. Its images load from the online library; replace them with your own before you collect data.
          </Typography>
          <TextField autoFocus fullWidth label="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          {createError && <Alert severity="error" sx={{ mt: 2 }}>{createError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPicked(null)} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={useTemplate} disabled={creating || !projectName.trim()}>
            {creating ? 'Creating…' : 'Create project'}
          </Button>
        </DialogActions>
      </Dialog>
    </AdminShell>
  );
}
