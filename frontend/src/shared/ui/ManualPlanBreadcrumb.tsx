export function ManualPlanBreadcrumb({
  editing,
  disabled,
  onRole,
  onHome,
  onDecision,
  onBasis,
}: {
  editing: boolean;
  disabled: boolean;
  onRole?: () => void;
  onHome: () => void;
  onDecision: () => void;
  onBasis: () => void;
}) {
  return (
    <nav className="console-breadcrumb manual-plan-breadcrumb" aria-label="当前位置">
      <ol>
        {onRole && (
          <li>
            <button disabled={disabled} onClick={onRole}>
              选择角色
            </button>
          </li>
        )}
        <li>
          <button disabled={disabled} onClick={onHome}>
            工作台总览
          </button>
        </li>
        <li>
          <button disabled={disabled} onClick={onDecision}>
            故障影响与方案决策
          </button>
        </li>
        <li>
          {editing ? (
            <button disabled={disabled} onClick={onBasis}>
              选择编辑起点
            </button>
          ) : (
            <span aria-current="page">选择编辑起点</span>
          )}
        </li>
        {editing && (
          <li>
            <span aria-current="page">人工调整排产方案</span>
          </li>
        )}
      </ol>
    </nav>
  );
}
