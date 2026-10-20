/** Loading follows the real request lifecycle without simulated progress. */
export function GenerationLoading({ running }: { running: boolean }) {
  if (!running) return null;
  return (
    <div className="message info generation-loading" aria-busy={running}>
      <div className="generation-loading-title" role="status">
        <span className="generation-loading-spinner" aria-hidden="true" />
        <strong>正在生成方案…</strong>
      </div>
    </div>
  );
}
