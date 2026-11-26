import { AdminActionButton } from './AdminPageLayout';
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Box, CircularProgress } from '@mui/material';
import { Download } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { markGuideProgress } from '../../lib/adminGuide';

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
    <Box sx={{ width: 216, maxWidth: '100%', aspectRatio: '1', bgcolor: '#fff', borderRadius: 1, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {dataUrl ? <Box component="img" src={dataUrl} alt={`${t.shareQrAlt}: ${projectName || projectId}`} sx={{ display: 'block', width: '100%', height: '100%' }} />
        : error ? <Alert severity="error">{t.shareQrError}</Alert> : <CircularProgress size={28} aria-label={t.shareQrLoading} />}
    </Box>
    {error ? <AdminActionButton onClick={() => setAttempt((n) => n + 1)}>{t.shareQrRetry}</AdminActionButton>
      : <AdminActionButton component="a" startIcon={<Download />} disabled={!dataUrl} href={dataUrl || undefined} onClick={() => markGuideProgress(projectId, 'shared')} download={`survey-${String(projectId || 'link').replace(/[^\w-]/g, '_')}-qr.png`}>{t.shareQrDownload}</AdminActionButton>}
  </Box>;
}
