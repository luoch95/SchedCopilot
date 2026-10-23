import { createContext, useContext } from 'react';

export const DEMO_DENIED = '演示模式：无操作权限';
// Standalone feature consumers retain their existing behavior; App always provides access.
export const DemoAccessContext = createContext({ readOnly: false });
export const useDemoAccess = () => useContext(DemoAccessContext);
