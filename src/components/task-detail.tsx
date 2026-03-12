'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
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
        status,
        priority,
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

  return (
    <div>
      <Link
        href="/tasks"
        className={buttonVariants({ variant: 'link' }) + ' px-0'}
      >
        &larr; Back to tasks
      </Link>

      <Card className="mt-4">
        <CardContent className="pt-6">
          {isEditing ? (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input name="title" defaultValue={task.title} required />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  name="description"
                  rows={4}
                  defaultValue={task.description ?? ''}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TaskStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as TaskPriority)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input
                  name="repository_url"
                  type="url"
                  defaultValue={task.repository_url ?? ''}
                />
              </div>
              <div className="space-y-2">
                <Label>Issue URL</Label>
                <Input
                  name="issue_url"
                  type="url"
                  defaultValue={task.issue_url ?? ''}
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <div className="flex items-start justify-between">
                <h1 className="text-2xl font-bold">{task.title}</h1>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {task.description && (
                <p className="mt-4 whitespace-pre-wrap text-muted-foreground">
                  {task.description}
                </p>
              )}
              <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="mt-1 font-medium capitalize">
                    {task.status.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <p className="mt-1 font-medium capitalize">
                    {task.priority}
                  </p>
                </div>
                {task.repository_url && (
                  <div>
                    <span className="text-muted-foreground">Repository</span>
                    <p className="mt-1">
                      <a
                        href={task.repository_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {task.repository_url}
                      </a>
                    </p>
                  </div>
                )}
                {task.issue_url && (
                  <div>
                    <span className="text-muted-foreground">Issue</span>
                    <p className="mt-1">
                      <a
                        href={task.issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {task.issue_url}
                      </a>
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p className="mt-1">
                    {new Date(task.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
