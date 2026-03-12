import { Card, CardContent } from '@/components/ui/card';

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  accent?: string;
}

export function StatCard({ title, value, description, accent }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-0">
        <div className="flex items-center gap-2">
          {accent && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            {title}
          </p>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
          {value}
        </p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
