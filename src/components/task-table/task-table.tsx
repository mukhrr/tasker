'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { useCustomColumns } from '@/hooks/use-custom-columns';
import { Toolbar } from './toolbar';
import { AddRow } from './add-row';
import { AddColumnButton } from './add-column-button';
import { ColumnHeader } from './column-header';
import { UrlCell } from './cells/url-cell';
import { StatusCell } from './cells/status-cell';
import { DateCell } from './cells/date-cell';
import { AmountCell } from './cells/amount-cell';
import { TextCell } from './cells/text-cell';
import { NoteCell } from './cells/note-cell';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2 } from 'lucide-react';
import type { Task, TaskStatus, TaskStatusGroup } from '@/types/database';

export function TaskTable({ userId }: { userId: string }) {
  const { tasks, loading, syncingTaskIds, addTask, updateTask, deleteTask } =
    useTasks(userId);
  const {
    columns,
    addColumn,
    updateColumn,
    deleteColumn,
    setFieldValue,
    getFieldValue,
  } = useCustomColumns(userId);

  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    if (activeTab !== 'all') {
      filtered = filtered.filter(
        (t) => t.status_group === (activeTab as TaskStatusGroup)
      );
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.issue_url.toLowerCase().includes(q) ||
          t.pr_url?.toLowerCase().includes(q) ||
          t.note?.toLowerCase().includes(q) ||
          t.repo_owner?.toLowerCase().includes(q) ||
          t.repo_name?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [tasks, activeTab, search]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Sync failed');
      }
      toast.success('Sync completed');
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Issue" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="PR" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Status" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Amount" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Assigned" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Payment" />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <ColumnHeader name="Note" />
                </th>
                {columns.map((col) => (
                  <th key={col.id} className="px-4 py-2.5 text-left">
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
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/tasks/${task.id}`}
                            className="mr-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            View
                          </Link>
                          <UrlCell
                            value={task.issue_url}
                            onChange={(v) =>
                              v && handleUpdate(task.id, { issue_url: v })
                            }
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2">
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
                      <td className="px-4 py-2">
                        {isSyncing && !task.last_synced_at ? (
                          <Skeleton className="h-5 w-20 rounded-full" />
                        ) : (
                          <StatusCell
                            value={task.status}
                            onChange={(status: TaskStatus) =>
                              handleUpdate(task.id, { status })
                            }
                          />
                        )}
                      </td>
                      <td className="px-4 py-2">
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
                      <td className="px-4 py-2">
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
                      <td className="px-4 py-2">
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
                      <td className="max-w-[300px] px-4 py-2">
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
                        <td key={col.id} className="px-4 py-2">
                          <TextCell
                            value={getFieldValue(task.id, col.id)}
                            onChange={(value) =>
                              setFieldValue(task.id, col.id, value)
                            }
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
        <p className="text-xs text-muted-foreground">
          {filteredTasks.length} of {tasks.length} tasks
        </p>
      )}
    </div>
  );
}
