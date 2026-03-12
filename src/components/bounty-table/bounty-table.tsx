'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useBounties } from '@/hooks/use-bounties';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2 } from 'lucide-react';
import type { Bounty, BountyStatus, BountyStatusGroup } from '@/types/database';

export function BountyTable({ userId }: { userId: string }) {
  const { bounties, loading, addBounty, updateBounty, deleteBounty } =
    useBounties(userId);
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

  const filteredBounties = useMemo(() => {
    let filtered = bounties;

    if (activeTab !== 'all') {
      filtered = filtered.filter(
        (b) => b.status_group === (activeTab as BountyStatusGroup)
      );
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.issue_url.toLowerCase().includes(q) ||
          b.pr_url?.toLowerCase().includes(q) ||
          b.note?.toLowerCase().includes(q) ||
          b.repo_owner?.toLowerCase().includes(q) ||
          b.repo_name?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [bounties, activeTab, search]);

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

  const handleAddBounty = async (issueUrl: string) => {
    try {
      await addBounty(issueUrl);
      toast.success('Bounty added');
    } catch {
      toast.error('Failed to add bounty');
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Bounty>) => {
    try {
      await updateBounty(id, updates);
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBounty(id);
      toast.success('Bounty deleted');
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
              {filteredBounties.length === 0 ? (
                <tr>
                  <td
                    colSpan={8 + columns.length}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {bounties.length === 0
                      ? 'No bounties yet. Add your first bounty below.'
                      : 'No bounties match your filters.'}
                  </td>
                </tr>
              ) : (
                filteredBounties.map((bounty) => (
                  <tr
                    key={bounty.id}
                    className="group/row border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/bounties/${bounty.id}`}
                          className="mr-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          View
                        </Link>
                        <UrlCell
                          value={bounty.issue_url}
                          onChange={(v) =>
                            v && handleUpdate(bounty.id, { issue_url: v })
                          }
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <UrlCell
                        value={bounty.pr_url}
                        onChange={(v) =>
                          handleUpdate(bounty.id, { pr_url: v })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <StatusCell
                        value={bounty.status}
                        onChange={(status: BountyStatus) =>
                          handleUpdate(bounty.id, { status })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <AmountCell
                        value={bounty.amount}
                        onChange={(amount) =>
                          handleUpdate(bounty.id, { amount })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <DateCell
                        value={bounty.assigned_date}
                        onChange={(assigned_date) =>
                          handleUpdate(bounty.id, { assigned_date })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <DateCell
                        value={bounty.payment_date}
                        onChange={(payment_date) =>
                          handleUpdate(bounty.id, { payment_date })
                        }
                      />
                    </td>
                    <td className="max-w-[200px] px-4 py-2">
                      <TextCell
                        value={bounty.note}
                        onChange={(note) =>
                          handleUpdate(bounty.id, { note })
                        }
                        placeholder="Add a note..."
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.id} className="px-4 py-2">
                        <TextCell
                          value={getFieldValue(bounty.id, col.id)}
                          onChange={(value) =>
                            setFieldValue(bounty.id, col.id, value)
                          }
                        />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <button
                        onClick={() => handleDelete(bounty.id)}
                        className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <AddRow onAdd={handleAddBounty} />
      </div>

      {bounties.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filteredBounties.length} of {bounties.length} bounties
        </p>
      )}
    </div>
  );
}
