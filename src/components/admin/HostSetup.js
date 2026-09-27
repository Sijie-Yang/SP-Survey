import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
} from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';
import SystemStatus from './SystemStatus';
import ProjectVersions from './ProjectVersions';
import WebsiteSetup from './WebsiteSetup';

export default function HostSetup({
  currentProject,
  surveyConfig,
  hasUnsavedChanges = false,
  onProjectUpdate,
  onReleased,
}) {
  const { t } = useRegion();
  const versionsRef = useRef(null);
  const [urlDraft, setUrlDraft] = useState(currentProject?.deployedParticipantUrl || '');
  const [urlSaved, setUrlSaved] = useState(false);

  useEffect(() => {
    setUrlDraft(currentProject?.deployedParticipantUrl || '');
    setUrlSaved(false);
  }, [currentProject?.id, currentProject?.deployedParticipantUrl]);

  const saveDeployedUrl = () => {
    if (!currentProject || !onProjectUpdate) return;
    const nextUrl = String(urlDraft || '').trim();
    if (nextUrl === String(currentProject.deployedParticipantUrl || '').trim()) {
      setUrlSaved(true);
      return;
    }
    onProjectUpdate({
      ...currentProject,
      deployedParticipantUrl: nextUrl,
    });
    setUrlSaved(true);
  };

  const scrollToVersions = () => {
    versionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box>
      <AdminPageHeader
        icon={<CloudUpload />}
        title={t.hostTitle}
        description={t.hostDescription}
      />

      <Typography variant="h6" sx={{ mb: 1 }}>
        {t.hostBackendTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t.serverDescription}
      </Typography>
      <SystemStatus
        embedded
        surveyConfig={surveyConfig}
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        onSetupComplete={scrollToVersions}
      />

      <Box ref={versionsRef} sx={{ mt: 3 }}>
        <ProjectVersions
          currentProject={currentProject}
          hasUnsavedChanges={hasUnsavedChanges}
          onReleased={onReleased}
        />
      </Box>

      <WebsiteSetup currentProject={currentProject} surveyConfig={surveyConfig} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t.hostDeployedUrlLabel}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t.hostDeployedUrlHelp}
          </Typography>
          <TextField
            fullWidth
            label={t.hostDeployedUrlLabel}
            placeholder={t.hostDeployedUrlPlaceholder}
            value={urlDraft}
            onChange={(e) => {
              setUrlDraft(e.target.value);
              setUrlSaved(false);
            }}
            onBlur={saveDeployedUrl}
          />
          <Button variant="contained" onClick={saveDeployedUrl} sx={{ mt: 2 }} disabled={!currentProject}>
            {urlSaved ? t.hostDeployedUrlSaved : t.hostDeployedUrlSave}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
