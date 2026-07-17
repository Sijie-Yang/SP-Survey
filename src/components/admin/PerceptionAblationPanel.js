import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, FormControlLabel, Checkbox, FormGroup,
  TextField, LinearProgress, Alert, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Collapse,
} from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';
import {
  ABLATION_MODELS, runPerceptionAblation, isAbortError, diagnoseFit,
} from '../../lib/perceptionAblation';
import { ImportanceBarChart } from './analysisCharts';

function formatR2(m) {
  if (!Number.isFinite(m?.r2)) return '—';
  const base = m.r2.toFixed(3);
  if (Number.isFinite(m.r2_std) && m.r2_std > 1e-6) {
    return `${base} ± ${m.r2_std.toFixed(3)}`;
  }
  return base;
}

function diagnosisChip(diagnosis) {
  if (diagnosis === 'overfit') {
    return <Chip size="small" color="warning" label="overfit" sx={{ ml: 0.5, height: 20 }} />;
  }
  if (diagnosis === 'weak_fit') {
    return <Chip size="small" color="default" label="weak fit" sx={{ ml: 0.5, height: 20 }} />;
  }
  return null;
}

/**
 * Multi-model ablation under Image × Perception (VIF + linear / RF / GBM / MLP).
 * Runs only on explicit Run; AbortController for Stop.
 */
