import type { DemoRole } from './model';

const roles: {
  id: DemoRole;
  category: string;
  name: string;
  description: string;
  action: string;
}[] = [
  {
    id: 'leader',
    category: '插单审批',
    name: '领导',
    description: '查看交期与影响摘要，批准或驳回插单申请。',
    action: '进入领导审批',
  },
  {
    id: 'sales',
    category: '订单需求',
    name: '业务员',
    description: '提交紧急需求，评估交付影响，跟踪申请进展。',
    action: '进入业务员页面',
  },
  {
    id: 'planner',
    category: '生产安排',
    name: '排产计划员',
    description: '分析故障影响，比较排产方案，复核并发布计划。',
    action: '进入排产工作台',
  },
];

function RoleIcon({ role }: { role: DemoRole }) {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {role === 'leader' ? (
        <>
          <path d="M8 43v-5c0-5 6-9 12-10h8c6 1 12 5 12 10v5" fill="#c9dce7" />
          <path d="m17 29 7 6 7-6M24 35l-3 8h6Z" fill="currentColor" />
          <path d="m17 30-3 9 6-2M31 30l3 9-6-2" />
          <path d="M14 16v4c0 6 4 10 10 10s10-4 10-10v-4" fill="#f4f7f9" />
          <path d="M14 16v-3C14 6 19 4 24 4s10 3 10 9v3l-6-5-6 3Z" fill="currentColor" />
          <rect x="15" y="17" width="7" height="5" rx="2" />
          <rect x="26" y="17" width="7" height="5" rx="2" />
          <path d="M22 19h4M21 25h6" />
        </>
      ) : role === 'sales' ? (
        <>
          <path d="M8 43v-5c0-6 6-9 12-10h7c6 1 11 4 11 10v5" fill="#c9dce7" />
          <path d="m18 29 6 6 6-6M24 35v8M13 37v6" />
          <path d="M14 15v5c0 6 4 10 10 10s10-4 10-10v-5" fill="#f4f7f9" />
          <path d="M14 16v-3c0-6 5-9 11-9 5 0 9 4 9 10v2l-7-6-6 5Z" fill="currentColor" />
          <path d="M19 19h1M28 19h1M21 24q3 3 6 0" />
          <rect x="30" y="30" width="11" height="14" rx="2" fill="#f4f7f9" />
          <path d="M33 34h5M33 38h5" />
        </>
      ) : (
        <>
          <path d="M8 43v-5c0-5 6-9 12-10h8c6 1 12 5 12 10v5" fill="#c9dce7" />
          <path d="m18 29 6 6 6-6M16 33v10M32 33v10M19 39h10" />
          <path d="M14 17v4c0 6 4 9 10 9s10-3 10-9v-4" fill="#f4f7f9" />
          <path d="M12 16C12 8 17 5 24 5s12 3 12 11" fill="#c9dce7" />
          <path d="M21 12V5h6v7M12 13v3M36 13v3" />
          <rect x="10" y="15" width="28" height="4" rx="2" fill="currentColor" />
          <path d="M19 22h1M28 22h1M21 26h6" />
        </>
      )}
    </svg>
  );
}

export function RoleSelection({ onSelect }: { onSelect: (role: DemoRole) => void }) {
  return (
    <main className="role-entry">
      <section className="entry-visual" aria-label="Schedule Copilot 智能制造排产">
        <div className="entry-visual-grid" aria-hidden="true" />
        <span className="entry-wordmark">
          SCHEDULE COPILOT <span>/</span> 智能制造
        </span>
        <div className="entry-brand">
          <svg className="entry-logo" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="m32 4 25 14v28L32 60 7 46V18Z" stroke="currentColor" strokeWidth="2" />
            <path
              d="m19 25 13-8 13 8-13 8Zm0 10 13 8 13-8M19 44l13 8 13-8"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>
          <p className="entry-eyebrow">连接需求 · 协同决策 · 驱动生产</p>
          <h1>
            Schedule <span>Copilot</span>
          </h1>
          <p className="entry-tagline">AI 驱动的智能制造排产引擎</p>
          <div className="entry-brand-line" aria-hidden="true" />
        </div>
        <p className="entry-visual-caption">
          <span aria-hidden="true" />
          让每一次生产调整，都有据可依。
        </p>
      </section>
      <section className="entry-access" aria-labelledby="role-heading">
        <div className="entry-access-content">
          <header className="entry-access-heading">
            <span className="entry-access-label">工作空间</span>
            <h2 id="role-heading">选择你的工作角色</h2>
            <p>不同职责，同一个协作现场。</p>
          </header>
          <div className="role-stack" aria-label="工作角色选择">
            {roles.map((role) => (
              <button
                className="entry-role-card"
                type="button"
                key={role.id}
                aria-label={role.action}
                onClick={() => onSelect(role.id)}
              >
                <span className={`entry-role-icon entry-role-icon--${role.id}`}>
                  <RoleIcon role={role.id} />
                </span>
                <span className="entry-role-copy">
                  <span className="entry-role-category">{role.category}</span>
                  <strong>{role.name}</strong>
                  <span className="entry-role-description">{role.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <footer className="role-note">
          演示模式：无需账号密码，点击角色卡片进入对应工作空间。
        </footer>
      </section>
    </main>
  );
}
