import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  Chip
} from '@mui/material';
import {
  CloudSync,
  CheckCircle,
  Error,
  Info
} from '@mui/icons-material';
import { isSupabaseConfigured } from '../../lib/supabase';
import { checkImageFolderStatus } from '../../lib/supabase';

export default function ImageManager({ images, onChange }) {
  const [checking, setChecking] = useState(false);
  const [folderStatus, setFolderStatus] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  // Auto-check status on component mount and every 10 seconds
  useEffect(() => {
    if (isSupabaseConfigured()) {
      handleCheckStatus();
      const checkInterval = setInterval(() => {
        handleCheckStatus();
      }, 10000);
      return () => clearInterval(checkInterval);
    }
  }, []);

  const handleCheckStatus = async () => {
    setChecking(true);
    setFolderStatus(null);
    try {
      const raw = await checkImageFolderStatus();
      setFolderStatus({
        success: raw.success,
        connected: raw.connected,
        bucketExists: raw.bucketExists,
        imageCount: raw.imageCount || 0,
        error: raw.error,
        message: raw.message,
      });
      setLastChecked(new Date().toLocaleString());
    } catch (error) {
      console.error('Error checking Supabase Storage status:', error);
      setFolderStatus({ success: false, error: error.message, bucketExists: false, imageCount: 0 });
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = () => {
    if (!folderStatus) return <Info color="action" />;
    if (folderStatus.success && folderStatus.bucketExists) return <CheckCircle color="success" />;
    return <Error color="error" />;
  };

  const getStatusMessage = () => {
    if (!isSupabaseConfigured()) {
      return {
        type: 'error',
        message: 'Supabase is not configured. Save credentials in Step 1 — Image Dataset first.'
      };
    }
    if (!folderStatus) {
      return { type: 'info', message: 'Click "Check Storage Status" to verify your Supabase setup.' };
    }
    if (folderStatus.success && folderStatus.bucketExists) {
      return { type: 'success', message: `Connected to Supabase Storage (${folderStatus.imageCount || 0} image(s) in survey-images bucket).` };
    }
    return { type: 'error', message: `❌ Connection failed: ${folderStatus.error || 'Unknown error'}` };
  };

  const statusInfo = getStatusMessage();

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, color: 'primary.main' }}>
          Image Manager
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Simplified image management - just check your image folder status and follow the setup guide.
        </Typography>
        
        {/* Setup Instructions */}
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            📋 Setup Instructions:
          </Typography>
          <Typography variant="body2" component="div">
            1. Configure Supabase in <strong>Step 1 — Image Dataset</strong> (Supabase Storage Configuration)<br/>
            2. Ensure a public bucket named <code>survey-images</code> exists<br/>
            3. Click &quot;Check Storage Status&quot; below to verify
          </Typography>
        </Alert>

        {/* Status Alert */}
        <Alert severity={statusInfo.type} sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {getStatusIcon()}
            <Typography variant="body2">
              {statusInfo.message}
            </Typography>
          </Box>
          {lastChecked && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Last checked: {lastChecked}
            </Typography>
          )}
        </Alert>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<CloudSync />}
            onClick={handleCheckStatus}
            disabled={checking || !isSupabaseConfigured()}
            size="large"
          >
            {checking ? 'Checking...' : 'Check Storage Status'}
          </Button>
          
        </Box>

        {/* Status Details */}
        {folderStatus && folderStatus.success && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              📊 Folder Status Details:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip 
                label={`Bucket: ${folderStatus.bucketExists ? '✅ Found' : '❌ Missing'}`}
                color={folderStatus.bucketExists ? 'success' : 'error'}
                variant="outlined"
              />
              <Chip 
                label={`Images: ${folderStatus.imageCount}`}
                color={folderStatus.imageCount > 0 ? 'success' : 'warning'}
                variant="outlined"
              />
              <Chip 
                label={`Supabase Storage: ${folderStatus.connected ? 'OK' : 'Failed'}`}
                color={folderStatus.connected ? 'success' : 'error'}
                variant="outlined"
              />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
