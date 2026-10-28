import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { workbench } from '../../test/fixtures';
import { EventEditor } from './EventEditor';
import { draftFor } from './model';

describe('设备故障编辑器', () => {
  it('按钮显示当前快照时间，点击后将该时间填入故障开始时间', () => {
    const onEdit = vi.fn();
    const firstState = { ...workbench, snapshot_time: '2026-10-26T10:00:00+08:00' };
    const view = render(
      <EventEditor
        state={firstState}
        draft={draftFor(firstState)}
        busy=""
        stale={false}
        draftInvalid={false}
        onEdit={onEdit}
        onSave={vi.fn()}
      />,
    );

    const firstButton = screen.getByRole('button', {
      name: '使用2026年10月26日 10:00快照时间',
    });
    fireEvent.click(firstButton);
    expect(onEdit).toHaveBeenLastCalledWith({ started_at: '2026-10-26T10:00' });

    const nextState = { ...firstState, snapshot_time: '2026-10-27T11:20:00+08:00' };
    view.rerender(
      <EventEditor
        state={nextState}
        draft={draftFor(nextState)}
        busy=""
        stale={false}
        draftInvalid={false}
        onEdit={onEdit}
        onSave={vi.fn()}
      />,
    );
    const nextButton = screen.getByRole('button', {
      name: '使用2026年10月27日 11:20快照时间',
    });
    fireEvent.click(nextButton);
    expect(onEdit).toHaveBeenLastCalledWith({ started_at: '2026-10-27T11:20' });
  });
});
