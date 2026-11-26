import React from 'react';
import { Box, Button, CircularProgress, Divider, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import { Add, ViewListOutlined } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { projectKind, projectStatus } from '../../lib/studioProject';
import { adminProjectPath, studioPathForProject } from '../../lib/adminDeepLink';
import { setActiveProject } from '../../lib/projectManager';
import { KindIcon, StatusChip, useL } from './studioUi';

export const STUDIO_SIDEBAR_WIDTH = 264;

// The list tells drafts, live studies and published studies apart; waiting changes show on the study's page.
function listStatus(project) {
  const status = projectStatus(project);
  return status.state === 'pending' ? { ...status, state: 'published' } : status;
}

/** New study, the researcher's studies (newest first), and the classic editor. */
export default function StudioSidebar({ projects, selectedId = null, localMode = false, onNavigate = () => {} }) {
  const L = useL();
  return (
    <Box
      component="nav"
      aria-label={L('My studies', '我的研究')}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', px: 1.5, py: 2, minHeight: 0 }}
    >
      <Button
        component={RouterLink}
        to={studioPathForProject(null)}
        onClick={onNavigate}
        startIcon={<Add />}
        variant="outlined"
        sx={{
          justifyContent: 'flex-start',
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderColor: 'divider',
          borderRadius: '10px',
          py: 1.1,
          px: 1.5,
          mb: 2,
          '&:hover': { borderColor: 'text.secondary', bgcolor: 'background.paper' },
        }}
      >
        {L('New study', '新建研究')}
      </Button>

      <Typography variant="caption" color="text.secondary" sx={{ px: 1.25, pb: 0.5 }}>
        {L('My studies', '我的研究')}
      </Typography>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', mx: -0.5, px: 0.5 }}>
        {projects === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} aria-label={L('Loading', '加载中')} /></Box>
        ) : projects.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.25, py: 1 }}>
            {L('No studies yet.', '还没有研究。')}
          </Typography>
        ) : (
          <List dense disablePadding data-testid="studio-project-list">
            {projects.map((project) => {
              const selected = project.id === selectedId;
              return (
                <ListItemButton
                  key={project.id}
                  component={RouterLink}
                  to={studioPathForProject(project.id)}
                  onClick={onNavigate}
                  selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  sx={{
                    borderRadius: '8px',
                    mb: 0.25,
                    gap: 0.75,
                    py: 0.9,
                    '&.Mui-selected': { bgcolor: 'action.selected', '& .MuiListItemText-primary': { fontWeight: 600 } },
                  }}
                >
                  <ListItemText
                    primary={project.name || L('Untitled study', '未命名研究')}
                    primaryTypographyProps={{ noWrap: true, fontSize: 14 }}
                    sx={{ minWidth: 0, my: 0 }}
                  />
                  <KindIcon kind={projectKind(project)} />
                  {!localMode && <StatusChip status={listStatus(project)} />}
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Box>

      <Divider sx={{ my: 1 }} />
      <ListItemButton
        component={RouterLink}
        to={adminProjectPath(selectedId)}
        onClick={() => {
          // The classic editor opens the study selected here.
          if (selectedId) setActiveProject(selectedId);
          onNavigate();
        }}
        data-testid="studio-classic-link"
        sx={{ borderRadius: '8px', flexGrow: 0 }}
      >
        <ListItemIcon sx={{ minWidth: 34 }}><ViewListOutlined fontSize="small" /></ListItemIcon>
        <ListItemText
          primary={L('Classic editor', '经典编辑器')}
          secondary={L('Build question by question', '一题一题地搭')}
          primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
          secondaryTypographyProps={{ fontSize: 12 }}
        />
      </ListItemButton>
    </Box>
  );
}
