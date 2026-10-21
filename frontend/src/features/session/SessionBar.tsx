import type { DemoRole } from './model';

export function SessionBar({
  role,
  onSwitch,
  disabled = false,
  compact = false,
}: {
  role: DemoRole;
  onSwitch: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="session-bar" aria-label={role === 'leader' ? '当前视角' : '当前演示角色'}>
      <span>
        {role === 'leader' ? '当前视角 · ' : compact ? '演示角色：' : '演示角色 · '}
        <strong>{{ sales: '业务员', planner: '排产计划员', leader: '生产总监' }[role]}</strong>
      </span>
      <button
        onClick={onSwitch}
        disabled={disabled}
        title={disabled ? '请等待当前操作结束后切换角色' : undefined}
      >
        切换角色
      </button>
    </div>
  );
}
