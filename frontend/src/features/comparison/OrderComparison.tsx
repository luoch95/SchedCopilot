import { stamp } from '../../shared/lib/time';
import type { Candidate, Workbench } from '../../shared/api/contracts';
const differs = (values: string[]) => new Set(values).size > 1;
export function OrderComparison({
  state,
  candidates,
  showHeading = true,
}: {
  state: Workbench;
  candidates: Candidate[];
  showHeading?: boolean;
}) {
  return (
    <section className="comparison-detail-section" aria-label="订单交付对照">
      {showHeading && <h3>订单交付对照</h3>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单 / 交期</th>
              {candidates.map((item) => (
                <th key={item.id}>{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.orders.map((order) => {
              const impacts = candidates.map((item) =>
                item.order_impacts.find((impact) => impact.订单 === order.id)!,
              );
              const different = differs(
                impacts.map((item) => `${item.新完工}/${item['新延期(分钟)']}`),
              );
              return (
                <tr key={order.id}>
                  <th>
                    {order.display_name ?? order.id} · {order.name}
                    <small>交期 {stamp(order.due)}</small>
                    <small>原完工 {stamp(impacts[0].原完工)}</small>
                  </th>
                  {impacts.map((impact, i) => (
                    <td key={candidates[i].id}>
                      <div className={different ? 'difference-cell' : ''}>
                        <strong>{stamp(impact.新完工)}</strong>
                        <span className={impact['新延期(分钟)'] > 0 ? 'late-text' : ''}>
                          延期 {impact['新延期(分钟)']} 分钟
                        </span>
                        <small>
                          较原计划 {impact['新增延期(分钟)'] >= 0 ? '+' : ''}
                          {impact['新增延期(分钟)']} 分钟 · {impact.判断}
                        </small>
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
