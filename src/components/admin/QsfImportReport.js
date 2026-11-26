import React from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography,
} from '@mui/material';
import { uiPair } from '../../lib/uiLanguages';
import { qsfNoteText } from '../../lib/qsfImport';

/** What a Qualtrics import converted, skipped and could not carry over. */
export default function QsfImportReport({ report, language, onClose }) {
  const L = (en, zh) => uiPair(language, en, zh);
  if (!report) return null;
  const clean = !report.skipped.length && !report.notes.length;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="qsf-import-report">
      <DialogTitle>{L('Qualtrics survey imported', '已导入 Qualtrics 问卷')}</DialogTitle>
      <DialogContent>
        <Alert severity={clean ? 'success' : 'info'} sx={{ mb: 2 }}>
          {L(`"${report.title}": ${report.converted} questions converted into a new project.`, `"${report.title}"：${report.converted} 道题已转换成新项目。`)}
          {' '}{L('Preview it before sharing the link.', '分享链接前请先预览一遍。')}
        </Alert>
        {report.skipped.length > 0 && (
          <>
            <Typography variant="subtitle2">{L('Not converted, rebuild by hand', '没有转换的题目，需要手动重建')}</Typography>
            <List dense>
              {report.skipped.map((s) => (
                <ListItem key={s.id} disableGutters>
                  <ListItemText primary={`${s.tag || s.id}${s.text ? ` · ${s.text}` : ''}`} secondary={`${s.type} · ${s.reason}`} />
                </ListItem>
              ))}
            </List>
          </>
        )}
        {report.notes.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>{L('Check these', '请检查以下几点')}</Typography>
            <List dense>
              {report.notes.map((n) => <ListItem key={n} disableGutters><ListItemText primary={qsfNoteText(n, L)} /></ListItem>)}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button href="https://sp-survey.org/docs/qualtrics-import" target="_blank" rel="noopener noreferrer">{L('What is converted', '转换说明')}</Button>
        <Button variant="contained" onClick={onClose}>{L('OK', '好的')}</Button>
      </DialogActions>
    </Dialog>
  );
}
