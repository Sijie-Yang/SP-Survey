import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Highest admin tab index (Silicon; self-hosted adds a Host tab). The address stays /admin; the step lives in history state. */
export const ADMIN_TAB_HISTORY_MAX = 7;

export function adminTabIndex(value, max = ADMIN_TAB_HISTORY_MAX) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, max);
}

/**
 * Remember admin steps in the browser history without a new path for each step.
 * Back returns to the previous step; the address bar stays on /admin.
 */
export function useAdminTabHistory(maxIndex = ADMIN_TAB_HISTORY_MAX) {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const navigateRef = useRef(navigate);
  const maxRef = useRef(maxIndex);
  locationRef.current = location;
  navigateRef.current = navigate;
  maxRef.current = maxIndex;

  const recorded = location.state?.adminTab;
  const tab = adminTabIndex(typeof recorded === 'number' ? recorded : 0, maxIndex);
  const overlay = location.state?.adminOverlay || null;

  const openTab = useCallback((index, options = {}) => {
    const loc = locationRef.current;
    const next = adminTabIndex(index, maxRef.current);
    const hasRecord = typeof loc.state?.adminTab === 'number';
    const shown = hasRecord ? adminTabIndex(loc.state.adminTab, maxRef.current) : 0;
    const overlayOpen = Boolean(loc.state?.adminOverlay);
    if (next === shown && !overlayOpen) return;
    navigateRef.current(
      { pathname: loc.pathname, search: loc.search, hash: loc.hash },
      {
        replace: options.replace === true || overlayOpen,
        preventScrollReset: true,
        state: { ...(loc.state || {}), adminTab: next, adminOverlay: null },
      },
    );
  }, []);

  const openOverlay = useCallback((name) => {
    const loc = locationRef.current;
    if (!name || loc.state?.adminOverlay === name) return;
    const hasRecord = typeof loc.state?.adminTab === 'number';
    const shown = hasRecord ? adminTabIndex(loc.state.adminTab, maxRef.current) : 0;
    navigateRef.current(
      { pathname: loc.pathname, search: loc.search, hash: loc.hash },
      {
        preventScrollReset: true,
        state: { ...(loc.state || {}), adminTab: shown, adminOverlay: name },
      },
    );
  }, []);

  const closeOverlay = useCallback(() => {
    if (!locationRef.current.state?.adminOverlay) return;
    navigateRef.current(-1);
  }, []);

  return { tab, overlay, openTab, openOverlay, closeOverlay };
}
