import React, { useCallback, useEffect, useState } from 'react';
import { AppBar, Box, Button, Drawer, IconButton, Toolbar, Tooltip, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Close, MenuOpen } from '@mui/icons-material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import RegionSwitcher from '../components/admin/RegionSwitcher';
import StudioSidebar, { STUDIO_SIDEBAR_WIDTH } from '../components/studio/StudioSidebar';
import StudioNewStudy from '../components/studio/StudioNewStudy';
import StudioProject from '../components/studio/StudioProject';
import { useL } from '../components/studio/studioUi';
import { isStudioLocalMode, listStudioProjects } from '../lib/studioData';
import { sortProjectsNewestFirst } from '../lib/studioProject';

const HEADER_HEIGHT = 64;

/** Self-hosted header: the logo and the language switch (the classic editor link is in the sidebar). */
function StudioHeader() {
  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar sx={{ minHeight: HEADER_HEIGHT, gap: 1 }}>
        <Box component={RouterLink} to="/studio" sx={{ display: 'flex', alignItems: 'center', mr: 'auto' }} aria-label="SP-Survey Studio">
          <Box component="img" src="/logo-web-header.png" alt="SP-Survey" sx={{ height: 32 }} />
        </Box>
        <RegionSwitcher variant="public" />
      </Toolbar>
    </AppBar>
  );
}

/**
 * Studio: the simple workspace. A list of studies on the left, and either the
 * "new study" screen (/studio) or one study on one screen (/studio/:projectId).
 * The classic editor stays at /admin as an equal choice.
 */
export default function StudioPage() {
  const L = useL();
  const { projectId = null } = useParams();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const localMode = isStudioLocalMode();
  const [projects, setProjects] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const reloadProjects = useCallback(async () => {
    try {
      setProjects(await listStudioProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  // After a write on the study's page, its row in the list changes in place.
  const projectSaved = useCallback((saved) => {
    if (!saved?.id) return;
    setProjects((prev) => (prev ? sortProjectsNewestFirst(prev.map((p) => (p.id === saved.id ? { ...p, ...saved } : p))) : prev));
  }, []);

  useEffect(() => { reloadProjects(); }, [reloadProjects]);
  useEffect(() => { setDrawerOpen(false); }, [projectId, desktop]);

  const sidebar = (
    <StudioSidebar
      projects={projects}
      selectedId={projectId}
      localMode={localMode}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <StudioHeader />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {desktop && (
          <Box
            component="aside"
            sx={{
              width: STUDIO_SIDEBAR_WIDTH,
              flexShrink: 0,
              position: 'sticky',
              top: HEADER_HEIGHT,
              alignSelf: 'flex-start',
              height: `calc(100vh - ${HEADER_HEIGHT}px)`,
              borderRight: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.default',
            }}
          >
            {sidebar}
          </Box>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!desktop && (
            <Box sx={{ px: 2, py: 1, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Button
                size="small"
                startIcon={<MenuOpen />}
                onClick={() => setDrawerOpen(true)}
                sx={{ color: 'text.primary' }}
                aria-controls={drawerOpen ? 'studio-drawer' : undefined}
                aria-expanded={drawerOpen}
              >
                {L('My studies', '我的研究')}
              </Button>
            </Box>
          )}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {projectId
              ? <StudioProject key={projectId} projectId={projectId} onProjectsChanged={reloadProjects} onProjectSaved={projectSaved} />
              : <StudioNewStudy onProjectsChanged={reloadProjects} />}
          </Box>
        </Box>
      </Box>

      {!desktop && (
        <Drawer
          id="studio-drawer"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={{ sx: { width: Math.min(STUDIO_SIDEBAR_WIDTH + 16, 320), maxWidth: '85vw', bgcolor: 'background.default' } }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, pt: 1 }}>
            <Tooltip title={L('Close', '关闭')}>
              <IconButton onClick={() => setDrawerOpen(false)} aria-label={L('Close', '关闭')}><Close /></IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>{sidebar}</Box>
        </Drawer>
      )}
    </Box>
  );
}
