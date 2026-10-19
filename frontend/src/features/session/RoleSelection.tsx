import type { DemoRole } from './model';

export function RoleSelection({ onSelect }: { onSelect: (role: DemoRole) => void }) {
  return (
    <main className="role-entry">
      <header className="role-brand">
        <span className="brand-mark" aria-hidden="true">
          SC
        </span>
        <span>
          Schedule Copilot<small>生产排程 · 人工决策</small>
        </span>
      </header>
      <section aria-labelledby="role-heading">
        <p className="eyebrow">车间协作入口</p>
        <h1 id="role-heading">选择你的工作角色</h1>
        <p className="role-intro">从订单需求到生产安排，进入对应的工作空间。</p>
        <div className="role-cards">
          <button className="role-card" onClick={() => onSelect('leader')}>
            <span className="role-card-label">插单审批</span>
            <strong>领导</strong>
            <span className="role-card-description">查看交期与影响摘要，批准或驳回插单申请。</span>
            <span className="role-card-action">
              进入领导审批 <span aria-hidden="true">→</span>
            </span>
          </button>
          <button className="role-card" onClick={() => onSelect('sales')}>
            <span className="role-card-label">订单需求</span>
            <strong>业务员</strong>
            <span className="role-card-description">
              填写插单需求、查询订单交期，预估加工时长。
            </span>
            <span className="role-card-action">
              进入业务员页面 <span aria-hidden="true">→</span>
            </span>
          </button>
          <button className="role-card" onClick={() => onSelect('planner')}>
            <span className="role-card-label">生产安排</span>
            <strong>排产计划员</strong>
            <span className="role-card-description">
              查看当前计划、分析故障影响、比较方案并确认发布。
            </span>
            <span className="role-card-action">
              进入排产工作台 <span aria-hidden="true">→</span>
            </span>
          </button>
        </div>
      </section>
      <footer className="role-note">演示模式 · 无需账号密码，角色仅用于切换工作视图。</footer>
    </main>
  );
}
