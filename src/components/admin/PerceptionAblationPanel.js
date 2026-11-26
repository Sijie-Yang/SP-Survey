import { useWorkflowText } from '../../contexts/workflowI18n';
import { downloadPerceptionFile, materializePerceptionRows } from '../../lib/imagePerceptionJoin';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, FormControlLabel, Checkbox, FormGroup,
  TextField, LinearProgress, Alert, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Collapse,
} from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';
import {
  ABLATION_MODELS, buildAblationMatrix, runPerceptionAblation, isAbortError, diagnoseFit,
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

function diagnosisChip(diagnosis, tx) {
  if (diagnosis === tx("overfit")) {
    return <Chip size="small" color="warning" label={tx("overfit")} sx={{ ml: 0.5, height: 20 }} />;
  }
  if (diagnosis === 'weak_fit') {
    return <Chip size="small" color="default" label={tx("weak fit")} sx={{ ml: 0.5, height: 20 }} />;
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
  const tx = useWorkflowText();
  const [selectedModels, setSelectedModels] = useState(() => (
    ABLATION_MODELS.map((m) => m.id)
  ));
  const [vifMax, setVifMax] = useState(10);
  const [testFraction, setTestFraction] = useState(0.25);
  const [folds, setFolds] = useState(1);
  const [groupByFolder, setGroupByFolder] = useState(false);
  const [imputeMissing, setImputeMissing] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showVif, setShowVif] = useState(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);
  useEffect(() => {
    runIdRef.current += 1; abortRef.current?.abort();
    setResult(null); setError(null); setRunning(false); setProgress(null);
    return () => { abortRef.current?.abort(); };
  }, [rows, modelFilter]);

  const scoredN = useMemo(
    () => (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0).length,
    [rows],
  );
  const usableN = useMemo(() => buildAblationMatrix(rows, modelFilter, {
    impute: false, deferImpute: imputeMissing,
  }).n, [rows, modelFilter, imputeMissing]);

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
      setError(tx("Select at least one model."));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setError(null);
    setProgress({ message: tx("Starting…"), pct: 0 });
    setResult(null);
    try {
      const out = await runPerceptionAblation({
        rows: (rows || []).map((r) => ({ ...r })),
        modelFilter,
        models: [...selectedModels],
        vifMax: Number(vifMax) || 10,
        testFraction: Math.min(0.5, Math.max(0.1, Number(testFraction) || 0.25)),
        folds: Math.max(1, Math.min(10, Math.floor(Number(folds) || 1))),
        imputeMissing, groupByFolder,
        signal: controller.signal,
        onProgress: (p) => {
          if (runIdRef.current !== runId) return;
          setProgress({ message: p.message, pct: p.pct, phase: p.phase, model: p.model });
        },
      });
      if (runIdRef.current === runId && !controller.signal.aborted) {
        setResult({ ...out, input_rows: materializePerceptionRows(rows, modelFilter), model_filter: modelFilter, score_label: scoreLabel, requested_models: [...selectedModels] });
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (isAbortError(err)) {
        setError(tx("Stopped."));
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
      <FormControlLabel control={<Checkbox checked={groupByFolder} disabled={running} onChange={(e) => { setGroupByFolder(e.target.checked); setResult(null); }} />} label={tx("Keep each folder in one validation split")} />
      {groupByFolder && <Alert severity="info" sx={{ mb: 1 }}>{' '}{tx("Use folders only when they represent independent scenes or locations. With one holdout, folders are balanced into two groups; the test fraction is ignored. At least two folders are required.")}{' '}</Alert>}
      {result && <Button size="small" onClick={() => downloadPerceptionFile(JSON.stringify({ format: 'sp_perception_model_run_v1', exported_at: new Date().toISOString(), ...result }, null, 2), `perception_models_${Date.now()}.json`)}>{' '}{tx("Export model run + split IDs")}{' '}</Button>}
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{' '}{tx("Multi-model ablation")}{' '}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{' '}{tx("VIF screen → predict")}{' '}{scoreLabel}{' '}{tx("(regression). Metrics are")}{' '}<strong>R² / RMSE / MAE</strong>
        {' '}{' '}{tx("— not classification accuracy. MLP = multilayer perceptron (neural net),")}{' '}<strong>{' '}{tx("not NLP")}{' '}</strong>{' '}{tx(". Small n often favors Ridge / Lasso / RF over MLP. Uses Features filter (")}{' '}{tx({ all: 'All models', l0: 'Basic image features', seg: 'Semantic segmentation features', sam: 'Researcher annotation features' }[modelFilter])}).
      </Typography>
      {scoredN > 0 && usableN < 50 && (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
          {usableN}{' '}{tx("of")}{' '}{scoredN}{' '}{tx("scored images have usable features. At least 12 are needed to run models.")}{' '}{' '}{' '}{tx("Entirely missing feature rows are excluded; imputation only fills partial observations.")}{' '}</Alert>
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
              <Typography variant="body2">{tx(m.label)}</Typography>
            )}
          />
        ))}
      </FormGroup>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
        <TextField
          size="small"
          label={tx("Max VIF")}
          type="number"
          value={vifMax}
          onChange={(e) => setVifMax(e.target.value)}
          disabled={running}
          helperText={tx("Drop collinear features above this VIF")}
          FormHelperTextProps={{ sx: { mx: 0, mt: 0.5, lineHeight: 1.3 } }}
          inputProps={{ min: 2, max: 50, step: 0.5 }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          label={tx("Test holdout")}
          type="number"
          value={testFraction}
          onChange={(e) => setTestFraction(e.target.value)}
          disabled={running || Number(folds) > 1}
          helperText={
            Number(folds) > 1
              ? tx("Ignored when K-fold > 1")
              : tx("Fraction held out once for Test R²")
          }
          FormHelperTextProps={{ sx: { mx: 0, mt: 0.5, lineHeight: 1.3 } }}
          inputProps={{ min: 0.1, max: 0.5, step: 0.05 }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          label={tx("K-fold")}
          type="number"
          value={folds}
          onChange={(e) => setFolds(e.target.value)}
          disabled={running}
          helperText={tx("1 = single split; ≥2 = mean±std R²")}
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
          label={<Typography variant="body2">{' '}{tx("Median impute missing features")}{' '}</Typography>}
        />
        <Chip size="small" label={`${tx("Usable rows")}: ${usableN} / ${scoredN}`} sx={{ mt: 1 }} />
        <Box sx={{ flex: 1 }} />
        {!running ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrow />}
            onClick={handleRun}
            disabled={disabled || usableN < 12 || !selectedModels.length}
            sx={{ mt: 0.5 }}
          >{' '}{tx("Run ablation")}{' '}</Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<Stop />}
            onClick={handleStop}
            sx={{ mt: 0.5 }}
          >{' '}{tx("Stop")}{' '}</Button>
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
            {progress?.message || tx("Running…")}
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity={error === tx("Stopped.") ? 'warning' : 'error'} sx={{ mb: 1.5 }}>
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
            <Alert severity="warning" sx={{ mb: 1.5, py: 0.5 }}>{' '}{tx("Test n=")}{' '}{result.nTest}{' '}{tx("is small — Test R² is noisy. Try K-fold ≥ 5 for mean±std.")}{' '}</Alert>
          )}
          <Typography variant="body2" sx={{ mb: 1 }}>{' '}{tx("Used")}{' '}<strong>{result.nFeaturesOut}</strong> / {result.nFeaturesIn}{' '}{tx("features across training folds. Imputation, VIF and scaling are fitted separately on each training fold.")}{' '}{' '}n={result.n}
            {result.foldsUsed > 1
              ? ` · ${result.foldsUsed}-fold CV (≈${result.nTrain} train / ${result.nTest} test per fold)`
              : ` · Train n=${result.nTrain}, test n=${result.nTest}`}
            {result.imputeMissing
              ? ` · imputed ${result.imputedCells || 0} missing cell(s) across folds`
              : null}
            {result.droppedIncomplete
              ? ` · dropped ${result.droppedIncomplete} incomplete row(s)`
              : null}
            .
            {' '}
            <Button size="small" onClick={() => setShowVif((v) => !v)}>
              {showVif ? tx('Hide VIF') : tx('Show VIF')}
            </Button>
          </Typography>

          <Collapse in={showVif}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {!!result.vifDropped?.length && (
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="caption" color="text.secondary">{' '}{tx("Dropped (high VIF)")}{' '}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {result.vifDropped.map((d) => (
                      <Chip
                        key={`${d.fold}-${d.feature}`}
                        size="small"
                        label={`${tx("Fold")} ${d.fold}: ${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="caption" color="text.secondary">{' '}{tx("Kept VIF")}{' '}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {(result.vifKept || []).slice(0, 24).map((d) => (
                    <Chip
                      key={`${d.fold}-${d.feature}`}
                      size="small"
                      label={`${tx("Fold")} ${d.fold}: ${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
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
                  <TableCell>{' '}{tx("Model")}{' '}</TableCell>
                  <TableCell align="right">{' '}{tx("Test R²")}{' '}{result.foldsUsed > 1 ? ' (mean±std)' : ''}
                  </TableCell>
                  <TableCell align="right">{' '}{tx("Test RMSE")}{' '}</TableCell>
                  <TableCell align="right">{' '}{tx("Test MAE")}{' '}</TableCell>
                  <TableCell align="right">{' '}{tx("Train R²")}{' '}</TableCell>
                  <TableCell>{' '}{tx("Fit")}{' '}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.results.map((r) => {
                  const diagnosis = r.diagnosis || diagnoseFit(r.train, r.test);
                  return (
                    <TableRow key={r.model}>
                      <TableCell>
                        {tx(r.label)}
                        {r.note ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {tx(r.note)}
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
                      <TableCell>{diagnosisChip(diagnosis, tx)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {result.results.map((r) => (
            <ImportanceBarChart
              key={`imp-${r.model}`}
              title={`${tx(r.label)} — ${tx("top features")}`}
              caption={tx("Relative importance (normalized to the strongest feature in this model).")}
              items={r.importance || []}
              maxItems={12}
            />
          ))}
        </Box>
      )}
    </Paper>
  );
}
