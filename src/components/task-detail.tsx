'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Task, TaskStatus, TaskPriority } from '@/types/database';

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'completed', label: 'Completed' },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function TaskDetail({ task }: { task: Task }) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);

    await supabase
      .from('tasks')
      .update({
        title: formData.get('title') as string,
        description: (formData.get('description') as string) || null,
        status: formData.get('status') as TaskStatus,
        priority: formData.get('priority') as TaskPriority,
        repository_url: (formData.get('repository_url') as string) || null,
        issue_url: (formData.get('issue_url') as string) || null,
      })
      .eq('id', task.id);

    setIsEditing(false);
    setLoading(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    await supabase.from('tasks').delete().eq('id', task.id);
    router.push('/tasks');
    router.refresh();
  };

  const inputClass =
    'mt-1 block w-full rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40';

  return (
    <div>
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
      >
        &larr; Back to tasks
      </Link>

      <div className="mt-6 rounded-xl border border-foreground/10 p-6">
        {isEditing ? (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Title</label>
              <input name="title" defaultValue={task.title} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium">Description</label>
              <textarea name="description" rows={4} defaultValue={task.description ?? ''} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium">Status</label>
                <select name="status" defaultValue={task.status} className={inputClass}>
                  {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Priority</label>
                <select name="priority" defaultValue={task.priority} className={inputClass}>
                  {priorityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Repository URL</label>
              <input name="repository_url" type="url" defaultValue={task.repository_url ?? ''} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium">Issue URL</label>
              <input name="issue_url" type="url" defaultValue={task.issue_url ?? ''} className={inputClass} />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setIsEditing(false)} className="rounded-lg border border-foreground/20 px-4 py-2 text-sm hover:bg-foreground/5">Cancel</button>
              <button type="submit" disabled={loading} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <h1 className="text-2xl font-bold">{task.title}</h1>
              <div className="flex gap-2">
                <button onClick={() => setIsEditing(true)} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">Edit</button>
                <button onClick={handleDelete} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/5">Delete</button>
              </div>
            </div>
            {task.description && (
              <p className="mt-4 whitespace-pre-wrap text-foreground/80">{task.description}</p>
            )}
            <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-foreground/10 p-4 text-sm">
              <div>
                <span className="text-foreground/40">Status</span>
                <p className="mt-1 font-medium capitalize">{task.status.replace('_', ' ')}</p>
              </div>
              <div>
                <span className="text-foreground/40">Priority</span>
                <p className="mt-1 font-medium capitalize">{task.priority}</p>
              </div>
              {task.repository_url && (
                <div>
                  <span className="text-foreground/40">Repository</span>
                  <p className="mt-1"><a href={task.repository_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{task.repository_url}</a></p>
                </div>
              )}
              {task.issue_url && (
                <div>
                  <span className="text-foreground/40">Issue</span>
                  <p className="mt-1"><a href={task.issue_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{task.issue_url}</a></p>
                </div>
              )}
              <div>
                <span className="text-foreground/40">Created</span>
                <p className="mt-1">{new Date(task.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
