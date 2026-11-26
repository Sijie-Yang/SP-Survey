import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import { requestSurveyTranslations } from '../../lib/surveyTranslationApi';
import {
  confirmAllTranslations,
  confirmTranslation,
  deleteLanguageVersion,
  editTranslation,
  extractTranslatableStrings,
  languageVersionSummary,
  mergeMachineTranslations,
  reconcileTranslations,
  setTranslationLanguages,
  strictSurveyLanguage,
  stringsForMachineTranslation,
  systemChromeNote,
  systemChromeRowNote,
  translationAccuracyNotice,
  translationPublishFindings,
  translationStatusLabel,
} from '../../lib/surveyTranslations';

const FIELD_LABELS = {
  title: ['Title', '标题'],
  description: ['Description', '说明'],
  completion: ['Completion page', '完成页'],
  choice: ['Option label', '选项文字'],
  row: ['Row label', '行文字'],
  column: ['Column label', '列文字'],
  rate: ['Scale label', '量表文字'],
  minRateDescription: ['Scale start', '量表起点'],
  maxRateDescription: ['Scale end', '量表终点'],
  labelTrue: ['Yes label', '“是”的文字'],
  labelFalse: ['No label', '“否”的文字'],
  scaleStart: ['Scale start', '量表起点'],
  scaleEnd: ['Scale end', '量表终点'],
};

function fieldLabel(field, uiLanguage) {
  const pair = FIELD_LABELS[field] || [field, field];
  return uiPair(uiLanguage, pair[0], pair[1]);
}

export function TranslationPublishNotice({ config, language }) {
  const findings = translationPublishFindings(config || {});
  if (!findings.missing.length && !findings.unreviewed.length) return null;
  const line = (row, status) => `${row.groupLabel} · ${fieldLabel(row.field, language)} · ${row.languageName} · ${translationStatusLabel(status, language)}`;
  return (
    <Alert severity="warning" sx={{ my: 1 }}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {uiPair(language, 'Check translations before publishing', '发布前请检查翻译')}
      </Typography>
      {findings.missing.map((row) => (
        <Typography key={`missing-${row.language}-${row.id}`} variant="caption" component="p">
          {line(row, 'missing')}
        </Typography>
      ))}
      {findings.unreviewed.map((row) => (
        <Typography key={`review-${row.language}-${row.id}`} variant="caption" component="p">
          {line(row, 'machine')}
        </Typography>
      ))}
    </Alert>
  );
}

