import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });

  const showToast = useCallback((message, severity = 'info') => {
    setToast({ open: true, message: String(message || ''), severity });
  }, []);

  const value = useMemo(() => ({
    showToast,
    toastSuccess: (m) => showToast(m, 'success'),
    toastError: (m) => showToast(m, 'error'),
    toastInfo: (m) => showToast(m, 'info'),
    toastWarning: (m) => showToast(m, 'warning'),
  }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: (m) => console.log('[toast]', m),
      toastSuccess: (m) => console.log('[toast]', m),
      toastError: (m) => console.warn('[toast]', m),
      toastInfo: (m) => console.log('[toast]', m),
      toastWarning: (m) => console.warn('[toast]', m),
    };
  }
  return ctx;
}
