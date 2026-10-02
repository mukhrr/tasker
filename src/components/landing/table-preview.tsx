'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useReveal } from './hooks';
import { MOCK_ROWS } from './data';

const TABLE_BODY_HEIGHT = 5 * 44;
const REPEATED_ROWS = [...MOCK_ROWS, ...MOCK_ROWS];

export function TablePreview() {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(false);
  const dirRef = useRef<'down' | 'up'>('down');
  const [revealRef, revealed] = useReveal();

  useEffect(() => {
    const lock = () => {
      lockedRef.current = true;
      document.body.style.overflow = 'hidden';
    };
    const unlock = () => {
      lockedRef.current = false;
      document.body.style.overflow = '';
    };

    const onWheel = (e: WheelEvent) => {
      const body = bodyRef.current;
      const card = cardRef.current;
      if (!body || !card) return;

      const maxScroll = body.scrollHeight - body.clientHeight;

      if (lockedRef.current) {
        e.preventDefault();
        body.scrollTop += e.deltaY;

        if (dirRef.current === 'down') {
          if (body.scrollTop >= maxScroll - 1) {
            body.scrollTop = maxScroll;
            unlock();
          }
        } else {
          if (body.scrollTop <= 1) {
            body.scrollTop = 0;
            unlock();
          }
        }
        return;
      }

      const rect = card.getBoundingClientRect();
      const tableCenter = (rect.top + rect.bottom) / 2;
      const screenCenter = window.innerHeight / 2;
      const centered =
        Math.abs(tableCenter - screenCenter) < window.innerHeight * 0.25;
      if (!centered) return;

      if (e.deltaY > 0 && body.scrollTop < 1) {
        e.preventDefault();
        dirRef.current = 'down';
        lock();
        body.scrollTop += e.deltaY;
        return;
      }

      if (e.deltaY < 0 && body.scrollTop >= maxScroll - 1) {
        e.preventDefault();
        dirRef.current = 'up';
        lock();
        body.scrollTop += e.deltaY;
        return;
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel);
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      ref={(node) => {
        revealRef(node);
        cardRef.current = node;
      }}
      className={cn(
        'relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-xl border border-border/60 bg-card/50 shadow-2xl shadow-violet-500/[0.03] backdrop-blur-sm transition-all duration-700 will-change-transform dark:border-white/[0.06] dark:bg-white/[0.02]',
        revealed ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 dark:border-white/[0.04]">
        <div className="h-3 w-3 rounded-full bg-red-400/60" />
        <div className="h-3 w-3 rounded-full bg-amber-400/60" />
        <div className="h-3 w-3 rounded-full bg-emerald-400/60" />
        <span className="ml-3 text-xs text-muted-foreground/60">
          tasks — Tasker
        </span>
      </div>

      <div className="grid grid-cols-[1fr_120px_100px_80px] gap-px border-b border-border/30 bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground dark:border-white/[0.03] dark:bg-white/[0.02]">
        <span>Task</span>
        <span>Repository</span>
        <span>Status</span>
        <span className="text-right">Amount</span>
      </div>

      <div
        ref={bodyRef}
        className="overflow-hidden"
        style={{ maxHeight: TABLE_BODY_HEIGHT }}
      >
        {REPEATED_ROWS.map((row, i) => (
          <div
            key={i}
            className={cn(
              'grid grid-cols-[1fr_120px_100px_80px] gap-px px-5 py-3 text-sm',
              i < REPEATED_ROWS.length - 1 &&
                'border-b border-border/20 dark:border-white/[0.03]'
            )}
          >
            <span className="truncate font-medium">{row.title}</span>
            <span className="truncate text-muted-foreground">{row.repo}</span>
            <span>
              <span
                className={cn(
                  'inline-block rounded-md px-2 py-0.5 text-xs font-medium',
                  row.statusColor
                )}
              >
                {row.status}
              </span>
            </span>
            <span className="text-right font-mono text-muted-foreground">
              {row.amount}
            </span>
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute -bottom-px left-0 right-0 h-16 bg-gradient-to-t from-background/80 to-transparent" />
    </div>
  );
}
