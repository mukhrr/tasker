import { Card, CardContent } from '@/components/ui/card';

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  /** Signed change vs a named period, e.g. "+$120 vs last month" */
  delta?: { text: string; direction: 'up' | 'down' };
  /** 12-point sparkline; drawn in the de-emphasis gray, current point in accent */
  trend?: number[];
}

function Sparkline({ points }: { points: number[] }) {
  const w = 72;
  const h = 24;
  const pad = 3;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => [
    pad + i * step,
    pad + (h - pad * 2) * (1 - (v - min) / range),
  ]);
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity={0.5}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill="var(--chart-1)"
        stroke="var(--card)"
        strokeWidth={2}
      />
    </svg>
  );
}

export function StatCard({
  title,
  value,
  description,
  delta,
  trend,
}: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-0">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          {title}
        </p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {trend && trend.length > 1 && <Sparkline points={trend} />}
        </div>
        {delta && (
          <p
            className={`mt-1 text-xs font-medium ${
              delta.direction === 'up'
                ? 'text-green-700 dark:text-green-500'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {delta.text}
          </p>
        )}
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
