import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { CheckCircle, ContentCopy } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import { captureParamNames } from '../../lib/surveyRuntimeContext';
import { PLATFORM_PRESETS, normalizeRecruitment, platformStudyLink, recruitmentIdParam, recruitmentMissing } from '../../lib/recruitment';
import { buildParameterLinks, loadParameterValues, parameterValuesKey, splitValues } from './ParameterLinks';

const mono = { fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 13 };

/**
 * Share tab: the link to paste on the recruitment platform, plus one per group (e.g. per country).
 * `hideClassicHints` leaves out what points to classic-editor screens (Survey Builder →
 * Basic Information): the empty and incomplete notices, which the settings shown with it
 * already cover, and the group advice when no link parameter is set (Studio).
 */
export default function RecruitmentLinks({ surveyUrl, surveyConfig, projectId, hideClassicHints = false }) {
  const { language } = useRegion();
  const t = (en, zh) => uiPair(language, en, zh);
  const setting = normalizeRecruitment(surveyConfig);
  const params = captureParamNames(surveyConfig);
  const [texts, setTexts] = useState(() => loadParameterValues(projectId));
  const [copied, setCopied] = useState('');
  useEffect(() => { setTexts(loadParameterValues(projectId)); }, [projectId]);
  useEffect(() => {
    try { localStorage.setItem(parameterValuesKey(projectId), JSON.stringify(texts)); } catch { /* private mode */ }
  }, [texts, projectId]);
  const groupLinks = useMemo(() => (surveyUrl && setting
    ? buildParameterLinks(surveyUrl, Object.fromEntries(params.map((p) => [p, splitValues(texts[p])])))
      .map((l) => ({ ...l, url: platformStudyLink(l.url, setting) }))
    : []), [surveyUrl, JSON.stringify(setting), params.join('|'), texts]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* manual copy */ }
  };
  const copyButton = (text, key) => (
    <Tooltip title={t('Copy link', '复制链接')}>
      <IconButton size="small" onClick={() => copy(text, key)} aria-label={t('Copy link', '复制链接')}>
        {copied === key ? <CheckCircle color="success" fontSize="small" /> : <ContentCopy fontSize="small" />}
      </IconButton>
    </Tooltip>
  );

  if (!setting) {
    if (hideClassicHints) return null;
    return (
      <Alert severity="info" data-testid="recruitment-links-empty">
        {t('No recruitment platform is set. To recruit paid participants from Prolific, CloudResearch Connect or another panel, open the survey settings (Survey Builder → Basic Information) and choose a platform under "Recruitment platform".',
          '还没有设置招募平台。要从 Prolific、CloudResearch Connect 或其他平台招募付费参与者，请到「问卷构建 → 基本信息」里的“招募平台”选择平台。')}
      </Alert>
    );
  }
  const name = setting.platform === 'other' ? t('the platform', '平台') : PLATFORM_PRESETS[setting.platform].label;
  const mainLink = platformStudyLink(surveyUrl, setting);
  const missing = recruitmentMissing(setting);
  const idParam = recruitmentIdParam(setting);

  const steps = {
    prolific: [
      t('On Prolific, create a study and choose "URL parameters" for how to record Prolific IDs.', '在 Prolific 新建研究，记录参与者 ID 的方式选 “URL parameters”。'),
      t('Paste the link below as the study URL.', '把下面的链接贴到研究链接（Study URL）一栏。'),
      t('Choose "Redirect to Prolific" for completion and copy its code into the survey settings (already done if the code shows below).', '完成方式选 “Redirect”，把 Prolific 给的完成码填进问卷设置（下面显示了完成码就说明已填）。'),
    ],
    connect: [
      t('In your Connect project, turn on adding the participant ID to the link and name the parameter participantId.', '在 Connect 项目里打开“把参与者 ID 加到链接里”，参数名设为 participantId。'),
      t('Paste the link below as the survey link.', '把下面的链接贴到问卷链接一栏。'),
      t('Copy Connect\'s completion redirect link into the survey settings.', '把 Connect 给的完成跳转链接填进问卷设置。'),
    ],
    other: [
      t(`Ask the platform to add the participant ID to the link as ?${idParam || 'uid'}=…`, `请平台在链接后面加上参与者编号：?${idParam || 'uid'}=…`),
      t('Give the platform the link below.', '把下面的链接交给平台。'),
      t('If the platform gives you a completion link, put it in the survey settings; otherwise participants see the thank-you page.', '平台给了完成跳转链接就填进问卷设置；没有的话参与者看到感谢页。'),
    ],
  }[setting.platform];

  return (
    <Box data-testid="recruitment-links">
      {missing.length > 0 && !hideClassicHints && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('The recruitment setting is incomplete, so participants will not be sent back yet. Finish it in Survey Builder → Basic Information.', '招募平台设置还没填完，参与者暂时不会被跳回平台。请到「问卷构建 → 基本信息」补全。')}
        </Alert>
      )}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t(`How to connect ${name}`, `如何接入 ${name}`)}</Typography>
      <Box component="ol" sx={{ pl: 3, mt: 0, mb: 2 }}>
        {steps.map((s, i) => <Typography component="li" variant="body2" key={i} sx={{ mb: 0.5 }}>{s}</Typography>)}
      </Box>

      <Typography variant="subtitle2" fontWeight={700}>{t(`Link to paste on ${name}`, `贴到 ${name} 的链接`)}</Typography>
      <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Box sx={{ ...mono, flex: 1 }} data-testid="recruitment-main-link">{mainLink}</Box>
        {copyButton(mainLink, 'main')}
      </Stack>
      {setting.platform === 'prolific' && setting.completionCode && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('Completion code participants are sent back with:', '参与者跳回时带的完成码：')} <strong>{setting.completionCode}</strong>
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('Only people who arrive with a platform ID are sent back; opening the plain link yourself just shows the thank-you page. Each platform ID can submit once. Results and exports get the columns recruit_platform and recruit_id.',
          '只有带着平台 ID 进来的人才会被跳回；你自己打开普通链接只会看到感谢页。每个平台 ID 只能提交一次。结果导出多出 recruit_platform、recruit_id 两列。')}
      </Typography>

      {(params.length > 0 || !hideClassicHints) && <Typography variant="subtitle2" fontWeight={700}>{t('Several countries or groups', '多个国家 / 分组')}</Typography>}
      {!params.length ? (!hideClassicHints && (
        <Typography variant="body2" color="text.secondary">
          {t('Create one study per country on the platform, each with its own places. To tell them apart in the results, add a link parameter such as country under "URL parameters to record" in the survey settings; this panel then builds one link per country.',
            '在平台上每个国家建一个研究，各设人数。要在结果里区分国家，请在问卷设置的“记录的链接参数”里加上 country 之类的参数，这里就会为每个国家生成一个链接。')}
        </Typography>
      )) : <>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('One study per country on the platform, each with its own link below. Results can be grouped by this value.', '平台上每个国家建一个研究，各用下面对应的链接。结果页可以按这个值分组。')}
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ mb: 1 }}>
          {params.map((p) => (
            <TextField key={p} fullWidth multiline minRows={2} size="small"
              label={t(`Values for ${p} (one per line)`, `${p} 的取值（每行一个）`)} placeholder={'UK\nUS\nDE'}
              value={texts[p] || ''} onChange={(e) => setTexts({ ...texts, [p]: e.target.value })} />
          ))}
        </Stack>
        {groupLinks.length > 0 && <>
          <Button size="small" variant="outlined" sx={{ mb: 1 }} startIcon={copied === 'all' ? <CheckCircle /> : <ContentCopy />}
            onClick={() => copy(groupLinks.map((l) => `${Object.values(l.params).join(', ')}\t${l.url}`).join('\n'), 'all')}>
            {t(`Copy all ${groupLinks.length} links`, `复制全部 ${groupLinks.length} 个链接`)}
          </Button>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 300, overflow: 'auto' }}>
            {groupLinks.map((l) => (
              <Stack key={l.url} direction="row" alignItems="center" gap={1} sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 70 }}>{Object.values(l.params).join(', ')}</Typography>
                <Box sx={{ ...mono, flex: 1 }}>{l.url}</Box>
                {copyButton(l.url, l.url)}
              </Stack>
            ))}
          </Box>
        </>}
      </>}
    </Box>
  );
}
