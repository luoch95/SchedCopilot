import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native dialog supplies focus trapping and makes the background inert. */
export function Modal({
  title,
  children,
  onClose,
  fullScreen = false,
  drawer = false,
  drawerWidth,
  busy = false,
  scrollPosition,
  heading,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  fullScreen?: boolean;
  drawer?: boolean;
  drawerWidth?: string;
  busy?: boolean;
  scrollPosition?: { current: number };
  heading?: (titleId: string) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    const body = bodyRef.current!;
    if (scrollPosition) body.scrollTop = scrollPosition.current;
    return () => {
      if (scrollPosition) scrollPosition.current = body.scrollTop;
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [scrollPosition]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      style={drawer && drawerWidth ? { width: drawerWidth } : undefined}
      className={['console-modal', fullScreen && 'console-modal-full', drawer && 'console-drawer']
        .filter(Boolean)
        .join(' ')}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) closeRef.current();
      }}
    >
      {heading ? (
        <div className="console-modal-heading console-modal-custom-heading">{heading(titleId)}</div>
      ) : (
        <header className="console-modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button disabled={busy} onClick={onClose}>
            {fullScreen ? '返回工作台' : '关闭'}
          </button>
        </header>
      )}
      <div ref={bodyRef} className="console-modal-body">
        {children}
      </div>
    </dialog>
  );
}
