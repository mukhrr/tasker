'use client';

import { Toolbar } from './toolbar';
import { AddRow } from './add-row';
import { BulkActionsBar } from './bulk-actions-bar';
import { Checkbox } from '@/components/ui/checkbox';
// import { AddColumnButton } from './add-column-button';
import { ColumnHeader } from './column-header';
import { TaskRow } from './task-row';
import { Skeleton } from '@/components/ui/skeleton';
import { useTaskTable } from './use-task-table';
import type { ColumnKey } from './column-config';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  issue: 'Issue',
  pr: 'PR',
  status: 'Status',
  amount: 'Amount',
  assigned: 'Assigned',
  payment: 'Payment',
  note: 'Note',
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function TaskTable({ userId }: { userId: string }) {
  const ctx = useTaskTable(userId);

  if (ctx.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const visibleColumnKeys = ctx.columnOrder.filter(ctx.isColumnVisible);
  const totalAmount = ctx.filteredTasks.reduce(
    (sum, task) => sum + (task.amount ?? 0),
    0
  );

  return (
    <div className="space-y-4">
      <Toolbar
        activeTab={ctx.activeTab}
        onTabChange={ctx.setActiveTab}
        search={ctx.search}
        onSearchChange={ctx.setSearch}
        onSync={ctx.handleSync}
        syncing={ctx.syncing}
        hasApiKey={ctx.hasApiKey}
        visibleColumns={ctx.visibleColumns}
        onToggleColumn={ctx.toggleColumn}
        columnOrder={ctx.columnOrder}
        onReorderColumns={ctx.reorderColumns}
        lastSyncResult={ctx.lastSyncResult}
        sortConfig={ctx.sortConfig}
        onSortChange={ctx.handleSortChange}
        filters={ctx.filters}
        onFiltersChange={ctx.setFilters}
        activeFilterCount={ctx.activeFilterCount}
        statuses={ctx.statuses}
      />

      <BulkActionsBar
        selectedCount={ctx.selectedCount}
        statuses={ctx.statuses}
        isArchivedView={ctx.activeTab === 'archived'}
        onStatusChange={ctx.handleBulkStatusChange}
        onUpdate={ctx.handleBulkUpdate}
        onDelete={ctx.handleBulkDelete}
        onClear={ctx.clearSelection}
      />

      <div className="rounded-lg border">
        <div className="scrollbar-thin -mx-px max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full min-w-[700px] text-[0.9rem]">
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
              <tr className="border-b">
                <th className="w-10 px-3 py-2.5 sm:px-4">
                  <Checkbox
                    checked={ctx.allVisibleSelected}
                    indeterminate={
                      ctx.selectedCount > 0 && !ctx.allVisibleSelected
                    }
                    onCheckedChange={ctx.toggleSelectAll}
                    disabled={ctx.filteredTasks.length === 0}
                    aria-label="Select all rows"
                  />
                </th>
                {visibleColumnKeys.map((key) => (
                  <th key={key} className="px-3 py-2.5 text-left sm:px-4">
                    <ColumnHeader
                      name={COLUMN_LABELS[key]}
                      sortDirection={
                        ctx.sortConfig.key === key
                          ? ctx.sortConfig.direction
                          : null
                      }
                      onSort={() => ctx.toggleColumnSort(key)}
                    />
                  </th>
                ))}
                {/* {ctx.columns.map((col) => (
                  <th key={col.id} className="px-3 py-2.5 text-left sm:px-4">
                    <ColumnHeader
                      name={col.name}
                      isCustom
                      onRename={(name) => ctx.updateColumn(col.id, { name })}
                      onDelete={() => ctx.deleteColumn(col.id)}
                    />
                  </th>
                ))}
                <th className="w-10 px-2 py-2.5">
                  <AddColumnButton onAdd={ctx.addColumn} />
                </th> */}
                <th className="sticky right-0 z-20 w-10 bg-muted px-2 py-2.5 text-left backdrop-blur-sm lg:w-[184px] lg:text-right">
                  <span className="text-sm font-medium text-muted-foreground">
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ctx.filteredTasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumnKeys.length + 2}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {ctx.tasks.length === 0
                      ? 'No tasks yet. Add your first task below.'
                      : 'No tasks match your filters.'}
                  </td>
                </tr>
              ) : (
                ctx.filteredTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isSyncing={ctx.syncingTaskIds.has(task.id)}
                    search={ctx.search}
                    visibleColumnKeys={visibleColumnKeys}
                    ctx={ctx}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <AddRow onAdd={ctx.handleAddTask} />
      </div>

      {ctx.tasks.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>
            {ctx.filteredTasks.length} of {ctx.tasks.length} tasks
          </p>
          <p className="shrink-0 tabular-nums">
            Total amount{' '}
            <span className="font-medium text-foreground">
              {currencyFormatter.format(totalAmount)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
