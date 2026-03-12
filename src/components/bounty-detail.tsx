'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { STATUS_CONFIG } from '@/lib/status';
import { shortenGitHubUrl } from '@/lib/github';
import type { Bounty, BountyStatus } from '@/types/database';

export function BountyDetail({ bounty }: { bounty: Bounty }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const statusConfig = STATUS_CONFIG[bounty.status];

  const handleDelete = async () => {
    if (!confirm('Delete this bounty?')) return;
    setDeleting(true);
    await supabase.from('bounties').delete().eq('id', bounty.id);
    router.push('/bounties');
    router.refresh();
  };

  return (
    <div>
      <Link
        href="/bounties"
        className={buttonVariants({ variant: 'link' }) + ' px-0'}
      >
        &larr; Back to bounties
      </Link>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">
                  {bounty.repo_owner && bounty.repo_name
                    ? `${bounty.repo_owner}/${bounty.repo_name}#${bounty.issue_number}`
                    : shortenGitHubUrl(bounty.issue_url)}
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
                href={bounty.issue_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {bounty.issue_url}
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
            {bounty.pr_url && (
              <div>
                <span className="text-muted-foreground">Pull Request</span>
                <p className="mt-1">
                  <a
                    href={bounty.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {shortenGitHubUrl(bounty.pr_url)}
                  </a>
                </p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Amount</span>
              <p className="mt-1 font-medium">
                {bounty.amount != null
                  ? `$${bounty.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Assigned Date</span>
              <p className="mt-1">
                {bounty.assigned_date
                  ? new Date(bounty.assigned_date + 'T00:00:00').toLocaleDateString()
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Payment Date</span>
              <p className="mt-1">
                {bounty.payment_date
                  ? new Date(bounty.payment_date + 'T00:00:00').toLocaleDateString()
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Synced</span>
              <p className="mt-1">
                {bounty.last_synced_at
                  ? new Date(bounty.last_synced_at).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p className="mt-1">
                {new Date(bounty.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {bounty.note && (
            <div className="mt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Note</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{bounty.note}</p>
            </div>
          )}

          {bounty.ai_summary && (
            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
              <h2 className="text-sm font-medium text-blue-700 dark:text-blue-300">
                AI Summary
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-blue-800 dark:text-blue-200">
                {bounty.ai_summary}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
