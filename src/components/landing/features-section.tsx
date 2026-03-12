'use client';

import { cn } from '@/lib/utils';
import { useReveal } from './hooks';
import { IconBrain, IconGithub, IconTable, IconZap } from './icons';

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
      "The agent understands pull requests, reviews, and timeline events. It follows the full lifecycle of your contributions so you don't have to.",
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

export function FeaturesSection() {
  const [ref, visible] = useReveal();
  return (
    <section className="px-5 py-20" aria-labelledby="features-heading">
      <div ref={ref} className="mx-auto max-w-5xl">
        <div
          className={cn(
            'text-center transition-all duration-700',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          )}
        >
          <h2
            id="features-heading"
            className="text-3xl font-bold tracking-tight sm:text-4xl"
          >
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
                  visible
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-6 opacity-0'
                )}
                style={{
                  transitionDelay: visible ? `${200 + i * 100}ms` : '0ms',
                }}
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
