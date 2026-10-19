import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// Existing workbench behavior is covered by WorkbenchPage.test.tsx.
vi.mock('./WorkbenchPage', () => ({
  default: ({ onSwitchRole }: { onSwitchRole: () => void }) => (
    <main>
      <h1>排产工作台</h1>
      <button onClick={onSwitchRole}>切换角色</button>
    </main>
  ),
}));
vi.mock('../features/sales', () => ({
  LeaderPage: ({ onSwitchRole }: { onSwitchRole: () => void }) => (
    <main>
      <h1>紧急插单审批</h1>
      <button onClick={onSwitchRole}>切换角色</button>
    </main>
  ),
  SalesPage: ({ onSwitchRole }: { onSwitchRole: () => void }) => (
    <main>
      <h1>紧急插单</h1>
      <button onClick={onSwitchRole}>切换角色</button>
    </main>
  ),
}));
const key = 'sched-copilot.demo-role.v1';
beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState(null, '');
});

describe('demo role navigation (URG-01)', () => {
  it('starts at role selection without loading backend data', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    expect(screen.getByRole('heading', { name: '选择你的工作角色' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('persists sales across remount and clears it when switching', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入业务员页面/ }));
    expect(screen.getByRole('heading', { name: '紧急插单' })).toBeTruthy();
    expect(sessionStorage.getItem(key)).toBe('sales');
    first.unmount();
    render(<App />);
    expect(screen.getByRole('heading', { name: '紧急插单' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
    expect(screen.getByRole('heading', { name: '选择你的工作角色' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
    expect(screen.getByRole('heading', { name: '排产工作台' })).toBeTruthy();
    expect(sessionStorage.getItem(key)).toBe('planner');
  });
  it('restores planner and returns to selection', async () => {
    sessionStorage.setItem(key, 'planner');
    render(<App />);
    expect(screen.getByRole('heading', { name: '排产工作台' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await screen.findByRole('heading', { name: '选择你的工作角色' });
  });
  it('rejects unknown stored roles', () => {
    sessionStorage.setItem(key, 'unknown');
    render(<App />);
    expect(screen.getByRole('heading', { name: '选择你的工作角色' })).toBeTruthy();
  });
  it('opens and restores the leader approval view', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入领导审批/ }));
    expect(screen.getByRole('heading', { name: '紧急插单审批' })).toBeTruthy();
    expect(sessionStorage.getItem(key)).toBe('leader');
    first.unmount();
    render(<App />);
    expect(screen.getByRole('heading', { name: '紧急插单审批' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await screen.findByRole('heading', { name: '选择你的工作角色' });
  });
  it('navigates when browser storage is unavailable', async () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError');
      });
    }
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入业务员页面/ }));
    expect(screen.getByRole('heading', { name: '紧急插单' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await screen.findByRole('heading', { name: '选择你的工作角色' });
  });
});

describe('browser Back and Forward (URG-01)', () => {
  it.each([
    [/进入业务员页面/, '紧急插单', 'sales'],
    [/进入排产工作台/, '排产工作台', 'planner'],
  ] as const)(
    'returns from %s to role selection and restores on Forward',
    async (button, heading, role) => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
      act(() => history.back());
      await screen.findByRole('heading', { name: '选择你的工作角色' });
      expect(sessionStorage.getItem(key)).toBeNull();
      act(() => history.forward());
      await screen.findByRole('heading', { name: heading });
      expect(sessionStorage.getItem(key)).toBe(role);
    },
  );

  it('keeps a role-selection parent for a restored session under StrictMode', async () => {
    sessionStorage.setItem(key, 'planner');
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { name: '排产工作台' })).toBeTruthy();
    act(() => history.back());
    await screen.findByRole('heading', { name: '选择你的工作角色' });
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
