'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const chartConfig = {
  created: {
    label: 'Created',
    color: 'var(--chart-1)',
  },
  completed: {
    label: 'Completed',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig;

interface ActivityChartProps {
  data: { month: string; created: number; completed: number }[];
}

export function ActivityChart({ data }: ActivityChartProps) {
  const hasData = data.some((d) => d.created > 0 || d.completed > 0);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Monthly Activity</CardTitle>
        <CardDescription>
          {hasData
            ? 'Tasks created and completed over the last 6 months'
            : 'No activity data yet'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Start adding and completing tasks to see activity
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart data={data} accessibilityLayer barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="created"
                  fill="var(--color-created)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="completed"
                  fill="var(--color-completed)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>
                Tasks created and completed by month, last 6 months
              </caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Created</th>
                  <th scope="col">Completed</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.month}>
                    <td>{d.month}</td>
                    <td>{d.created}</td>
                    <td>{d.completed}</td>
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
