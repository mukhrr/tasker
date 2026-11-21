import type { Turn } from '@/lib/role';

export function TurnCell({ turn }: { turn: Turn }) {
  if (turn === 'me') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="size-2 rounded-full bg-blue-500" />
        You
      </span>
    );
  }
  if (turn === 'author') {
    return <span className="text-sm text-muted-foreground">Author</span>;
  }
  if (turn === 'merge') {
    return <span className="text-sm text-muted-foreground">Merge</span>;
  }
  return <span className="text-sm text-muted-foreground">—</span>;
}
