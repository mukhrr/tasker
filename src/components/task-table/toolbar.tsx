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
} from 'lucide-react';
import type { ColumnKey, SortConfig } from './column-config';
import { BUILT_IN_COLUMNS } from './column-config';

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
  visibleColumns,
  onToggleColumn,
  columnOrder,
  onReorderColumns,
  lastSyncResult,
  sortConfig,
  onSortChange,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSync: () => void;
  syncing: boolean;
  visibleColumns: Set<ColumnKey>;
  onToggleColumn: (key: ColumnKey) => void;
  columnOrder: ColumnKey[];
  onReorderColumns: (order: ColumnKey[]) => void;
  lastSyncResult: { failed: boolean; error?: string } | null;
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
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

  return (
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

      {/* Right: Sync status + Sort + Columns + Sync Now */}
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
          disabled={syncing}
          className="ml-auto gap-2 sm:ml-0"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
          />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </div>
    </div>
  );
}
