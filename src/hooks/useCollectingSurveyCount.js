import { useEffect, useState } from 'react';
import { getUserProjects } from '../lib/projectManager';
import { countCollectingSurveys } from '../lib/collectingSurveys';

/**
 * Published surveys this account owns that are still open for responses.
 * Uses getUserProjects (owned rows plus invited rows) and then drops
 * anything that is not this user's.
 */
export function useCollectingSurveyCount({ userId = null, refreshKey = '', pollMs = 60000 } = {}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getUserProjects()
        .then((projects) => {
          if (!cancelled) setCount(countCollectingSurveys(projects, { userId }));
        })
        .catch(() => {
          if (!cancelled) setCount(0);
        });
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [userId, refreshKey, pollMs]);

  return count;
}
