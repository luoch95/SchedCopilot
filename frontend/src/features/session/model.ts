// Demo identity for the current production line; replace with the authenticated user later.
export const DEMO_PLANNER_ID = 'planner_01';

import { useCallback, useEffect, useState } from 'react';

export type DemoRole = 'sales' | 'planner' | 'leader';
export const DEMO_ROLE_KEY = 'sched-copilot.demo-role.v1';
const HISTORY_KEY = 'sched-copilot.demo-navigation.v1';
const PLANNER_KEY = 'sched-copilot.planner-navigation.v1';

type RequestLink = { id: string; request_no: string; product_id: string; quantity: number };
type PlannerRoute = {
  view: 'dashboard' | 'fault';
  eventOpen: boolean;
  request: RequestLink | null;
};
const plannerHome: PlannerRoute = { view: 'dashboard', eventOpen: false, request: null };

function roleUrl(role: DemoRole | null) {
  return role ? `#/${role}` : '#/roles';
}

function plannerUrl(route: PlannerRoute) {
  const page = route.view === 'fault' ? '#/planner/fault-decision' : '#/planner';
  if (route.request) return `${page}/requests/${encodeURIComponent(route.request.request_no)}`;
  return route.eventOpen ? `${page}/equipment-fault` : page;
}

function plannerEntry(): { route: PlannerRoute; depth: number } {
  return window.history.state?.[PLANNER_KEY] ?? { route: plannerHome, depth: 0 };
}

/** Internal planner views participate in the same history as role selection. */
export function usePlannerNavigation() {
  const [route, setRoute] = useState<PlannerRoute>(() => plannerEntry().route);
  useEffect(() => {
    const onPopState = () => setRoute(plannerEntry().route);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const push = useCallback((next: PlannerRoute) => {
    const parent = plannerEntry();
    // Older tabs may have a visible planner view without its role/route in history.
    // Repair that parent before adding a child, so Back cannot select another role.
    const parentState = {
      ...window.history.state,
      [HISTORY_KEY]: 'planner',
      [PLANNER_KEY]: parent,
    };
    window.history.replaceState(parentState, '', plannerUrl(parent.route));
    window.history.pushState(
      { ...parentState, [PLANNER_KEY]: { route: next, depth: parent.depth + 1 } },
      '',
      plannerUrl(next),
    );
    setRoute(next);
  }, []);
  const openRequest = useCallback(
    (request: RequestLink) => push({ ...route, request }),
    [push, route],
  );

  return {
    ...route,
    openFault: () => push({ ...plannerHome, view: 'fault' }),
    openEvent: () => push({ ...route, eventOpen: true }),
    openRequest,
    back: () => window.history.back(),
  };
}

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
  const next = { ...window.history.state, [HISTORY_KEY]: role };
  delete next[PLANNER_KEY];
  return next;
}

export function resetPlannerNavigation() {
  const role = readRole();
  window.history.replaceState(navigationState(role), '', roleUrl(role));
}

/** A tab-scoped demo identity; browser history owns the current work view. */
export function useDemoSession() {
  const [role, setRole] = useState<DemoRole | null>(readRole);

  useEffect(() => {
    if (historyRole() === undefined) {
      // A restored session also needs an in-app parent for the Back button.
      window.history.replaceState(navigationState(null), '', roleUrl(null));
      if (role) window.history.pushState(navigationState(role), '', roleUrl(role));
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
    window.history.pushState(navigationState(value), '', roleUrl(value));
    storeRole(value);
    setRole(value);
  }

  return {
    role,
    selectRole,
    clearRole: () => window.history.go(-(plannerEntry().depth + 1)),
  };
}
