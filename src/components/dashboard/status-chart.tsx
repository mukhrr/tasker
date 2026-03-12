'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartTooltip } from './chart-tooltip';
import type { TaskStatusGroup } from '@/types/database';

const GROUP_COLORS: Record<TaskStatusGroup, string> = {
  todo: 'var(--chart-4)',
  in_progress: 'var(--chart-1)',
  complete: 'var(--chart-2)',
};

interface StatusChartProps {
  data: { name: string; value: number; group: TaskStatusGroup }[];
}

export function StatusChart({ data }: StatusChartProps) {
  const hasData = data.some((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks by Status</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            No tasks yet
          </div>
        ) : (
          <div className="flex h-[280px] items-center gap-6">
            <div className="relative h-[200px] w-[200px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {data.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={GROUP_COLORS[entry.group]}
                        className="outline-none"
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums">{total}</span>
                <span className="text-[11px] text-muted-foreground">Total</span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {data.map((entry) => (
                <div key={entry.group} className="flex items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-[4px]"
                    style={{ backgroundColor: GROUP_COLORS[entry.group] }}
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
