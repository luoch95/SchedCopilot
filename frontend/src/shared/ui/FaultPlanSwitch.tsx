export function FaultPlanSwitch({
  view,
  onChange,
  aiStatus,
  manualStatus,
  hasManual = false,
  hasAi = true,
}: {
  view: 'ai' | 'manual';
  onChange: (view: 'ai' | 'manual') => void;
  aiStatus: string;
  manualStatus?: string;
  hasManual?: boolean;
  hasAi?: boolean;
}) {
  return (
    <div className="fault-analysis-switch" role="group" aria-label="分析方案切换">
      <button
        aria-label="原 AI 方案"
        aria-pressed={view === 'ai'}
        disabled={!hasAi}
        onClick={() => onChange('ai')}
      >
        原 AI 方案 <span className="fault-plan-badge">{aiStatus}</span>
      </button>
      {hasManual && (
        <button
          aria-label="人工调整方案"
          aria-pressed={view === 'manual'}
          onClick={() => onChange('manual')}
        >
          人工调整方案 <span className="fault-plan-badge">{manualStatus ?? '未提交审批'}</span>
        </button>
      )}
    </div>
  );
}
