import { useState } from 'react';
import { workbenchApi } from '../workbench';
import type { Metrics } from '../../shared/api/metrics';

export function weeklyMarkdown(metrics: Metrics) {
  const { ai, period } = metrics;
  return [
    '# 本周 AI 运行周报',
    '',
    `统计区间：${period.start} 至 ${period.end}（${period.timezone}，截至导出时）`,
    '',
    `- AI 拦截风险：${ai.risk_interceptions} 次`,
    `- 方案生成：${ai.generated} 批`,
    `- 方案采纳：${ai.adopted} 项`,
    `- 计划发布：${ai.published} 次`,
    `- 采纳率：${ai.adoption_rate === null ? '未统计' : `${ai.adoption_rate}%`}`,
    `- 产能节省：${metrics.capacity_saved_minutes === null ? '未统计' : `${metrics.capacity_saved_minutes} 分钟`}`,
    `- 工作流失败：${ai.failed} 次`,
    `- AI 降级：${ai.degraded} 次`,
    '',
    '统计口径与限制：',
    ...metrics.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

export function WeeklyReportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      const report = weeklyMarkdown(await workbenchApi.weeklyMetrics());
      const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'schedcopilot-weekly-report.md';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('周报读取失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="weekly-report-action">
      <button
        className="weekly-report-button"
        type="button"
        disabled={busy}
        onClick={() => void download()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" />
        </svg>
        {busy ? '正在导出…' : '导出运行周报'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
