'use client';

import { useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Reads and writes `?role=` without a server round trip; Next keeps
// useSearchParams in sync with history.replaceState.
export function useRoleParam<T extends string>(
  allowed: readonly T[],
  fallback: T
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const raw = searchParams.get('role');
  const role = allowed.includes(raw as T) ? (raw as T) : fallback;

  const setRole = useCallback(
    (next: T) => {
      const params = new URLSearchParams(window.location.search);
      if (next === fallback) params.delete('role');
      else params.set('role', next);
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        query ? `${pathname}?${query}` : pathname
      );
    },
    [fallback, pathname]
  );

  return [role, setRole];
}
