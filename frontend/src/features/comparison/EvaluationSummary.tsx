import type { Simulation, WorkflowResult } from '../../shared/api/contracts';
import { WorkflowNotices } from '../../shared/ui/WorkflowEvidence';

const metrics: Record<string, string> = {
  extra_changeovers: '新增换型次数',
  extra_changeover_minutes: '新增换型时长',
  machine_utilization: '班次利用率',
  material_availability: '物料可用性',
  staffing: '人员配置',
  mold_maintenance: '模具维护状态',
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const quantity = (value: unknown, unit: string) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value} ${unit}` : '未计算';

export function EvaluationSummary({
  result,
  simulation,
}: {
  result: WorkflowResult;
  simulation: Simulation;
}) {
  const report = result.results.evaluation;
  if (!report) return null;
  const columns = simulation.candidates.map((candidate) => {
    const evaluation = report.data?.evaluations?.find((item) => item.candidate_id === candidate.id);
    const values = record(evaluation && result.evidence_catalog[evaluation.metrics_ref]?.content);
    const loads = Array.isArray(values.machine_loads) ? values.machine_loads.map(record) : [];
    return { candidate, evaluation, values, loads };
  });
  const referenceId = result.results.scheduling?.data?.candidates?.find(
    (candidate) => candidate.strategy_id === 'wait-recovery',
  )?.candidate_id;
  const reference = referenceId
    ? columns.find(({ candidate }) => candidate.id === referenceId)
    : columns.find(({ candidate }) => candidate.label === '原计划对照');
  const machineIds = [
    ...new Set(
      columns.flatMap(({ loads }) =>
        loads.map((load) => load.machine_id).filter((id): id is string => typeof id === 'string'),
      ),
    ),
  ].sort();
  const rows = [
    {
      label: '缺失指标',
      values: columns.map(({ evaluation }) =>
        evaluation
          ? evaluation.missing_metrics.map((metric) => metrics[metric] ?? metric).join('、') || '无'
          : '未评估',
      ),
    },
    {
      label: '换型总次数',
      values: columns.map(({ values }) => quantity(values.changeovers, '次')),
    },
    {
      label: '换型总时长',
      values: columns.map(({ values }) => quantity(values.changeover_minutes, '分钟')),
    },
    ...machineIds.map((id) => ({
      label: `${id} 换型次数 / 时长`,
      values: columns.map(({ loads }) => {
        const load = loads.find((item) => item.machine_id === id) ?? {};
        return `${quantity(load.changeovers, '次')} / ${quantity(load.setup_minutes, '分钟')}`;
      }),
    })),
    ...machineIds.map((id) => ({
      label: `${id} 班次利用率`,
      values: columns.map(({ candidate, loads }) => {
        const value = loads.find((item) => item.machine_id === id)?.utilization;
        if (typeof value !== 'number' || !Number.isFinite(value)) return '未计算';
        const percentage = `${(value * 100).toFixed(1)}%`;
        const base = reference?.loads.find((item) => item.machine_id === id)?.utilization;
        if (candidate.id === reference?.candidate.id) return `${percentage}（基准）`;
        if (typeof base !== 'number' || !Number.isFinite(base)) return percentage;
        const delta = Math.round(value * 1000) - Math.round(base * 1000);
        if (delta === 0) return `${percentage}（持平）`;
        return (
          <>
            {percentage}{' '}
            <span className={`utilization-change ${delta > 0 ? 'load-increase' : 'load-decrease'}`}>
              {delta > 0 ? '↑ 上升' : '↓ 下降'} {(Math.abs(delta) / 10).toFixed(1)} 个百分点
            </span>
          </>
        );
      }),
    })),
  ];
  const sameTotals =
    columns.length > 1 &&
    columns.every(
      ({ values }) =>
        typeof values.changeovers === 'number' &&
        typeof values.changeover_minutes === 'number' &&
        values.changeovers === columns[0].values.changeovers &&
        values.changeover_minutes === columns[0].values.changeover_minutes,
    );
  return (
    <section className="evaluation-summary" aria-label="方案评估结果">
      <h3 data-outline className="block-title">
        评估说明与差异
      </h3>
      <p className="hint">
        班次利用率＝（加工时间＋换型时间）÷可用班次时间，已扣除故障停机时间。
        {reference && `箭头表示相对“${reference.candidate.label}”同一设备的变化。`}
        利用率升高不代表方案一定更优，需结合延期和设备负荷判断。
      </p>
      <WorkflowNotices result={result} notices={[...report.errors, ...report.warnings]} />
      <div className="table-wrap">
        <table aria-label="方案评估对比表">
          <thead>
            <tr>
              <th scope="col">评估项目</th>
              {columns.map(({ candidate }) => (
                <th scope="col" key={candidate.id}>
                  {candidate.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, i) => (
                  <td key={columns[i].candidate.id}>
                    <strong>{value}</strong>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sameTotals && (
        <p className="hint">换型总量相同，请结合各设备分布、订单延期和班次利用率判断方案差异。</p>
      )}
    </section>
  );
}
