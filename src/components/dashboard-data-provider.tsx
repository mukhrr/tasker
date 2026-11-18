'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useTasks } from '@/hooks/use-tasks';
import { useStatuses } from '@/hooks/use-statuses';
import { useCustomColumns } from '@/hooks/use-custom-columns';
import type { Task } from '@/types/database';

interface DashboardData {
  userId: string;
  tasks: ReturnType<typeof useTasks<Task>>;
  statuses: ReturnType<typeof useStatuses>;
  customColumns: ReturnType<typeof useCustomColumns>;
  // Last values a page fetched for itself (sync status, settings). Only a
  // first paint for the next mount; each page still reloads its own.
  snapshots: MutableRefObject<Record<string, unknown>>;
}

const DashboardDataContext = createContext<DashboardData | null>(null);

// Lives in the (dashboard) layout, which stays mounted across page switches,
// so a page renders from memory instead of refetching everything.
export function DashboardDataProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const tasks = useTasks<Task>(userId);
  const statuses = useStatuses(userId);
  const customColumns = useCustomColumns(userId);
  const snapshots = useRef<Record<string, unknown>>({});
  const pathname = usePathname();

  const refetch = useRef(() => {});
  useEffect(() => {
    refetch.current = () => {
      void tasks.refetch();
      void statuses.refetch();
      void customColumns.refetch();
    };
  });

  // Realtime only covers tasks, and misses events while a tab sleeps, so
  // refresh quietly on every page switch and when the tab comes back.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    refetch.current();
  }, [pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return (
    <DashboardDataContext.Provider
      value={{ userId, tasks, statuses, customColumns, snapshots }}
    >
      {children}
    </DashboardDataContext.Provider>
  );
}

export function useDashboardData(): DashboardData {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData needs DashboardDataProvider above it');
  }
  return ctx;
}
