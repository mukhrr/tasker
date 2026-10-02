import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function TaskDetailLoading() {
  return (
    <div>
      <Skeleton className="h-5 w-28" />

      <Card className="mt-4">
        <CardContent className="pt-6">
          {/* Header: title + badge + delete */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>

          {/* Note */}
          <div className="mt-6 space-y-2">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>

          {/* Details grid */}
          <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>

          {/* AI Summary */}
          <div className="mt-6 rounded-lg border p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
