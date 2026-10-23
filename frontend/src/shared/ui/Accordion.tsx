import type { ReactNode } from 'react';

export function Accordion({
  title,
  children,
  level = 3,
  outline = false,
  headingId,
}: {
  title: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
  outline?: boolean;
  headingId?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <details className="decision-accordion">
      <summary>
        <Heading id={headingId} data-outline={outline || undefined}>
          {title}
        </Heading>
      </summary>
      <div className="decision-accordion-content">{children}</div>
    </details>
  );
}
