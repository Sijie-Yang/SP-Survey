import { useWorkflowText } from '../../contexts/workflowI18n';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import PerceptionCoverage from './PerceptionCoverage';
import { useRegion } from '../../contexts/RegionContext';
import React, { useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Box, Button, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, Alert, FormControl, InputLabel, Select, MenuItem, CircularProgress, TableSortLabel, TablePagination } from '@mui/material';
import { ExpandMore, Download } from '@mui/icons-material';
import { buildImagePerceptionRows, perceptionAnalysisSnapshot, downloadPerceptionFile, correlateFeaturesWithPerception, exportImagePerceptionCsv, listPerceptionScoreQuestions, scoreKindLabel, featureKeyMatchesModelFilter, perceptionFeatureValue } from '../../lib/imagePerceptionJoin';
import { loadFeaturesMapFromR2, FEATURE_MODELS } from '../../lib/imageFeaturesR2';
import { isR2Configured, resetR2ProxyUnreachable } from '../../lib/r2';
import { useAuth } from '../../contexts/AuthContext';
import { CorrelationBarChart, FeatureScoreScatterChart, ScoreExtremeGallery } from './analysisCharts';
import PerceptionAblationPanel from './PerceptionAblationPanel';

/**
 * Results: join image features with a selected image-question score
 * (and attribute when the question is multi-dimensional).
 */
