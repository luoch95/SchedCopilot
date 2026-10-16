import { stamp } from '../../shared/lib/time';
import type { Candidate } from '../../shared/api/contracts';
const differs = (values: number[]) => new Set(values).size > 1;
export function MetricsTable({ candidates }: { candidates: Candidate[] }) {
  const metrics: {
    label: string;
    get: (item: Candidate) => number;
    display?: (value: number) => string;
  }[] = [
    { label: '延期订单', get: (item) => item.metrics.late_orders },
    { label: '累计延期 / 分钟', get: (item) => item.metrics.total_lateness_minutes },
    { label: '移动工序', get: (item) => item.metrics.moved_operations },
    {
      label: '计划完工',
      get: (item) => +new Date(item.metrics.makespan),
      display: (value) => stamp(new Date(value).toISOString()),
    },
  ];
  return (
    <>
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
                      {metric.display ? metric.display(value) : value}
                      {different && (
                        <small>{value === Math.min(...values) ? '较优' : '较差'}</small>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        绿色 / 较优，红色 / 较差。各指标独立比较；移动工序少代表调整少，不代表交付一定更好。
      </p>
    </>
  );
}
