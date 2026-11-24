'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
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
import { COMMITTER_COLOR, REVIEWER_COLOR } from './chart-colors';

const chartConfig = {
  contributor: { label: 'Committer', color: COMMITTER_COLOR },
  reviewer: { label: 'Reviewer', color: REVIEWER_COLOR },
} satisfies ChartConfig;

interface EarningsChartProps {
  data: { month: string; amount: number; reviewer: number }[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function EarningsChart({ data }: EarningsChartProps) {
  const hasData = data.some((d) => d.amount > 0);
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const average = total / Math.max(1, data.length);
  const best = data.reduce((a, b) => (b.amount > a.amount ? b : a), data[0]);
  const current = data[data.length - 1];
  const rows = data.map((d) => ({ ...d, contributor: d.amount - d.reviewer }));
  // The current month is still running, so its bar is drawn lighter.
  const fade = (i: number) => (i === rows.length - 1 ? 0.55 : 1);

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Earned per month</CardTitle>
          <CardDescription>
            {hasData
              ? `${money(total)} in the last 12 months · average ${money(average)}`
              : 'No earnings data yet'}
          </CardDescription>
        </div>
        {hasData && (
          <span className="text-right text-xs text-muted-foreground">
            Best: {best.month.slice(0, 3)}, {money(best.amount)}
            <br />
            {current.month.slice(0, 3)} so far: {money(current.amount)}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Add amounts and mark tasks as complete to see earnings
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart data={rows} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => v.slice(0, 3)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span className="flex w-full justify-between gap-4">
                          <span className="text-muted-foreground">
                            {name === 'reviewer' ? 'Reviewer' : 'Committer'}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {money(value as number)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                <ReferenceLine
                  y={average}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: `avg ${money(average)}`,
                    position: 'insideTopLeft',
                    fill: 'var(--muted-foreground)',
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="contributor"
                  stackId="earned"
                  fill="var(--color-contributor)"
                  maxBarSize={36}
                >
                  {rows.map((r, i) => (
                    <Cell key={r.month} fillOpacity={fade(i)} />
                  ))}
                </Bar>
                <Bar
                  dataKey="reviewer"
                  stackId="earned"
                  fill="var(--color-reviewer)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                >
                  {rows.map((r, i) => (
                    <Cell key={r.month} fillOpacity={fade(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>Earnings by month, last 12 months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Earnings</th>
                  <th scope="col">Of which reviewer</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.month}>
                    <td>{d.month}</td>
                    <td>${d.amount.toLocaleString()}</td>
                    <td>${d.reviewer.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
