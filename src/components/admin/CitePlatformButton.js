import React, { useMemo, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { FormatQuote } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { platformCitations, PLATFORM_VERSION } from '../../lib/platformCitation';
import { SP_REPORT_URL } from '../../lib/spReport';
import { JOURNAL_STYLES, renderJournalMethods } from '../../lib/journalMethods';
import { AdminActionButton } from './AdminPageLayout';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Cite" button for the Results toolbar: BibTeX, APA and a methods sentence, one click to copy.
 * With `getMethodsFacts` (a function, called when the tab opens) it also drafts a full Methods
 * section in a journal's house style.
 */
export default function CitePlatformButton({ language, getMethodsFacts = null }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('bibtex');
  const [copied, setCopied] = useState('');
  const [journal, setJournal] = useState('epb');
  const c = platformCitations();
  const journalText = useMemo(() => {
    if (!open || tab !== 'journal' || !getMethodsFacts) return '';
    try {
      return renderJournalMethods(getMethodsFacts(), journal).markdown;
    } catch (err) {
      return `${L('Could not draft the Methods section', '无法生成方法部分')}: ${err?.message || err}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, journal, getMethodsFacts]);
  const formats = {
    bibtex: { label: 'BibTeX', text: c.all.bibtex },
    apa: { label: 'APA', text: c.all.apa.replace(/\*/g, '') },
    text: { label: L('Methods sentence', '方法段落'), text: c.text },
    ...(getMethodsFacts ? { journal: { label: L('Methods for a journal', '按期刊写方法'), text: journalText } } : {}),
  };
  const current = formats[tab];

  const copy = async () => {
    const ok = await copyText(current.text);
    setCopied(ok ? tab : 'fail');
  };

  return (
    <>
      <AdminActionButton startIcon={<FormatQuote />} onClick={() => { setOpen(true); setCopied(''); }}>
        {L('Cite', '引用')}
      </AdminActionButton>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth={tab === 'journal' ? 'md' : 'sm'} fullWidth>
        <DialogTitle>{L('Cite SP-Survey', '引用 SP-Survey')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {L(
              `If these data appear in a paper, please cite SP-Survey with the version you used (${PLATFORM_VERSION}). Every export also carries references.bib and CITATION.cff.`,
              `数据用在论文里时，请引用 SP-Survey 和所用的版本（${PLATFORM_VERSION}）。每个导出包里也带 references.bib 和 CITATION.cff。`,
            )}
          </Typography>
          <Tabs value={tab} onChange={(_, v) => { setTab(v); setCopied(''); }} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 1 }}>
            {Object.entries(formats).map(([id, f]) => <Tab key={id} value={id} label={f.label} />)}
          </Tabs>
          {tab === 'journal' && (
            <Box sx={{ mb: 1 }}>
              <TextField select size="small" label={L('Journal style', '期刊格式')} value={journal} onChange={(e) => { setJournal(e.target.value); setCopied(''); }} sx={{ minWidth: 280 }}>
                {['epb', 'ceus', 'lup', 'generic'].map((id) => <MenuItem key={id} value={id}>{JOURNAL_STYLES[id].label}</MenuItem>)}
              </TextField>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                {L('Written from your survey and the current filter by fixed templates, not by AI. Fill in the [bracketed] parts before submitting. The full export has all three journal versions.',
                  '根据你的问卷和当前筛选的数据，用固定模板生成，不经过 AI。投稿前请补全 [方括号] 里的内容。完整导出包里有三个期刊版本。')}
              </Typography>
            </Box>
          )}
          <Box component="pre" data-testid="citation-text" sx={{
            m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12.5, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: tab === 'bibtex' ? 'monospace' : 'inherit',
          }}>
            {current.text}
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            {L('Reporting a perception experiment? The export README includes the ', '写感知实验的论文？导出的 README 里附有 ')}
            <Link href={SP_REPORT_URL.replace('https://sp-survey.org', '')} target="_blank" rel="noopener">SP-Report</Link>
            {L(' checklist, already filled from your data where possible.', ' 报告清单，能从数据里填的已经填好。')}
          </Typography>
        </DialogContent>
        <DialogActions>
          {copied === 'fail' && <Typography variant="caption" color="error" sx={{ mr: 'auto', ml: 1 }}>{L('Copy failed; select the text instead.', '复制失败，请手动选中文本。')}</Typography>}
          <Button onClick={() => setOpen(false)}>{L('Close', '关闭')}</Button>
          <Button variant="contained" onClick={copy}>
            {copied === tab ? L('Copied', '已复制') : L(`Copy ${current.label}`, `复制 ${current.label}`)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
