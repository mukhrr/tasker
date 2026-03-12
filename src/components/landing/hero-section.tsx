'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconArrowRight } from './icons';
import { TablePreview } from './table-preview';

export function HeroSection({ scrollY }: { scrollY: number }) {
  return (
    <section
      className="relative px-5 pt-24 pb-8 sm:pt-32"
      aria-labelledby="hero-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <div
          className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/[0.06] px-3.5 py-1.5 text-xs font-medium text-violet-600 dark:border-violet-400/15 dark:text-violet-400"
          style={{ animation: 'fadeIn 0.6s ease-out both' }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          Your AI assistant for open source
        </div>

        <h1
          id="hero-heading"
          className="mt-7 text-4xl font-bold leading-[1.1] tracking-tight will-change-transform sm:text-6xl"
          style={{
            animation: 'fadeIn 0.6s ease-out 0.1s both',
            transform: `translateY(${scrollY * 0.06}px)`,
          }}
        >
          Meet your{' '}
          <span className="bg-gradient-to-r from-violet-500 to-blue-500 bg-clip-text text-transparent dark:from-violet-400 dark:to-blue-400">
            AI agent
          </span>{' '}
          <br className="hidden sm:block" />
          that manages your <br className="hidden sm:block" />
          open source tasks
        </h1>

        <p
          className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground will-change-transform sm:text-lg"
          style={{
            animation: 'fadeIn 0.6s ease-out 0.2s both',
            transform: `translateY(${scrollY * 0.03}px)`,
          }}
        >
          Tasker is an AI-powered assistant that watches your GitHub activity,
          automatically updates task statuses, and keeps your bounties and
          payments organized — so you can focus on writing code.
        </p>

        <div
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animation: 'fadeIn 0.6s ease-out 0.3s both' }}
        >
          <Link
            href="/auth/signup"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'gap-2 bg-violet-600 px-5 text-white hover:bg-violet-700 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500'
            )}
          >
            Start for free
            <IconArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/auth/login"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'px-5'
            )}
          >
            Sign in
          </Link>
        </div>
      </div>

      <TablePreview />
    </section>
  );
}
