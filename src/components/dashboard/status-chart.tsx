'use client';

import { Pie, PieChart, Label } from 'recharts';
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
import type { TaskStatusGroup } from '@/types/database';

const chartConfig = {
  value: { label: 'Tasks' },
  todo: { label: 'To-do', color: 'var(--chart-4)' },
  in_progress: { label: 'In Progress', color: 'var(--chart-1)' },
  complete: { label: 'Complete', color: 'var(--chart-2)' },
} satisfies ChartConfig;

interface StatusChartProps {
  data: { name: string; value: number; group: TaskStatusGroup }[];
}

export function StatusChart({ data }: StatusChartProps) {
  const hasData = data.some((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  const chartData = data.map((d) => ({
    ...d,
    fill: `var(--color-${d.group})`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks by Status</CardTitle>
        <CardDescription>
          {hasData ? `${total} total tasks` : 'No tasks yet'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Add tasks to see status distribution
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <ChartContainer
              config={chartConfig}
              className="h-[250px] w-[200px] shrink-0"
            >
              <PieChart accessibilityLayer>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={4}
                  strokeWidth={0}
                >
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy}
                              className="fill-foreground text-2xl font-bold"
                            >
                              {total}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy ?? 0) + 20}
                              className="fill-muted-foreground text-xs"
                            >
                              Total
                            </tspan>
                          </text>
                        );
                      }
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="flex flex-col gap-3">
              {data.map((entry) => (
                <div key={entry.group} className="flex items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-[4px]"
                    style={{
                      backgroundColor:
                        (
                          chartConfig[
                            entry.group as keyof typeof chartConfig
                          ] as { color?: string } | undefined
                        )?.color,
                    }}
                  />
                  <div>
                    <p className="text-sm font-medium leading-none">
                      {entry.value}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
