'use client';

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Tiny icons                                                         */
/* ------------------------------------------------------------------ */

function IconBrain(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2a5 5 0 0 1 4.546 2.914A4 4 0 0 1 18 11a4.002 4.002 0 0 1-1.382 3.025A3.5 3.5 0 0 1 13 18v4M12 2a5 5 0 0 0-4.546 2.914A4 4 0 0 0 6 11a4.002 4.002 0 0 0 1.382 3.025A3.5 3.5 0 0 0 11 18v4" />
      <path d="M12 8v2M12 14v.01" />
    </svg>
  );
}

function IconGithub(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

function IconTable(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function IconZap(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconArrowRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function IconSun(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                                */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: IconBrain,
    title: 'Autonomous AI Agent',
    description:
      'Your assistant reads every issue, PR, and comment — then updates task statuses automatically with confidence scoring. No manual work.',
  },
  {
    icon: IconGithub,
    title: 'Deep GitHub Awareness',
    description:
      'The agent understands pull requests, reviews, and timeline events. It follows the full lifecycle of your contributions so you don\'t have to.',
  },
  {
    icon: IconTable,
    title: 'Notion-Style Dashboard',
    description:
      'A live workspace where your agent keeps everything current. Click any cell to edit status, amounts, dates, and URLs inline.',
  },
  {
    icon: IconZap,
    title: 'Smart Status System',
    description:
      'From backlog to paid — 12 precise statuses your agent uses to classify tasks. You always know where every bounty stands.',
  },
];


/* ------------------------------------------------------------------ */
/*  JSON-LD structured data for SEO + AI search engines                */
/* ------------------------------------------------------------------ */

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Tasker',
  image: '/home_hero.jpg',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  description:
    'Tasker is an AI-powered assistant that syncs with GitHub to automatically track bounties, update task statuses, and manage payments across open source repositories.',
  featureList: [
    'AI-powered automatic task status updates',
    'GitHub issue and pull request tracking',
    'Bounty and payment management',
    'Notion-style inline-editable task table',
    '12-status taxonomy for precise task classification',
    'Real-time sync with GitHub activity',
  ],
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

/* ------------------------------------------------------------------ */
/*  Parallax scroll hook                                               */
/* ------------------------------------------------------------------ */

function useParallax() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const transform = useCallback(
    (speed: number) => `translateY(${scrollY * speed}px)`,
    [scrollY],
  );

  return { scrollY, transform };
}

/* ------------------------------------------------------------------ */
/*  Scroll-triggered reveal via callback ref (lint-safe)               */
/* ------------------------------------------------------------------ */

function useReveal() {
  const [visible, setVisible] = useState(false);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
  }, []);

  return [ref, visible] as const;
}

/* ------------------------------------------------------------------ */
/*  Animated background with parallax orbs                             */
/* ------------------------------------------------------------------ */

