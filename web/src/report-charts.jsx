import { useEffect, useId, useMemo, useRef, useState } from 'react';

const shortDate = (date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
const axisNumber = (value) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

function DailyRequests({ report }) {
  const titleId = useId();
  const descriptionId = useId();
  const container = useRef(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(280, Math.round(entry.contentRect.width));
      setWidth((current) => current === next ? current : next);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const days = useMemo(() => {
    const counts = new Map();
    for (const row of report.rows) counts.set(row.date, (counts.get(row.date) || 0) + row.count);
    const result = [];
    const end = new Date(report.to + 'T00:00:00Z').getTime();
    for (let cursor = new Date(report.from + 'T00:00:00Z').getTime(); cursor <= end; cursor += 86400000) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      result.push({ date, count: counts.get(date) || 0 });
    }
    return result;
  }, [report.from, report.to, report.rows]);
  const maximum = Math.max(4, Math.ceil(Math.max(...days.map((item) => item.count)) / 4) * 4);
  const plot = { x: 48, y: 18, width: width - 70, height: 170 };
  const step = plot.width / days.length;
  const barWidth = Math.min(40, step * 0.72);
  const ticks = [...new Set([0, Math.round((days.length - 1) / 4), Math.round((days.length - 1) / 2), Math.round((days.length - 1) * 3 / 4), days.length - 1])];
  return <figure className="rounded-xl border border-[var(--border)] bg-[var(--quiet)] p-3" aria-label="Daily request chart">
    <figcaption><h3>Requests by received date</h3><p className="muted mt-1 text-sm">Daily totals in Dhaka time, including days with zero requests.</p></figcaption>
    <div ref={container} className="mt-3 min-w-0">
    <svg viewBox={`0 0 ${width} 235`} className="block w-full" role="img" aria-labelledby={titleId + ' ' + descriptionId}>
      <title id={titleId}>Requests by received date</title>
      <desc id={descriptionId}>{report.total} requests from {report.from} through {report.to}. Exact nonzero counts are in the report table below.</desc>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = plot.y + plot.height - tick * plot.height / 4;
        return <g key={tick}>
          <line x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y} stroke="var(--border)" strokeDasharray={tick ? '4 4' : undefined} />
          <text x={plot.x - 8} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{axisNumber(tick * maximum / 4)}</text>
        </g>;
      })}
      {days.map((item, index) => {
        const height = item.count / maximum * plot.height;
        return <rect key={item.date} data-date={item.date} data-count={item.count}
          x={plot.x + index * step + (step - barWidth) / 2} y={plot.y + plot.height - height}
          width={barWidth} height={height} rx="1" fill="var(--accent-strong)">
          <title>{item.date + ' · ' + item.count + ' requests'}</title>
        </rect>;
      })}
      {ticks.map((index) => <text key={index} x={plot.x + index * step + step / 2} y={plot.y + plot.height + 22}
        textAnchor="middle" fill="var(--muted)" fontSize="11">{shortDate(days[index].date)}</text>)}
    </svg>
    </div>
  </figure>;
}

function CategoryChart({ title, name, items, labels }) {
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return <figure className="rounded-xl border border-[var(--border)] bg-[var(--quiet)] p-3" aria-label={name}>
    <figcaption><h3>{title}</h3></figcaption>
    <ul className="note-list mt-3">{items.map((item) => <li key={item.value}>
      <div className="mb-2 flex items-start justify-between gap-3 text-sm"><span>{labels[item.value] || item.value}</span><strong>{item.count}</strong></div>
      <svg viewBox="0 0 300 10" className="block h-3 w-full" preserveAspectRatio="none" aria-hidden="true">
        <rect width="300" height="10" rx="5" fill="var(--border)" />
        <rect data-category={item.value} data-count={item.count} width={item.count / maximum * 300} height="10" rx="5" fill="var(--accent-strong)" />
      </svg>
    </li>)}</ul>
  </figure>;
}

export function ReportCharts({ report, types, statuses }) {
  if (!report.total) return null;
  return <section className="grid min-w-0 gap-4" aria-label="Report charts">
    <h2>Report charts</h2>
    <DailyRequests report={report} />
    <div className="field-grid">
      <CategoryChart title="By request type" name="Request type chart" items={report.byType} labels={types} />
      <CategoryChart title="By current status" name="Current status chart" items={report.byStatus} labels={statuses} />
    </div>
  </section>;
}
