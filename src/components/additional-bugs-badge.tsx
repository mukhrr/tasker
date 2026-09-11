'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function AdditionalBugsBadge({
  count = 0,
  onChange,
  children,
}: {
  count?: number;
  onChange?: (count: number) => Promise<void>;
  children: ReactNode;
}) {
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedCount = useRef<number | null>(null);
  const saveRef = useRef(onChange);
  const mounted = useRef(true);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const displayedCount = draftCount ?? count;
  const description = `Fixes this bug + ${displayedCount} additional bug${displayedCount === 1 ? '' : 's'}`;

  useEffect(() => {
    saveRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      // Preserve edits if filtering or navigation removes the row before the delay.
      const value = queuedCount.current;
      queuedCount.current = null;
      if (value !== null) void saveRef.current?.(value).catch(() => {});
    };
  }, []);

  const save = async () => {
    timer.current = null;
    const value = queuedCount.current;
    queuedCount.current = null;
    if (value === null || !saveRef.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await saveRef.current(value);
    } catch {
      // The dashboard reports the failure and restores the persisted task.
    } finally {
      pending.current = false;
      if (mounted.current) {
        setDraftCount(null);
        setSaving(false);
      }
    }
  };

  const change = (delta: number) => {
    if (!onChange || pending.current) return;
    const next = Math.max(0, (queuedCount.current ?? displayedCount) + delta);
    queuedCount.current = next;
    setDraftCount(next);
    if (timer.current !== null) clearTimeout(timer.current);
    // Returning to the saved value does not need a request.
    if (next === count) {
      queuedCount.current = null;
      timer.current = null;
      setDraftCount(null);
      return;
    }
    timer.current = setTimeout(() => void save(), 400);
  };
  return (
    <span className="group/bugs relative inline-flex mr-3">
      {children}
      <span
        className="absolute -right-2.5 -top-2.5 z-10 flex h-[18px] items-center rounded-full border-2 border-background bg-foreground text-[11px] font-semibold text-background shadow-sm"
        title={description}
      >
        {onChange && (
          <button
            type="button"
            aria-label="Decrease additional bugs fixed"
            disabled={saving || displayedCount === 0}
            onClick={(event) => {
              event.stopPropagation();
              void change(-1);
            }}
            className="w-0 overflow-hidden rounded-l-full opacity-0 transition-all group-hover/bugs:w-5 group-hover/bugs:opacity-100 group-focus-within/bugs:w-5 group-focus-within/bugs:opacity-100 [@media(hover:none)]:w-5 [@media(hover:none)]:opacity-100 hover:bg-foreground/80 disabled:text-background/40"
          >
            −
          </button>
        )}
        <span
          className="min-w-[18px] px-1 text-center tabular-nums"
          aria-label={description}
          aria-live="polite"
        >
          {displayedCount}
        </span>
        {onChange && (
          <button
            type="button"
            aria-label="Increase additional bugs fixed"
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation();
              void change(1);
            }}
            className="w-0 overflow-hidden rounded-r-full opacity-0 transition-all group-hover/bugs:w-5 group-hover/bugs:opacity-100 group-focus-within/bugs:w-5 group-focus-within/bugs:opacity-100 [@media(hover:none)]:w-5 [@media(hover:none)]:opacity-100 hover:bg-foreground/80 disabled:text-background/40"
          >
            +
          </button>
        )}
      </span>
    </span>
  );
}
