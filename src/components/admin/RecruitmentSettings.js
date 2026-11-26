import React, { useEffect, useState } from 'react';
import { Alert, Box, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import { cleanCode, cleanReturnUrl, normalizeRecruitment, recruitmentMissing } from '../../lib/recruitment';

const draftFrom = (config) => {
  const r = config?.recruitment || {};
  return {
    platform: r.platform || '',
    completionCode: r.completionCode || '',
    quotaFullCode: r.quotaFullCode || '',
    returnUrl: r.returnUrl || '',
    idParam: r.idParam || '',
  };
};

/** Draft fields → stored setting (only the fields the chosen platform uses). */
export function draftToRecruitment(draft) {
  if (!draft.platform) return undefined;
  const out = { platform: draft.platform };
  if (draft.platform === 'prolific') {
    out.completionCode = draft.completionCode.trim();
    if (draft.quotaFullCode.trim()) out.quotaFullCode = draft.quotaFullCode.trim();
  } else if (draft.returnUrl.trim()) {
    out.returnUrl = draft.returnUrl.trim();
  }
  if (draft.platform === 'other') out.idParam = draft.idParam.trim();
  return out;
}

/**
 * Builder settings: which recruitment platform participants come from, and how they go back.
 * `hideClassicHints` leaves out the hint that points to classic-editor screens
 * (Share, Versions & release), for places that show the links next to it (Studio).
 */
export default function RecruitmentSettings({ config, onChange, hideClassicHints = false }) {
  const { language } = useRegion();
  const t = (en, zh) => uiPair(language, en, zh);
  const [draft, setDraft] = useState(() => draftFrom(config));
  useEffect(() => { setDraft(draftFrom(config)); }, [config?.recruitment]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => {
    setDraft(next);
    onChange('recruitment', draftToRecruitment(next));
  };
  const field = (key) => ({
    value: draft[key],
    onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
    onBlur: () => commit(draft),
  });
  const setting = normalizeRecruitment({ recruitment: draftToRecruitment(draft) });
  const missing = recruitmentMissing(setting);
  const badCode = (v) => Boolean(v.trim()) && !cleanCode(v);
  const badUrl = Boolean(draft.returnUrl.trim()) && !cleanReturnUrl(draft.returnUrl);

  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }} data-testid="recruitment-settings">
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t('Recruitment platform (optional)', '招募平台（可选）')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('Choose this when paid participants come from Prolific or another panel. Participants who arrive from the platform are sent back automatically after their answers are saved, and each platform ID can submit only once.',
          '从 Prolific 等平台招募付费参与者时选择。从平台进来的参与者，答卷保存后会自动跳回平台算完成；同一个平台 ID 只能提交一次。')}
      </Typography>
      <Stack gap={2}>
        <FormControl fullWidth size="small">
          <InputLabel id="recruitment-platform-label">{t('Platform', '平台')}</InputLabel>
          <Select labelId="recruitment-platform-label" label={t('Platform', '平台')} value={draft.platform}
            onChange={(e) => commit({ ...draft, platform: e.target.value })}
            inputProps={{ 'data-testid': 'recruitment-platform' }}>
            <MenuItem value="">{t('Not used', '不使用')}</MenuItem>
            <MenuItem value="prolific">Prolific</MenuItem>
            <MenuItem value="connect">CloudResearch Connect</MenuItem>
            <MenuItem value="other">{t('Other platform (e.g. Credamo)', '其他平台（如见数）')}</MenuItem>
          </Select>
        </FormControl>

        {draft.platform === 'prolific' && <>
          <TextField size="small" fullWidth label={t('Completion code', '完成码')} {...field('completionCode')}
            error={badCode(draft.completionCode)} placeholder="C1A2B3C4"
            helperText={badCode(draft.completionCode)
              ? t('Letters, digits, - and _ only.', '只能包含字母、数字、- 和 _。')
              : t('The code in the "Completion code" box when you create the study on Prolific.', '在 Prolific 建研究时 “Completion code” 那一栏的码。')} />
          <TextField size="small" fullWidth label={t('Code when places are full (optional)', '名额已满时的码（可选）')} {...field('quotaFullCode')}
            error={badCode(draft.quotaFullCode)}
            helperText={t('Used when the response limit above is reached. Leave empty to only show a closed message.', '上面的名额上限满了以后使用。留空则只显示“已满”提示。')} />
        </>}

        {draft.platform === 'connect' && (
          <TextField size="small" fullWidth label={t('Completion redirect link', '完成后跳转链接')} {...field('returnUrl')}
            error={badUrl} placeholder="https://connect.cloudresearch.com/..."
            helperText={badUrl ? t('Must start with https://', '需要以 https:// 开头')
              : t('Copy the completion redirect URL from your Connect project. In Connect, set the participant ID URL parameter to participantId.', '从 Connect 项目设置里复制“完成跳转链接”。在 Connect 里把参与者 ID 的链接参数名设为 participantId。')} />
        )}

        {draft.platform === 'other' && <>
          <TextField size="small" fullWidth label={t('Participant ID parameter name', '参与者 ID 的参数名')} {...field('idParam')} placeholder="uid"
            helperText={t('The name the platform puts in the link, e.g. uid for ...?uid=12345. Ask the platform if unsure.', '平台在链接里放参与者编号用的名字，例如链接是 ...?uid=12345 就填 uid。不确定就问平台客服。')} />
          <TextField size="small" fullWidth label={t('Completion redirect link (optional)', '完成后跳转链接（可选）')} {...field('returnUrl')}
            error={badUrl}
            helperText={badUrl ? t('Must start with https://', '需要以 https:// 开头')
              : t('Where to send participants when they finish. Write {id} where the participant ID belongs. Leave empty to show the thank-you page only.', '做完后跳去的地址，参与者编号的位置写 {id}。留空则只显示感谢页。')} />
        </>}

        {setting && (missing.length
          ? <Alert severity="warning">{t('Fill in the field above before sharing; until then participants are not sent back.', '请先填好上面的必填项；填好之前参与者不会被跳回平台。')}</Alert>
          : !hideClassicHints && <Alert severity="info">{t('Next: Share → Recruitment platform gives the link to paste on the platform. If this survey uses Versions & release, publish again after changing this setting.', '下一步：到「分享 → 招募平台」复制要贴到平台上的链接。如果问卷用了「版本与发布」，改完这里要重新发布一次。')}</Alert>)}
      </Stack>
    </Box>
  );
}
