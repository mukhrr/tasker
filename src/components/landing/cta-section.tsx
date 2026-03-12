'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useReveal } from './hooks';
import { IconArrowRight } from './icons';

export function CtaSection() {
  const [ref, visible] = useReveal();
  return (
    <section className="px-5 py-24" aria-labelledby="cta-heading">
      <div
        ref={ref}
        className={cn(
          'relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.06] to-blue-500/[0.04] p-10 text-center backdrop-blur-sm transition-all duration-700 sm:p-14 dark:border-violet-400/10',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        )}
      >
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-violet-500/10 blur-[80px]"
          aria-hidden="true"
        />

        <h2
          id="cta-heading"
          className="relative text-2xl font-bold tracking-tight sm:text-3xl"
        >
          Let your AI agent take over
        </h2>
        <p className="relative mx-auto mt-4 max-w-md text-base text-muted-foreground">
          Stop manually tracking tasks. Your assistant monitors GitHub, updates
          statuses, and keeps everything in sync — automatically.
        </p>
        <div className="relative mt-8">
          <Link
            href="/auth/signup"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'gap-2 bg-violet-600 px-6 text-white hover:bg-violet-700 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500'
            )}
          >
            Get started — it&apos;s free
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
