'use client';

import { cn } from '@/lib/utils';
import { useReveal } from './hooks';

const STATS = [
  { title: 'Total Earned', value: '$4,250', desc: '12 completed', accent: '#34d399' },
  { title: 'Pending', value: '$2,100', desc: '5 active tasks', accent: '#818cf8' },
  { title: 'Active Tasks', value: '8', accent: '#f59e0b' },
  { title: 'Completed', value: '12', desc: 'of 20 total', accent: '#22d3ee' },
];

const AREA_POINTS = [
  { x: 0, y: 80 },
  { x: 40, y: 65 },
  { x: 80, y: 70 },
  { x: 120, y: 45 },
  { x: 160, y: 50 },
  { x: 200, y: 30 },
  { x: 240, y: 15 },
  { x: 280, y: 25 },
  { x: 320, y: 10 },
];

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function areaPath() {
  const pts = AREA_POINTS;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cp1x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) / 3;
    const cp1y = pts[i - 1].y;
    const cp2x = pts[i].x - (pts[i].x - pts[i - 1].x) / 3;
    const cp2y = pts[i].y;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[i].x},${pts[i].y}`;
  }
  return d;
}

function areaFillPath() {
  const line = areaPath();
  const lastPt = AREA_POINTS[AREA_POINTS.length - 1];
  const firstPt = AREA_POINTS[0];
  return `${line} L${lastPt.x},100 L${firstPt.x},100 Z`;
}

const PIE_DATA = [
  { label: 'To-do', value: 5, color: '#f59e0b' },
  { label: 'In Progress', value: 8, color: '#818cf8' },
  { label: 'Complete', value: 12, color: '#34d399' },
];

function pieSlices() {
  const total = PIE_DATA.reduce((s, d) => s + d.value, 0);
  const slices: { d: string; color: string; label: string; value: number }[] = [];
  let cumAngle = -90;
  const cx = 60,
    cy = 60,
    r = 50,
    ir = 32;

  for (const seg of PIE_DATA) {
    const angle = (seg.value / total) * 360;
    const gap = 3;
    const startAngle = cumAngle + gap / 2;
    const endAngle = cumAngle + angle - gap / 2;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const largeArc = angle - gap > 180 ? 1 : 0;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const x3 = cx + ir * Math.cos(endRad);
    const y3 = cy + ir * Math.sin(endRad);
    const x4 = cx + ir * Math.cos(startRad);
    const y4 = cy + ir * Math.sin(startRad);

    slices.push({
      d: `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${ir},${ir} 0 ${largeArc} 0 ${x4},${y4} Z`,
      color: seg.color,
      label: seg.label,
      value: seg.value,
    });
    cumAngle += angle;
  }
  return slices;
}

export function DashboardPreview() {
  const [ref, visible] = useReveal();
  const slices = pieSlices();

  return (
    <section className="px-5 py-20" aria-labelledby="dashboard-heading">
      <div ref={ref} className="mx-auto max-w-5xl">
        <div
          className={cn(
            'text-center transition-all duration-700',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          )}
        >
          <h2
            id="dashboard-heading"
            className="text-3xl font-bold tracking-tight sm:text-4xl"
          >
            See the full picture at a glance
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            Track earnings, monitor active tasks, and visualize your progress
            with real-time charts and stats.
          </p>
        </div>

        <div
          className={cn(
            'relative mx-auto mt-14 max-w-4xl overflow-hidden rounded-xl border border-border/60 bg-card/50 shadow-2xl shadow-violet-500/[0.03] backdrop-blur-sm transition-all duration-700 will-change-transform dark:border-white/[0.06] dark:bg-white/[0.02]',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          )}
          style={{ transitionDelay: visible ? '200ms' : '0ms' }}
        >
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 dark:border-white/[0.04]">
            <div className="h-3 w-3 rounded-full bg-red-400/60" />
            <div className="h-3 w-3 rounded-full bg-amber-400/60" />
            <div className="h-3 w-3 rounded-full bg-emerald-400/60" />
            <span className="ml-3 text-xs text-muted-foreground/60">
              dashboard — Tasker
            </span>
          </div>

          <div className="p-5 sm:p-6">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATS.map((stat, i) => (
                <div
                  key={stat.title}
                  className={cn(
                    'rounded-lg border border-border/40 bg-background/60 p-3.5 transition-all duration-500 dark:border-white/[0.04] dark:bg-white/[0.02]',
                    visible
                      ? 'translate-y-0 opacity-100'
                      : 'translate-y-4 opacity-0'
                  )}
                  style={{
                    transitionDelay: visible ? `${300 + i * 80}ms` : '0ms',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: stat.accent }}
                    />
                    <span className="text-[10px] font-medium tracking-wide text-muted-foreground sm:text-xs">
                      {stat.title}
                    </span>
                  </div>
                  <p className="mt-1.5 text-lg font-bold tabular-nums tracking-tight sm:text-xl">
                    {stat.value}
                  </p>
                  {stat.desc && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">
                      {stat.desc}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div
              className={cn(
                'mt-4 grid gap-3 sm:grid-cols-2 transition-all duration-600',
                visible
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-4 opacity-0'
              )}
              style={{ transitionDelay: visible ? '600ms' : '0ms' }}
            >
              {/* Earnings chart */}
              <div className="rounded-lg border border-border/40 bg-background/60 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
                <p className="text-xs font-semibold">Earnings Over Time</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  $4,250 in the last 9 months
                </p>
                <svg
                  viewBox="0 0 320 110"
                  className="mt-3 w-full"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient
                      id="lp-area-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#818cf8"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="100%"
                        stopColor="#818cf8"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {[25, 50, 75].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      y1={y}
                      x2="320"
                      y2={y}
                      stroke="currentColor"
                      className="text-border/30 dark:text-white/[0.04]"
                      strokeWidth={0.5}
                    />
                  ))}
                  <path d={areaFillPath()} fill="url(#lp-area-fill)" />
                  <path
                    d={areaPath()}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  {AREA_POINTS.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r={2.5}
                      fill="#818cf8"
                      className="opacity-0 transition-opacity hover:opacity-100"
                    />
                  ))}
                  {/* X-axis labels */}
                  {MONTHS.map((m, i) => (
                    <text
                      key={m}
                      x={AREA_POINTS[i].x}
                      y={108}
                      textAnchor="middle"
                      className="fill-muted-foreground/50 text-[7px]"
                    >
                      {m}
                    </text>
                  ))}
                </svg>
              </div>

              {/* Status pie chart */}
              <div className="rounded-lg border border-border/40 bg-background/60 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
                <p className="text-xs font-semibold">Tasks by Status</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  25 total tasks
                </p>
                <div className="mt-3 flex items-center gap-5">
                  <svg viewBox="0 0 120 120" className="h-[100px] w-[100px] shrink-0">
                    {slices.map((s, i) => (
                      <path
                        key={i}
                        d={s.d}
                        fill={s.color}
                        className="transition-opacity hover:opacity-80"
                      />
                    ))}
                    <text
                      x="60"
                      y="57"
                      textAnchor="middle"
                      className="fill-foreground text-[18px] font-bold"
                    >
                      25
                    </text>
                    <text
                      x="60"
                      y="72"
                      textAnchor="middle"
                      className="fill-muted-foreground text-[8px]"
                    >
                      Total
                    </text>
                  </svg>
                  <div className="flex flex-col gap-2.5">
                    {PIE_DATA.map((seg) => (
                      <div key={seg.label} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: seg.color }}
                        />
                        <div>
                          <p className="text-xs font-medium leading-none">
                            {seg.value}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {seg.label}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom fade */}
          <div className="pointer-events-none absolute -bottom-px left-0 right-0 h-12 bg-gradient-to-t from-background/60 to-transparent" />
        </div>
      </div>
    </section>
  );
}
