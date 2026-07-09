import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  CheckCircle,
  Error as ErrorIcon,
  Refresh,
  Info
} from '@mui/icons-material';
import { API_ROOT, API_BASE_URL } from '../../lib/apiConfig';

/**
 * Backend Status Monitor Component
 * Monitors the backend server status and displays it in the admin panel header
 */
export default function BackendStatus() {
  const [status, setStatus] = useState('checking'); // 'online', 'offline', 'checking'
  const [lastCheck, setLastCheck] = useState(null);
  const [errorCount, setErrorCount] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  // Check backend server health
  const checkBackendStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      const response = await fetch(`${API_ROOT}/projects`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        setStatus('online');
        setErrorCount(0);
        setLastCheck(new Date());
        return true;
      } else {
        throw new Error('Server returned non-OK status');
      }
    } catch (error) {
      console.warn('Backend health check failed:', error.message);
      setStatus('offline');
      setErrorCount(prev => prev + 1);
      setLastCheck(new Date());
      return false;
    }
  }, []);

  // Auto-check every 5 seconds
  useEffect(() => {
    // Initial check
    checkBackendStatus();

    // Set up interval
    const interval = setInterval(() => {
      checkBackendStatus();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [checkBackendStatus]);

  // Copy command to clipboard
  const copyStartCommand = async () => {
    const command = 'npm run dev:safe';
    try {
      await navigator.clipboard.writeText(command);
      alert(
        '✅ Startup command copied to clipboard!\n\n' +
        'Run this in your project directory:\n' +
        '  npm run dev:safe\n\n' +
        'Or use standard mode:\n' +
        '  npm run dev'
      );
    } catch (error) {
      console.error('Failed to copy:', error);
      alert(
        'Failed to copy. Please run manually in your project directory:\n\n' +
        'npm run dev:safe (recommended)\n' +
        'or\n' +
        'npm run dev'
      );
    }
  };

  // Handle automatic restart
  const handleRestart = async () => {
    setIsRestarting(true);
    
    try {
      // Try to trigger auto-restart through a special endpoint
      const response = await fetch(`${API_ROOT}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        alert('✅ Backend server restart initiated!\n\nPlease wait 5-10 seconds for the server to restart.');
        
        // Check status after delay
        setTimeout(() => {
          checkBackendStatus();
          setIsRestarting(false);
        }, 5000);
      } else {
        throw new Error('Restart endpoint failed');
      }
    } catch (error) {
      // If restart endpoint doesn't work, fallback to copy command
      console.warn('Auto-restart failed, showing manual instructions:', error);
      
      const confirmed = window.confirm(
        '⚠️ Backend Server is Offline\n\n' +
        'Auto-restart requires the server to be running.\n\n' +
        'Would you like to:\n' +
        '✅ Copy the startup command to clipboard?\n\n' +
        'You can then paste and run it in your terminal.'
      );
      
      if (confirmed) {
        await copyStartCommand();
      }
      
      setIsRestarting(false);
    }
  };

  // Determine display props based on status
  const getStatusProps = () => {
    switch (status) {
      case 'online':
        return {
          label: 'Backend Online',
          color: 'success',
          icon: <CheckCircle sx={{ fontSize: '1rem' }} />,
          bgcolor: 'success.light',
          textColor: 'success.dark'
        };
      case 'offline':
        return {
          label: 'Backend Offline',
          color: 'error',
          icon: <ErrorIcon sx={{ fontSize: '1rem' }} />,
          bgcolor: 'error.main',
          textColor: 'error.contrastText',
          pulse: true
        };
      case 'checking':
        return {
          label: 'Checking...',
          color: 'default',
          icon: <CircularProgress size={12} sx={{ color: 'inherit' }} />,
          bgcolor: 'action.hover',
          textColor: 'text.secondary'
        };
      default:
        return {
          label: 'Unknown',
          color: 'default',
          icon: <Info sx={{ fontSize: '1rem' }} />,
          bgcolor: 'action.hover',
          textColor: 'text.secondary'
        };
    }
  };

  const statusProps = getStatusProps();

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Status Chip */}
        <Chip
          label={statusProps.label}
          icon={statusProps.icon}
          size="small"
          onClick={() => setDetailsOpen(true)}
          sx={{
            bgcolor: statusProps.bgcolor,
            color: statusProps.textColor,
            fontWeight: 'bold',
            cursor: 'pointer',
            border: '1px solid',
            borderColor: statusProps.pulse ? 'error.dark' : 'transparent',
            transition: 'all 0.3s ease',
            ...(statusProps.pulse && {
              animation: 'pulse 2s infinite',
              '@keyframes pulse': {
                '0%': { 
                  opacity: 1,
                  transform: 'scale(1)'
                },
                '50%': { 
                  opacity: 0.9,
                  transform: 'scale(1.05)'
                },
                '100%': { 
                  opacity: 1,
                  transform: 'scale(1)'
                }
              }
            }),
            '&:hover': {
              opacity: 0.9,
              transform: 'translateY(-1px)',
              boxShadow: 2
            }
          }}
        />

        {/* Restart Button (only show when offline) */}
        {status === 'offline' && (
          <Tooltip title="Restart Backend Server">
            <IconButton
              size="small"
              color="error"
              onClick={handleRestart}
              disabled={isRestarting}
              sx={{
                bgcolor: 'error.main',
                color: 'error.contrastText',
                '&:hover': {
                  bgcolor: 'error.dark'
                },
                animation: 'shake 0.5s infinite',
                '@keyframes shake': {
                  '0%, 100%': { transform: 'translateX(0)' },
                  '25%': { transform: 'translateX(-3px)' },
                  '75%': { transform: 'translateX(3px)' }
                }
              }}
            >
              {isRestarting ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Details Dialog */}
      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Backend Server Status
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Current Status */}
            <Alert 
              severity={status === 'online' ? 'success' : status === 'offline' ? 'error' : 'info'}
              icon={statusProps.icon}
            >
              <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                Status: {statusProps.label}
              </Typography>
              {lastCheck && (
                <Typography variant="body2">
                  Last checked: {lastCheck.toLocaleTimeString()}
                </Typography>
              )}
            </Alert>

            {/* Server Info */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                Server Information:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • URL: {API_BASE_URL}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • API Endpoint: /api/projects
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Check Interval: 5 seconds
              </Typography>
              {errorCount > 0 && (
                <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                  • Failed checks: {errorCount}
                </Typography>
              )}
            </Box>

            {/* Offline Warning */}
            {status === 'offline' && (
              <Alert severity="error">
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Backend server is not responding!</strong>
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  This will prevent:
                </Typography>
                <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px' }}>
                  <li>Saving projects</li>
                  <li>Loading project files</li>
                  <li>Deploying surveys</li>
                </ul>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  To fix: Run <code>npm run dev</code> in your terminal
                </Typography>
              </Alert>
            )}

            {/* Manual Actions */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={() => {
                  checkBackendStatus();
                }}
                fullWidth
              >
                Check Now
              </Button>
              {status === 'offline' && (
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<Refresh />}
                  onClick={handleRestart}
                  disabled={isRestarting}
                  fullWidth
                >
                  {isRestarting ? 'Restarting...' : 'Restart Instructions'}
                </Button>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

