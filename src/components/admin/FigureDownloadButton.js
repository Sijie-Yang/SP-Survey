import React, { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { InsertChartOutlined } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { figureZipFiles, figuresForQuestion, svgToPngBytes } from '../../lib/journalFigures';
import { downloadZip } from '../../lib/zipDownload';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Journal-style figure(s) for one Results question, drawn from the same
 * summary numbers as the CSV export. One figure downloads as a file; several
 * (e.g. one per slider dimension) come as a ZIP with captions.
 */
export default function FigureDownloadButton({ question, responses, questionNumber, language, onError }) {
  const [anchor, setAnchor] = useState(null);
  const L = (en, zh) => uiPair(language, en, zh);
  const download = async (format) => {
    setAnchor(null);
    try {
      const figures = figuresForQuestion(question, responses, { questionNumber });
      if (!figures.length) throw new Error(L('This question has no figure to export.', '这道题没有可以导出的图。'));
      if (figures.length === 1) {
        const [f] = figures;
        if (format === 'svg') saveBlob(new Blob([f.svg], { type: 'image/svg+xml' }), `${f.file}.svg`);
        else saveBlob(new Blob([await svgToPngBytes(f.svg)], { type: 'image/png' }), `${f.file}.png`);
        return;
      }
      const files = await figureZipFiles(figures, { png: format === 'png', dir: '' });
      downloadZip(`${question.name}_figures_${format}.zip`, format === 'png' ? files.filter((x) => !x.path.endsWith('.svg')) : files);
    } catch (err) {
      onError?.(err?.message || String(err));
    }
  };
  return <>
    <Button size="small" variant="outlined" startIcon={<InsertChartOutlined />} sx={{ mr: 1, flexShrink: 0 }}
      aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}>
      {L('Figure', '论文图')}
    </Button>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
      <MenuItem onClick={() => download('svg')}>{L('SVG (vector, for the manuscript)', 'SVG（矢量，放论文用）')}</MenuItem>
      <MenuItem onClick={() => download('png')}>{L('PNG (high resolution)', 'PNG（高分辨率）')}</MenuItem>
    </Menu>
  </>;
}
