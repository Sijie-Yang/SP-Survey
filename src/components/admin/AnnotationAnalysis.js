import React, { useMemo, useContext, useState } from 'react';
import {
  Box, Typography, Button, Stack, Chip, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { AnnotationOverlay, colorForLabel, inferShapeTool } from '../ImageAnnotationWidget';
import {
  annotationToolLabel,
  normalizeAnnotationTool,
} from '../../lib/annotationTools';
import { ImageResolverContext } from './imageResolverContext';
import AggregateDensityOverlay from './AggregateDensityOverlay';

/**
 * Group annotation answers by base image URL and render overlay + export.
 * Filterable by class label and drawing tool.
 *
 * @param {'survey'|'library'} exportProfile
 *   survey → participant/session columns (imageannotation question)
 *   library → media_id/name columns (media-library pre-annotate)
 */
export default function AnnotationAnalysis({
  answers,
  questionName,
  responses,
  exportProfile = 'survey',
  unitChipLabel = 'participant(s)',
  extraActions = null,
}) {
  const nameToUrl = useContext(ImageResolverContext);
  const [labelFilter, setLabelFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const isLibrary = exportProfile === 'library';

  const byImage = useMemo(() => {
    const isUrl = (s) => s && (s.startsWith('http') || s.startsWith('/') || s.startsWith('data:'));
    const map = {};
    answers.forEach(({ answer, shown_images }, idx) => {
      const ann = typeof answer === 'object' ? answer : null;
      if (!ann?.shapes?.length) return;
      let imgUrl = ann.image || shown_images?.[0] || 'unknown';
      if (!isUrl(imgUrl) && nameToUrl?.has(imgUrl)) imgUrl = nameToUrl.get(imgUrl);
      if (!map[imgUrl]) map[imgUrl] = [];
      map[imgUrl].push({ shapes: ann.shapes, participantIndex: idx });
    });
    return map;
  }, [answers, nameToUrl]);

  const allLabels = useMemo(() => {
    const set = new Set();
    Object.values(byImage).forEach((anns) => {
      anns.forEach((ann) => {
        (ann.shapes || []).forEach((s) => {
          if (s.label) set.add(s.label);
        });
      });
    });
    return [...set].sort();
  }, [byImage]);

  const allTools = useMemo(() => {
    const set = new Set();
    Object.values(byImage).forEach((anns) => {
      anns.forEach((ann) => {
        (ann.shapes || []).forEach((s) => {
          const tool = inferShapeTool(s);
          if (tool) set.add(tool);
        });
      });
    });
    return [...set].sort();
  }, [byImage]);

  const shapePassesFilters = (shape) => {
    if (labelFilter && shape.label !== labelFilter) return false;
    if (toolFilter && inferShapeTool(shape) !== normalizeAnnotationTool(toolFilter)) return false;
    return true;
  };

  const exportAnnotationCsv = () => {
    const rows = isLibrary
      ? [['media_id', 'name', 'image', 'tool', 'label', 'points_json']]
      : [['participant_id', 'session_id', 'attempt_index', 'question', 'image', 'tool', 'label', 'points_json']];
    (responses || []).forEach((row) => {
      const qData = row.responses?.[questionName];
      const ann = qData?.answer || qData;
      if (!ann?.shapes) return;
      const img = ann.image || '';
      const mediaIds = qData?.shown_media_ids || [];
      const fileName = img.split('/').pop() || '';
      ann.shapes.forEach((shape) => {
        if (!shapePassesFilters(shape)) return;
        if (isLibrary) {
          rows.push([
            mediaIds[0] || row.participant_id || '',
            fileName,
            fileName,
            inferShapeTool(shape),
            shape.label || '',
            JSON.stringify(shape.points),
          ]);
        } else {
          rows.push([
            row.participant_id || '',
            row.survey_metadata?.session_id || '',
            row.survey_metadata?.attempt_index ?? '',
            questionName,
            fileName,
            inferShapeTool(shape),
            shape.label || '',
            JSON.stringify(shape.points),
          ]);
        }
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAnnotationJson = () => {
    const payload = (responses || []).map((row) => {
      const qData = row.responses?.[questionName];
      const annotation = qData?.answer || qData;
      if (isLibrary) {
        const img = annotation?.image || '';
        return {
          media_id: qData?.shown_media_ids?.[0] || row.participant_id || '',
          name: img.split('/').pop() || '',
          annotation,
        };
      }
      return {
        participant_id: row.participant_id,
        session_id: row.survey_metadata?.session_id,
        attempt_index: row.survey_metadata?.attempt_index,
        annotation,
      };
    }).filter((r) => r.annotation?.shapes?.length);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const imageKeys = Object.keys(byImage);
  if (!imageKeys.length) {
    return <Typography variant="body2" color="text.secondary">No annotation data yet.</Typography>;
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }} alignItems="center">
        <Button size="small" variant="outlined" onClick={exportAnnotationCsv}>Export CSV</Button>
        <Button size="small" variant="outlined" onClick={exportAnnotationJson}>Export JSON</Button>
        {extraActions}
        {allLabels.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Filter label</InputLabel>
            <Select
              label="Filter label"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
            >
              <MenuItem value="">All labels</MenuItem>
              {allLabels.map((lb) => (
                <MenuItem key={lb} value={lb}>{lb}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {allTools.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Filter tool</InputLabel>
            <Select
              label="Filter tool"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
            >
              <MenuItem value="">All tools</MenuItem>
              {allTools.map((tool) => (
                <MenuItem key={tool} value={tool}>{annotationToolLabel(tool)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Stack>
      {(allLabels.length > 0 || allTools.length > 0) && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
          {allLabels.map((lb) => (
            <Chip
              key={`lb-${lb}`}
              size="small"
              label={lb}
              onClick={() => setLabelFilter(labelFilter === lb ? '' : lb)}
              variant={labelFilter === lb ? 'filled' : 'outlined'}
              sx={{
                borderColor: colorForLabel(lb),
                bgcolor: labelFilter === lb ? colorForLabel(lb) : undefined,
                color: labelFilter === lb ? '#fff' : undefined,
              }}
            />
          ))}
          {allTools.map((tool) => (
            <Chip
              key={`tool-${tool}`}
              size="small"
              label={annotationToolLabel(tool)}
              onClick={() => setToolFilter(toolFilter === tool ? '' : tool)}
              variant={toolFilter === tool ? 'filled' : 'outlined'}
              color={toolFilter === tool ? 'primary' : 'default'}
            />
          ))}
        </Stack>
      )}
      {imageKeys.map((imgUrl) => (
        <Box key={imgUrl} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {imgUrl.split('/').pop()}
            <Chip size="small" label={`${byImage[imgUrl].length} ${unitChipLabel}`} sx={{ ml: 1 }} />
          </Typography>
          {byImage[imgUrl].length > 1 && (
            <AggregateDensityOverlay
              imageUrl={imgUrl}
              annotations={byImage[imgUrl]}
              width={480}
              labelFilter={labelFilter || null}
              toolFilter={toolFilter || null}
            />
          )}
          <AnnotationOverlay
            imageUrl={imgUrl}
            annotations={byImage[imgUrl]}
            width={480}
            labelFilter={labelFilter || null}
            toolFilter={toolFilter || null}
          />
        </Box>
      ))}
    </Box>
  );
}
