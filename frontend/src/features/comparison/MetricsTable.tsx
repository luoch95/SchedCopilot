import { stamp } from '../../shared/lib/time';
import type { Candidate, ManualFaultDraft } from '../../shared/api/contracts';
import { changedOperationCount } from '../../shared/lib/candidatePresentation';
const differs = (values: number[]) => new Set(values).size > 1;
export function MetricsTable({
  candidates,
  manualDraft,
}: {
  candidates: Candidate[];
  manualDraft?: ManualFaultDraft | null;
}) {
  const metrics: {
    label: string;
    get: (item: Candidate) => number;
    display?: (value: number) => string;
  }[] = [
    { label: '延期订单', get: (item) => item.metrics.late_orders },
    { label: '总延期 / 分钟', get: (item) => item.metrics.total_lateness_minutes },
    {
      label: '新增延期（相对执行计划）/ 分钟',
      get: (item) => item.order_impacts.reduce((sum, impact) => sum + impact['新增延期(分钟)'], 0),
    },
    { label: '调整工序（相对执行计划）', get: (item) => item.metrics.moved_operations },
    {
      label: '计划完工',
      get: (item) => +new Date(item.metrics.makespan),
      display: (value) => stamp(new Date(value).toISOString()),
    },
  ];
  return (
    <>
      <h3 data-outline className="block-title">
        对比决策指标
      </h3>
      <div className="table-wrap">
        <table className="metrics-table">
          <thead>
            <tr>
              <th>决策指标</th>
              {candidates.map((item) => (
                <th key={item.id}>{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const values = candidates.map(metric.get),
                different = differs(values);
              return (
                <tr key={metric.label}>
                  <th>{metric.label}</th>
                  {values.map((value, i) => (
                    <td
                      key={candidates[i].id}
                      className={
                        !different ? '' : value === Math.min(...values) ? 'better' : 'worse'
                      }
                    >
                      <strong>{metric.display ? metric.display(value) : value}</strong>
                      {different && (
                        <small>{value === Math.min(...values) ? '较优' : '较差'}</small>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {manualDraft?.simulation && (
              <tr>
                <th>人工修改工序（相对编辑起点）</th>
                {candidates.map((item) => (
                  <td key={item.id}>
                    {manualDraft.simulation?.candidates.some((manual) => manual.id === item.id)
                      ? changedOperationCount(manualDraft.origin, item.schedule)
                      : '—'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        绿色 / 较优，红色 / 较差。各指标独立比较；移动工序少代表调整少，不代表交付一定更好。
        总延期包含执行计划已有延期；新增延期按服务端返回的各订单新增延期汇总。人工修改数按编辑起点比较，不等同于相对执行计划调整数。
      </p>
    </>
  );
}
