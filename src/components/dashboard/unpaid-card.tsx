import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { unpaidByStatus } from '@/lib/dashboard-charts';
import type { TaskStatusGroup } from '@/types/database';
import { COMMITTER_COLOR, REVIEWER_COLOR } from './chart-colors';

const GROUP_LABELS: Record<TaskStatusGroup, string> = {
  pending: 'Pending payout',
  in_progress: 'In progress',
  todo: 'To-do',
  complete: 'Complete',
};

const money = (n: number) => `$${n.toLocaleString()}`;

export function UnpaidCard({
  data,
}: {
  data: ReturnType<typeof unpaidByStatus>;
}) {
  const { groups, total, count } = data;
  const max = Math.max(
    1,
    ...groups.flatMap((g) => g.rows.map((r) => r.committer + r.reviewer))
  );
  const width = (n: number) => `${(n / max) * 100}%`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unpaid money by status</CardTitle>
        <CardDescription>
          {count > 0
            ? `${money(total)} across ${count} ${count === 1 ? 'task' : 'tasks'} · closest to payout first`
            : 'No open tasks'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map((g) => (
          <div key={g.group} className="space-y-1.5">
            <div className="flex justify-between pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>{GROUP_LABELS[g.group]}</span>
              <span>{money(g.total)}</span>
            </div>
            <ul className="space-y-1">
              {g.rows.map((r) => (
                <li
                  key={r.key}
                  className="grid h-6 grid-cols-[132px_minmax(0,1fr)_92px] items-center gap-3 text-[13px]"
                >
                  <span className="truncate">{r.label}</span>
                  <div
                    role="img"
                    aria-label={`${money(r.committer + r.reviewer)}: committer ${money(r.committer)}, reviewer ${money(r.reviewer)}`}
                    className="flex h-3 gap-0.5"
                  >
                    {r.committer > 0 && (
                      <div
                        className="rounded-sm"
                        style={{
                          width: width(r.committer),
                          background: COMMITTER_COLOR,
                        }}
                      />
                    )}
                    {r.reviewer > 0 && (
                      <div
                        className="rounded-sm"
                        style={{
                          width: width(r.reviewer),
                          background: REVIEWER_COLOR,
                        }}
                      />
                    )}
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums">
                    {money(r.committer + r.reviewer)}{' '}
                    <span className="text-muted-foreground">· {r.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
