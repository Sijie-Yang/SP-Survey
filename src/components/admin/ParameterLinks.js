import React, { useEffect, useMemo, useState } from 'react';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import QRCode from 'qrcode';
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { CheckCircle, ContentCopy, Download, QrCode2 } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { captureParamNames, normalizeConditions } from '../../lib/surveyRuntimeContext';
const MAX_LINKS = 200;
export const parameterValuesKey = projectId => `sp_param_link_values_${projectId || 'default'}`;
export function splitValues(text) {
  return [...new Set(String(text || '').split(/[\n,]+/).map(v => v.trim()).filter(Boolean))];
}

/** One link per combination of the entered values (params without values are left out). */
export function buildParameterLinks(baseUrl, valuesByParam) {
  let combos = [{}];
  Object.entries(valuesByParam).forEach(([name, values]) => {
    if (!values.length) return;
    combos = combos.flatMap(c => values.map(v => ({
      ...c,
      [name]: v
    }))).slice(0, MAX_LINKS);
  });
  if (combos.length === 1 && !Object.keys(combos[0]).length) return [];
  return combos.map(params => {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return {
      params,
      url: url.toString()
    };
  });
}
export function loadParameterValues(projectId) {
  try {
    return JSON.parse(localStorage.getItem(parameterValuesKey(projectId)) || '{}') || {};
  } catch {
    return {};
  }
}
function downloadBlob(content, filename, type) {
  const a = document.createElement('a');
  a.href = typeof content === 'string' && content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], {
    type
  }));
  a.download = filename;
  a.click();
}

/** Share tab: explains the recorded link parameters and builds one link + QR code per value. */
export default function ParameterLinks({
  surveyUrl,
  surveyConfig,
  projectId
}) {
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const params = captureParamNames(surveyConfig);
  const hasConditions = normalizeConditions(surveyConfig).length > 1;
  const [texts, setTexts] = useState(() => loadParameterValues(projectId));
  const [copied, setCopied] = useState('');
  useEffect(() => {
    setTexts(loadParameterValues(projectId));
  }, [projectId]);
  useEffect(() => {
    try {
      localStorage.setItem(parameterValuesKey(projectId), JSON.stringify(texts));
    } catch {/* private mode */}
  }, [texts, projectId]);
  const links = useMemo(() => surveyUrl ? buildParameterLinks(surveyUrl, Object.fromEntries(params.map(p => [p, splitValues(texts[p])]))) : [], [surveyUrl, params.join('|'), texts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!surveyUrl || !params.length && !hasConditions) return null;
  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {/* manual copy */}
  };
  const label = link => Object.entries(link.params).map(([k, v]) => `${k}=${v}`).join(', ');
  const fileSafe = link => Object.values(link.params).join('-').replace(/[^\w-]/g, '_');
  const downloadQr = async link => {
    const png = await QRCode.toDataURL(link.url, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: 'M'
    });
    downloadBlob(png, `survey-${fileSafe(link)}-qr.png`);
  };
  const downloadCsv = () => {
    const header = [...params, 'url'];
    const rows = links.map(l => [...params.map(p => l.params[p] || ''), l.url]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(`\ufeff${csv}\n`, 'survey-links.csv', 'text/csv;charset=utf-8');
  };
  return <Card sx={{
    mb: 3
  }}>
      <CardContent>
        {hasConditions && <Alert severity="info" sx={{
        mb: params.length ? 2 : 0
      }}>
            {uiPair(language, 'This survey has experimental conditions: everyone opens the same link above and is randomly assigned. No separate links are needed.', '本问卷设置了实验条件：每位参与者打开上面的同一个链接时会被随机分到一个条件，不需要为不同条件准备不同的链接。')}
          </Alert>}
        {params.length > 0 && <>
            <Typography variant="subtitle1" fontWeight={700} sx={{
          mb: 1
        }}>
              {uiPair(language, 'Links with parameters (one per site or channel)', '带参数的链接（每个地点 / 渠道一个链接）')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{
          mb: 1
        }}>
              {zh ? `这份问卷会记录链接中的参数：${params.join('、')}。在下方填入取值，每个取值会生成一个专属链接和二维码，例如在每个调查地点张贴不同的二维码，或把外部平台的参与者编号带进来。` : `This survey records these link parameters: ${params.join(', ')}. Enter values below to get one link and QR code per value, e.g. a different QR code at each site, or a participant ID passed in from another platform.`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{
          mb: 2
        }}>
              {zh ? `参与者用哪个链接打开，结果里就记录对应的值（导出列：${params.map(p => `url_${p}`).join('、')}），结果页可以按它分组。题目或页面也可以设置为只在有这个参数时显示。上面的普通链接不带参数。` : `The value from the link a participant used is saved with the response (export columns: ${params.map(p => `url_${p}`).join(', ')}) and can be used to group results. Questions or pages can also be shown only when the parameter is present. The plain link above has no parameter.`}
            </Typography>
            <Stack direction={{
          xs: 'column',
          md: 'row'
        }} gap={2} sx={{
          mb: 2
        }}>
              {params.map(p => <TextField key={p} fullWidth multiline minRows={3} label={zh ? `${p} 的取值（每行一个）` : `Values for ${p} (one per line)`} placeholder={'S01\nS02\nS03'} value={texts[p] || ''} onChange={e => setTexts({
            ...texts,
            [p]: e.target.value
          })} />)}
            </Stack>
            {links.length > 0 && <>
                <Stack direction="row" gap={1} sx={{
            mb: 1
          }} flexWrap="wrap">
                  <Button size="small" variant="outlined" startIcon={copied === 'all' ? <CheckCircle /> : <ContentCopy />} onClick={() => copy(links.map(l => l.url).join('\n'), 'all')}>
                    {zh ? `复制全部 ${links.length} 个链接` : `Copy all ${links.length} links`}
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<Download />} onClick={downloadCsv}>
                    {uiPair(language, 'Download link list (CSV)', '下载链接表（CSV）')}
                  </Button>
                </Stack>
                <Box sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: 360,
            overflow: 'auto'
          }}>
                  {links.map(link => <Box key={link.url} sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderBottom: 1,
              borderColor: 'divider'
            }}>
                      <Typography variant="body2" fontWeight={600} sx={{
                minWidth: 110
              }}>{label(link)}</Typography>
                      <Typography variant="body2" sx={{
                fontFamily: 'monospace',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>{link.url}</Typography>
                      <Tooltip title={uiPair(language, 'Copy link', '复制链接')}>
                        <IconButton size="small" onClick={() => copy(link.url, link.url)}>{copied === link.url ? <CheckCircle color="success" fontSize="small" /> : <ContentCopy fontSize="small" />}</IconButton>
                      </Tooltip>
                      <Tooltip title={uiPair(language, 'Download QR code', '下载二维码')}>
                        <IconButton size="small" onClick={() => downloadQr(link)}><QrCode2 fontSize="small" /></IconButton>
                      </Tooltip>
                    </Box>)}
                </Box>
              </>}
          </>}
      </CardContent>
    </Card>;
}