import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FaultOutline } from './FaultOutline';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('uses only fixed business anchors, highlights ancestors and preserves the route', () => {
  vi.useFakeTimers();
  let offset = 0;
  const scroll = vi.fn();
  render(
    <div className="fault-decision-layout">
      <main className="workspace">
        <h1>故障影响与方案决策</h1>
        <h2
          id="section-plan"
          ref={(node) => {
            if (node) node.getBoundingClientRect = () => ({ top: -offset }) as DOMRect;
          }}
        >
          执行计划概览
        </h2>
        <h3
          id="section-current-plan"
          ref={(node) => {
            if (node) {
              node.getBoundingClientRect = () => ({ top: 800 - offset }) as DOMRect;
              node.scrollIntoView = scroll;
            }
          }}
        >
          当前执行计划
        </h3>
        <h2
          id="section-comparison"
          ref={(node) => {
            if (node) node.getBoundingClientRect = () => ({ top: 1600 - offset }) as DOMRect;
          }}
        >
          方案比较
        </h2>
        <h3 data-outline>某个候选卡片</h3>
        <table>
          <tbody>
            <tr>
              <td>无关表格文字</td>
            </tr>
          </tbody>
        </table>
      </main>
      <FaultOutline />
    </div>,
  );
  const nav = screen.getByRole('navigation');
  expect(within(nav).queryByText('某个候选卡片')).toBeNull();
  expect(within(nav).queryByText('无关表格文字')).toBeNull();
  expect(within(nav).getAllByRole('list')).toHaveLength(6);
  expect(
    Array.from(
      nav.querySelectorAll(
        '.fault-outline-scroll > ul > li > a, .fault-outline-scroll > ul > li > span',
      ),
    ).map((node) => node.textContent),
  ).toEqual(['执行计划概览', '智能分析链路', '方案比较', '辅助分析', '人工确认']);
  expect(within(nav).queryByText(/条记录/)).toBeNull();
  const child = within(nav).getByRole('link', { name: '当前执行计划' });
  const parent = within(nav).getByRole('link', { name: '执行计划概览' });
  expect(child.closest('ul')?.parentElement?.contains(parent)).toBe(true);
  const route = location.hash;
  fireEvent.click(child);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  expect(document.activeElement?.textContent).toBe('当前执行计划');
  expect(child.getAttribute('aria-current')).toBe('location');
  expect(parent.dataset.active).toBe('true');
  expect(location.hash).toBe(route);
  offset = 1650;
  fireEvent.scroll(window);
  act(() => vi.advanceTimersByTime(20));
  expect(within(nav).getByRole('link', { name: '方案比较' }).getAttribute('aria-current')).toBe(
    'location',
  );
  expect(parent.dataset.active).toBeUndefined();
});

it('updates hierarchy with new results and opens folded targets', async () => {
  const scroll = vi.fn();
  const View = ({ ready }: { ready: boolean }) => (
    <div className="fault-decision-layout">
      <main className="workspace">
        <h2 id="section-confirm">人工确认</h2>
        {ready && (
          <details>
            <summary>查看记录</summary>
            <h3
              id="section-history"
              ref={(node) => {
                if (node) node.scrollIntoView = scroll;
              }}
            >
              历史记录
            </h3>
          </details>
        )}
      </main>
      <FaultOutline />
    </div>
  );
  const { rerender } = render(<View ready={false} />);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  rerender(<View ready />);
  const child = await screen.findByRole('link', { name: '历史记录' });
  vi.useFakeTimers();
  fireEvent.click(child);
  expect(screen.getByText('查看记录').closest('details')?.open).toBe(true);
  act(() => vi.advanceTimersByTime(300));
  expect(scroll).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '人工确认' }).dataset.active).toBe('true');
  vi.useRealTimers();
  rerender(<View ready={false} />);
  await act(async () => {});
  expect(screen.queryByRole('link', { name: '历史记录' })).toBeNull();
  expect(
    within(screen.getByRole('navigation')).getByText('历史记录').getAttribute('aria-disabled'),
  ).toBe('true');
});
