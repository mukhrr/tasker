'use client';

import { shortenGitHubUrl, normalizeUrl } from '@/lib/github';
import { UrlCell } from './cells/url-cell';
import { StatusCell } from './cells/status-cell';
import { DateCell } from './cells/date-cell';
import { AmountCell } from './cells/amount-cell';
import { TextCell } from './cells/text-cell';
import { NoteCell } from './cells/note-cell';
import { HighlightText } from './highlight-text';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink } from 'lucide-react';
import { TaskRowActions } from './task-row-actions';
import type { Task } from '@/types/database';
import type { ColumnKey } from './column-config';
import type { TaskTableContext } from './use-task-table';

interface TaskRowProps {
  task: Task;
  isSyncing: boolean;
  search: string;
  visibleColumnKeys: ColumnKey[];
  ctx: Pick<
    TaskTableContext,
    | 'statuses'
    | 'columns'
    | 'getFieldValue'
    | 'setFieldValue'
    | 'handleUpdateTask'
    | 'handleDeleteTask'
    | 'handleSyncTask'
    | 'deleteConfirmId'
    | 'setDeleteConfirmId'
    | 'addStatus'
    | 'updateStatus'
    | 'deleteStatus'
  >;
}

export function TaskRow({ task, isSyncing, search, visibleColumnKeys, ctx }: TaskRowProps) {
  const isConfirmingDelete = ctx.deleteConfirmId === task.id;

  return (
    <tr className="group/row border-b last:border-b-0 hover:bg-muted/30">
      {/* Issue column (always first) */}
      <td className="max-w-[280px] px-3 py-2 sm:px-4">
        {isSyncing && !task.issue_title ? (
          <Skeleton className="h-4 w-36" />
        ) : (
          <a
            href={normalizeUrl(task.issue_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="group/issue block"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="line-clamp-1 text-sm font-medium text-foreground group-hover/issue:underline">
              <HighlightText
                text={task.issue_title || shortenGitHubUrl(task.issue_url)}
                query={search}
              />
              <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-0 transition-opacity group-hover/issue:opacity-100" />
            </span>
            {task.issue_title && (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                <HighlightText
                  text={shortenGitHubUrl(task.issue_url)}
                  query={search}
                />
              </span>
            )}
          </a>
        )}
      </td>

      {/* Dynamic built-in columns */}
      {visibleColumnKeys
        .filter((k) => k !== 'issue')
        .map((key) => (
          <td
            key={key}
            className={getCellClassName(key)}
          >
            <CellContent
              columnKey={key}
              task={task}
              isSyncing={isSyncing}
              search={search}
              ctx={ctx}
            />
          </td>
        ))}

      {/* Custom columns (disabled for now)
      {ctx.columns.map((col) => (
        <td key={col.id} className="px-3 py-2 sm:px-4">
          <TextCell
            value={ctx.getFieldValue(task.id, col.id)}
            onChange={(value) => ctx.setFieldValue(task.id, col.id, value)}
            highlight={search}
          />
        </td>
      ))} */}

      {/* Actions */}
      <td className="px-2 py-2">
        <TaskRowActions
          taskId={task.id}
          isSyncing={isSyncing}
          isConfirmingDelete={isConfirmingDelete}
          onSync={() => ctx.handleSyncTask(task.id)}
          onDelete={() => {
            ctx.handleDeleteTask(task.id);
            ctx.setDeleteConfirmId(null);
          }}
          onRequestDelete={() => ctx.setDeleteConfirmId(task.id)}
          onCancelDelete={() => ctx.setDeleteConfirmId(null)}
        />
      </td>
    </tr>
  );
}

function getCellClassName(key: ColumnKey): string {
  switch (key) {
    case 'amount':
    case 'assigned':
    case 'payment':
      return 'whitespace-nowrap px-3 py-2 sm:px-4';
    case 'note':
      return 'min-w-[250px] max-w-[350px] px-3 py-2 sm:px-4';
    default:
      return 'px-3 py-2 sm:px-4';
  }
}

function CellContent({
  columnKey,
  task,
  isSyncing,
  search,
  ctx,
}: {
  columnKey: ColumnKey;
  task: Task;
  isSyncing: boolean;
  search: string;
  ctx: Pick<
    TaskTableContext,
    | 'statuses'
    | 'handleUpdateTask'
    | 'addStatus'
    | 'updateStatus'
    | 'deleteStatus'
  >;
}) {
  switch (columnKey) {
    case 'pr':
      return isSyncing && !task.pr_url ? (
        <Skeleton className="h-4 w-28" />
      ) : (
        <UrlCell
          value={task.pr_url}
          onChange={(v) => ctx.handleUpdateTask(task.id, { pr_url: v })}
          highlight={search}
        />
      );

    case 'status':
      return isSyncing && !task.last_synced_at ? (
        <Skeleton className="h-5 w-20 rounded-full" />
      ) : (
        <StatusCell
          value={task.status}
          statuses={ctx.statuses}
          onChange={(status) => {
            const matched = ctx.statuses.find((s) => s.key === status);
            ctx.handleUpdateTask(task.id, {
              status,
              status_group: matched?.group_name ?? 'todo',
            });
          }}
          onAddStatus={ctx.addStatus}
          onUpdateStatus={ctx.updateStatus}
          onDeleteStatus={ctx.deleteStatus}
        />
      );

    case 'amount':
      return isSyncing && !task.amount ? (
        <Skeleton className="h-4 w-14" />
      ) : (
        <AmountCell
          value={task.amount}
          onChange={(amount) => ctx.handleUpdateTask(task.id, { amount })}
        />
      );

    case 'assigned':
      return isSyncing && !task.assigned_date ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <DateCell
          value={task.assigned_date}
          onChange={(assigned_date) =>
            ctx.handleUpdateTask(task.id, { assigned_date })
          }
        />
      );

    case 'payment':
      return isSyncing && !task.payment_date ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <DateCell
          value={task.payment_date}
          onChange={(payment_date) =>
            ctx.handleUpdateTask(task.id, { payment_date })
          }
          mode="past"
        />
      );

    case 'note':
      return isSyncing && !task.note ? (
        <Skeleton className="h-4 w-36" />
      ) : (
        <NoteCell
          value={task.note}
          onChange={(note) => ctx.handleUpdateTask(task.id, { note })}
          highlight={search}
        />
      );

    default:
      return null;
  }
}
