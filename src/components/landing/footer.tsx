import Image from 'next/image';

export function Footer() {
  return (
    <footer className="border-t border-border/40 dark:border-white/[0.04]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Tasker"
            width={20}
            height={20}
            className="rounded"
          />
          <span className="text-sm font-medium text-muted-foreground">
            Tasker
          </span>
        </div>
        <p className="text-xs text-muted-foreground/60">
          Open source task tracking, powered by GitHub & AI.
        </p>
      </div>
    </footer>
  );
}
