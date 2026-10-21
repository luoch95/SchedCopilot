import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { DemoAccessContext } from '../../shared/lib/demoAccess';

const DemoAccessBarContext = createContext<ReactNode>(null);

export function DemoAccessBar() {
  return useContext(DemoAccessBarContext);
}

export function DemoAccess({ children }: { children: ReactNode }) {
  const [IS_DEMO, setIsDemo] = useState(true);
  const [hintHidden, setHintHidden] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const loginRef = useRef<HTMLDivElement>(null);
  const loginTrigger = useRef<HTMLButtonElement>(null);
  const loginId = useId();
  useEffect(() => {
    if (!loginOpen) return;
    const close = () => {
      setLoginOpen(false);
      setPassword('');
      setError('');
    };
    const outsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !loginRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      loginTrigger.current?.focus();
    };
    document.addEventListener('click', outsideClick);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outsideClick);
      document.removeEventListener('keydown', escape);
    };
  }, [loginOpen]);
  function login(event: FormEvent) {
    event.preventDefault();
    if (password !== 'admin123') {
      setError('演示密码错误');
      return;
    }
    setIsDemo(false);
    setError('');
    setPassword('');
    setLoginOpen(false);
  }
  const bar = (
    <div className={`demo-access-bar${IS_DEMO && hintHidden ? ' is-collapsed' : ''}`}>
      {IS_DEMO && !hintHidden && (
        <p className="demo-readonly-banner" role="status">
          当前为只读模式
        </p>
      )}
      {(!IS_DEMO || !hintHidden) && (
        <div className="demo-access-controls">
          {!IS_DEMO ? (
            <>
              <span>✓ 已解锁操作权限</span>
              <button onClick={() => setIsDemo(true)}>锁定操作</button>
            </>
          ) : (
            <div className="demo-login" ref={loginRef}>
              <button
                ref={loginTrigger}
                className="demo-login-trigger"
                onClick={() => {
                  setLoginOpen((value) => !value);
                  setPassword('');
                  setError('');
                }}
                aria-expanded={loginOpen}
                aria-controls={loginOpen ? loginId : undefined}
              >
                解锁
              </button>
              {loginOpen && (
                <form
                  id={loginId}
                  aria-label="演示解锁"
                  onSubmit={login}
                  className="demo-login-form"
                >
                  <input
                    type="password"
                    aria-label="演示密码"
                    autoComplete="off"
                    placeholder="输入演示密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoFocus
                  />
                  <button type="submit" disabled={!password}>
                    解锁
                  </button>
                  {error && <p role="alert">{error}</p>}
                </form>
              )}
            </div>
          )}
        </div>
      )}
      {IS_DEMO && (
        <button
          className="demo-hint-toggle"
          aria-expanded={!hintHidden}
          onClick={() => {
            setHintHidden((value) => !value);
            setLoginOpen(false);
            setPassword('');
            setError('');
          }}
        >
          {hintHidden ? '显示提示' : '隐藏提示'}
        </button>
      )}
    </div>
  );
  return (
    <DemoAccessContext.Provider value={{ readOnly: IS_DEMO }}>
      <DemoAccessBarContext.Provider value={bar}>{children}</DemoAccessBarContext.Provider>
    </DemoAccessContext.Provider>
  );
}
