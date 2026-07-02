'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TaskStatusGroup } from '@/types/database';

/** Ordinal ramp: one hue, lightness encodes progression through the pipeline */
const RAMP: Record<TaskStatusGroup, string> = {
  todo: 'var(--chart-ramp-1)',
  in_progress: 'var(--chart-ramp-2)',
  complete: 'var(--chart-ramp-3)',
};

interface StatusChartProps {
  data: { name: string; value: number; group: TaskStatusGroup }[];
}

export function StatusChart({ data }: StatusChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const hasData = total > 0;
  const segments = data.filter((d) => d.value > 0);

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
          <div className="flex h-[250px] flex-col justify-center gap-6">
            <TooltipProvider>
              <div
                className="flex h-6 w-full gap-[2px]"
                role="img"
                aria-label={data
                  .map((d) => `${d.name}: ${d.value} of ${total} tasks`)
                  .join(', ')}
              >
                {segments.map((d, i) => (
                  <Tooltip key={d.group}>
                    <TooltipTrigger
                      render={
                        <div
                          className={`min-w-2 transition-[filter] hover:brightness-110 ${
                            i === 0 ? 'rounded-l-[4px]' : ''
                          } ${i === segments.length - 1 ? 'rounded-r-[4px]' : ''}`}
                          style={{
                            width: `${(d.value / total) * 100}%`,
                            backgroundColor: RAMP[d.group],
                          }}
                        />
                      }
                    />
                    <TooltipContent>
                      <span className="font-medium">{d.value}</span>
                      <span>
                        {d.name} · {Math.round((d.value / total) * 100)}%
                      </span>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
            <div className="flex flex-col gap-3">
              {data.map((d) => (
                <div key={d.group} className="flex items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: RAMP[d.group] }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {d.name}
                  </span>
                  <span className="ml-auto text-sm font-medium tabular-nums">
                    {d.value}
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
