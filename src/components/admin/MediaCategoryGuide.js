import React from 'react';
import {
  Alert,
  Typography,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { MEDIA_CATEGORY_SEPARATOR, MEDIA_GROUP_SEPARATOR } from '../../lib/mediaUtils';

function CategoryProjectPoolBar({
  context,
  categoryCount,
  projectCategoryCount,
  categoryLabels,
  totalFileCount,
  matchingFileCount,
  mediaTypeFilter,
}) {
  const cat = MEDIA_CATEGORY_SEPARATOR;
  const isQuestion = context === 'question';
  const displayCount = categoryCount ?? projectCategoryCount;
  const labels = categoryLabels || [];

  if (displayCount == null && totalFileCount == null && !isQuestion) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
      <Typography variant="body2" fontWeight={700} color="secondary.dark" sx={{ mr: 0.5 }}>
        Project pool:
      </Typography>
      {totalFileCount != null && (
        <Chip
          size="small"
          label={`${totalFileCount} media file${totalFileCount === 1 ? '' : 's'}`}
          color="secondary"
          variant="outlined"
        />
      )}
      {displayCount != null && (
        <Chip
          size="small"
          label={`${displayCount} categor${displayCount === 1 ? 'y' : 'ies'}`}
          color={displayCount > 0 ? 'secondary' : 'default'}
          variant={displayCount > 0 ? 'filled' : 'outlined'}
        />
      )}
      {!isQuestion && labels.slice(0, 8).map((label) => (
        <Chip key={label} size="small" label={label} variant="outlined" sx={{ fontSize: '0.7rem' }} />
      ))}
      {!isQuestion && labels.length > 8 && (
        <Chip size="small" label={`+${labels.length - 8} more`} variant="outlined" sx={{ fontSize: '0.7rem' }} />
      )}
      {!isQuestion && displayCount === 0 && (totalFileCount ?? 0) > 0 && (
        <Typography variant="caption" color="text.secondary">
          Add {cat} prefixes — e.g. <code>street{cat}photo.jpg</code>
        </Typography>
      )}
      {!isQuestion && (totalFileCount ?? 0) === 0 && (
        <Typography variant="caption" color="text.secondary">
          Upload media first
        </Typography>
      )}
      {isQuestion && matchingFileCount != null && (
        <>
          <Typography variant="body2" fontWeight={700} color="secondary.dark" sx={{ ml: 1, mr: 0.5 }}>
            This question:
          </Typography>
          <Chip
            size="small"
            label={`${categoryCount ?? 0} categor${(categoryCount ?? 0) === 1 ? 'y' : 'ies'}`}
            color={(categoryCount ?? 0) > 0 ? 'secondary' : 'warning'}
            variant="outlined"
          />
          <Chip size="small" label={`${matchingFileCount} matching file${matchingFileCount === 1 ? '' : 's'}`} variant="outlined" />
          {mediaTypeFilter && mediaTypeFilter !== 'any' && (
            <Chip size="small" label={mediaTypeFilter} variant="outlined" />
          )}
        </>
      )}
    </Box>
  );
}

function CategoryGuideContent({ compact = false }) {
  const cat = MEDIA_CATEGORY_SEPARATOR;
  const pair = MEDIA_GROUP_SEPARATOR;

  return (
    <Typography variant="body2" component="div" sx={{ '& code': { fontSize: '0.85em', bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5 } }}>
      Prefix each file with a <strong>category label</strong> and a single <strong>{cat}</strong> (at-sign).
      Questions in <strong>One per category</strong> mode pick <strong>one random file from every category</strong>
      — each category appears exactly once, randomization happens inside each category.
      <br /><br />
      <strong>Format:</strong> <code>{'{category}'}{cat}{'{filename}'}.ext</code>
      {' '}(filename may also use {pair} for fixed-set pairing — see Media pairing guide)
      <br /><br />
      <strong>Examples — 3 image categories (one image from each):</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li><code>street{cat}scene01.jpg</code></li>
        <li><code>park{cat}scene02.jpg</code></li>
        <li><code>plaza{cat}scene03.jpg</code></li>
      </Box>
      <strong>Examples — 2 audio categories:</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li><code>traffic{cat}recording01.wav</code></li>
        <li><code>nature{cat}recording02.wav</code></li>
      </Box>
      <strong>Category + pairing combined:</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li>
          <code>street{cat}block01{pair}before.jpg</code> +{' '}
          <code>street{cat}block01{pair}after.jpg</code>
          {' '}(same category; use <strong>Random fixed sets</strong> mode if you need the pair together)
        </li>
      </Box>
      <strong>Not categorized:</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li><code>photo01.jpg</code> — no {cat} → excluded from category mode</li>
        <li><code>street_scene01.jpg</code> — underscore is <em>not</em> a category marker</li>
      </Box>
      {!compact && (
        <>
          In <strong>Survey Builder</strong>, set Media Assignment to{' '}
          <strong>&quot;One per category&quot;</strong>. Files per set is set automatically to the number of
          categories detected in Image Dataset. Check <strong>Detected Media Categories</strong> below after upload.
        </>
      )}
    </Typography>
  );
}

/** Collapsible media category help — project pool always visible above the accordion. */
export function MediaCategoryGuide({
  context = 'dataset',
  categoryCount = null,
  projectCategoryCount = null,
  categoryLabels = null,
  totalFileCount = null,
  matchingFileCount = null,
  mediaTypeFilter = null,
  compact = false,
  defaultExpanded = false,
}) {
  const cat = MEDIA_CATEGORY_SEPARATOR;
  const labels = categoryLabels;

  return (
    <Box
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'secondary.light',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ px: 2, py: 1.5, bgcolor: 'secondary.50', borderBottom: '1px solid', borderColor: 'secondary.light' }}>
        <Typography variant="subtitle2" fontWeight={700} color="secondary.dark">
          Media categories (one per class)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          Prefix with <strong>{cat}</strong> — e.g.{' '}
          <code>street{cat}photo.jpg</code>, <code>park{cat}photo.jpg</code> → one random pick from each class
        </Typography>
        <CategoryProjectPoolBar
          context={context}
          categoryCount={categoryCount}
          projectCategoryCount={projectCategoryCount}
          categoryLabels={labels}
          totalFileCount={totalFileCount}
          matchingFileCount={matchingFileCount}
          mediaTypeFilter={mediaTypeFilter}
        />
      </Box>
      <Accordion
        defaultExpanded={defaultExpanded}
        disableGutters
        sx={{
          '&:before': { display: 'none' },
          boxShadow: 'none',
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMore />}
          sx={{
            minHeight: 40,
            '& .MuiAccordionSummary-content': { my: 0.75 },
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Filename naming guide & examples
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
          <Alert severity="info" sx={{ mb: 0, bgcolor: 'secondary.50', color: 'text.primary' }}>
            <CategoryGuideContent compact={compact} />
          </Alert>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
