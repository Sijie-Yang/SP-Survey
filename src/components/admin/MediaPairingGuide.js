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
import { MEDIA_GROUP_SEPARATOR } from '../../lib/mediaUtils';

function PairingProjectPoolBar({
  context,
  totalFileCount,
  matchingFileCount,
  mediaTypeFilter,
  pairedSetCount,
  pairedSetsBySize,
  eligibleGroupCount,
  filesPerSet,
}) {
  const sep = MEDIA_GROUP_SEPARATOR;
  const isQuestion = context === 'question';
  const bySizeEntries = pairedSetsBySize
    ? Object.entries(pairedSetsBySize).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    : [];

  if (totalFileCount == null && pairedSetCount == null && !isQuestion) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        mt: 1,
      }}
    >
      <Typography variant="body2" fontWeight={700} color="info.dark" sx={{ mr: 0.5 }}>
        Project pool:
      </Typography>
      {totalFileCount != null && (
        <Chip
          size="small"
          label={`${totalFileCount} media file${totalFileCount === 1 ? '' : 's'}`}
          color="info"
          variant="outlined"
        />
      )}
      {pairedSetCount != null && (
        <Chip
          size="small"
          label={`${pairedSetCount} paired set${pairedSetCount === 1 ? '' : 's'}`}
          color={pairedSetCount > 0 ? 'success' : 'default'}
          variant={pairedSetCount > 0 ? 'filled' : 'outlined'}
        />
      )}
      {!isQuestion && bySizeEntries.map(([size, count]) => (
        <Chip
          key={size}
          size="small"
          label={`${count} × ${size} file${parseInt(size, 10) === 1 ? '' : 's'}`}
          variant="outlined"
          sx={{ fontSize: '0.7rem' }}
        />
      ))}
      {!isQuestion && pairedSetCount === 0 && (totalFileCount ?? 0) > 0 && (
        <Typography variant="caption" color="text.secondary">
          No <code>{sep}</code> groups — e.g. <code>image_1.jpg</code> is not a set
        </Typography>
      )}
      {isQuestion && matchingFileCount != null && (
        <>
          <Typography variant="body2" fontWeight={700} color="info.dark" sx={{ ml: 1, mr: 0.5 }}>
            This question:
          </Typography>
          <Chip size="small" label={`${matchingFileCount} matching file${matchingFileCount === 1 ? '' : 's'}`} variant="outlined" />
          {mediaTypeFilter && mediaTypeFilter !== 'any' && (
            <Chip size="small" label={mediaTypeFilter} variant="outlined" />
          )}
          {eligibleGroupCount != null && filesPerSet != null && (
            <Chip
              size="small"
              label={`${eligibleGroupCount} set(s) of ${filesPerSet}`}
              color={eligibleGroupCount > 0 ? 'success' : 'warning'}
              variant="outlined"
            />
          )}
        </>
      )}
    </Box>
  );
}

