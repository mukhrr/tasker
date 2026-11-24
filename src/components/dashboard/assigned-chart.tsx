'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { assignedPerDay } from '@/lib/dashboard-charts';
import { COMMITTER_COLOR, REVIEWER_COLOR } from './chart-colors';

const chartConfig = {
  committer: { label: 'Committer', color: COMMITTER_COLOR },
  reviewer: { label: 'Reviewer', color: REVIEWER_COLOR },
} satisfies ChartConfig;

const RANGES = [10, 30, 90] as const;
type Range = (typeof RANGES)[number];

// Day number under every bar; the month only where it starts or changes.
function dayTick(label: string, index: number) {
  const dayOfMonth = label.split(' ')[1];
  return index === 0 || dayOfMonth === '1' ? label : dayOfMonth;
}

export function AssignedChart({
  tasks,
}: {
  tasks: Parameters<typeof assignedPerDay>[0];
}) {
  const [range, setRange] = useState<Range>(10);
  const { days, total, reviewer, previous } = useMemo(
    () => assignedPerDay(tasks, new Date(), range),
    [tasks, range]
  );
  const diff = total - previous;
  const split =
    reviewer > 0 && reviewer < total
      ? ` · ${total - reviewer} committer, ${reviewer} reviewer`
      : '';

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>Assigned per day</CardTitle>
          <CardDescription>
            {total > 0
              ? `${total} ${total === 1 ? 'task' : 'tasks'} in the last ${range} days${split}`
              : `Nothing assigned in the last ${range} days`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-right">
            <div
              className={`font-mono text-xl font-medium tabular-nums ${
                diff > 0 ? 'text-emerald-500' : diff < 0 ? 'text-red-400' : ''
              }`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </div>
            <div className="text-xs text-muted-foreground">
              vs {range} days before
            </div>
          </div>
          <div
            role="group"
            aria-label="Date range"
            className="inline-flex gap-0.5 rounded-lg border bg-muted/40 p-0.5"
          >
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                  range === r
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[160px] w-full">
          <BarChart data={days} accessibilityLayer barCategoryGap={3}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={range === 90 ? 'preserveStartEnd' : 0}
              minTickGap={range === 90 ? 16 : 0}
              tickFormatter={dayTick}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              allowDecimals={false}
              width={24}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="committer"
              stackId="day"
              fill="var(--color-committer)"
              maxBarSize={18}
            />
            <Bar
              dataKey="reviewer"
              stackId="day"
              fill="var(--color-reviewer)"
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            />
          </BarChart>
        </ChartContainer>
        <table className="sr-only">
          <caption>Tasks assigned per day, last {range} days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Committer</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{d.label}</td>
                <td>{d.committer}</td>
                <td>{d.reviewer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
