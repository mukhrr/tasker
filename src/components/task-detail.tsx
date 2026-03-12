'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_CONFIG } from '@/lib/status';
import { shortenGitHubUrl } from '@/lib/github';
import type { Task } from '@/types/database';

export function TaskDetail({ task }: { task: Task }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const statusConfig = STATUS_CONFIG[task.status];

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;
    setDeleting(true);
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
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">
                  {task.repo_owner && task.repo_name
                    ? `${task.repo_owner}/${task.repo_name}#${task.issue_number}`
                    : shortenGitHubUrl(task.issue_url)}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.color}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${statusConfig.dotColor}`}
                  />
                  {statusConfig.label}
                </span>
              </div>
              <a
                href={task.issue_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {task.issue_url}
              </a>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              Delete
            </Button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm md:grid-cols-3">
            {task.pr_url && (
              <div>
                <span className="text-muted-foreground">Pull Request</span>
                <p className="mt-1">
                  <a
                    href={task.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {shortenGitHubUrl(task.pr_url)}
                  </a>
                </p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Amount</span>
              <p className="mt-1 font-medium">
                {task.amount != null
                  ? `$${task.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Assigned Date</span>
              <p className="mt-1">
                {task.assigned_date
                  ? new Date(task.assigned_date + 'T00:00:00').toLocaleDateString()
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Payment Date</span>
              <p className="mt-1">
                {task.payment_date
                  ? new Date(task.payment_date + 'T00:00:00').toLocaleDateString()
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Synced</span>
              <p className="mt-1">
                {task.last_synced_at
                  ? new Date(task.last_synced_at).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p className="mt-1">
                {new Date(task.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {task.note && (
            <div className="mt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Note</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{task.note}</p>
            </div>
          )}

          {task.ai_summary && (
            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
              <h2 className="text-sm font-medium text-blue-700 dark:text-blue-300">
                AI Summary
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-blue-800 dark:text-blue-200">
                {task.ai_summary}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
