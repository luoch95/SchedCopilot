import { useState } from 'react';
import type { PlanPublication } from '../../shared/api/contracts';
import { localInput } from '../../shared/lib/time';
import { Modal } from '../../shared/ui/Modal';

export function PlanVersionTag({
  version,
  publication,
}: {
  version: number;
  publication?: PlanPublication;
}) {
  const [open, setOpen] = useState(false);
  const info = publication?.version === version ? publication : undefined;
  const history = info?.history?.length
    ? info.history
    : [
        {
          version,
          published_at: info?.published_at ?? null,
          published_by: info?.published_by ?? null,
          version_summary:
            info?.version_summary ?? (version === 1 ? '初始演示计划' : '历史版本，未记录发布信息'),
          details: ['未记录详细变更说明'],
        },
      ];
  return (
    <>
      <span className="plan-version">
        <button
          type="button"
          className="plan-version-tag"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`查看执行计划 V${version} 发布信息`}
          title="查看计划版本历史"
          onClick={() => setOpen(true)}
        >
          V{version} <span aria-hidden="true">›</span>
        </button>
      </span>
      {open && (
        <Modal
          title="计划版本历史"
          drawer
          drawerWidth="min(560px, 100vw)"
          onClose={() => setOpen(false)}
        >
          <ol className="plan-version-timeline" aria-label="计划版本时间轴">
            {[...history]
              .sort((a, b) => b.version - a.version)
              .map((entry) => (
                <li key={entry.version}>
                  <details className="plan-version-entry" open={entry.version === version}>
                    <summary>
                      <strong>V{entry.version}</strong>
                      <span
                        className={`plan-version-status${entry.version === version ? ' is-current' : ''}`}
                      >
                        {entry.version === version ? '当前执行版' : '历史修订'}
                      </span>
                      <span className="plan-version-date">
                        {entry.published_at
                          ? localInput(entry.published_at).replace('T', ' ')
                          : '发布时间未记录'}
                      </span>
                      <span className="plan-version-row-meta">
                        发布人：{entry.published_by ?? '未记录'}
                      </span>
                      <span className="plan-version-row-summary">
                        变更摘要：{entry.version_summary}
                      </span>
                    </summary>
                    <div className="plan-version-description">
                      <p>
                        发布时间：
                        {entry.published_at
                          ? localInput(entry.published_at).replace('T', ' ')
                          : '未记录'}
                      </p>
                      <ul>
                        {entry.details.map((detail, index) => (
                          <li key={index}>{detail}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
          </ol>
        </Modal>
      )}
    </>
  );
}
