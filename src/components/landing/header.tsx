'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { IconSun, IconMoon, IconGithub } from './icons';

function useStarCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('https://api.github.com/repos/mukhrr/tasker')
      .then(r => r.json())
      .then(d => { if (typeof d.stargazers_count === 'number') setCount(d.stargazers_count); })
      .catch(() => {});
  }, []);
  return count;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function Header() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const { theme, setTheme } = useTheme();
  const starCount = useStarCount();
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsSignedIn(!!session);
    });
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl dark:border-white/4">
      <nav
        className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5"
        aria-label="Main navigation"
      >
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Tasker"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="text-base font-bold tracking-tight">Tasker</span>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/mukhrr/tasker"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center overflow-hidden rounded-lg border border-border/60 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1">
              <IconGithub className="h-4 w-4" />
              <span>Star</span>
            </span>
            {starCount !== null && (
              <span className="border-l border-border/60 bg-muted/50 px-2 py-1 tabular-nums">
                {formatCount(starCount)}
              </span>
            )}
          </a>
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <IconSun className="h-4 w-4" />
              ) : (
                <IconMoon className="h-4 w-4" />
              )}
            </button>
          )}
          {isSignedIn ? (
            <Link
              href="/tasks"
              className={buttonVariants({ size: 'sm' })}
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'text-muted-foreground'
                )}
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className={buttonVariants({ size: 'sm' })}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
