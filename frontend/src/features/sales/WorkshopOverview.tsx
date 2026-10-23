import { useId, useState, type ReactNode } from 'react';

function AffectedLine({ line, detail }: { line: string; detail: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`workshop-line${line === 'M3产线' ? ' workshop-line-danger' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        onClick={() => setOpen(!open)}
      >
        {line}
      </button>
      {open && (
        <span id={id} role="tooltip" className="workshop-tooltip">
          {detail}
        </span>
      )}
    </span>
  );
}

/** Static showcase only; deliberately independent from live approval and plan data. */
export function WorkshopOverview({ headerActions }: { headerActions?: ReactNode }) {
  return (
    <section className="section workshop-overview" aria-label="生产车间概况">
      <div className="section-heading">
        <div className="workshop-overview-title">
          <h2>生产车间概况</h2>
          <span className="tag">静态演示数据</span>
        </div>
        {headerActions}
      </div>
      <div className="workshop-metrics">
        <article className="workshop-metric">
          <h3>出勤情况</h3>
          <div className="workshop-value">
            95<small> / 100 人</small>
          </div>
          <p>应到 100 人 / 实到 95 人</p>
          <span className="workshop-status workshop-status-good">到岗率 95%</span>
        </article>
        <article className="workshop-metric">
          <h3>产线运行</h3>
          <div className="workshop-value">
            4<small> / 5 条</small>
          </div>
          <p>产线总数 5 / 生产中 4</p>
          <span className="workshop-status workshop-status-blue">利用率 80%</span>
        </article>
        <article className="workshop-metric">
          <h3>紧急插单</h3>
          <div className="workshop-value">
            1<small> 项待关注</small>
          </div>
          <div className="workshop-alert-row">
            <span>紧急插单</span>
            <AffectedLine
              line="M2产线"
              detail="插单 URG-20261020-001 影响了 M2；需关注原订单交期。"
            />
          </div>
          <div className="workshop-alert-row">
            <span>设备故障</span>
            <AffectedLine line="M3产线" detail="故障详情：M3 停机维修，预计 16:00 恢复。" />
          </div>
          <p className="sales-muted">悬浮产线名称查看明细</p>
        </article>
        <article className="workshop-metric">
          <h3>缺料预警</h3>
          <div className="workshop-value">
            1<small> 条产线</small>
          </div>
          <div className="workshop-alert-row">
            <span>原料待补充</span>
            <AffectedLine
              line="M5产线"
              detail="缺料详情：M5 的 ABS 原料待补充，预计 15:30 到料。"
            />
          </div>
          <span className="workshop-status workshop-status-warning">待跟进</span>
        </article>
      </div>
    </section>
  );
}
