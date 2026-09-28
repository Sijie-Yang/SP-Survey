import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { Download } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';

export default function SurveyQrCode({ surveyUrl, projectId, projectName }) {
  const { t } = useRegion();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dataUrl = result?.surveyUrl === surveyUrl ? result.dataUrl : null;

  useEffect(() => {
    let cancelled = false;
    setResult(null); setError(false);
    // Generate locally; the encoded URL is identical to the displayed participant link.
    QRCode.toDataURL(surveyUrl, {
      type: 'image/png', width: 1024, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    }).then((png) => { if (!cancelled) setResult({ surveyUrl, dataUrl: png }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [surveyUrl, attempt]);

  return <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 0 }}>
    <Box sx={{ width: 216, maxWidth: '100%', aspectRatio: '1', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {dataUrl ? <Box component="img" src={dataUrl} alt={`${t.shareQrAlt}: ${projectName || projectId}`} sx={{ display: 'block', width: '100%', height: '100%' }} />
        : error ? <Alert severity="error">{t.shareQrError}</Alert> : <CircularProgress size={28} aria-label={t.shareQrLoading} />}
    </Box>
    {error ? <Button onClick={() => setAttempt((n) => n + 1)} sx={{ minHeight: 44 }}>{t.shareQrRetry}</Button>
      : <Button component="a" variant="outlined" startIcon={<Download />} disabled={!dataUrl} href={dataUrl || undefined} download={`survey-${String(projectId || 'link').replace(/[^\w-]/g, '_')}-qr.png`} sx={{ minHeight: 44 }}>{t.shareQrDownload}</Button>}
    <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 280 }}>{t.shareQrHint}</Typography>
  </Box>;
}
