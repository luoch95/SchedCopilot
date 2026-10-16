import { stamp } from '../../shared/lib/time';
import type { Decision } from '../../shared/api/contracts';
export function DecisionHistory({ history }: { history: Decision[] }) {
  return (
    <section className="section">
      <div className="section-heading">
        <h2>人工决定记录</h2>
        <span className="tag">{history.length} 条记录</span>
      </div>
      {history.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>记录</th>
                <th>操作</th>
                <th>理由</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>#{item.id}</td>
                  <td>{item.action === 'publish' ? '已发布' : '暂不发布'}</td>
                  <td>{item.reason}</td>
                  <td>{stamp(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">还没有人工决定。生成并比较方案后，记录你的选择。</p>
      )}
    </section>
  );
}
