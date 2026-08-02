'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { useCustomColumns } from '@/hooks/use-custom-columns';
import { useStatuses } from '@/hooks/use-statuses';
import { getStatusGroup } from '@/lib/status';
import type { Task, TaskStatusGroup } from '@/types/database';
import type { ColumnKey, SortConfig, TaskFilters } from './column-config';
import {
  loadVisibleColumns,
  saveVisibleColumns,
  loadColumnOrder,
  saveColumnOrder,
  loadSortConfig,
  saveSortConfig,
  loadFilters,
  saveFilters,
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
  const [hasApiKey, setHasApiKey] = useState(true); // optimistic default

  // Check if user has API key configured
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => setHasApiKey(!!data.has_api_key))
      .catch(() => {});
  }, []);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() =>
    loadVisibleColumns()
  );
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() =>
    loadColumnOrder()
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(() =>
    loadSortConfig()
  );
  const [filters, setFiltersState] = useState<TaskFilters>(() => loadFilters());

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

  // Filters
  const setFilters = useCallback((next: TaskFilters) => {
    setFiltersState(next);
    saveFilters(next);
  }, []);

  const activeFilterCount = filters.statuses.length;

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

    if (activeTab === 'archived') {
      filtered = filtered.filter((t) => t.archived);
    } else {
      filtered = filtered.filter((t) => !t.archived);
      if (activeTab !== 'all') {
        filtered = filtered.filter(
          (t) =>
            getStatusGroup(statusesCrud.statuses, t.status) ===
            (activeTab as TaskStatusGroup)
        );
      }
    }

    // Apply filters
    if (filters.statuses.length > 0) {
      filtered = filtered.filter((t) => filters.statuses.includes(t.status));
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
          t.repo_name?.toLowerCase().includes(q) ||
          `${t.repo_owner}/${t.repo_name}#${t.issue_number}`.toLowerCase().includes(q) ||
          `#${t.issue_number}`.includes(q)
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
  }, [tasksCrud.tasks, statusesCrud.statuses, activeTab, search, sortConfig, filters]);

  // ── Bulk selection ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Selection is scoped to what's on screen. Without this, selecting rows and
  // then switching tab/filter/search would keep invisible rows selected and a
  // later bulk action would silently edit tasks the user can no longer see.
  const visibleSelectedIds = useMemo(
    () => filteredTasks.filter((t) => selectedIds.has(t.id)).map((t) => t.id),
    [filteredTasks, selectedIds]
  );

  const selectedCount = visibleSelectedIds.length;
  const allVisibleSelected =
    filteredTasks.length > 0 && selectedCount === filteredTasks.length;

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = filteredTasks.every((t) => prev.has(t.id));
      return allSelected ? new Set() : new Set(filteredTasks.map((t) => t.id));
    });
  }, [filteredTasks]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Bulk handlers ───────────────────────────────────────────────────────
  const bulkNoun = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

  const handleBulkUpdate = useCallback(
    async (updates: Partial<Task>, description: string) => {
      const ids = visibleSelectedIds;
      if (ids.length === 0) return;
      try {
        await tasksCrud.updateTasks(ids, updates);
        toast.success(`${description} for ${bulkNoun(ids.length)}`);
        clearSelection();
      } catch {
        toast.error(`Failed to update ${bulkNoun(ids.length)}`);
      }
    },
    [tasksCrud, visibleSelectedIds, clearSelection]
  );

  const handleBulkStatusChange = useCallback(
    (statusKey: string) => {
      const matched = statusesCrud.statuses.find((s) => s.key === statusKey);
      return handleBulkUpdate(
        { status: statusKey, status_group: matched?.group_name ?? 'todo' },
        `Status set to ${matched?.label ?? statusKey}`
      );
    },
    [handleBulkUpdate, statusesCrud.statuses]
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = visibleSelectedIds;
    if (ids.length === 0) return;
    try {
      await tasksCrud.deleteTasks(ids);
      toast.success(`Deleted ${bulkNoun(ids.length)}`);
      clearSelection();
    } catch {
      toast.error(`Failed to delete ${bulkNoun(ids.length)}`);
    }
  }, [tasksCrud, visibleSelectedIds, clearSelection]);

  // Handlers
  const handleSync = useCallback(async () => {
    if (!hasApiKey) {
      toast.error('Add your Claude API key in Settings to enable sync.');
      return;
    }
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
  }, [hasApiKey]);

  const handleAddTask = useCallback(
    async (issueUrl: string) => {
      try {
        await tasksCrud.addTask(issueUrl);
        toast.success('Task added');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add task');
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

  const handleArchiveTask = useCallback(
    async (id: string, archived: boolean) => {
      try {
        await tasksCrud.archiveTask(id, archived);
        toast.success(archived ? 'Task archived' : 'Task unarchived');
      } catch {
        toast.error('Failed to update');
      }
    },
    [tasksCrud]
  );

  const handleResetStaleTimer = useCallback(
    async (id: string) => {
      try {
        await tasksCrud.resetStaleTimer(id);
        toast.success('Highlight cleared — 3-day timer reset');
      } catch {
        toast.error('Failed to clear highlight');
      }
    },
    [tasksCrud]
  );

  const handleSyncTask = useCallback(
    async (id: string) => {
      if (!hasApiKey) {
        toast.error('Add your Claude API key in Settings to enable sync.');
        return;
      }
      try {
        await tasksCrud.syncTask(id);
        toast.success('Task synced');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Sync failed');
      }
    },
    [tasksCrud, hasApiKey]
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
    filters,
    setFilters,
    activeFilterCount,

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
    hasApiKey,
    handleSync,

    // Archive
    handleArchiveTask,
    handleResetStaleTimer,

    // Bulk selection + actions
    selectedCount,
    allVisibleSelected,
    isSelected,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
    handleBulkUpdate,
    handleBulkStatusChange,
    handleBulkDelete,

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
