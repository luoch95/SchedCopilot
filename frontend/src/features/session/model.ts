import { useEffect, useState } from 'react';

export type DemoRole = 'sales' | 'planner' | 'leader';
export const DEMO_ROLE_KEY = 'sched-copilot.demo-role.v1';
const HISTORY_KEY = 'sched-copilot.demo-navigation.v1';

function validRole(value: unknown): value is DemoRole | null {
  return value === null || value === 'sales' || value === 'planner' || value === 'leader';
}

function historyRole(): DemoRole | null | undefined {
  const value = window.history.state?.[HISTORY_KEY];
  return validRole(value) ? value : undefined;
}

function readRole(): DemoRole | null {
  const saved = historyRole();
  if (saved !== undefined) return saved;
  try {
    const value = window.sessionStorage.getItem(DEMO_ROLE_KEY);
    return value === 'sales' || value === 'planner' || value === 'leader' ? value : null;
  } catch {
    return null;
  }
}

function storeRole(value: DemoRole | null) {
  try {
    if (value) window.sessionStorage.setItem(DEMO_ROLE_KEY, value);
    else window.sessionStorage.removeItem(DEMO_ROLE_KEY);
  } catch {
    // Storage may be disabled. Navigation still works for this page lifetime.
  }
}

function navigationState(role: DemoRole | null) {
  return { ...window.history.state, [HISTORY_KEY]: role };
}

/** A tab-scoped demo identity; browser history owns the current work view. */
export function useDemoSession() {
  const [role, setRole] = useState<DemoRole | null>(readRole);

  useEffect(() => {
    if (historyRole() === undefined) {
      // A restored session also needs an in-app parent for the Back button.
      window.history.replaceState(navigationState(null), '');
      if (role) window.history.pushState(navigationState(role), '');
    }
    const onPopState = () => {
      const value = historyRole() ?? null;
      storeRole(value);
      setRole(value);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Initialize once; subsequent navigation is handled by popstate or selectRole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectRole(value: DemoRole) {
    window.history.pushState(navigationState(value), '');
    storeRole(value);
    setRole(value);
  }

  return {
    role,
    selectRole,
    clearRole: () => window.history.back(),
  };
}
