'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  RefreshCw,
  Columns3,
  Eye,
  EyeOff,
  GripVertical,
  ArrowUpDown,
  Check,
  Filter,
  X,
} from 'lucide-react';
import type { ColumnKey, SortConfig, TaskFilters } from './column-config';
import { BUILT_IN_COLUMNS } from './column-config';
import type { UserStatus } from '@/types/database';
import { getStatusColor, getStatusesByGroup, STATUS_GROUP_LABELS } from '@/lib/status';

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SyncStatus {
  time: string;
  failed: boolean;
  error?: string;
}

export function Toolbar({
  activeTab,
  onTabChange,
  search,
  onSearchChange,
  onSync,
  syncing,
  hasApiKey,
  visibleColumns,
  onToggleColumn,
  columnOrder,
  onReorderColumns,
  lastSyncResult,
  sortConfig,
  onSortChange,
  filters,
  onFiltersChange,
  activeFilterCount,
  statuses,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSync: () => void;
  syncing: boolean;
  hasApiKey: boolean;
  visibleColumns: Set<ColumnKey>;
  onToggleColumn: (key: ColumnKey) => void;
  columnOrder: ColumnKey[];
  onReorderColumns: (order: ColumnKey[]) => void;
  lastSyncResult: { failed: boolean; error?: string } | null;
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  activeFilterCount: number;
  statuses: UserStatus[];
}) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Fetch initial sync status on mount
  useEffect(() => {
    fetch('/api/sync/status')
      .then((res) => res.json())
      .then((data) => {
        if (!data) return;
        const time = data.completed_at || data.started_at;
        if (time) {
          setSyncStatus({
            time,
            failed: data.status === 'failed',
            error: data.error_message,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Derive display status: parent result overrides fetched status
  const displayStatus = useMemo<SyncStatus | null>(() => {
    if (!lastSyncResult) return syncStatus;
    if (lastSyncResult.failed) {
      return {
        time: syncStatus?.time ?? new Date().toISOString(),
        failed: true,
        error: lastSyncResult.error,
      };
    }
    return { time: new Date().toISOString(), failed: false };
  }, [lastSyncResult, syncStatus]);

  const tabs: { value: string; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'todo', label: 'To-do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
  ];

  // Draggable columns list (exclude locked 'issue' from reordering)
  const reorderableColumns = columnOrder
    .map((key) => BUILT_IN_COLUMNS.find((c) => c.key === key)!)
    .filter((c) => c && !c.locked);

  const handleDragStart = (idx: number) => {
    dragItem.current = idx;
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    dragOverItem.current = idx;
  };

  const handleDrop = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) {
      setDragIdx(null);
      return;
    }

    const reordered = [...reorderableColumns];
    const [moved] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, moved);

    // Rebuild full order: locked columns first, then reordered
    const locked = columnOrder.filter(
      (k) => BUILT_IN_COLUMNS.find((c) => c.key === k)?.locked
    );
    onReorderColumns([...locked, ...reordered.map((c) => c.key)]);

    dragItem.current = null;
    dragOverItem.current = null;
    setDragIdx(null);
  };

  const removeStatusFilter = (key: string) => {
    onFiltersChange({
      ...filters,
      statuses: filters.statuses.filter((k) => k !== key),
    });
  };

  return (
    <div className="space-y-2">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {/* Left: Tabs + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 w-full text-sm sm:w-[200px]"
        />
      </div>

      {/* Right: Sync status + Filter + Sort + Columns + Sync Now */}
      <div className="flex items-center gap-2">
        {displayStatus && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Synced {timeAgo(displayStatus.time)}
          </span>
        )}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Filter</span>
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            }
          />
          <PopoverContent align="end" className="w-64 p-3">
            <div className="flex items-center justify-between pb-2">
              <p className="text-xs font-medium text-muted-foreground">
                Filter tasks
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => onFiltersChange({ statuses: [] })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="border-t pt-2">
              <p className="pb-1.5 text-xs font-medium">Status</p>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {Object.entries(getStatusesByGroup(statuses)).map(
                  ([group, groupStatuses]) =>
                    groupStatuses.length > 0 && (
                      <div key={group}>
                        <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {STATUS_GROUP_LABELS[group as keyof typeof STATUS_GROUP_LABELS]}
                        </p>
                        {groupStatuses.map((s) => {
                          const active = filters.statuses.includes(s.key);
                          const color = getStatusColor(s.color);
                          return (
                            <button
                              key={s.key}
                              onClick={() => {
                                const next = active
                                  ? filters.statuses.filter((k) => k !== s.key)
                                  : [...filters.statuses, s.key];
                                onFiltersChange({ ...filters, statuses: next });
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
                            >
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`}
                              />
                              <span className="flex-1 truncate text-left">
                                {s.label}
                              </span>
                              {active && (
                                <Check className="h-3.5 w-3.5 text-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )
                )}
              </div>
            </div>

          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sort</span>
              </Button>
            }
          />
          <PopoverContent align="end" className="w-48 p-2">
            <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
              Sort by
            </p>
            {(
              [
                { key: 'created_at', label: 'Date created' },
                { key: 'updated_at', label: 'Last updated' },
                ...BUILT_IN_COLUMNS.map((c) => ({
                  key: c.key,
                  label: c.label,
                })),
              ] as { key: SortConfig['key']; label: string }[]
            ).map((item) => {
              const isActive = sortConfig.key === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() =>
                    onSortChange({
                      key: item.key,
                      direction: isActive
                        ? sortConfig.direction === 'asc'
                          ? 'desc'
                          : 'asc'
                        : 'asc',
                    })
                  }
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <span className={isActive ? 'font-medium' : ''}>
                    {item.label}
                  </span>
                  {isActive && (
                    <span className="text-xs text-muted-foreground">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="gap-2">
                <Columns3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            }
          />
          <PopoverContent align="end" className="w-52 p-2">
            <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
              Toggle & reorder columns
            </p>
            {reorderableColumns.map((col, idx) => (
              <div
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDrop}
                className={`flex items-center gap-1.5 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted ${
                  dragIdx === idx ? 'opacity-50' : ''
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
                <button
                  onClick={() => onToggleColumn(col.key)}
                  className="flex flex-1 items-center gap-2"
                >
                  {visibleColumns.has(col.key) ? (
                    <Eye className="h-3.5 w-3.5 text-foreground" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span
                    className={
                      visibleColumns.has(col.key) ? '' : 'text-muted-foreground'
                    }
                  >
                    {col.label}
                  </span>
                </button>
              </div>
            ))}
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={syncing || !hasApiKey}
          title={!hasApiKey ? 'Add your Claude API key in Settings first' : undefined}
          className="ml-auto gap-2 sm:ml-0"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
          />
          {syncing ? 'Syncing...' : !hasApiKey ? 'API Key Required' : 'Sync Now'}
        </Button>
      </div>
    </div>
    {activeFilterCount > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Filtered by:</span>
        {filters.statuses.map((key) => {
          const s = statuses.find((st) => st.key === key);
          if (!s) return null;
          const color = getStatusColor(s.color);
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${color.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
              {s.label}
              <button
                onClick={() => removeStatusFilter(key)}
                className="ml-0.5 hover:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
    )}
    </div>
  );
}
