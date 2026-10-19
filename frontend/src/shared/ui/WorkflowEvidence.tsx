import type { WorkflowNotice, WorkflowResult, WorkflowStatement } from '../api/contracts';
import { DecisionText } from './DecisionText';

export function WorkflowDebugDetails({
  data,
  headingLevel = 5,
}: {
  data: unknown;
  headingLevel?: 4 | 5;
}) {
  const Heading = headingLevel === 4 ? 'h4' : 'h5';
  return (
    <details className="workflow-evidence">
      <summary>
        <Heading>调试详情</Heading>
      </summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

export function WorkflowNotices({
  notices,
}: {
  result: WorkflowResult;
  notices: WorkflowNotice[];
}) {
  return notices.map((notice, i) => (
    <div className="message warning" key={i}>
      <p>
        <strong>{notice.message}</strong>
      </p>
      <p className="hint">{notice.repair_hint}</p>
    </div>
  ));
}

export function WorkflowStatements({
  title,
  items,
  headingLevel = 3,
}: {
  result: WorkflowResult;
  title: string;
  items?: WorkflowStatement[];
  headingLevel?: 3 | 5;
}) {
  if (!items?.length) return null;
  const Heading = headingLevel === 5 ? 'h5' : 'h3';
  return (
    <div className="explanation-group">
      <Heading>{title}</Heading>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            {title === '取舍' ? <strong>{item.text}</strong> : <DecisionText text={item.text} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
