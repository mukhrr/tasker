'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseIssueUrl } from '@/lib/github';
import type { Bounty, BountyStatus } from '@/types/database';

export function useBounties(userId: string) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchBounties = useCallback(async () => {
    const { data } = await supabase
      .from('bounties')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    setBounties((data as Bounty[]) ?? []);
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchBounties();

    const channel = supabase
      .channel('bounties-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bounties',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchBounties();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const addBounty = async (issueUrl: string) => {
    const parsed = parseIssueUrl(issueUrl);

    const newBounty = {
      user_id: userId,
      issue_url: issueUrl,
      status: 'in_proposal' as BountyStatus,
      repo_owner: parsed?.owner ?? null,
      repo_name: parsed?.repo ?? null,
      issue_number: parsed?.number ?? null,
    };

    // Optimistic: add a temp bounty
    const tempId = crypto.randomUUID();
    const optimistic: Bounty = {
      ...newBounty,
      id: tempId,
      pr_url: null,
      status_group: 'todo',
      amount: null,
      payment_date: null,
      assigned_date: null,
      note: null,
      ai_summary: null,
      last_synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setBounties((prev) => [optimistic, ...prev]);

    const { error } = await supabase.from('bounties').insert(newBounty);
    if (error) {
      setBounties((prev) => prev.filter((b) => b.id !== tempId));
      throw error;
    }

    await fetchBounties();
  };

  const updateBounty = async (id: string, updates: Partial<Bounty>) => {
    // Optimistic update
    setBounties((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
    );

    const { error } = await supabase
      .from('bounties')
      .update(updates)
      .eq('id', id);

    if (error) {
      await fetchBounties();
      throw error;
    }
  };

  const deleteBounty = async (id: string) => {
    setBounties((prev) => prev.filter((b) => b.id !== id));
    const { error } = await supabase.from('bounties').delete().eq('id', id);
    if (error) {
      await fetchBounties();
      throw error;
    }
  };

  return { bounties, loading, addBounty, updateBounty, deleteBounty, refetch: fetchBounties };
}
