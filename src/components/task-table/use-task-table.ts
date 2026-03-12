'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { useCustomColumns } from '@/hooks/use-custom-columns';
import { useStatuses } from '@/hooks/use-statuses';
import { getStatusGroup } from '@/lib/status';
import type { Task, TaskStatusGroup } from '@/types/database';
import type { ColumnKey, SortConfig } from './column-config';
import {
  loadVisibleColumns,
  saveVisibleColumns,
  loadColumnOrder,
  saveColumnOrder,
  loadSortConfig,
  saveSortConfig,
} from './column-config';

export function useTaskTable(userId: string) {
  const tasksCrud = useTasks(userId);
  const customColumns = useCustomColumns(userId);
  const statusesCrud = useStatuses(userId);

  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{
    failed: boolean;
    error?: string;
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() =>
    loadVisibleColumns()
  );
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() =>
    loadColumnOrder()
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(() =>
    loadSortConfig()
  );

  // Column visibility
  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveVisibleColumns(next);
      return next;
    });
  }, []);

  const reorderColumns = useCallback((order: ColumnKey[]) => {
    setColumnOrder(order);
    saveColumnOrder(order);
  }, []);

  const isColumnVisible = useCallback(
    (key: ColumnKey) => visibleColumns.has(key),
    [visibleColumns]
  );

  // Sorting
  const handleSortChange = useCallback((config: SortConfig) => {
    setSortConfig(config);
    saveSortConfig(config);
  }, []);

  const toggleColumnSort = useCallback(
    (key: ColumnKey) => {
      if (sortConfig.key === key) {
        handleSortChange({
          key,
          direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
        });
      } else {
        handleSortChange({ key, direction: 'asc' });
      }
    },
    [sortConfig, handleSortChange]
  );

  // Filtered + sorted tasks
  const filteredTasks = useMemo(() => {
    let filtered = tasksCrud.tasks;

    if (activeTab !== 'all') {
      filtered = filtered.filter(
        (t) =>
          getStatusGroup(statusesCrud.statuses, t.status) ===
          (activeTab as TaskStatusGroup)
      );
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.issue_url.toLowerCase().includes(q) ||
          t.issue_title?.toLowerCase().includes(q) ||
          t.pr_url?.toLowerCase().includes(q) ||
          t.note?.toLowerCase().includes(q) ||
          t.repo_owner?.toLowerCase().includes(q) ||
          t.repo_name?.toLowerCase().includes(q)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      const fieldMap: Record<string, (t: Task) => string | number | null> = {
        issue: (t) => (t.issue_title || t.issue_url).toLowerCase(),
        pr: (t) => t.pr_url?.toLowerCase() ?? null,
        status: (t) => t.status,
        amount: (t) => t.amount,
        assigned: (t) => t.assigned_date,
        payment: (t) => t.payment_date,
        note: (t) => t.note?.toLowerCase() ?? null,
        created_at: (t) => t.created_at,
        updated_at: (t) => t.updated_at,
      };
      const getter = fieldMap[sortConfig.key];
      if (!getter) return 0;
      const aVal = getter(a);
      const bVal = getter(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return dir;
      if (bVal == null) return -dir;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * dir;
      }
      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });

    return sorted;
  }, [tasksCrud.tasks, statusesCrud.statuses, activeTab, search, sortConfig]);

  // Handlers
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Sync failed';
        setLastSyncResult({ failed: true, error: msg });
        throw new Error(msg);
      }
      if (data.errors?.length) {
        setLastSyncResult({
          failed: true,
          error: `${data.errors.length} tasks failed`,
        });
        toast.warning(
          `Synced ${data.tasks_updated} tasks, ${data.errors.length} failed`
        );
      } else {
        setLastSyncResult({ failed: false });
        toast.success(`Synced ${data.tasks_updated} tasks`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setLastSyncResult({ failed: true, error: msg });
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleAddTask = useCallback(
    async (issueUrl: string) => {
      try {
        await tasksCrud.addTask(issueUrl);
        toast.success('Task added');
      } catch {
        toast.error('Failed to add task');
      }
    },
    [tasksCrud]
  );

  const handleUpdateTask = useCallback(
    async (id: string, updates: Partial<Task>) => {
      try {
        await tasksCrud.updateTask(id, updates);
      } catch {
        toast.error('Failed to update');
      }
    },
    [tasksCrud]
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      try {
        await tasksCrud.deleteTask(id);
        toast.success('Task deleted');
      } catch {
        toast.error('Failed to delete');
      }
    },
    [tasksCrud]
  );

  const handleSyncTask = useCallback(
    async (id: string) => {
      try {
        await tasksCrud.syncTask(id);
        toast.success('Task synced');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Sync failed');
      }
    },
    [tasksCrud]
  );

  return {
    // Data
    tasks: tasksCrud.tasks,
    filteredTasks,
    loading: tasksCrud.loading,
    syncingTaskIds: tasksCrud.syncingTaskIds,
    statuses: statusesCrud.statuses,
    columns: customColumns.columns,
    getFieldValue: customColumns.getFieldValue,

    // Filters
    activeTab,
    setActiveTab,
    search,
    setSearch,

    // Column config
    visibleColumns,
    columnOrder,
    sortConfig,
    toggleColumn,
    reorderColumns,
    isColumnVisible,
    handleSortChange,
    toggleColumnSort,

    // Sync
    syncing,
    lastSyncResult,
    handleSync,

    // CRUD
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleSyncTask,
    deleteConfirmId,
    setDeleteConfirmId,

    // Status CRUD (passed through for StatusCell)
    addStatus: statusesCrud.addStatus,
    updateStatus: statusesCrud.updateStatus,
    deleteStatus: statusesCrud.deleteStatus,

    // Custom column CRUD
    addColumn: customColumns.addColumn,
    updateColumn: customColumns.updateColumn,
    deleteColumn: customColumns.deleteColumn,
    setFieldValue: customColumns.setFieldValue,
  };
}

export type TaskTableContext = ReturnType<typeof useTaskTable>;
