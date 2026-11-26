import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { countStoredProjectResponses, formatSurveyAgeLabel } from '../../lib/surveyAge';

export function useStoredResponseCount(projectId) {
  const [count, setCount] = useState(undefined);
  useEffect(() => {
    if (!projectId) {
      setCount(null);
      return undefined;
    }
    let cancelled = false;
    setCount(undefined);
    const load = () => {
      countStoredProjectResponses(projectId).then((value) => {
        if (!cancelled) setCount(value);
      });
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [projectId]);
  return count;
}

/** Project name plus how long this survey has been up and how many answers are stored. */
export function ProjectHeaderTitle({ project, responseCount, now }) {
  const { t } = useRegion();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (now != null) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [now]);
  if (!project) return null;
  const label = formatSurveyAgeLabel({
    project,
    responseCount,
    now: now ?? clock,
    t,
  });
  return (
    <Box sx={{ minWidth: 0 }} data-testid="project-header">
      <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold', lineHeight: 1.15 }}>
        {project.name}
      </Typography>
      {label ? (
        <Typography
          variant="caption"
          component="p"
          data-testid="survey-age"
          title={label}
          noWrap
          sx={{ m: 0, opacity: 0.92, lineHeight: 1.2, fontWeight: 500 }}
        >
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function OpenProjectHeader({ project }) {
  const responseCount = useStoredResponseCount(project?.id);
  return <ProjectHeaderTitle project={project} responseCount={responseCount} />;
}
