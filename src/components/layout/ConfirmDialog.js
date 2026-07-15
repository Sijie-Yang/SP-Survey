import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';

/**
 * Shared confirm dialog — replaces window.confirm.
 */
export default function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      {message && (
        <DialogContent>
          <DialogContentText component="div">{message}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button onClick={onCancel} disabled={loading} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          color={confirmColor}
          variant="contained"
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
