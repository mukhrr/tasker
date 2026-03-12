import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'animate-shimmer rounded-md bg-muted bg-[length:200%_100%]',
        'bg-gradient-to-r from-muted via-muted-foreground/10 to-muted',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
