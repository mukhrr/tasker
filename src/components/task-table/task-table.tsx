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
import { getStatusColor, getStatusTotals } from '@/lib/status';
import { cn } from '@/lib/utils';
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

export function TaskTable() {
  const ctx = useTaskTable();

  if (ctx.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const visibleColumnKeys = ctx.columnOrder.filter(ctx.isColumnVisible);
  // The computed Whose turn column sits after Status, or after Issue when
  // Status is hidden.
  const turnAfter: ColumnKey = visibleColumnKeys.includes('status')
    ? 'status'
    : 'issue';
  const turnHeader = (
    <th key="turn" className="px-3 py-2.5 text-left sm:px-4">
      <ColumnHeader
        name="Whose turn"
        sortDirection={
          ctx.sortConfig.key === 'turn' ? ctx.sortConfig.direction : null
        }
        onSort={() => ctx.toggleColumnSort('turn')}
      />
    </th>
  );
  const totalAmount = ctx.filteredTasks.reduce(
    (sum, task) => sum + (task.amount ?? 0),
    0
  );
  const statusTotals = getStatusTotals(ctx.filteredTasks, ctx.statuses);
  const isReviewerTab = ctx.role === 'reviewer';

  return (
    <div className="space-y-4">
      <Toolbar
        role={ctx.role}
        onRoleChange={ctx.setRole}
        roleCounts={ctx.roleCounts}
        yourTurnOnly={ctx.yourTurnOnly}
        onYourTurnOnlyChange={ctx.setYourTurnOnly}
        activeTab={ctx.activeTab}
        onTabChange={ctx.setActiveTab}
        search={ctx.search}
        onSearchChange={ctx.setSearch}
        onSync={ctx.handleSync}
        syncing={ctx.syncing}
        syncReady={ctx.syncReady}
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
        role={ctx.role}
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
                {visibleColumnKeys.flatMap((key) => {
                  const header = (
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
                  );
                  return isReviewerTab && key === turnAfter
                    ? [header, turnHeader]
                    : [header];
                })}
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
                <th className="sticky right-0 z-20 w-10 bg-muted px-2 py-2.5 text-left backdrop-blur-sm lg:w-[216px] lg:text-right">
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
                    colSpan={visibleColumnKeys.length + (isReviewerTab ? 3 : 2)}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {ctx.roleTasks.length === 0
                      ? isReviewerTab
                        ? 'No reviews yet. Add one below or move a task here from its row menu.'
                        : 'No tasks yet. Add your first task below.'
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
                    showTurn={isReviewerTab}
                    ctx={ctx}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <AddRow onAdd={ctx.handleAddTask} />
      </div>

      {ctx.roleTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <p>
            {ctx.filteredTasks.length} of {ctx.roleTasks.length} tasks
          </p>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 tabular-nums">
            {statusTotals.map((total) => (
              <span key={total.key} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    getStatusColor(total.color).dot
                  )}
                />
                {total.label}{' '}
                <span className="font-medium text-foreground">
                  {currencyFormatter.format(total.amount)}
                </span>
              </span>
            ))}
            {isReviewerTab ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-400" />
                C+ total{' '}
                <span className="font-medium text-foreground">
                  {currencyFormatter.format(totalAmount)}
                </span>
              </span>
            ) : (
              <span className="shrink-0">
                Total{' '}
                <span className="font-medium text-foreground">
                  {currencyFormatter.format(totalAmount)}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