export default function TranslationEditor({ config, onChange }) {
  const { language } = useRegion();
  const live = useMemo(() => reconcileTranslations(config || {}), [config]);
  const strings = useMemo(() => extractTranslatableStrings(config || {}), [config]);
  const rows = useMemo(
    () => live.targetLanguages.map((code) => languageVersionSummary({ ...config, translations: live }, code)),
    [config, live],
  );
  const [openLanguage, setOpenLanguage] = useState('');
  const [sourceDraft, setSourceDraft] = useState(live.sourceLanguage);
  const [languageDraft, setLanguageDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const target = live.targetLanguages.includes(openLanguage) ? openLanguage : '';

  useEffect(() => {
    setSourceDraft(live.sourceLanguage);
  }, [live.sourceLanguage]);

  const write = (translations) => onChange({ ...config, translations });

  const updateLanguages = (patch) => {
    write(setTranslationLanguages(config, {
      sourceLanguage: live.sourceLanguage,
      targetLanguages: live.targetLanguages,
      enabledLanguages: live.enabledLanguages,
      ...patch,
    }));
  };

  const saveSource = () => {
    const code = strictSurveyLanguage(sourceDraft);
    if (!code || code === live.sourceLanguage) return;
    updateLanguages({ sourceLanguage: code });
  };

  const addLanguage = () => {
    const code = strictSurveyLanguage(languageDraft);
    if (!code) return;
    if (code === live.sourceLanguage || live.targetLanguages.includes(code)) {
      setNotice(uiPair(language, 'That language is already in the table.', '这个语言已经在表里。'));
      return;
    }
    updateLanguages({ targetLanguages: [...live.targetLanguages, code] });
    setLanguageDraft('');
    setNotice('');
  };

  const generate = async (languageCode, forceIds = []) => {
    if (!languageCode) return;
    const items = stringsForMachineTranslation({ ...config, translations: live }, languageCode, { forceIds });
    if (!items.length) {
      setNotice(uiPair(language, 'Every string already has a reviewed or edited translation.', '每条文字都已有审阅过或人工改过的翻译。'));
      return;
    }
    setBusy(true);
    setNotice('');
    const result = await requestSurveyTranslations({
      sourceLanguage: live.sourceLanguage,
      targetLanguage: languageCode,
      items,
    });
    setBusy(false);
    if (!result.configured) {
      setNotice(uiPair(
        language,
        'The Assistant model is not configured, so no translation was requested. Add a model and key in AI & Integrations.',
        '尚未配置助手模型，因此没有请求翻译。请在「AI 与集成」中添加模型和密钥。',
      ));
      return;
    }
    if (result.error) {
      setNotice(result.error);
      return;
    }
    write(mergeMachineTranslations(live, languageCode, result.translations, { forceIds }));
    if (result.rejected?.length) {
      setNotice(uiPair(
        language,
        'Some strings were left unchanged because the translation altered a number, placeholder, or tag.',
        '有些文字未更新，因为译文改动了数字、占位符或标签。',
      ));
    }
  };

  const setEnabled = (code, checked) => {
    const enabled = new Set(live.enabledLanguages);
    if (checked) enabled.add(code);
    else enabled.delete(code);
    updateLanguages({ enabledLanguages: [...enabled] });
  };

  const removeLanguage = (code) => {
    write(deleteLanguageVersion(live, code));
    if (openLanguage === code) setOpenLanguage('');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">{uiPair(language, 'Translations', '翻译')}</Typography>
      <Alert severity="info">{translationAccuracyNotice(language)}</Alert>
      <Typography variant="body2" color="text.secondary">
        {uiPair(
          language,
          'One survey, one response dataset. Type any language. The Assistant translates the survey wording. Participants choose a language on its own first page. Later pages have no language switcher.',
          '一份问卷，一份答卷数据。可以输入任意语言，由助手翻译问卷文字。参与者在单独的第一页选择语言。后面的页面没有语言切换。',
        )}
      </Typography>
      {!!notice && <Alert severity="warning">{notice}</Alert>}
      {!target && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label={uiPair(language, 'Source language', '源语言')}
              value={sourceDraft}
              onChange={(event) => setSourceDraft(event.target.value)}
              onBlur={saveSource}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveSource();
              }}
              helperText={uiPair(language, 'Not limited to the interface languages.', '不限于界面里已有的语言。')}
            />
            <TextField
              size="small"
              label={uiPair(language, 'Add a language', '添加语言')}
              value={languageDraft}
              onChange={(event) => setLanguageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addLanguage();
              }}
              helperText={uiPair(language, 'Type any language, then add it.', '输入任意语言后添加。')}
            />
            <Button variant="outlined" sx={{ alignSelf: 'flex-start', mt: 0.5 }} onClick={addLanguage}>
              {uiPair(language, 'Add language', '添加语言')}
            </Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{uiPair(language, 'Language', '语言')}</TableCell>
                <TableCell>{uiPair(language, 'Translated', '是否已翻译')}</TableCell>
                <TableCell>{uiPair(language, 'Needs update', '是否需要更新')}</TableCell>
                <TableCell>{uiPair(language, 'Participants can choose', '参与者可选')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2">{systemChromeNote(language)}</Typography>
                </TableCell>
              </TableRow>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      {uiPair(language, 'No languages yet. Type one above.', '还没有语言。请在上面输入。')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.language} hover>
                  <TableCell>
                    {row.name}
                    {!row.hasUiPack && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {systemChromeRowNote(language, live.sourceLanguage)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.translated ? 'success' : row.partial ? 'warning' : 'default'}
                      label={row.translated
                        ? uiPair(language, 'Translated', '已翻译')
                        : row.partial
                          ? uiPair(language, 'Partly translated', '部分翻译')
                          : uiPair(language, 'Not translated', '未翻译')}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.needsUpdate ? 'warning' : 'success'}
                      label={row.needsUpdate
                        ? uiPair(language, 'Needs update', '需要更新')
                        : uiPair(language, 'Up to date', '无需更新')}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.enabled}
                      onChange={(event) => setEnabled(row.language, event.target.checked)}
                      inputProps={{ 'aria-label': row.name }}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => setOpenLanguage(row.language)}>
                      {uiPair(language, 'Check sentences', '检查句子')}
                    </Button>
                    <Button size="small" disabled={busy} onClick={() => generate(row.language, strings.map((item) => item.id))}>
                      {uiPair(language, 'Update', '更新')}
                    </Button>
                    <Button size="small" color="error" disabled={busy} onClick={() => removeLanguage(row.language)}>
                      {uiPair(language, 'Delete', '删除')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {!!target && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button onClick={() => setOpenLanguage('')}>{uiPair(language, 'Back to languages', '返回语言列表')}</Button>
            <Typography variant="subtitle1">{languageVersionSummary({ ...config, translations: live }, target).name}</Typography>
            <Button variant="contained" disabled={busy} onClick={() => generate(target)}>
              {busy
                ? uiPair(language, 'Translating…', '正在翻译…')
                : uiPair(language, 'Generate translations', '生成翻译')}
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => generate(target, strings.map((item) => item.id))}>
              {uiPair(language, 'Update this language', '更新此语言')}
            </Button>
            <Button color="error" disabled={busy} onClick={() => removeLanguage(target)}>
              {uiPair(language, 'Delete this language', '删除此语言')}
            </Button>
            <Button onClick={() => write(confirmAllTranslations(live, target))}>
              {uiPair(language, 'Mark all as reviewed', '全部标为已审阅')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {uiPair(
              language,
              'Edits are saved immediately. Update regenerates this language and saves it. Delete removes it from the first-page language question.',
              '修改会立即保存。更新会重新生成此语言并保存。删除后，第一页的语言题不再包含它。',
            )}
          </Typography>
          {strings.map((item) => {
            const cell = live.entries[item.id]?.byLanguage?.[target];
            const status = cell?.text ? cell.status : 'missing';
            return (
              <Box key={item.id} sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, alignItems: 'start' }}>
                <TextField
                  size="small"
                  label={`${item.groupLabel} · ${fieldLabel(item.field, language)}`}
                  value={item.sourceText}
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  key={`${target}:${item.id}`}
                  size="small"
                  label={uiPair(language, 'Translation', '译文')}
                  value={cell?.text || ''}
                  onChange={(event) => write(editTranslation(live, item.id, target, event.target.value))}
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.5 }}>
                  <Chip size="small" color={status === 'reviewed' ? 'success' : status === 'missing' ? 'default' : 'warning'} label={translationStatusLabel(status, language)} />
                  <Button size="small" disabled={!cell?.text || status === 'reviewed'} onClick={() => write(confirmTranslation(live, item.id, target))}>
                    {uiPair(language, 'Mark reviewed', '标为已审阅')}
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
