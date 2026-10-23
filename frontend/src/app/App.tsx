import { useDemoSession, RoleSelection, DemoAccess } from '../features/session';
import { SalesPage, LeaderPage } from '../features/sales';
import WorkbenchPage from './WorkbenchPage';

export default function App() {
  const session = useDemoSession();
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
