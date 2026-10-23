import type { ContributionReport as Report } from '../api/contracts';
import { stamp } from '../lib/time';

export function ContributionReport({ report }: { report?: Report | null }) {
  if (!report) return null;
  return (
    <section className="contribution-report" aria-label="系统模型与人工贡献报告">
      <h3>
        {report.title ?? '分析贡献报告'}
        {report.revision ? ` · R${report.revision}` : ''}
      </h3>
      <p>
        <strong>规则系统：</strong>
        {report.rules_work ?? '历史记录未保存规则工作明细。'}
      </p>
      <p>
        <strong>大模型：</strong>
        {report.model_work ?? '历史记录未保存模型工作明细。'}
        {report.model?.error_code && `（${report.model.error_code}）`}
      </p>
      <p>
        <strong>人工调整：</strong>
        {report.manual_summary}
      </p>
      {report.comparison && <p className="hint">{report.comparison}</p>}
      {!!report.edits?.length && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>工序 / 操作者</th>
                <th>原安排</th>
                <th>调整后</th>
                <th>记录</th>
              </tr>
            </thead>
            <tbody>
              {report.edits?.map((edit, i) => (
                <tr key={i}>
                  <td>
                    {edit.operation_id}
                    <br />
                    {edit.operator}
                  </td>
                  <td>
                    {edit.before.machine_id}
                    <br />
                    {stamp(edit.before.start)} — {stamp(edit.before.end)}
                  </td>
                  <td>
                    {edit.after.machine_id}
                    <br />
                    {stamp(edit.after.start)} — {stamp(edit.after.end)}
                  </td>
                  <td>
                    {stamp(edit.at)}
                    <br />
                    {edit.reason || '未填写调整原因'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!report.edits && <p className="hint">历史记录未保存人工修改明细。</p>}
      {!!report.order_impacts?.length && (
        <ul>
          {report.order_impacts
            .filter((i) => i['新增延期(分钟)'] !== 0 || i['新延期(分钟)'] > 0)
            .map((i) => (
              <li key={i.订单}>
                订单 {i.订单}：新完工 {stamp(i.新完工)}，延期 {i['新延期(分钟)']} 分钟，较基线变化{' '}
                {i['新增延期(分钟)']} 分钟。
              </li>
            ))}
        </ul>
      )}
      {report.model?.highlights?.map((item, i) => (
        <p key={i}>{item.text}</p>
      ))}
      {report.risks?.map((risk, i) => (
        <p className="hint" key={i}>
          {risk}
        </p>
      ))}
      {!report.risks && <p className="hint">历史记录未保存风险明细。</p>}
      <p>
        <strong>报告生成时的决策状态：</strong>
        {report.decision}
      </p>
    </section>
  );
}
