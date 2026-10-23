import { WriteButton } from './WriteButton';

export function AiAnalysisButton({
  onClick,
  label = '查看 AI 分析详情',
  disabled = false,
  write = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  write?: boolean;
}) {
  const Button = write ? WriteButton : 'button';
  return (
    <Button className="ai-analysis-button" onClick={onClick} disabled={disabled}>
      <svg
        className="ai-bot-icon"
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 3v3M9 3h6" />
        <rect x="5" y="6" width="14" height="14" rx="4" />
        <path d="M2 11v4m20-4v4M9 16h6" />
        <g className="ai-bot-eyes" fill="currentColor" stroke="none">
          <circle cx="9" cy="11" r="1.3" />
          <circle cx="15" cy="11" r="1.3" />
        </g>
      </svg>
      <span>{label}</span>
    </Button>
  );
}
