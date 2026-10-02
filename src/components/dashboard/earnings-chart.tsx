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
} satisfies ChartConfig;

interface EarningsChartProps {
  data: { month: string; amount: number }[];
}

export function EarningsChart({ data }: EarningsChartProps) {
  const hasData = data.some((d) => d.amount > 0);
  const total = data.reduce((sum, d) => sum + d.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Earnings Over Time</CardTitle>
        <CardDescription>
          {hasData
            ? `$${total.toLocaleString()} in the last 12 months`
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
              <AreaChart data={data} accessibilityLayer>
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
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="var(--color-amount)"
                  strokeWidth={2}
                  fill="var(--color-amount)"
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{
                    r: 4,
                    stroke: 'var(--card)',
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>Earnings by month, last 12 months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.month}>
                    <td>{d.month}</td>
                    <td>${d.amount.toLocaleString()}</td>
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
