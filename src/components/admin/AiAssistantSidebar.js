import React, { useState } from 'react';
import {
  Box,
  Drawer,
  IconButton,
  Typography,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
} from '@mui/material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  Close,
  Settings,
  Clear,
  Download,
  SmartToy,
  MoreHoriz,
} from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import ChatAssistant from './ChatAssistant';
import { chatPropsFromLocalAssistant } from '../../hooks/useLocalSurveyAssistant';
import { AI_SIDEBAR_ID, AI_SIDEBAR_WIDTH } from '../../hooks/surveyAssistantUtils';

export default function AiAssistantSidebar({
  open,
  onClose,
  assistant,
  variant = 'persistent',
  width = AI_SIDEBAR_WIDTH,
}) {
  const { t } = useRegion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const chatProps = chatPropsFromLocalAssistant(assistant);

  return (
    <Drawer
      id={AI_SIDEBAR_ID}
      anchor="right"
      open={open}
      onClose={onClose}
      variant={variant}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: variant === 'persistent' && open ? width : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: variant === 'temporary' ? 'min(420px, 100vw)' : width,
          maxWidth: '100vw',
          boxSizing: 'border-box',
          top: variant === 'persistent' ? '64px' : 0,
          height: variant === 'persistent' ? 'calc(100vh - 64px)' : '100%',
          borderLeft: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box
        sx={{
          px: 1.75,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 32,
              height: 32,
              borderRadius: 2.5,
              color: 'primary.main',
              bgcolor: 'action.hover',
              flexShrink: 0,
            }}
          >
            <SmartToy sx={{ fontSize: 19 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.25 }} noWrap>
                {t.aiSidebarTitle}
              </Typography>
              <Box
                role="img"
                aria-label={assistant?.apiKeyValid ? t.aiSidebarConnected : t.aiSidebarDisconnected}
                title={assistant?.apiKeyValid ? t.aiSidebarConnected : t.aiSidebarDisconnected}
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: assistant?.apiKeyValid ? 'success.main' : 'text.disabled',
                  flexShrink: 0,
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 205 }}>
              {assistant?.currentProject?.name || t.aiSidebarSubtitle}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {chatProps.messages?.length > 0 && (
            <Tooltip title={t.aiSidebarMore}>
              <IconButton
                size="small"
                onClick={(event) => setMenuAnchor(event.currentTarget)}
                aria-label={t.aiSidebarMore}
                aria-haspopup="menu"
                aria-expanded={Boolean(menuAnchor)}
              >
                <MoreHoriz fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t.aiSidebarSettings}>
            <IconButton
              size="small"
              onClick={() => setSettingsOpen(true)}
              aria-label={t.aiSidebarSettings}
            >
              <Settings fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.aiSidebarClose}>
            <IconButton size="small" onClick={onClose} aria-label={t.aiSidebarClose}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 190, borderRadius: 2.5 } } }}
      >
        {chatProps.messages?.length > 0 && (
          <MenuItem onClick={() => { setMenuAnchor(null); chatProps.onDownloadHistory?.(); }}>
            <ListItemIcon><Download fontSize="small" /></ListItemIcon>
            {t.aiSidebarDownload}
          </MenuItem>
        )}
        {chatProps.messages?.length > 0 && (
          <MenuItem onClick={() => { setMenuAnchor(null); setConfirmClear(true); }}>
            <ListItemIcon><Clear fontSize="small" color="error" /></ListItemIcon>
            {t.aiSidebarClear}
          </MenuItem>
        )}
      </Menu>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ChatAssistant
          variant="content"
          fillHeight
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          {...chatProps}
        />
      </Box>
      <ConfirmDialog
        open={confirmClear}
        title={t.aiClearHistoryTitle}
        message={t.aiClearHistoryMessage}
        confirmLabel={t.aiClearHistoryConfirm}
        confirmColor="error"
        onConfirm={() => {
          setConfirmClear(false);
          chatProps.onClearHistory?.();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </Drawer>
  );
}
