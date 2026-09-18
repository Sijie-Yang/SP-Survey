import { useCallback, useEffect, useState } from 'react';

/** Protect reload/close and explicit editor actions without persisting draft content. */
export default function useUnsavedChanges(dirty) {
  const [pending, setPending] = useState(null);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const request = useCallback((action) => {
    if (dirty) setPending(() => action);
    else action();
  }, [dirty]);
  return {
    request,
    open: !!pending,
    cancel: () => setPending(null),
    discard: () => { setPending(null); pending?.(); },
  };
}
