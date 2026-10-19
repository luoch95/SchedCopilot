import { SessionBar } from '../session';
import { PendingRequestsPanel } from './PendingRequestsPanel';

export function LeaderPage({ onSwitchRole }: { onSwitchRole: () => void }) {
  return (
    <main className="sales-workspace">
      <SessionBar role="leader" onSwitch={onSwitchRole} />
      <h1>紧急插单审批</h1>
      <p>根据已保存的交期与延期影响作出决定。批准后仍须排产计划员复核发布。</p>
      <PendingRequestsPanel leader />
    </main>
  );
}
