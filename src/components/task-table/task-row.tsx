'use client';

import { useState } from 'react';
import { shortenGitHubUrl, normalizeUrl } from '@/lib/github';
import { getStatusByKey, getStatusColor, getStaleRowBg } from '@/lib/status';
import type { UserStatus } from '@/types/database';
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
    | 'handleArchiveTask'
    | 'deleteConfirmId'
    | 'setDeleteConfirmId'
    | 'addStatus'
    | 'updateStatus'
    | 'deleteStatus'
  >;
}

export function TaskRow({ task, isSyncing, search, visibleColumnKeys, ctx }: TaskRowProps) {
  const isConfirmingDelete = ctx.deleteConfirmId === task.id;
  const [titleExpanded, setTitleExpanded] = useState(false);

  const titleText = task.issue_title || shortenGitHubUrl(task.issue_url);
  const TRUNCATE_LENGTH = 80;
  const isTitleTruncatable = titleText.length > TRUNCATE_LENGTH;
  const displayTitle =
    !titleExpanded && isTitleTruncatable
      ? titleText.slice(0, TRUNCATE_LENGTH) + '…'
      : titleText;

  const staleRowBg = getStaleRowBg(ctx.statuses, task.status, task.status_changed_at);

  return (
    <tr className={`group/row border-b last:border-b-0 hover:bg-muted/30 ${staleRowBg} ${task.archived ? 'opacity-50' : ''}`}>
      {/* Issue column (always first) */}
      <td className="min-w-[300px] max-w-[450px] px-3 py-2 sm:px-4">
        {isSyncing && !task.issue_title ? (
          <Skeleton className="h-4 w-36" />
        ) : (
          <div>
            <a
              href={normalizeUrl(task.issue_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="group/issue inline"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-sm font-medium text-foreground group-hover/issue:underline">
                <HighlightText text={displayTitle} query={search} />
                <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-0 transition-opacity group-hover/issue:opacity-100" />
              </span>
            </a>
            {isTitleTruncatable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTitleExpanded(!titleExpanded);
                }}
                className="ml-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {titleExpanded ? 'show less' : 'more'}
              </button>
            )}
            {task.issue_title && (
              <div className="line-clamp-1 text-xs text-muted-foreground">
                <HighlightText
                  text={shortenGitHubUrl(task.issue_url)}
                  query={search}
                />
              </div>
            )}
          </div>
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
              readOnly={task.archived}
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
      <td className="sticky right-0 bg-muted/50 px-2 py-2 backdrop-blur-xs">
        <TaskRowActions
          taskId={task.id}
          isSyncing={isSyncing}
          isConfirmingDelete={isConfirmingDelete}
          isArchived={task.archived}
          onSync={() => ctx.handleSyncTask(task.id)}
          onDelete={() => {
            ctx.handleDeleteTask(task.id);
            ctx.setDeleteConfirmId(null);
          }}
          onRequestDelete={() => ctx.setDeleteConfirmId(task.id)}
          onCancelDelete={() => ctx.setDeleteConfirmId(null)}
          onArchive={() => ctx.handleArchiveTask(task.id, !task.archived)}
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
      return 'min-w-[150px] max-w-[250px] px-3 py-2 sm:px-4';
    default:
      return 'px-3 py-2 sm:px-4';
  }
}

function CellContent({
  columnKey,
  task,
  isSyncing,
  search,
  readOnly,
  ctx,
}: {
  columnKey: ColumnKey;
  task: Task;
  isSyncing: boolean;
  search: string;
  readOnly?: boolean;
  ctx: Pick<
    TaskTableContext,
    | 'statuses'
    | 'handleUpdateTask'
    | 'addStatus'
    | 'updateStatus'
    | 'deleteStatus'
  >;
}) {
  if (readOnly) {
    return <ReadOnlyCell columnKey={columnKey} task={task} search={search} statuses={ctx.statuses} />;
  }
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

function ReadOnlyCell({
  columnKey,
  task,
  search,
  statuses,
}: {
  columnKey: ColumnKey;
  task: Task;
  search: string;
  statuses: UserStatus[];
}) {
  switch (columnKey) {
    case 'pr':
      return task.pr_url ? (
        <a
          href={normalizeUrl(task.pr_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:underline"
        >
          {shortenGitHubUrl(task.pr_url)}
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      );

    case 'status': {
      const s = getStatusByKey(statuses, task.status);
      if (!s) return <span className="text-sm text-muted-foreground">—</span>;
      const color = getStatusColor(s.color);
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${color.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
          {s.label}
        </span>
      );
    }

    case 'amount':
      return (
        <span className="text-sm text-muted-foreground">
          {task.amount != null ? `$${task.amount.toLocaleString()}` : '—'}
        </span>
      );

    case 'assigned':
    case 'payment': {
      const date = columnKey === 'assigned' ? task.assigned_date : task.payment_date;
      return (
        <span className="text-sm text-muted-foreground">
          {date ? new Date(date).toLocaleDateString() : '—'}
        </span>
      );
    }

    case 'note':
      return task.note ? (
        <span className="line-clamp-2 text-sm text-muted-foreground">
          <HighlightText text={task.note} query={search} />
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      );

    default:
      return null;
  }
}
