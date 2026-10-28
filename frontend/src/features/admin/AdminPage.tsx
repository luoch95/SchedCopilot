import { useEffect, useState, type FormEvent } from 'react';
import { workbenchApi } from '../workbench';
import type { Metrics } from '../../shared/api/metrics';
import { WeeklyReportButton } from './WeeklyReportButton';
import { WorkbenchTitle } from '../../shared/ui/WorkbenchTitle';
import { AgentTraces } from './AgentTraces';

const roleLabels: Record<string, string> = { sales: '业务员', planner: '计划员', leader: '管理者' };

export default function AdminPage({ onSwitchRole }: { onSwitchRole: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  async function load() {
    setMetrics(null);
    setMetrics(await workbenchApi.adminMetrics());
  }
  useEffect(() => {
    let active = true;
    void workbenchApi
      .adminSession()
      .then(async (session) => {
        if (!active) return;
        setAuthorized(session.admin);
        if (session.admin) {
          const value = await workbenchApi.adminMetrics();
          if (active) setMetrics(value);
        }
      })
      .catch(() => {
        if (active) setError('研发指标暂不可用，请重试。');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await workbenchApi.adminLogin(password);
      setPassword('');
      setAuthorized(true);
      await load();
    } catch {
      setError('登录或指标读取失败，请核对演示密码后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setMetrics(null);
    setBusy(true);
    try {
      await workbenchApi.adminLogout();
      setAuthorized(false);
    } catch {
      setError('退出失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const maximum = Math.max(
    1,
    ...(metrics?.trend.flatMap((day) => [day.generated, day.published]) ?? []),
  );
  return (
    <main className="admin-console">
      <header className="page-header admin-header">
        <div>
          <WorkbenchTitle title="系统运行看板" english="System Operations Dashboard" />
          <p>独立研发入口 · 演示权限，不具备正式管理员认证保障。</p>
        </div>
        <div className="admin-header-actions">
          {authorized && (
            <button
              className="admin-logout"
              type="button"
              disabled={busy}
              onClick={() => void logout()}
            >
              退出研发后台
            </button>
          )}
          <button type="button" onClick={onSwitchRole}>
            返回角色选择
          </button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">正在读取…</p>}
      {!authorized && !busy && (
        <form className="admin-panel admin-login" onSubmit={login}>
          <h2>研发后台登录</h2>
          <label>
            演示密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit">登录</button>
        </form>
      )}
      {authorized && !busy && !metrics && (
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            setError('');
            void load()
              .catch(() => setError('指标读取失败，请重试或重新登录。'))
              .finally(() => setBusy(false));
          }}
        >
          重试读取指标
        </button>
      )}
      {authorized && <AgentTraces />}
      {metrics && (
        <>
          <div className="admin-toolbar">
            <p className="admin-period">
              业务累计至{' '}
              {new Date(metrics.period.end).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              （北京时间）
            </p>
            <WeeklyReportButton />
          </div>
          <section className="admin-kpis" aria-label="核心指标">
            <article>
              <span>累计日访客 UV</span>
              <strong>{metrics.visits.total.toLocaleString()}</strong>
              <small>按北京时间每日 IP 去重后累计</small>
            </article>
            <article>
              <span>AI 方案生成</span>
              <strong>{metrics.ai.generated}</strong>
              <small>成功产出候选的故障批次</small>
            </article>
            <article>
              <span>采纳 / 发布</span>
              <strong>
                {metrics.ai.adopted} / {metrics.ai.published}
              </strong>
              <small>
                采纳率{' '}
                {metrics.ai.adoption_rate === null ? '未统计' : `${metrics.ai.adoption_rate}%`}
              </small>
            </article>
            <article>
              <span>失败 / 降级</span>
              <strong>
                {metrics.ai.failed} / {metrics.ai.degraded}
              </strong>
              <small>按工作流计次，可重叠</small>
            </article>
          </section>
          <section className="admin-grid">
            <article className="admin-panel admin-trend">
              <header>
                <h2>本周 AI 方案趋势</h2>
                <span>生成 / 发布</span>
              </header>
              <div
                className="trend-chart"
                role="img"
                aria-label={metrics.trend
                  .map((day) => `${day.label}：生成 ${day.generated}，发布 ${day.published}`)
                  .join('；')}
              >
                {metrics.trend.map((item) => (
                  <div className="trend-day" key={item.label}>
                    <div className="trend-bars">
                      <i
                        style={{ height: `${(item.generated / maximum) * 100}%` }}
                        title={`生成 ${item.generated}`}
                      />
                      <b
                        style={{ height: `${(item.published / maximum) * 100}%` }}
                        title={`发布 ${item.published}`}
                      />
                    </div>
                    <small>{item.label}</small>
                    <small>
                      {item.generated} / {item.published}
                    </small>
                  </div>
                ))}
              </div>
              <footer>
                <span>
                  <i />
                  生成
                </span>
                <span>
                  <b />
                  发布
                </span>
              </footer>
            </article>
            <article className="admin-panel">
              <header>
                <h2>角色访问占比</h2>
                <span>Mock</span>
              </header>
              <div className="role-breakdown">
                {Object.entries(metrics.visits.roles).map(([role, value]) => (
                  <div key={role}>
                    <span>{roleLabels[role] ?? role}</span>
                    <div>
                      <i style={{ width: `${value}%` }} />
                    </div>
                    <strong>{value}%</strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="admin-panel">
              <header>
                <h2>场景热度</h2>
                <span>累计记录数</span>
              </header>
              <div className="scenario-list">
                <div>
                  <span>设备故障（按设备和起始时间去重）</span>
                  <strong>{metrics.scenarios.equipment_failure}</strong>
                </div>
                <div>
                  <span>紧急插单申请</span>
                  <strong>{metrics.scenarios.urgent_insertion}</strong>
                </div>
              </div>
            </article>
          </section>
          <aside className="admin-health" aria-labelledby="admin-limitations-heading">
            <header>
              <h2 id="admin-limitations-heading">统计口径与限制</h2>
              <span>真实业务记录 · 角色占比为 Mock</span>
            </header>
            <ul>
              {metrics.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </>
      )}
    </main>
  );
}
