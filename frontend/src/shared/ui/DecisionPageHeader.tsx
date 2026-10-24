import type { ReactNode } from 'react';
import { WorkbenchTitle } from './WorkbenchTitle';

export function DecisionPageHeader({
  title,
  titleId,
  status,
  breadcrumb,
  description,
  actions,
}: {
  title: string;
  titleId?: string;
  status?: ReactNode;
  breadcrumb?: ReactNode;
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="decision-page-header">
      <div className="planner-title-row">
        <WorkbenchTitle title={title} as={titleId ? 'h2' : 'h1'} id={titleId} />
        {typeof status === 'string' ? <span className="fault-stage-status">{status}</span> : status}
        {breadcrumb}
      </div>
      <p>{description}</p>
      <div className="fault-header-actions">{actions}</div>
    </header>
  );
}