export default function PerceptionAblationPanel({
  rows,
  modelFilter = 'all',
  scoreLabel = 'Score',
  disabled = false,
}) {
  const [selectedModels, setSelectedModels] = useState(() => (
    ABLATION_MODELS.map((m) => m.id)
  ));
  const [vifMax, setVifMax] = useState(10);
  const [testFraction, setTestFraction] = useState(0.25);
  const [folds, setFolds] = useState(1);
  const [imputeMissing, setImputeMissing] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showVif, setShowVif] = useState(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);

  const scoredN = useMemo(
    () => (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0).length,
    [rows],
  );

  const toggleModel = (id) => {
    setSelectedModels((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRun = async () => {
    if (running) return;
    if (!selectedModels.length) {
      setError('Select at least one model.');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setError(null);
    setProgress({ message: 'Starting…', pct: 0 });
    setResult(null);
    try {
      const out = await runPerceptionAblation({
        rows: (rows || []).map((r) => ({ ...r })),
        modelFilter,
        models: [...selectedModels],
        vifMax: Number(vifMax) || 10,
        testFraction: Math.min(0.5, Math.max(0.1, Number(testFraction) || 0.25)),
        folds: Math.max(1, Math.min(10, Math.floor(Number(folds) || 1))),
        imputeMissing,
        signal: controller.signal,
        onProgress: (p) => {
          if (runIdRef.current !== runId) return;
          setProgress({ message: p.message, pct: p.pct, phase: p.phase, model: p.model });
        },
      });
      if (runIdRef.current === runId && !controller.signal.aborted) {
        setResult(out);
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (isAbortError(err)) {
        setError('Stopped.');
        setProgress(null);
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Multi-model ablation
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        VIF screen → predict {scoreLabel} (regression). Metrics are <strong>R² / RMSE / MAE</strong>
        {' '}— not classification accuracy. MLP = multilayer perceptron (neural net), <strong>not NLP</strong>.
        Small n often favors Ridge / Lasso / RF over MLP. Uses Features filter ({modelFilter}).
      </Typography>
      {scoredN > 0 && scoredN < 50 && (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
          Only {scoredN} scored images — prefer Ridge / Lasso / RF; treat MLP as exploratory.
        </Alert>
      )}

      <FormGroup row sx={{ mb: 1.5, gap: 0.5 }}>
        {ABLATION_MODELS.map((m) => (
          <FormControlLabel
            key={m.id}
            control={(
              <Checkbox
                size="small"
                checked={selectedModels.includes(m.id)}
                onChange={() => toggleModel(m.id)}
                disabled={running}
              />
            )}
            label={(
              <Typography variant="body2">{m.label}</Typography>
            )}
          />
        ))}
      </FormGroup>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
        <TextField
          size="small"
          label="Max VIF"
          type="number"
          value={vifMax}
          onChange={(e) => setVifMax(e.target.value)}
          disabled={running}
          helperText="Drop collinear features above this VIF"
          FormHelperTextProps={{ sx: { mx: 0, mt: 0.5, lineHeight: 1.3 } }}
          inputProps={{ min: 2, max: 50, step: 0.5 }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          label="Test holdout"
          type="number"
          value={testFraction}
          onChange={(e) => setTestFraction(e.target.value)}
          disabled={running || Number(folds) > 1}
          helperText={
            Number(folds) > 1
              ? 'Ignored when K-fold > 1'
              : 'Fraction held out once for Test R²'
          }
          FormHelperTextProps={{ sx: { mx: 0, mt: 0.5, lineHeight: 1.3 } }}
          inputProps={{ min: 0.1, max: 0.5, step: 0.05 }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          label="K-fold"
          type="number"
          value={folds}
          onChange={(e) => setFolds(e.target.value)}
          disabled={running}
          helperText="1 = single split; ≥2 = mean±std R²"
          FormHelperTextProps={{ sx: { mx: 0, mt: 0.5, lineHeight: 1.3 } }}
          inputProps={{ min: 1, max: 10, step: 1 }}
          sx={{ width: 160 }}
        />
        <FormControlLabel
          sx={{ mt: 0.5 }}
          control={(
            <Checkbox
              size="small"
              checked={imputeMissing}
              onChange={(e) => setImputeMissing(e.target.checked)}
              disabled={running}
            />
          )}
          label={<Typography variant="body2">Median impute missing features</Typography>}
        />
        <Chip size="small" label={`Scored rows: ${scoredN}`} sx={{ mt: 1 }} />
        <Box sx={{ flex: 1 }} />
        {!running ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrow />}
            onClick={handleRun}
            disabled={disabled || scoredN < 12 || !selectedModels.length}
            sx={{ mt: 0.5 }}
          >
            Run ablation
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<Stop />}
            onClick={handleStop}
            sx={{ mt: 0.5 }}
          >
            Stop
          </Button>
        )}
      </Box>

      {running && (
        <Box sx={{ mb: 1.5 }}>
          <LinearProgress
            variant={progress?.pct != null ? 'determinate' : 'indeterminate'}
            value={progress?.pct ?? 0}
            sx={{ mb: 0.5 }}
          />
          <Typography variant="caption" color="text.secondary">
            {progress?.message || 'Running…'}
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity={error === 'Stopped.' ? 'warning' : 'error'} sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {result && (
        <Box>
          {result.cvFallbackNote && (
            <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
              {result.cvFallbackNote}
            </Alert>
          )}
          {result.nTest < 15 && result.foldsUsed <= 1 && (
            <Alert severity="warning" sx={{ mb: 1.5, py: 0.5 }}>
              Test n={result.nTest} is small — Test R² is noisy. Try K-fold ≥ 5 for mean±std.
            </Alert>
          )}
          <Typography variant="body2" sx={{ mb: 1 }}>
            Kept <strong>{result.nFeaturesOut}</strong> / {result.nFeaturesIn} features after VIF
            (dropped {result.vifDropped?.length || 0}).
            {' '}n={result.n}
            {result.foldsUsed > 1
              ? ` · ${result.foldsUsed}-fold CV (≈${result.nTrain} train / ${result.nTest} test per fold)`
              : ` · Train n=${result.nTrain}, test n=${result.nTest}`}
            {result.imputeMissing
              ? ` · imputed ${result.imputedCells || 0} missing cell(s)`
              : null}
            {result.droppedIncomplete
              ? ` · dropped ${result.droppedIncomplete} incomplete row(s)`
              : null}
            .
            {' '}
            <Button size="small" onClick={() => setShowVif((v) => !v)}>
              {showVif ? 'Hide VIF' : 'Show VIF'}
            </Button>
          </Typography>

          <Collapse in={showVif}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {!!result.vifDropped?.length && (
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="caption" color="text.secondary">Dropped (high VIF)</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {result.vifDropped.map((d) => (
                      <Chip
                        key={d.feature}
                        size="small"
                        label={`${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="caption" color="text.secondary">Kept VIF</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {(result.vifKept || []).slice(0, 24).map((d) => (
                    <Chip
                      key={d.feature}
                      size="small"
                      label={`${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
                      color="success"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          </Collapse>

          <TableContainer sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">
                    Test R²
                    {result.foldsUsed > 1 ? ' (mean±std)' : ''}
                  </TableCell>
                  <TableCell align="right">Test RMSE</TableCell>
                  <TableCell align="right">Test MAE</TableCell>
                  <TableCell align="right">Train R²</TableCell>
                  <TableCell>Fit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.results.map((r) => {
                  const diagnosis = r.diagnosis || diagnoseFit(r.train, r.test);
                  return (
                    <TableRow key={r.model}>
                      <TableCell>
                        {r.label}
                        {r.note ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {r.note}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell align="right">{formatR2(r.test)}</TableCell>
                      <TableCell align="right">
                        {Number.isFinite(r.test?.rmse) ? r.test.rmse.toFixed(3) : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {Number.isFinite(r.test?.mae) ? r.test.mae.toFixed(3) : '—'}
                      </TableCell>
                      <TableCell align="right">{formatR2(r.train)}</TableCell>
                      <TableCell>{diagnosisChip(diagnosis)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {result.results.map((r) => (
            <ImportanceBarChart
              key={`imp-${r.model}`}
              title={`${r.label} — top features`}
              caption="Relative importance (normalized to the strongest feature in this model)."
              items={r.importance || []}
              maxItems={12}
            />
          ))}
        </Box>
      )}
    </Paper>
  );
}
