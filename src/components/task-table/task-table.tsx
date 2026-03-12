'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { useCustomColumns } from '@/hooks/use-custom-columns';
import { useStatuses } from '@/hooks/use-statuses';
import { getStatusGroup } from '@/lib/status';
import { Toolbar } from './toolbar';
import { AddRow } from './add-row';
import { AddColumnButton } from './add-column-button';
import { ColumnHeader } from './column-header';
import { UrlCell } from './cells/url-cell';
import { StatusCell } from './cells/status-cell';
import { shortenGitHubUrl, normalizeUrl } from '@/lib/github';
import { DateCell } from './cells/date-cell';
import { AmountCell } from './cells/amount-cell';
import { TextCell } from './cells/text-cell';
import { NoteCell } from './cells/note-cell';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Trash2, Eye, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { Task, TaskStatusGroup } from '@/types/database';

export function TaskTable({ userId }: { userId: string }) {
  const { tasks, loading, syncingTaskIds, addTask, updateTask, deleteTask, syncTask } =
    useTasks(userId);
  const {
    columns,
    addColumn,
    updateColumn,
    deleteColumn,
    setFieldValue,
    getFieldValue,
  } = useCustomColumns(userId);
  const {
    statuses,
    addStatus,
    updateStatus,
    deleteStatus,
  } = useStatuses(userId);

  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    if (activeTab !== 'all') {
      filtered = filtered.filter(
        (t) => getStatusGroup(statuses, t.status) === (activeTab as TaskStatusGroup)
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

    return filtered;
  }, [tasks, statuses, activeTab, search]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }
      if (data.errors?.length) {
        toast.warning(`Synced ${data.tasks_updated} tasks, ${data.errors.length} failed`);
      } else {
        toast.success(`Synced ${data.tasks_updated} tasks`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddTask = async (issueUrl: string) => {
    try {
      await addTask(issueUrl);
      toast.success('Task added');
    } catch {
      toast.error('Failed to add task');
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Task>) => {
    try {
      await updateTask(id, updates);
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTask(id);
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        search={search}
        onSearchChange={setSearch}
        onSync={handleSync}
        syncing={syncing}
      />

      <div className="rounded-lg border">
        <div className="-mx-px overflow-x-auto">
          <table className="w-full min-w-[700px] text-[0.9rem]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Issue" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="PR" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Status" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Amount" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Assigned" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Payment" />
                </th>
                <th className="px-3 py-2.5 text-left sm:px-4">
                  <ColumnHeader name="Note" />
                </th>
                {columns.map((col) => (
                  <th key={col.id} className="px-3 py-2.5 text-left sm:px-4">
                    <ColumnHeader
                      name={col.name}
                      isCustom
                      onRename={(name) => updateColumn(col.id, { name })}
                      onDelete={() => deleteColumn(col.id)}
                    />
                  </th>
                ))}
                <th className="w-10 px-2 py-2.5">
                  <AddColumnButton onAdd={addColumn} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={8 + columns.length}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {tasks.length === 0
                      ? 'No tasks yet. Add your first task below.'
                      : 'No tasks match your filters.'}
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => {
                  const isSyncing = syncingTaskIds.has(task.id);
                  return (
                    <tr
                      key={task.id}
                      className="group/row border-b last:border-b-0 hover:bg-muted/30"
                    >
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
                              {task.issue_title || shortenGitHubUrl(task.issue_url)}
                              <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-0 transition-opacity group-hover/issue:opacity-100" />
                            </span>
                            {task.issue_title && (
                              <span className="line-clamp-1 text-xs text-muted-foreground">
                                {shortenGitHubUrl(task.issue_url)}
                              </span>
                            )}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2 sm:px-4">
                        {isSyncing && !task.pr_url ? (
                          <Skeleton className="h-4 w-28" />
                        ) : (
                          <UrlCell
                            value={task.pr_url}
                            onChange={(v) =>
                              handleUpdate(task.id, { pr_url: v })
                            }
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 sm:px-4">
                        {isSyncing && !task.last_synced_at ? (
                          <Skeleton className="h-5 w-20 rounded-full" />
                        ) : (
                          <StatusCell
                            value={task.status}
                            statuses={statuses}
                            onChange={(status) =>
                              handleUpdate(task.id, { status })
                            }
                            onAddStatus={addStatus}
                            onUpdateStatus={updateStatus}
                            onDeleteStatus={deleteStatus}
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 sm:px-4">
                        {isSyncing && !task.amount ? (
                          <Skeleton className="h-4 w-14" />
                        ) : (
                          <AmountCell
                            value={task.amount}
                            onChange={(amount) =>
                              handleUpdate(task.id, { amount })
                            }
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 sm:px-4">
                        {isSyncing && !task.assigned_date ? (
                          <Skeleton className="h-4 w-20" />
                        ) : (
                          <DateCell
                            value={task.assigned_date}
                            onChange={(assigned_date) =>
                              handleUpdate(task.id, { assigned_date })
                            }
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 sm:px-4">
                        {isSyncing && !task.payment_date ? (
                          <Skeleton className="h-4 w-20" />
                        ) : (
                          <DateCell
                            value={task.payment_date}
                            onChange={(payment_date) =>
                              handleUpdate(task.id, { payment_date })
                            }
                          />
                        )}
                      </td>
                      <td className="min-w-[250px] max-w-[350px] px-3 py-2 sm:px-4">
                        {isSyncing && !task.note ? (
                          <Skeleton className="h-4 w-36" />
                        ) : (
                          <NoteCell
                            value={task.note}
                            onChange={(note) =>
                              handleUpdate(task.id, { note })
                            }
                          />
                        )}
                      </td>
                      {columns.map((col) => (
                        <td key={col.id} className="px-3 py-2 sm:px-4">
                          <TextCell
                            value={getFieldValue(task.id, col.id)}
                            onChange={(value) =>
                              setFieldValue(task.id, col.id, value)
                            }
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        {deleteConfirmId === task.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                handleDelete(task.id);
                                setDeleteConfirmId(null);
                              }}
                              className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <TooltipProvider delay={400}>
                            <div className="flex items-center">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      onClick={async () => {
                                        try {
                                          await syncTask(task.id);
                                          toast.success('Task synced');
                                        } catch (err) {
                                          toast.error(err instanceof Error ? err.message : 'Sync failed');
                                        }
                                      }}
                                      disabled={isSyncing}
                                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    />
                                  }
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                </TooltipTrigger>
                                <TooltipContent>Sync</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      onClick={() => setDeleteConfirmId(task.id)}
                                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-100 hover:text-destructive dark:hover:bg-red-950"
                                    />
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Link
                                      href={`/tasks/${task.id}`}
                                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    />
                                  }
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </TooltipTrigger>
                                <TooltipContent>View</TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <AddRow onAdd={handleAddTask} />
      </div>

      {tasks.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {filteredTasks.length} of {tasks.length} tasks
        </p>
      )}
    </div>
  );
}