export default function ImagePerceptionPanel({
  currentProject,
  responses,
  questions,
  onOpenMedia
}) {
  const tx = useWorkflowText();
  const {
    user
  } = useAuth();
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const [method, setMethod] = useState('pearson');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [featureError, setFeatureError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [tablePage, setTablePage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [modelFilter, setModelFilter] = useState('all');
  const [questionName, setQuestionName] = useState('');
  const [attributeId, setAttributeId] = useState('');
  const [featureMap, setFeatureMap] = useState(null);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [orderBy, setOrderBy] = useState('mean_score');
  const [order, setOrder] = useState('desc');
  const [scatterFeature, setScatterFeature] = useState('');
  const [scatterFeatureManual, setScatterFeatureManual] = useState(false);
  useEffect(() => {
    setTablePage(0);
  }, [modelFilter, questionName, attributeId, reviewFilter, refresh, responses]);
  const userId = currentProject?.user_id || user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const r2Prefix = projectId ? `${userId}/${projectId}/` : '';
  const scoreQuestions = useMemo(() => listPerceptionScoreQuestions(questions, responses), [questions, responses]);
  const selectedMeta = scoreQuestions.find(q => q.name === questionName) || null;
  const attributes = useMemo(() => selectedMeta?.attributes || [], [selectedMeta]);
  const needsAttribute = !!selectedMeta?.needsAttribute;
  useEffect(() => {
    if (questionName && !scoreQuestions.some(q => q.name === questionName)) {
      setQuestionName('');
      setAttributeId('');
    }
  }, [scoreQuestions, questionName]);
  useEffect(() => {
    if (!needsAttribute) {
      setAttributeId('');
      return;
    }
    if (attributeId && !attributes.some(a => a.id === attributeId)) {
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
      setFeatureMap(null);
      setFeatureError(null);
      try {
        const map = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
        if (!cancelled) setFeatureMap(map);
      } catch (err) {
        if (!cancelled) {
          setFeatureMap({});
          setFeatureError(err.message || String(err));
        }
      } finally {
        if (!cancelled) setLoadingFeatures(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [r2Prefix, refresh]);
  const selectionReady = !loadingFeatures && !featureError && !!questionName && (!needsAttribute || !!attributeId);
  const rows = useMemo(() => buildImagePerceptionRows(currentProject, responses, questions, featureMap || {}, selectionReady ? questionName : null, selectionReady && needsAttribute ? attributeId : null), [currentProject, responses, questions, featureMap, selectionReady, questionName, needsAttribute, attributeId]);
  const filteredRows = useMemo(() => rows.filter(r => {
    if (reviewFilter === 'accepted' && r.sam_review_status !== 'accepted') return false;
    if (reviewFilter === 'unreviewed' && r.sam_review_status === 'accepted') return false;
    if (modelFilter === 'l0') return r.l0_status === 'ready';
    if (modelFilter === 'seg') return r.seg_status === 'ready';
    if (modelFilter === 'sam') return r.sam_status === 'ready';
    return true;
  }), [rows, modelFilter, reviewFilter]);
  const correlations = useMemo(() => {
    if (!selectionReady) return [];
    return correlateFeaturesWithPerception(filteredRows, modelFilter, method);
  }, [filteredRows, selectionReady, modelFilter, method]);
  const featureCols = useMemo(() => {
    const skip = new Set(['media_id', 'name', 'url', 'mean_score', 'n_ratings', 'question_name', 'attribute_id', 'score_kind', 'l0_status', 'seg_status', 'sam_status', 'seg_vocab']);
    const keys = new Set();
    filteredRows.forEach(r => {
      Object.keys(r).forEach(k => {
        if (skip.has(k)) return;
        if (!featureKeyMatchesModelFilter(k, modelFilter)) return;
        if (typeof r[k] === 'number') keys.add(k);
      });
    });
    const absR = Object.fromEntries((correlations || []).map(c => [c.feature, Math.abs(c.r) || 0]));
    const modelRank = k => {
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
    (correlations || []).forEach(c => {
      if (c?.feature && !seen.has(c.feature)) {
        seen.add(c.feature);
        out.push(c.feature);
      }
    });
    featureCols.forEach(k => {
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
    return filteredRows.filter(r => r.mean_score != null && r.n_ratings > 0).map(r => {
      const x = perceptionFeatureValue(r, scatterFeature);
      if (!Number.isFinite(x)) return null;
      return {
        x,
        y: r.mean_score,
        label: r.name || r.media_id,
        url: r.url
      };
    }).filter(Boolean);
  }, [filteredRows, scatterFeature]);
  const featureLabel = key => {
    const match = key.match(/^sam_(count|ratio|area_sum)_(.+)$/);
    if (!match) return key;
    const label = rows.find(r => r.sam_label_dictionary?.[match[2]])?.sam_label_dictionary?.[match[2]];
    const kind = {
      count: uiPair(language, 'count', '数量'),
      ratio: uiPair(language, 'coverage', '覆盖率'),
      area_sum: uiPair(language, 'summed area', '面积之和')
    }[match[1]];
    return label ? `${label} · ${kind}` : key;
  };
  const scatterCorr = correlations.find(c => c.feature === scatterFeature);
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
  const handleSort = col => {
    if (orderBy === col) {
      setOrder(prev => prev === 'asc' ? 'desc' : 'asc');
      return;
    }
    setOrderBy(col);
    setOrder(col === 'name' || col === 'l0_status' || col === 'seg_status' || col === 'sam_status' ? 'asc' : 'desc');
  };
  const sortLabel = (col, label, align) => <TableCell key={col} align={align} sortDirection={orderBy === col ? order : false}>
      <TableSortLabel active={orderBy === col} direction={orderBy === col ? order : 'asc'} onClick={() => handleSort(col)}>
        {label}
      </TableSortLabel>
    </TableCell>;
  const l0Count = rows.filter(r => r.l0_status === 'ready').length;
  const segCount = rows.filter(r => r.seg_status === 'ready').length;
  const samCount = rows.filter(r => r.sam_status === 'ready').length;
  const scoredCount = rows.filter(r => r.n_ratings > 0 && r.mean_score != null).length;
  const scoreLabel = selectedMeta ? tx(scoreKindLabel(selectedMeta.type, needsAttribute ? attributeId : null)) : 'Score';
  if (loadingFeatures || featureMap == null) {
    return <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      mb: 2
    }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">{' '}{tx("Loading R2 feature CSVs…")}{' '}</Typography>
      </Box>;
  }
  if (!scoreQuestions.length) {
    return <Alert severity="info" sx={{
      mb: 2
    }}>{' '}{tx("No image questions found for Image × Perception. Add image choice / rating / ranking / boolean / matrix / slider / point allocation / annotation questions, extract features, then return here.")}{' '}</Alert>;
  }
  return <Accordion defaultExpanded sx={{
    mb: 3
  }}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {uiPair(language, 'Annotation & Image Features × Perception', '标注与图像特征 × 感知')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {uiPair(language, 'Choose a perception question, check feature–score matching, then analyze and export.', '选择感知题目，检查标注与评分的对应关系，再分析和导出。')}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {featureError && <Alert severity="error" action={<Button color="inherit" onClick={() => {
        resetR2ProxyUnreachable();
        setRefresh(n => n + 1);
      }}>{uiPair(language, 'Retry', '重试')}</Button>}>
          {uiPair(language, 'Feature loading failed. Analysis and export paused: ', '特征加载失败，已暂停分析与导出：')}{featureError}
        </Alert>}
        <Alert severity="info" sx={{
        mb: 2
      }}>{uiPair(language, 'Exploratory analysis uses current annotations and features, not a feature snapshot frozen with the questionnaire. Coverage removes overlaps; box area is not segmented object area. Group-level ratings are excluded from per-image analysis.', '探索性分析：使用当前标注和图像特征，不会随问卷版本自动冻结。标注覆盖率去除重叠；矩形框面积不等于物体分割面积。成组评分不能归给单张图片，因此不纳入单图分析。')}</Alert>
        <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        mb: 2
      }}>
          <FormControl size="small" sx={{
          minWidth: 160
        }}>
            <InputLabel id="annotation-review-label">{uiPair(language, 'Annotation review', '标注审核')}</InputLabel>
            <Select labelId="annotation-review-label" value={reviewFilter} label={uiPair(language, 'Annotation review', '标注审核')} onChange={e => setReviewFilter(e.target.value)}>
              <MenuItem value="all">{uiPair(language, 'All statuses', '全部状态')}</MenuItem>
              <MenuItem value="accepted">{uiPair(language, 'Accepted only', '仅已审核')}</MenuItem>
              <MenuItem value="unreviewed">{uiPair(language, 'Unreviewed / unknown', '未审核 / 未知')}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{
          minWidth: 160
        }}>
            <InputLabel id="annotation-correlation-label">{uiPair(language, 'Correlation', '相关方法')}</InputLabel>
            <Select labelId="annotation-correlation-label" value={method} label={uiPair(language, 'Correlation', '相关方法')} onChange={e => setMethod(e.target.value)}>
              <MenuItem value="pearson">Pearson</MenuItem><MenuItem value="spearman">Spearman</MenuItem>
            </Select>
          </FormControl>
          <Button disabled={loadingFeatures} onClick={() => {
          resetR2ProxyUnreachable();
          setRefresh(n => n + 1);
        }}>{uiPair(language, 'Refresh features', '刷新特征')}</Button>
        </Box>
        <PerceptionCoverage reviewFilter={reviewFilter} rows={rows} filteredRows={filteredRows} featureCols={featureCols} selectionReady={selectionReady} onOpenMedia={onOpenMedia} />
        {rows.some(r => r.sam_status === 'ready' && r.sam_feature_version !== '2') && <Alert severity="warning" sx={{
        mb: 2
      }}>{uiPair(language, 'Some legacy features have no source annotations and cannot be rebuilt or assigned verified zeros. Review before formal analysis.', '部分旧特征缺少原始标注，无法重算覆盖率或确认零值；请核对后再用于正式分析。')}</Alert>}
        {rows.some(r => !r.media_matched && r.n_ratings > 0) && <Alert severity="warning" sx={{
        mb: 2
      }}>{uiPair(language, 'Some historical scores do not match current media. Original identities are retained; same-name images are not guessed.', '部分历史评分无法对应当前媒体。已保留原始身份，不会按同名图片强行匹配。')}</Alert>}

        <Box sx={{
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap',
        mb: 2,
        alignItems: 'center'
      }}>
          <FormControl size="small" sx={{
          minWidth: 0,
          width: {
            xs: '100%',
            sm: 320
          }
        }}>
            <InputLabel shrink id="img-perception-q-label">{' '}{tx("Image question")}{' '}</InputLabel>
            <Select labelId="img-perception-q-label" label={tx("Image question")} value={questionName} displayEmpty notched onChange={e => {
            setQuestionName(e.target.value);
            setAttributeId('');
          }}>
              <MenuItem value="">
                <em>{' '}{tx("Select an image question…")}{' '}</em>
              </MenuItem>
              {scoreQuestions.map(q => <MenuItem key={q.name} value={q.name}>
                  {q.title}
                  {q.title !== q.name ? ` (${q.name})` : ''}
                  {' · '}
                  {q.type}
                </MenuItem>)}
            </Select>
          </FormControl>

          {needsAttribute && <FormControl size="small" sx={{
          minWidth: 220
        }} disabled={!questionName}>
              <InputLabel shrink id="img-perception-attr-label">{' '}{tx("Attribute / dimension")}{' '}</InputLabel>
              <Select labelId="img-perception-attr-label" label={tx("Attribute / dimension")} value={attributeId} displayEmpty notched onChange={e => setAttributeId(e.target.value)}>
                <MenuItem value="">
                  <em>{' '}{tx("Select attribute…")}{' '}</em>
                </MenuItem>
                {attributes.map(a => <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>)}
              </Select>
            </FormControl>}

          <FormControl size="small" sx={{
          minWidth: 150
        }} disabled={!selectionReady}>
            <InputLabel id="annotation-features-label">{' '}{tx("Features")}{' '}</InputLabel>
            <Select labelId="annotation-features-label" label={tx("Features")} value={modelFilter} onChange={e => setModelFilter(e.target.value)}>
              <MenuItem value="all">{' '}{tx("All models")}{' '}</MenuItem>
              <MenuItem value="l0">{' '}{tx("L0 only")}{' '}</MenuItem>
              <MenuItem value="seg">{' '}{tx("Seg only")}{' '}</MenuItem>
              <MenuItem value="sam">{' '}{tx("SAM pre-annot only")}{' '}</MenuItem>
            </Select>
          </FormControl>

          <Chip size="small" label={`${tx("Basic image features")}: ${l0Count}`} color={l0Count ? 'success' : 'default'} />
          <Chip size="small" label={`${tx("Semantic segmentation features")}: ${segCount}`} color={segCount ? 'success' : 'default'} />
          <Chip size="small" label={`${tx("Researcher annotation features")}: ${samCount}`} color={samCount ? 'secondary' : 'default'} />
          <Chip size="small" label={`${tx("Scored images")}: ${scoredCount}`} />
          <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => exportImagePerceptionCsv(filteredRows, modelFilter)} disabled={!selectionReady || !filteredRows.length}>
            {uiPair(language, 'Export analysis CSV', '导出分析数据 CSV')}
          </Button>
          <Button size="small" variant="outlined" disabled={!selectionReady || !filteredRows.length} onClick={() => {
          const snapshot = perceptionAnalysisSnapshot({
            rows: filteredRows,
            modelFilter,
            method,
            reviewFilter,
            responses,
            question: questions.find(q => q.name === questionName),
            attributeId,
            projectId
          });
          downloadPerceptionFile(JSON.stringify(snapshot, null, 2), `annotation_perception_${projectId}_${Date.now()}.json`);
        }}>{uiPair(language, 'Export snapshot & methods', '导出分析快照与方法')}</Button>
        </Box>

        {!questionName && <Alert severity="info" sx={{
        mb: 2
      }}>{' '}{tx("Select an image question to define the subjective score used for correlations. Choice / ranking → μ std (0–5); rating → mean rating; boolean → yes rate; matrix / slider / points → pick an attribute; annotation → count (or per-label count).")}{' '}</Alert>}

        {questionName && needsAttribute && !attributeId && <Alert severity="info" sx={{
        mb: 2
      }}>{' '}{tx("This question has multiple attributes. Select one dimension / row / label to analyze.")}{' '}</Alert>}

        {selectionReady && <>
            <Typography variant="caption" color="text.secondary" display="block" sx={{
          mb: 1
        }}>{' '}{tx("Score =")}{' '}<strong>{scoreLabel}</strong>
              {' for '}
              <strong>{selectedMeta?.title || questionName}</strong>
              {needsAttribute && attributeId ? <>
                  {' · attribute '}
                  <strong>{attributes.find(a => a.id === attributeId)?.label || attributeId}</strong>
                </> : null}{' '}{tx(". Mean column is that score per image.")}{' '}</Typography>

            {correlations.length > 0 || scatterFeatureOptions.length > 0 ? <Box sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: '1fr 1fr'
          },
          gap: 2,
          mb: 2,
          alignItems: 'start'
        }}>
                <Box sx={{
            minWidth: 0,
            overflowX: 'auto'
          }}>
                  {correlations.length > 0 ? <CorrelationBarChart correlations={correlations.map(c => ({
              ...c,
              feature: featureLabel(c.feature)
            }))} title={`${method === 'spearman' ? 'Spearman' : 'Pearson'} · ${scoreLabel}`} caption={uiPair(language, 'Stars use BH-FDR adjusted p-values across all tested features. Small samples and repeated ratings require caution; not causal.', '星号使用全部特征的 BH-FDR 校正 p 值；小样本及重复评分需谨慎解释，不表示因果。')} maxItems={24} chartW={520} /> : <Alert severity="info">{' '}{tx("Not enough scored images with features for correlation yet (need ≥3).")}{' '}</Alert>}
                </Box>

                <Box sx={{
            minWidth: 0
          }}>
                  {scatterFeatureOptions.length > 0 ? <>
                      <Box sx={{
                display: 'flex',
                gap: 1,
                flexWrap: 'wrap',
                alignItems: 'center',
                mb: 1
              }}>
                        <FormControl size="small" sx={{
                  minWidth: 200,
                  flex: 1
                }}>
                          <InputLabel shrink id="img-perception-scatter-feat">{' '}{tx("Scatter feature")}{' '}</InputLabel>
                          <Select labelId="img-perception-scatter-feat" label={tx("Scatter feature")} value={scatterFeature} notched onChange={e => {
                    setScatterFeatureManual(true);
                    setScatterFeature(e.target.value);
                  }}>
                            {scatterFeatureOptions.map(f => {
                      const c = correlations.find(x => x.feature === f);
                      return <MenuItem key={f} value={f}>
                                  {f}
                                  {c ? ` (r=${c.r.toFixed(2)}${c.stars || ''})` : ''}
                                </MenuItem>;
                    })}
                          </Select>
                        </FormControl>
                        {scatterCorr && <Chip size="small" variant="outlined" label={[`r=${scatterCorr.r.toFixed(2)}${scatterCorr.stars || ''}`, scatterCorr.p != null ? scatterCorr.p < 0.001 ? 'p<.001' : `p=${scatterCorr.p.toFixed(3)}` : null, `n=${scatterCorr.n}`].filter(Boolean).join(' · ')} />}
                      </Box>
                      {scatterPoints.length >= 2 ? <FeatureScoreScatterChart points={scatterPoints} featureLabel={featureLabel(scatterFeature)} scoreLabel={scoreLabel} title={`${featureLabel(scatterFeature)} vs ${scoreLabel}`} caption={tx("Each point is one image. Orange dashed line is OLS fit.")} size={400} /> : <Alert severity="info">{' '}{tx("Not enough points to draw a scatter for this feature.")}{' '}</Alert>}
                    </> : <Alert severity="info">{' '}{tx("Select features to enable scatter.")}{' '}</Alert>}
                </Box>
              </Box> : <Alert severity="info" sx={{
          mb: 2
        }}>{' '}{tx("Not enough scored images with features for correlation yet (need ≥3 images with both a score and numeric features).")}{' '}</Alert>}

            <PerceptionAblationPanel rows={filteredRows} modelFilter={modelFilter} scoreLabel={scoreLabel} disabled={!selectionReady} />

            <ScoreExtremeGallery rows={filteredRows} scoreLabel={scoreLabel} count={8} featureKey={scatterFeature || null} getFeatureValue={perceptionFeatureValue} title={tx("High / low score images")} />

            <TableContainer component={Paper} variant="outlined" sx={{
          maxHeight: 420
        }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {sortLabel('name', tx('Image'))}
                    {sortLabel('mean_score', tx('Score'), 'right')}
                    {sortLabel('l0_status', tx('Basic image features'))}
                    {sortLabel('seg_status', tx('Semantic segmentation features'))}
                    {sortLabel('sam_status', tx('Researcher annotation features'))}
                    {featureCols.map(c => sortLabel(c, featureLabel(c), 'right'))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRows.slice(tablePage * pageSize, (tablePage + 1) * pageSize).map(r => <TableRow key={r.media_id}>
                      <TableCell sx={{
                  maxWidth: 220
                }}>
                        <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minWidth: 0
                  }}>
                          {r.url ? <Box component="img" src={r.url} alt={r.name || ''} loading="lazy" sx={{
                      width: 48,
                      height: 48,
                      objectFit: 'cover',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      flexShrink: 0,
                      bgcolor: 'grey.100'
                    }} onError={e => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.removeAttribute('src');
                    }} /> : <Box sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 1,
                      bgcolor: 'grey.100',
                      border: '1px solid',
                      borderColor: 'divider',
                      flexShrink: 0
                    }} />}
                          <Typography variant="body2" noWrap title={r.name} sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                            {r.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {r.mean_score != null ? r.mean_score.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={tx(r.l0_status)} color={r.l0_status === 'ready' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={tx(r.seg_status)} color={r.seg_status === 'ready' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={tx(r.sam_status || 'missing')} color={r.sam_status === 'ready' ? 'secondary' : 'default'} />
                      </TableCell>
                      {featureCols.map(c => <TableCell key={c} align="right">
                          {Number.isFinite(perceptionFeatureValue(r, c)) ? perceptionFeatureValue(r, c).toFixed(3) : '—'}
                        </TableCell>)}
                    </TableRow>)}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={sortedRows.length} page={Math.min(tablePage, Math.max(0, Math.ceil(sortedRows.length / pageSize) - 1))} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]} onPageChange={(_event, page) => setTablePage(page)} onRowsPerPageChange={event => {
          setPageSize(Number(event.target.value));
          setTablePage(0);
        }} labelRowsPerPage={uiPair(language, 'Rows per page', '每页')} sx={{
          '& .MuiTablePagination-toolbar': {
            flexWrap: 'wrap',
            px: 0
          }
        }} />
          </>}
      </AccordionDetails>
    </Accordion>;
}