import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DemoAccess, DemoAccessBar } from './DemoAccess';
import { WriteButton } from '../../shared/ui/WriteButton';
import { DEMO_DENIED } from '../../shared/lib/demoAccess';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('No auth server'))),
  );
});

function open() {
  const write = vi.fn();
  const view = vi.fn();
  render(
    <DemoAccess>
      <DemoAccessBar />
      <WriteButton onClick={write}>确认发布</WriteButton>
      <button onClick={view}>查看详情</button>
    </DemoAccess>,
  );
  return { write, view };
}

async function unlock(password = 'admin123') {
  fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
  fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: password } });
  fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
}

describe('demo access', () => {
  it('hides and restores the hint without unlocking writes or blocking viewing', () => {
    const { write, view } = open();
    fireEvent.click(screen.getByRole('button', { name: '隐藏提示' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: '解锁' })).toBeNull();
    const toggle = screen.getByRole('button', { name: '显示提示' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByRole('button', { name: '确认发布' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(write).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏提示' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: '解锁' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('closes the password popover and clears its draft when hiding the hint', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: '隐藏提示' }));
    expect(screen.queryByLabelText('演示密码')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示提示' }));
    fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    expect((screen.getByLabelText('演示密码') as HTMLInputElement).value).toBe('');
  });

  it('starts collapsed and toggles the login popover without closing on inside clicks', async () => {
    open();
    const trigger = screen.getAllByRole('button', { name: '解锁' }).at(-1)!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('演示密码')).toBeNull();
    fireEvent.click(trigger);
    const input = screen.getByLabelText('演示密码');
    expect(document.activeElement).toBe(input);
    fireEvent.click(input);
    expect(screen.getByRole('form', { name: '演示解锁' })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByLabelText('演示密码')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('closes on outside clicks or Escape and clears the password when reopened', async () => {
    const { view } = open();
    const trigger = screen.getAllByRole('button', { name: '解锁' }).at(-1)!;
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByText('查看详情'));
    expect(view).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('演示密码')).toBeNull();
    fireEvent.click(trigger);
    expect((screen.getByLabelText('演示密码') as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(screen.getByLabelText('演示密码'), { key: 'Escape' });
    expect(screen.queryByLabelText('演示密码')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('locks writes with a hover explanation while allowing viewing', async () => {
    const { write, view } = open();
    expect(screen.getByRole('status').textContent).toBe('当前为只读模式');
    expect(screen.getAllByTitle(DEMO_DENIED)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(write).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects wrong passwords and supports unlocking and relocking', async () => {
    const { write } = open();
    await unlock('wrong');
    await screen.findByText('演示密码错误');
    expect((screen.getByText('确认发布') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'admin123' } });
    fireEvent.submit(screen.getByRole('form', { name: '演示解锁' }));
    await screen.findByText('✓ 已解锁操作权限');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText('确认发布'));
    expect(write).toHaveBeenCalledOnce();
    expect(screen.queryByText('重置演示数据')).toBeNull();
    fireEvent.click(screen.getByText('锁定操作'));
    await screen.findByRole('status');
    expect((screen.getByText('确认发布') as HTMLButtonElement).disabled).toBe(true);
  });

  it('unlocks and relocks without any authentication requests', async () => {
    open();
    await unlock();
    expect(screen.getByText('✓ 已解锁操作权限')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '锁定操作' }));
    expect((screen.getByText('确认发布') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