function Background({ transform }: { transform: (speed: number) => string }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(139,92,246,0.9) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        className="absolute -top-[40%] left-[20%] h-[80vh] w-[80vh] rounded-full opacity-[0.06] blur-[120px] will-change-transform dark:opacity-[0.10]"
        style={{
          background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
          transform: transform(-0.15),
        }}
      />
      <div
        className="absolute -bottom-[20%] right-[10%] h-[60vh] w-[60vh] rounded-full opacity-[0.04] blur-[100px] will-change-transform dark:opacity-[0.08]"
        style={{
          background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          transform: transform(-0.08),
        }}
      />
      <div
        className="absolute top-[50%] -left-[10%] h-[50vh] w-[50vh] rounded-full opacity-[0.03] blur-[90px] will-change-transform dark:opacity-[0.06]"
        style={{
          background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)',
          transform: transform(-0.12),
        }}
      />
      <div
        className="absolute top-[20%] right-[30%] h-[40vh] w-[40vh] rounded-full opacity-[0.03] blur-[100px] will-change-transform dark:opacity-[0.05]"
        style={{
          background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)',
          transform: transform(-0.2),
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Floating SVG lines with parallax                                   */
/* ------------------------------------------------------------------ */

function FloatingLines({ transform }: { transform: (speed: number) => string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.03] will-change-transform dark:opacity-[0.05]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ transform: transform(-0.05) }}
    >
      <defs>
        <linearGradient id="landing-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <line x1="0" y1="18%" x2="100%" y2="22%" stroke="url(#landing-line-grad)" strokeWidth="1" className="animate-[drift_14s_ease-in-out_infinite]" />
      <line x1="0" y1="45%" x2="100%" y2="42%" stroke="url(#landing-line-grad)" strokeWidth="1" className="animate-[drift_18s_ease-in-out_infinite_reverse]" />
      <line x1="0" y1="72%" x2="100%" y2="75%" stroke="url(#landing-line-grad)" strokeWidth="1" className="animate-[drift_22s_ease-in-out_infinite]" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock table preview                                                 */
/* ------------------------------------------------------------------ */

const MOCK_ROWS = [
  { title: 'Fix auth redirect loop', repo: 'acme/web', status: 'In Review', statusColor: 'bg-amber-500/20 text-amber-600 dark:text-amber-400', amount: '$250' },
  { title: 'Add dark mode support', repo: 'acme/ui', status: 'Merged', statusColor: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400', amount: '$500' },
  { title: 'Refactor API client', repo: 'acme/sdk', status: 'In Progress', statusColor: 'bg-violet-500/20 text-violet-600 dark:text-violet-400', amount: '$750' },
  { title: 'Update documentation', repo: 'acme/docs', status: 'Paid', statusColor: 'bg-sky-500/20 text-sky-600 dark:text-sky-400', amount: '$150' },
  { title: 'Optimize bundle size', repo: 'acme/web', status: 'Todo', statusColor: 'bg-zinc-500/20 text-zinc-500', amount: '$400' },
];

function TablePreview({ scrollY }: { scrollY: number }) {
  const [ref, visible] = useReveal();
  return (
    <div
      ref={ref}
      className={cn(
        'relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-xl border border-border/60 bg-card/50 shadow-2xl shadow-violet-500/[0.03] backdrop-blur-sm transition-all duration-700 will-change-transform dark:border-white/[0.06] dark:bg-white/[0.02]',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
      )}
      style={{ transform: visible ? `translateY(${Math.max(0, (scrollY - 200) * -0.04)}px)` : undefined }}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 dark:border-white/[0.04]">
        <div className="h-3 w-3 rounded-full bg-red-400/60" />
        <div className="h-3 w-3 rounded-full bg-amber-400/60" />
        <div className="h-3 w-3 rounded-full bg-emerald-400/60" />
        <span className="ml-3 text-xs text-muted-foreground/60">tasks — Tasker</span>
      </div>
      <div className="grid grid-cols-[1fr_120px_100px_80px] gap-px border-b border-border/30 bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground dark:border-white/[0.03] dark:bg-white/[0.02]">
        <span>Task</span>
        <span>Repository</span>
        <span>Status</span>
        <span className="text-right">Amount</span>
      </div>
      {MOCK_ROWS.map((row, i) => (
        <div
          key={i}
          className={cn(
            'grid grid-cols-[1fr_120px_100px_80px] gap-px px-5 py-3 text-sm transition-all duration-500',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
            i < MOCK_ROWS.length - 1 && 'border-b border-border/20 dark:border-white/[0.03]',
          )}
          style={{ transitionDelay: visible ? `${200 + i * 80}ms` : '0ms' }}
        >
          <span className="truncate font-medium">{row.title}</span>
          <span className="truncate text-muted-foreground">{row.repo}</span>
          <span>
            <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-medium', row.statusColor)}>
              {row.status}
            </span>
          </span>
          <span className="text-right font-mono text-muted-foreground">{row.amount}</span>
        </div>
      ))}
      <div className="pointer-events-none absolute -bottom-px left-0 right-0 h-24 bg-gradient-to-t from-background/80 to-transparent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Self-contained section components (refs stay internal)             */
/* ------------------------------------------------------------------ */


function FeaturesSection() {
  const [ref, visible] = useReveal();
  return (
    <section className="px-5 py-20" aria-labelledby="features-heading">
      <div ref={ref} className="mx-auto max-w-5xl">
        <div
          className={cn(
            'text-center transition-all duration-700',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
          )}
        >
          <h2 id="features-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
            Your agent handles the busywork
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            While you ship code, your AI assistant tracks every issue, PR, and
            payment across all your repositories.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <article
                key={i}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm transition-all duration-500 hover:border-violet-500/20 hover:shadow-lg hover:shadow-violet-500/[0.03] dark:border-white/[0.05] dark:bg-white/[0.02] dark:hover:border-violet-400/15',
                  visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
                )}
                style={{ transitionDelay: visible ? `${200 + i * 100}ms` : '0ms' }}
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:bg-violet-400/10 dark:text-violet-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
                <div className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-violet-500/[0.04] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 dark:bg-violet-400/[0.06]" />
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const [ref, visible] = useReveal();
  return (
    <section className="px-5 py-24" aria-labelledby="cta-heading">
      <div
        ref={ref}
        className={cn(
          'relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.06] to-blue-500/[0.04] p-10 text-center backdrop-blur-sm transition-all duration-700 sm:p-14 dark:border-violet-400/10',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        )}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-violet-500/10 blur-[80px]" aria-hidden="true" />

        <h2 id="cta-heading" className="relative text-2xl font-bold tracking-tight sm:text-3xl">
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
              'gap-2 bg-violet-600 px-6 text-white hover:bg-violet-700 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500',
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

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { theme, setTheme } = useTheme();
  const { scrollY, transform } = useParallax();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <Background transform={transform} />
      <FloatingLines transform={transform} />

      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl dark:border-white/[0.04]">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Tasker" width={28} height={28} className="rounded-lg" />
            <span className="text-base font-bold tracking-tight">Tasker</span>
          </Link>
          <div className="flex items-center gap-2">
            {mounted && (
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
              </button>
            )}
            <Link
              href="/auth/login"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'text-muted-foreground',
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

      <main>
        <section className="relative px-5 pt-24 pb-8 sm:pt-32" aria-labelledby="hero-heading">
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
              that manages your{' '}
              <br className="hidden sm:block" />
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
              automatically updates task statuses, and keeps your bounties and payments
              organized — so you can focus on writing code.
            </p>

            <div
              className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ animation: 'fadeIn 0.6s ease-out 0.3s both' }}
            >
              <Link
                href="/auth/signup"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'gap-2 bg-violet-600 px-5 text-white hover:bg-violet-700 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500',
                )}
              >
                Start for free
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/auth/login"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'px-5',
                )}
              >
                Sign in
              </Link>
            </div>
          </div>

          <TablePreview scrollY={scrollY} />
        </section>

        <FeaturesSection />
        <CtaSection />
      </main>

      <footer className="border-t border-border/40 dark:border-white/[0.04]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Tasker" width={20} height={20} className="rounded" />
            <span className="text-sm font-medium text-muted-foreground">
              Tasker
            </span>
          </div>
          <p className="text-xs text-muted-foreground/60">
            Open source task tracking, powered by GitHub & AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
