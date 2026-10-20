import { SessionBar } from '../session';
import { useState } from 'react';
import type { InsertionRequestRecord } from '../../shared/api/contracts';
import { Modal } from '../../shared/ui/Modal';
import { LeaderFormalPlan } from '../plan';
import { WorkshopOverview } from './WorkshopOverview';
import { PendingRequestsPanel } from './PendingRequestsPanel';

export function LeaderPage({ onSwitchRole }: { onSwitchRole: () => void }) {
  const [selected, setSelected] = useState<InsertionRequestRecord | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <main className="sales-workspace leader-workspace">
      <header className="page-header">
        <div>
          <h1>排产计划工作台</h1>
          <p>审批紧急插单，查看车间概况与当前已发布的生产安排。</p>
        </div>
        <div className="workbench-identity">
          <SessionBar role="leader" onSwitch={onSwitchRole} disabled={busy} />
        </div>
      </header>
      <PendingRequestsPanel leader onOpen={setSelected} refreshVersion={refresh} />
      <WorkshopOverview />
      <LeaderFormalPlan />
      {selected && (
        <Modal
          drawer
          title="插单审批详情"
          busy={busy}
          onClose={() => {
            setSelected(null);
            setRefresh((value) => value + 1);
          }}
        >
          <p className="console-request-context">
            {selected.request_no} · {selected.product_id} / {selected.quantity} 件
          </p>
          <PendingRequestsPanel leader requestId={selected.request_no} onBusyChange={setBusy} />
        </Modal>
      )}
    </main>
  );
}
