import type { ButtonHTMLAttributes } from 'react';
import { DEMO_DENIED, useDemoAccess } from '../lib/demoAccess';

/** The wrapper receives hover events even when the native button is disabled. */
export function WriteButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { readOnly } = useDemoAccess();
  return (
    <span className="write-action" title={readOnly ? DEMO_DENIED : undefined}>
      <button
        {...props}
        disabled={readOnly || props.disabled}
        title={readOnly ? DEMO_DENIED : props.title}
      />
    </span>
  );
}
