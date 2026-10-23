import { useDemoSession, RoleSelection, DemoAccess } from '../features/session';
import { SalesPage, LeaderPage } from '../features/sales';
import WorkbenchPage from './WorkbenchPage';
import { AdminPage } from '../features/admin';
import { useEffect } from 'react';
import { workbenchApi } from '../features/workbench';

export default function App() {
  const session = useDemoSession();
  useEffect(() => {
    void workbenchApi.recordVisit().catch(() => {});
  }, []);
  if (window.location.pathname === '/admin') {
    return (
      <DemoAccess>
        <AdminPage
          onSwitchRole={() => {
            window.location.href = '/';
          }}
        />
      </DemoAccess>
    );
  }
  if (!session.role) return <RoleSelection onSelect={session.selectRole} />;
  return (
    <DemoAccess>
      {session.role === 'planner' ? (
        <WorkbenchPage onSwitchRole={session.clearRole} />
      ) : session.role === 'leader' ? (
        <LeaderPage onSwitchRole={session.clearRole} />
      ) : (
        <SalesPage onSwitchRole={session.clearRole} />
      )}
    </DemoAccess>
  );
}
