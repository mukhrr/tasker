'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
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

const chartConfig = {
  amount: {
    label: 'Earnings',
    color: 'var(--chart-1)',
  },
  contributor: {
    label: 'Committer',
    color: 'var(--chart-1)',
  },
  reviewer: {
    label: 'C+',
    color: '#f59e0b',
  },
} satisfies ChartConfig;

interface EarningsChartProps {
  data: { month: string; amount: number; reviewer: number }[];
  /** Stack contributor and C+ earnings as two series (the All view). */
  split?: boolean;
  /** Draw the single series in the C+ amber (the Reviewer view). */
  reviewerOnly?: boolean;
}

const ACTIVE_DOT = { r: 4, stroke: 'var(--card)', strokeWidth: 2 };

export function EarningsChart({
  data,
  split = false,
  reviewerOnly = false,
}: EarningsChartProps) {
  const hasData = data.some((d) => d.amount > 0);
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const reviewerTotal = data.reduce((sum, d) => sum + d.reviewer, 0);
  const stacked = split && reviewerTotal > 0;
  const rows = data.map((d) => ({ ...d, contributor: d.amount - d.reviewer }));
  const singleColor = reviewerOnly
    ? 'var(--color-reviewer)'
    : 'var(--color-amount)';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Earnings Over Time</CardTitle>
        <CardDescription>
          {hasData
            ? `$${total.toLocaleString()} in the last 12 months${
                stacked
                  ? `, $${reviewerTotal.toLocaleString()} of it as C+`
                  : ''
              }`
            : 'No earnings data yet'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Add amounts and mark tasks as complete to see earnings
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart data={rows} accessibilityLayer>
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
                      formatter={(value) => (
                        <span className="font-mono font-medium tabular-nums">
                          ${(value as number).toLocaleString()}
                        </span>
                      )}
                    />
                  }
                />
                {stacked ? (
                  <>
                    <Area
                      type="monotone"
                      dataKey="contributor"
                      stackId="earnings"
                      stroke="var(--color-contributor)"
                      strokeWidth={2}
                      fill="var(--color-contributor)"
                      fillOpacity={0.1}
                      dot={false}
                      activeDot={ACTIVE_DOT}
                    />
                    <Area
                      type="monotone"
                      dataKey="reviewer"
                      stackId="earnings"
                      stroke="var(--color-reviewer)"
                      strokeWidth={2}
                      fill="var(--color-reviewer)"
                      fillOpacity={0.15}
                      dot={false}
                      activeDot={ACTIVE_DOT}
                    />
                  </>
                ) : (
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke={singleColor}
                    strokeWidth={2}
                    fill={singleColor}
                    fillOpacity={0.1}
                    dot={false}
                    activeDot={ACTIVE_DOT}
                  />
                )}
              </AreaChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>Earnings by month, last 12 months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Earnings</th>
                  {stacked && <th scope="col">Of which C+</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.month}>
                    <td>{d.month}</td>
                    <td>${d.amount.toLocaleString()}</td>
                    {stacked && <td>${d.reviewer.toLocaleString()}</td>}
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
