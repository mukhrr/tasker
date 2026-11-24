import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { assignedToPaid } from '@/lib/dashboard-charts';
import { COMMITTER_COLOR } from './chart-colors';

export function PayoutTimeChart({
  data,
}: {
  data: ReturnType<typeof assignedToPaid>;
}) {
  const { buckets, median, count } = data;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const slow = buckets[buckets.length - 1];

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Assigned to paid</CardTitle>
          <CardDescription>
            {count > 0
              ? `${count} paid ${count === 1 ? 'task' : 'tasks'} · median ${median} days`
              : 'No paid tasks with both dates yet'}
          </CardDescription>
        </div>
        {slow.count > 0 && (
          <span className="text-right text-xs text-muted-foreground">
            {slow.count} {slow.count === 1 ? 'task' : 'tasks'} took
            <br />
            over 45 days
          </span>
        )}
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label={`Days from assigned to paid: ${buckets
            .map((b) => `${b.label} ${b.count}`)
            .join(', ')}`}
          className="grid h-[200px] grid-cols-6 items-end gap-3 border-b border-border"
        >
          {buckets.map((b, i) => (
            <div key={b.label} className="flex flex-col items-center gap-1.5">
              <span className="font-mono text-xs tabular-nums">{b.count}</span>
              <div
                className="w-full rounded-t-[3px]"
                style={{
                  height: `${(b.count / max) * 160}px`,
                  background:
                    i === buckets.length - 1 ? '#c4693f' : COMMITTER_COLOR,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-6 gap-3">
          {buckets.map((b) => (
            <span
              key={b.label}
              className="text-center text-[11px] text-muted-foreground"
            >
              {b.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
