'use client';

import { useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconSun, IconMoon } from './icons';

export function Header() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl dark:border-white/[0.04]">
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
        </div>
      </nav>
    </header>
  );
}
