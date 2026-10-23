import { useId, useState } from 'react';
import type { DateRange } from '../lib/dateRange';
import { localInput } from '../lib/time';
import { Modal } from './Modal';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const dayKey = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function DateRangeFilter({
  onChange,
  initialRange = { start: '', end: '' },
}: {
  onChange: (range: DateRange) => void;
  initialRange?: DateRange;
}) {
  const [range, setRange] = useState<DateRange>(initialRange);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState('');
  const [hovered, setHovered] = useState('');
  const [month, setMonth] = useState(() =>
    (initialRange.start || localInput(new Date().toISOString())).slice(0, 7),
  );
  const hintId = useId();
  const [year, monthNumber] = month.split('-').map(Number);
  function moveMonth(offset: number) {
    const next = new Date(year, monthNumber - 1 + offset, 1);
    setMonth(dayKey(next.getFullYear(), next.getMonth(), 1).slice(0, 7));
  }
  function select(day: string) {
    if (!anchor) {
      setAnchor(day);
      setHovered(day);
      return;
    }
    const [start, end] = [anchor, day].sort();
    const next = { start, end };
    setRange(next);
    onChange(next);
    setOpen(false);
  }
  const preview = anchor ? [anchor, hovered || anchor].sort() : [range.start, range.end];
  const short = (day: string) => day.slice(5).replace('-', '/');
  return (
    <div className="dashboard-date-filter" role="group" aria-label="时间范围">
      <button
        type="button"
        className="date-range-trigger"
        aria-label={range.start ? `时间范围：${range.start} 至 ${range.end}` : '选择时间范围'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setAnchor('');
          setHovered('');
          if (range.start) setMonth(range.start.slice(0, 7));
          setOpen(true);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4m10-4v4M3 11h18" />
        </svg>
        {range.start ? `${short(range.start)} - ${short(range.end)}` : '时间范围'}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <Modal title="选择日期范围" onClose={() => setOpen(false)}>
          <div className="date-range-calendar">
            <div className="date-range-navigation">
              <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>
                ‹
              </button>
              <input
                type="month"
                aria-label="显示月份"
                value={month}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value);
                }}
              />
              <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>
                ›
              </button>
            </div>
            <p id={hintId} className="date-range-instruction" aria-live="polite">
              {anchor ? `已选 ${anchor}，请选择结束日期` : '依次选择开始和结束日期'}
            </p>
            <div className="date-range-months" aria-describedby={hintId}>
              {[0, 1].map((offset) => {
                const date = new Date(year, monthNumber - 1 + offset, 1);
                const y = date.getFullYear();
                const m = date.getMonth();
                const days = new Date(y, m + 1, 0).getDate();
                const padding = (date.getDay() + 6) % 7;
                return (
                  <section
                    className="date-range-month"
                    key={`${y}-${m}`}
                    aria-label={`${y}年${m + 1}月`}
                  >
                    <h3>
                      {y}年 {m + 1}月
                    </h3>
                    <div className="date-range-days">
                      {weekdays.map((day) => (
                        <span className="date-range-weekday" key={day}>
                          {day}
                        </span>
                      ))}
                      {Array.from({ length: padding }, (_, index) => (
                        <span key={`blank-${index}`} />
                      ))}
                      {Array.from({ length: days }, (_, index) => {
                        const day = dayKey(y, m, index + 1);
                        const selected = !!preview[0] && day >= preview[0] && day <= preview[1];
                        const edge = selected && (day === preview[0] || day === preview[1]);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-label={day}
                            aria-pressed={selected}
                            className={`date-range-day${selected ? ' is-in-range' : ''}${edge ? ' is-edge' : ''}`}
                            onClick={() => select(day)}
                            onMouseEnter={() => setHovered(day)}
                            onFocus={() => setHovered(day)}
                          >
                            {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
