import { limitationHint, productionConditionLimitation } from '../lib/productionConditions';
import { DetailSurface } from './DetailSurface';
import type { ReactNode } from 'react';
import type { WorkflowNotice, WorkflowResult, WorkflowStatement } from '../api/contracts';
import { DecisionText, EvidenceText } from './DecisionText';
import { useBusinessText } from '../lib/BusinessLabelProvider';

export function WorkflowDebugDetails({
  data,
  headingLevel = 5,
  flat = false,
}: {
  data: unknown;
  headingLevel?: 4 | 5;
  flat?: boolean;
}) {
  const format = useBusinessText();
  const Heading = headingLevel === 4 ? 'h4' : 'h5';
  return (
    <DetailSurface flat={flat} className="workflow-evidence" title={<Heading>调试详情</Heading>}>
      <pre>{format(JSON.stringify(data, null, 2) ?? '')}</pre>
    </DetailSurface>
  );
}

export function WorkflowNotices({
  notices,
}: {
  result: WorkflowResult;
  notices: WorkflowNotice[];
}) {
  const format = useBusinessText();
  return notices.map((notice, i) => (
    <div className="message warning" key={i}>
      <p>
        <strong>{format(productionConditionLimitation(notice.message))}</strong>
      </p>
      <p className="hint">{format(limitationHint(notice.code, notice.repair_hint))}</p>
    </div>
  ));
}

export function WorkflowStatements({
  title,
  items,
  headingLevel = 3,
  icon,
}: {
  result: WorkflowResult;
  title: string;
  items?: WorkflowStatement[];
  headingLevel?: 3 | 5;
  icon?: ReactNode;
}) {
  if (!items?.length) return null;
  const Heading = headingLevel === 5 ? 'h5' : 'h3';
  return (
    <div className="explanation-group">
      <Heading>
        {icon && (
          <span className="analysis-focus-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {title}
      </Heading>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            {title === '取舍' ? (
              <strong>
                <EvidenceText text={item.text} />
              </strong>
            ) : (
              <DecisionText text={item.text} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
