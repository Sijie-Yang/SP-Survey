import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionSummary, AccordionDetails, Box, Button, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Chip, Alert, FormControl, InputLabel, Select, MenuItem, CircularProgress,
  TableSortLabel,
} from '@mui/material';
import { ExpandMore, Download } from '@mui/icons-material';
import {
  buildImagePerceptionRows,
  correlateFeaturesWithPerception,
  exportImagePerceptionCsv,
  listPerceptionScoreQuestions,
  scoreKindLabel,
  featureKeyMatchesModelFilter,
  perceptionFeatureValue,
  L0_MODEL,
  SEG_MODEL,
  SAM_PREANNOT_MODEL,
} from '../../lib/imagePerceptionJoin';
import { loadFeaturesMapFromR2, FEATURE_MODELS } from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';
import { LOCAL_USER_ID } from '../../lib/appMode';
import { CorrelationBarChart, FeatureScoreScatterChart, ScoreExtremeGallery } from './analysisCharts';
import PerceptionAblationPanel from './PerceptionAblationPanel';

/**
 * Results: join image features with a selected image-question score
 * (and attribute when the question is multi-dimensional).
 */
export default function ImagePerceptionPanel({ currentProject, responses, questions }) {
  const user = { id: LOCAL_USER_ID };
  const [modelFilter, setModelFilter] = useState('all');
  const [questionName, setQuestionName] = useState('');
  const [attributeId, setAttributeId] = useState('');
  const [featureMap, setFeatureMap] = useState(null);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [orderBy, setOrderBy] = useState('mean_score');
  const [order, setOrder] = useState('desc');
  const [scatterFeature, setScatterFeature] = useState('');
  const [scatterFeatureManual, setScatterFeatureManual] = useState(false);

  const userId = user?.id || currentProject?.user_id || 'anonymous';
  const projectId = currentProject?.id;
  const r2Prefix = projectId ? `${userId}/${projectId}/` : '';

  const scoreQuestions = useMemo(
    () => listPerceptionScoreQuestions(questions, responses),
    [questions, responses],
  );

  const selectedMeta = scoreQuestions.find((q) => q.name === questionName) || null;
  const attributes = selectedMeta?.attributes || [];
  const needsAttribute = !!selectedMeta?.needsAttribute;

  useEffect(() => {
    if (questionName && !scoreQuestions.some((q) => q.name === questionName)) {
      setQuestionName('');
      setAttributeId('');
    }
  }, [scoreQuestions, questionName]);

  useEffect(() => {
    if (!needsAttribute) {
      setAttributeId('');
      return;
    }
    if (attributeId && !attributes.some((a) => a.id === attributeId)) {
      setAttributeId('');
    }
  }, [needsAttribute, attributes, attributeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!r2Prefix || !isR2Configured()) {
        setFeatureMap({});
        return;
      }
      setLoadingFeatures(true);
      try {
        const map = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
        if (!cancelled) setFeatureMap(map);
      } catch (err) {
        console.warn(err);
        if (!cancelled) setFeatureMap({});
      } finally {
        if (!cancelled) setLoadingFeatures(false);
      }
    })();
    return () => { cancelled = true; };
  }, [r2Prefix]);

  const selectionReady = !!questionName && (!needsAttribute || !!attributeId);

  const rows = useMemo(
    () => buildImagePerceptionRows(
      currentProject,
      responses,
      questions,
      featureMap || {},
      selectionReady ? questionName : null,
      selectionReady && needsAttribute ? attributeId : null,
    ),
    [currentProject, responses, questions, featureMap, selectionReady, questionName, needsAttribute, attributeId],
  );

  const filteredRows = useMemo(() => {
    if (modelFilter === 'l0') return rows.filter((r) => r.l0_status === 'ready');
    if (modelFilter === 'seg') return rows.filter((r) => r.seg_status === 'ready');
    if (modelFilter === 'sam') return rows.filter((r) => r.sam_status === 'ready');
    return rows;
  }, [rows, modelFilter]);

  const correlations = useMemo(() => {
    if (!selectionReady) return [];
    return correlateFeaturesWithPerception(filteredRows, modelFilter);
  }, [filteredRows, selectionReady, modelFilter]);

  const featureCols = useMemo(() => {
    const skip = new Set([
      'media_id', 'name', 'url', 'mean_score', 'n_ratings', 'question_name',
      'attribute_id', 'score_kind',
      'l0_status', 'seg_status', 'sam_status', 'seg_vocab',
    ]);
    const keys = new Set();
    filteredRows.forEach((r) => {
      Object.keys(r).forEach((k) => {
        if (skip.has(k)) return;
        if (!featureKeyMatchesModelFilter(k, modelFilter)) return;
        if (typeof r[k] === 'number') keys.add(k);
      });
    });
    const absR = Object.fromEntries(
      (correlations || []).map((c) => [c.feature, Math.abs(c.r) || 0]),
    );
    const modelRank = (k) => {
      if (k.startsWith('seg_')) return 1;
      if (k.startsWith('sam_')) return 2;
      return 0; // L0 / other numeric features
    };
    return [...keys].sort((a, b) => {
      // All / mixed views: keep L0 → Seg → SAM blocks, don't interleave by |r|.
      const mg = modelRank(a) - modelRank(b);
      if (mg !== 0) return mg;
      const d = (absR[b] || 0) - (absR[a] || 0);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }, [filteredRows, modelFilter, correlations]);

  // Scatter options follow correlation ranking (|r|), then any leftover numeric cols.
  const scatterFeatureOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (correlations || []).forEach((c) => {
      if (c?.feature && !seen.has(c.feature)) {
        seen.add(c.feature);
        out.push(c.feature);
      }
    });
    featureCols.forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    });
    return out;
  }, [correlations, featureCols]);

  // Default = strongest |r| (first correlation). Don't lock onto an early alphabetical
  // feature like aspect_ratio before correlations finish computing.
  const topCorrFeature = correlations[0]?.feature || '';

  useEffect(() => {
    setScatterFeatureManual(false);
  }, [questionName, attributeId, modelFilter]);

  useEffect(() => {
    if (!topCorrFeature) {
      if (!scatterFeatureManual) setScatterFeature('');
      return;
    }
    if (!scatterFeatureManual || !scatterFeatureOptions.includes(scatterFeature)) {
      setScatterFeature(topCorrFeature);
    }
  }, [topCorrFeature, scatterFeatureManual, scatterFeatureOptions, scatterFeature]);

  const scatterPoints = useMemo(() => {
    if (!scatterFeature) return [];
    return filteredRows
      .filter((r) => r.mean_score != null && r.n_ratings > 0)
      .map((r) => {
        const x = perceptionFeatureValue(r, scatterFeature);
        if (!Number.isFinite(x)) return null;
        return {
          x,
          y: r.mean_score,
          label: r.name || r.media_id,
          url: r.url,
        };
      })
      .filter(Boolean);
  }, [filteredRows, scatterFeature]);

  const scatterCorr = correlations.find((c) => c.feature === scatterFeature);

  const sortedRows = useMemo(() => {
    const dir = order === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = a[orderBy];
      const bv = b[orderBy];
      if (av == null && bv == null) {
        return String(a.name || a.media_id || '').localeCompare(String(b.name || b.media_id || ''));
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        if (av === bv) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
        return av < bv ? -dir : dir;
      }
      const cmp = String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }, [filteredRows, orderBy, order]);

  const handleSort = (col) => {
    if (orderBy === col) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setOrderBy(col);
    setOrder(col === 'name' || col === 'l0_status' || col === 'seg_status' || col === 'sam_status'
      ? 'asc'
      : 'desc');
  };

  const sortLabel = (col, label, align) => (
    <TableCell
      key={col}
      align={align}
      sortDirection={orderBy === col ? order : false}
    >
      <TableSortLabel
        active={orderBy === col}
        direction={orderBy === col ? order : 'asc'}
        onClick={() => handleSort(col)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const l0Count = rows.filter((r) => r.l0_status === 'ready').length;
  const segCount = rows.filter((r) => r.seg_status === 'ready').length;
  const samCount = rows.filter((r) => r.sam_status === 'ready').length;
  const scoredCount = rows.filter((r) => r.n_ratings > 0 && r.mean_score != null).length;

  const scoreLabel = selectedMeta
    ? scoreKindLabel(selectedMeta.type, needsAttribute ? attributeId : null)
    : 'Score';

  if (loadingFeatures || featureMap == null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">Loading feature CSVs from Supabase Storage…</Typography>
      </Box>
    );
  }

  if (!scoreQuestions.length) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        No image questions found for Image × Perception. Add image choice / rating / ranking /
        boolean / matrix / slider / point allocation / annotation questions, extract features,
        then return here.
      </Alert>
    );
  }

  return (
    <Accordion defaultExpanded sx={{ mb: 3 }}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Image × Perception
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Join {L0_MODEL} / {SEG_MODEL} / {SAM_PREANNOT_MODEL} with any image-question score
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel shrink id="img-perception-q-label">Image question</InputLabel>
            <Select
              labelId="img-perception-q-label"
              label="Image question"
              value={questionName}
              displayEmpty
              notched
              onChange={(e) => {
                setQuestionName(e.target.value);
                setAttributeId('');
              }}
            >
              <MenuItem value="">
                <em>Select an image question…</em>
              </MenuItem>
              {scoreQuestions.map((q) => (
                <MenuItem key={q.name} value={q.name}>
                  {q.title}
                  {q.title !== q.name ? ` (${q.name})` : ''}
                  {' · '}
                  {q.type}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {needsAttribute && (
            <FormControl size="small" sx={{ minWidth: 220 }} disabled={!questionName}>
              <InputLabel shrink id="img-perception-attr-label">Attribute / dimension</InputLabel>
              <Select
                labelId="img-perception-attr-label"
                label="Attribute / dimension"
                value={attributeId}
                displayEmpty
                notched
                onChange={(e) => setAttributeId(e.target.value)}
              >
                <MenuItem value="">
                  <em>Select attribute…</em>
                </MenuItem>
                {attributes.map((a) => (
                  <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size="small" sx={{ minWidth: 150 }} disabled={!selectionReady}>
            <InputLabel>Features</InputLabel>
            <Select
              label="Features"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <MenuItem value="all">All models</MenuItem>
              <MenuItem value="l0">L0 only</MenuItem>
              <MenuItem value="seg">Seg only</MenuItem>
              <MenuItem value="sam">SAM pre-annot only</MenuItem>
            </Select>
          </FormControl>

          <Chip size="small" label={`L0: ${l0Count}`} color={l0Count ? 'success' : 'default'} />
          <Chip size="small" label={`Seg: ${segCount}`} color={segCount ? 'success' : 'default'} />
          <Chip size="small" label={`SAM: ${samCount}`} color={samCount ? 'secondary' : 'default'} />
          <Chip size="small" label={`Scored images: ${scoredCount}`} />
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download />}
            onClick={() => exportImagePerceptionCsv(filteredRows)}
            disabled={!selectionReady || !filteredRows.length}
          >
            Export wide CSV
          </Button>
        </Box>

        {!questionName && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Select an image question to define the subjective score used for correlations.
            Choice / ranking → μ std (0–5); rating → mean rating; boolean → yes rate;
            matrix / slider / points → pick an attribute; annotation → count (or per-label count).
          </Alert>
        )}

        {questionName && needsAttribute && !attributeId && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This question has multiple attributes. Select one dimension / row / label to analyze.
          </Alert>
        )}

        {selectionReady && (
          <>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Score = <strong>{scoreLabel}</strong>
              {' for '}
              <strong>{selectedMeta?.title || questionName}</strong>
              {needsAttribute && attributeId ? (
                <>
                  {' · attribute '}
                  <strong>{attributes.find((a) => a.id === attributeId)?.label || attributeId}</strong>
                </>
              ) : null}
              . Mean column is that score per image.
            </Typography>

            {(correlations.length > 0 || scatterFeatureOptions.length > 0) ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  gap: 2,
                  mb: 2,
                  alignItems: 'start',
                }}
              >
                <Box sx={{ minWidth: 0, overflowX: 'auto' }}>
                  {correlations.length > 0 ? (
                    <CorrelationBarChart
                      correlations={correlations}
                      title={`Correlation with ${scoreLabel}`}
                      maxItems={24}
                      chartW={520}
                    />
                  ) : (
                    <Alert severity="info">
                      Not enough scored images with features for correlation yet (need ≥3).
                    </Alert>
                  )}
                </Box>

                <Box sx={{ minWidth: 0 }}>
                  {scatterFeatureOptions.length > 0 ? (
                    <>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
                        <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                          <InputLabel shrink id="img-perception-scatter-feat">Scatter feature</InputLabel>
                          <Select
                            labelId="img-perception-scatter-feat"
                            label="Scatter feature"
                            value={scatterFeature}
                            notched
                            onChange={(e) => {
                              setScatterFeatureManual(true);
                              setScatterFeature(e.target.value);
                            }}
                          >
                            {scatterFeatureOptions.map((f) => {
                              const c = correlations.find((x) => x.feature === f);
                              return (
                                <MenuItem key={f} value={f}>
                                  {f}
                                  {c ? ` (r=${c.r.toFixed(2)}${c.stars || ''})` : ''}
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                        {scatterCorr && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={[
                              `r=${scatterCorr.r.toFixed(2)}${scatterCorr.stars || ''}`,
                              scatterCorr.p != null
                                ? (scatterCorr.p < 0.001 ? 'p<.001' : `p=${scatterCorr.p.toFixed(3)}`)
                                : null,
                              `n=${scatterCorr.n}`,
                            ].filter(Boolean).join(' · ')}
                          />
                        )}
                      </Box>
                      {scatterPoints.length >= 2 ? (
                        <FeatureScoreScatterChart
                          points={scatterPoints}
                          featureLabel={scatterFeature}
                          scoreLabel={scoreLabel}
                          title={`${scatterFeature} vs ${scoreLabel}`}
                          caption="Each point is one image. Orange dashed line is OLS fit."
                          size={400}
                        />
                      ) : (
                        <Alert severity="info">
                          Not enough points to draw a scatter for this feature.
                        </Alert>
                      )}
                    </>
                  ) : (
                    <Alert severity="info">Select features to enable scatter.</Alert>
                  )}
                </Box>
              </Box>
            ) : (
              <Alert severity="info" sx={{ mb: 2 }}>
                Not enough scored images with features for correlation yet (need ≥3 images with both
                a score and numeric features).
              </Alert>
            )}

            <PerceptionAblationPanel
              rows={filteredRows}
              modelFilter={modelFilter}
              scoreLabel={scoreLabel}
              disabled={!selectionReady}
            />

            <ScoreExtremeGallery
              rows={filteredRows}
              scoreLabel={scoreLabel}
              count={8}
              featureKey={scatterFeature || null}
              getFeatureValue={perceptionFeatureValue}
              title="High / low score images"
            />

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {sortLabel('name', 'Image')}
                    {sortLabel('mean_score', 'Score', 'right')}
                    {sortLabel('l0_status', 'L0')}
                    {sortLabel('seg_status', 'Seg')}
                    {sortLabel('sam_status', 'SAM')}
                    {featureCols.map((c) => sortLabel(c, c, 'right'))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRows.slice(0, 100).map((r) => (
                    <TableRow key={r.media_id}>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                          {r.url ? (
                            <Box
                              component="img"
                              src={r.url}
                              alt={r.name || ''}
                              loading="lazy"
                              sx={{
                                width: 48,
                                height: 48,
                                objectFit: 'cover',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                                flexShrink: 0,
                                bgcolor: 'grey.100',
                              }}
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.removeAttribute('src');
                              }}
                            />
                          ) : (
                            <Box
                              sx={{
                                width: 48,
                                height: 48,
                                borderRadius: 1,
                                bgcolor: 'grey.100',
                                border: '1px solid',
                                borderColor: 'divider',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <Typography
                            variant="body2"
                            noWrap
                            title={r.name}
                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {r.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {r.mean_score != null ? r.mean_score.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={r.l0_status} color={r.l0_status === 'ready' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={r.seg_status} color={r.seg_status === 'ready' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={r.sam_status || 'missing'} color={r.sam_status === 'ready' ? 'secondary' : 'default'} />
                      </TableCell>
                      {featureCols.map((c) => (
                        <TableCell key={c} align="right">
                          {typeof r[c] === 'number' ? r[c].toFixed(3) : (r[c] ?? '—')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
