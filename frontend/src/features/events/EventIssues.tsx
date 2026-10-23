import type { Workbench } from '../../shared/api/contracts';
import { stamp } from '../../shared/lib/time';
import { businessText } from '../../shared/lib/businessLabels';
import { explainIssue } from './model';

export function EventIssues({ state }: { state: Workbench }) {
  if (!state.issues.length) return null;
  const stale = state.issues.some((issue) => issue.startsWith('报工状态过期'));
  return (
    <div className="blockers" role="alert">
      <strong>
        {stale ? '缺少故障发生时的报工状态，暂不能分析' : '故障信息与执行记录不一致，暂不能分析'}
      </strong>
      <p>
        报工数据快照：{stamp(state.snapshot_time)}；本次故障：{state.event.machine_id}，
        {stamp(state.event.started_at)} 起。
      </p>
      <ul>
        {state.issues.map((issue) => (
          <li key={issue}>{businessText(explainIssue(state, issue), state.baseline.operations)}</li>
        ))}
      </ul>
      <p>校验范围是整个执行计划，因此其他设备的报工缺失也会阻止分析。这不等于故障时间填写错误。</p>
      <p>
        下一步：核实上述工序在故障发生时的实际状态，并更新报工数据后再分析。当前页面仅能录入故障，不能更新工序报工；修改故障时间不会自动将工序标记为开工或完成。
      </p>
      <p>
        若只是演示，请选择与现有报工快照一致的故障场景；真实故障应保留实际时间，不要为通过校验随意改时。
      </p>
    </div>
  );
}