function PairingGuideContent({ compact = false }) {
  const sep = MEDIA_GROUP_SEPARATOR;

  return (
    <Typography variant="body2" component="div" sx={{ '& code': { fontSize: '0.85em', bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5 } }}>
      Related files must share the same <strong>group ID</strong> and use a{' '}
      <strong>double underscore {sep} (two underscores in a row)</strong> before the slot name.
      This {sep} is the only separator the system recognizes — a single <code>_</code> does{' '}
      <strong>not</strong> create a pair.
      <br /><br />
      <strong>Format:</strong>{' '}
      <code>{'{groupId}'}{sep}{'{slot}'}.ext</code>
      <br />
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li><code>groupId</code> — any name (may contain single underscores); must be identical within a set</li>
        <li><code>{sep}</code> — exactly <strong>two</strong> underscores (not one)</li>
        <li><code>slot</code> — order or role: <code>1</code>, <code>2</code>, <code>before</code>, <code>after</code>, <code>photo</code>, <code>sound</code>, …</li>
      </Box>

      <strong>Valid examples (grouped):</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li>
          <strong>Before / after (2 images):</strong>{' '}
          <code>street01{sep}before.jpg</code> + <code>street01{sep}after.jpg</code>
        </li>
        <li>
          <strong>Numeric slots (2 images):</strong>{' '}
          <code>image{sep}01.jpg</code> + <code>image{sep}02.jpg</code>
          {' '}(Group ID = <code>image</code> — not <code>image_01</code>)
        </li>
        <li>
          <strong>Three-up set:</strong>{' '}
          <code>plaza{sep}1.png</code>, <code>plaza{sep}2.png</code>, <code>plaza{sep}3.png</code>
        </li>
        <li>
          <strong>Four design options:</strong>{' '}
          <code>designA{sep}1.jpg</code> … <code>designA{sep}4.jpg</code>
        </li>
        <li>
          <strong>Group ID with single underscore:</strong>{' '}
          <code>my_scene{sep}1.jpg</code> + <code>my_scene{sep}2.jpg</code>
          {' '}(Group ID = <code>my_scene</code>)
        </li>
        <li>
          <strong>Image + audio (mixed):</strong>{' '}
          <code>alley{sep}photo.jpg</code> + <code>alley{sep}ambient.mp3</code>
          {' '}(set question Media Type Filter to <strong>Any</strong>)
        </li>
        <li>
          <strong>Video pair:</strong>{' '}
          <code>walk{sep}day.mp4</code> + <code>walk{sep}night.mp4</code>
        </li>
        <li>
          <strong>Audio pair:</strong>{' '}
          <code>block{sep}quiet.wav</code> + <code>block{sep}busy.wav</code>
        </li>
      </Box>

      <strong>Not paired (common mistakes):</strong>
      <Box component="ul" sx={{ m: '8px 0', pl: 2.5 }}>
        <li>
          <code>image_01.jpg</code> + <code>image_02.jpg</code>
          {' '}— single <code>_</code> only → <strong>0 sets</strong> (two separate files)
        </li>
        <li>
          <code>before.jpg</code> + <code>after.jpg</code>
          {' '}— no {sep} → two separate files
        </li>
        <li>
          <code>street01-before.jpg</code>
          {' '}— hyphen instead of {sep} → not grouped
        </li>
      </Box>

      {!compact && (
        <>
          In <strong>Survey Builder</strong>, set Media Assignment to{' '}
          <strong>&quot;Random fixed sets&quot;</strong> and set{' '}
          <strong>files per set</strong> to the group size (2, 3, 4…).
          Check <strong>Detected Media Groups</strong> on this page after upload.
        </>
      )}
    </Typography>
  );
}

/**
 * Collapsible media pairing help — used on Image Dataset and in Question Editor.
 * Collapsed by default.
 */
export function MediaPairingGuide({
  context = 'dataset',
  totalFileCount = null,
  matchingFileCount = null,
  mediaTypeFilter = null,
  pairedSetCount = null,
  pairedSetsBySize = null,
  eligibleGroupCount = null,
  filesPerSet = null,
  compact = false,
  defaultExpanded = false,
}) {
  const sep = MEDIA_GROUP_SEPARATOR;

  return (
    <Box
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'info.light',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ px: 2, py: 1.5, bgcolor: 'info.50', borderBottom: '1px solid', borderColor: 'info.light' }}>
        <Typography variant="subtitle2" fontWeight={700} color="info.dark">
          Media pairing (fixed sets)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          Use <strong>{sep}</strong> (double underscore) — e.g.{' '}
          <code>street01{sep}before.jpg</code> + <code>street01{sep}after.jpg</code>
        </Typography>
        <PairingProjectPoolBar
          context={context}
          totalFileCount={totalFileCount}
          matchingFileCount={matchingFileCount}
          mediaTypeFilter={mediaTypeFilter}
          pairedSetCount={pairedSetCount}
          pairedSetsBySize={pairedSetsBySize}
          eligibleGroupCount={eligibleGroupCount}
          filesPerSet={filesPerSet}
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
          <Alert severity="info" sx={{ mb: 0 }}>
            <PairingGuideContent compact={compact} />
          </Alert>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
