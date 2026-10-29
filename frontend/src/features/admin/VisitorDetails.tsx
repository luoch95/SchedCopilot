import { useEffect, useState } from 'react';
import { workbenchApi } from '../workbench';
import type { VisitorPage } from '../../shared/api/visitors';
import { Modal } from '../../shared/ui/Modal';

export function VisitorDetails({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [excludeCurrent, setExcludeCurrent] = useState(false);
  const [data, setData] = useState<VisitorPage | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void workbenchApi.adminVisitors(page, excludeCurrent).then(
      (value) => {
        if (active) setData(value);
      },
      () => {
        if (active) setError('访客明细读取失败，请重试。');
      },
    );
    return () => {
      active = false;
    };
  }, [page, excludeCurrent, revision]);
  return (
    <Modal title="访客明细" onClose={onClose}>
      <p>
        按北京时间每日 IP 去重；同一 IP 跨日重复计数。记录代表访问来源，不能确认姓名或登录身份。
      </p>
      <label>
        <input
          type="checkbox"
          checked={excludeCurrent}
          onChange={(event) => {
            setExcludeCurrent(event.target.checked);
            setPage(1);
          }}
        />
        排除当前 IP
      </label>
      {error ? <p role="alert">{error}</p> : !data && <p role="status">正在读取访客明细…</p>}
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        刷新明细
      </button>
      {data && (
        <>
          <p>
            当前 IP：{data.current_ip ?? '无法识别'}。共享网络可能使用同一
            IP，排除后也可能隐藏其他访客。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>访问日期（北京时间）</th>
                  <th>来源 IP</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={`${item.visit_date}:${item.ip}`}>
                    <td>{item.visit_date}</td>
                    <td>{item.ip}</td>
                    <td>{item.matches_current_ip ? '与当前 IP 相同' : '其他 IP'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.items.length === 0 && <p>暂无符合条件的访问记录。</p>}
          <div>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>
              第 {page} 页 · 共 {data.total} 条
            </span>
            <button
              disabled={page * data.page_size >= data.total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
