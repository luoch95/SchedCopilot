import { stamp } from './api';
import Gantt from './Gantt';
import type { Candidate, Operation, Simulation, Workbench } from './types';

const slot = (op: Operation) => `${op.machine_id} · ${stamp(op.start)} → ${stamp(op.end)}`;
const differs = (values: (string | number)[]) => new Set(values).size > 1;

export default function Comparison({
  state,
  simulation,
  range,
}: {
  state: Workbench;
  simulation: Simulation;
  range: [number, number];
}) {
  const candidates = simulation.candidates;
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
  const operations = state.baseline.operations.filter((op) =>
    candidates.some((item) => {
      const after = item.schedule.operations.find((task) => task.id === op.id)!;
      return after.machine_id !== op.machine_id || after.start !== op.start;
    }),
  );
  return (
    <section className="section" aria-labelledby="comparison-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SCENARIO COMPARISON</p>
          <h2 id="comparison-title">方案比较</h2>
        </div>
        <span className="tag">{candidates.length} 套候选 · 尚未发布</span>
      </div>
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
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="candidate-card" key={item.id}>
            <header>
              <h3>{item.label}</h3>
              <span>{item.metrics.moved_operations} 道工序调整</span>
            </header>
            <Gantt
              schedule={item.schedule}
              baseline={state.baseline}
              failure={state.event}
              machines={state.machines}
              range={range}
            />
          </article>
        ))}
      </div>
      <p className="outline-legend">
        <span>
          <i className="purple-outline" />
          设备转移
        </span>
        <span>
          <i className="amber-outline" />
          仅调整时间
        </span>
        <span>两图共用时间范围与订单颜色</span>
      </p>

      <h3 className="block-title">
        工序调整对照 <small>黄色框标出方案间不同的安排</small>
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>工序 / 原计划</th>
              {candidates.map((item) => (
                <th key={item.id}>{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => {
              const values = candidates.map((item) =>
                item.schedule.operations.find((task) => task.id === op.id)!,
              );
              const different = differs(values.map(slot));
              return (
                <tr key={op.id}>
                  <th>
                    {op.id}
                    <small>{slot(op)}</small>
                  </th>
                  {values.map((value, index) => (
                    <td key={candidates[index].id}>
                      <div className={different ? 'difference-cell' : ''}>
                        <strong>{value.machine_id}</strong>
                        <span>
                          {stamp(value.start)} → {stamp(value.end)}
                        </span>
                        {op.machine_id !== value.machine_id ? (
                          <small className="transfer-text">
                            设备转移 {op.machine_id} → {value.machine_id}
                          </small>
                        ) : op.start !== value.start ? (
                          <small className="time-text">时间调整</small>
                        ) : (
                          <small>保持原安排</small>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
            {!operations.length && (
              <tr>
                <td colSpan={candidates.length + 1}>所有候选均未改变工序安排。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="block-title">订单交付对照</h3>
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
                    {order.id} · {order.name}
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

      <h3 className="block-title">工序变化与影响链</h3>
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="chain-card" key={item.id}>
            <h4>{item.label}</h4>
            {item.changes.map((change) => (
              <div className="chain-item" key={change.工序}>
                <strong>
                  {change.工序}
                  <span className="tag">{change.类型}</span>
                </strong>
                <p>{change.影响链}</p>
                <small>依据：{change.依据}</small>
              </div>
            ))}
            {!item.changes.length && <p className="hint">该方案没有改变任何工序。</p>}
          </article>
        ))}
      </div>

      <h3 className="block-title">证据与假设</h3>
      <div className="evidence-grid">
        {candidates.map((item) => (
          <h4 key={item.id}>{item.label}</h4>
        ))}
        {(['evidence', 'assumptions'] as const).map((field) => (
          <EvidenceRows key={field} candidates={candidates} field={field} />
        ))}
      </div>
    </section>
  );
}

function EvidenceRows({
  candidates,
  field,
}: {
  candidates: Candidate[];
  field: 'evidence' | 'assumptions';
}) {
  return (
    <>
      <div className="evidence-label">{field === 'evidence' ? '决策证据' : '适用假设'}</div>
      {Array.from(
        { length: Math.max(...candidates.map((item) => item[field].length)) },
        (_, index) =>
          candidates.map((item) => (
            <div className="evidence-cell" key={`${item.id}-${index}`}>
              {item[field][index] || '—'}
            </div>
          )),
      )}
    </>
  );
}
