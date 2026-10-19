import { stamp } from '../../shared/lib/time';
import type { Candidate, Operation, Workbench } from '../../shared/api/contracts';
import { DecisionText } from '../../shared/ui/DecisionText';
const slot = (op: Operation) => `${op.machine_id} · ${stamp(op.start)} → ${stamp(op.end)}`;
const differs = (values: (string | number)[]) => new Set(values).size > 1;
export function OperationComparison({
  state,
  candidates,
}: {
  state: Workbench;
  candidates: Candidate[];
}) {
  const operations = state.baseline.operations.filter((op) =>
    candidates.some((item) => {
      const after = item.schedule.operations.find((task) => task.id === op.id)!;
      return after.machine_id !== op.machine_id || after.start !== op.start;
    }),
  );
  return (
    <>
      {' '}
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
                            <strong>
                              设备转移 {op.machine_id} → {value.machine_id}
                            </strong>
                          </small>
                        ) : op.start !== value.start ? (
                          <small className="time-text">时间调整</small>
                        ) : (
                          <small>保持原安排</small>
                        )}
                        {candidates[index].changes.find((change) => change.工序 === op.id) && (
                          <small>
                            <DecisionText
                              text={
                                candidates[index].changes.find((change) => change.工序 === op.id)
                                  ?.依据 ?? ''
                              }
                            />
                          </small>
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
    </>
  );
}
