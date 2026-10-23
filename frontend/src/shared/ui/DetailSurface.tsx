import type { ReactNode } from 'react';

/** Render inner diagnostics without adding another disclosure level. */
export function DetailSurface({
  flat = false,
  title,
  children,
  className,
}: {
  flat?: boolean;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return flat ? (
    <div className={className}>
      <div className="detail-surface-title">{title}</div>
      {children}
    </div>
  ) : (
    <details className={className}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
