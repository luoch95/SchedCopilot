import { useDemoSession, RoleSelection } from '../features/session';
import { SalesPage, LeaderPage } from '../features/sales';
import WorkbenchPage from './WorkbenchPage';

export default function App() {
  const session = useDemoSession();
  if (!session.role) return <RoleSelection onSelect={session.selectRole} />;
  if (session.role === 'planner') return <WorkbenchPage onSwitchRole={session.clearRole} />;
  if (session.role === 'leader') return <LeaderPage onSwitchRole={session.clearRole} />;
  return <SalesPage onSwitchRole={session.clearRole} />;
}
