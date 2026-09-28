import { useBlocker } from 'react-router-dom';
import useUnsavedChanges from './useUnsavedChanges';

/** Uses the router's history blocker so Back/Forward retain the mounted editor. */
export default function useRouteUnsavedChanges(dirty) {
  const actions = useUnsavedChanges(dirty);
  const blocker = useBlocker(dirty);
  const blocked = blocker.state === 'blocked';
  return {
    request: actions.request,
    open: actions.open || blocked,
    cancel: () => { if (blocked) blocker.reset(); else actions.cancel(); },
    discard: () => { if (blocked) blocker.proceed(); else actions.discard(); },
  };
}
