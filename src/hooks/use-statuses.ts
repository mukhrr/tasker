'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { UserStatus, TaskStatusGroup } from '@/types/database';

const supabase = createClient();

export function useStatuses(userId: string) {
  const [statuses, setStatuses] = useState<UserStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async () => {
    const { data } = await supabase
      .from('user_statuses')
      .select('*')
      .eq('user_id', userId)
      .order('group_name')
      .order('position');

    const rows = (data as UserStatus[]) ?? [];

    if (rows.length === 0) {
      // Seed defaults
      await supabase.rpc('seed_default_statuses', { p_user_id: userId });
      const { data: seeded } = await supabase
        .from('user_statuses')
        .select('*')
        .eq('user_id', userId)
        .order('group_name')
        .order('position');
      setStatuses((seeded as UserStatus[]) ?? []);
    } else {
      setStatuses(rows);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const addStatus = async (data: {
    key: string;
    label: string;
    description: string;
    color: string;
    group_name: TaskStatusGroup;
  }) => {
    // Position = max position in group + 1
    const groupStatuses = statuses.filter(
      (s) => s.group_name === data.group_name
    );
    const position =
      groupStatuses.length > 0
        ? Math.max(...groupStatuses.map((s) => s.position)) + 1
        : 0;

    const { error } = await supabase.from('user_statuses').insert({
      user_id: userId,
      ...data,
      position,
    });
    if (!error) await fetchStatuses();
    return { error };
  };

  const updateStatus = async (
    id: string,
    updates: Partial<
      Pick<UserStatus, 'label' | 'description' | 'color' | 'group_name' | 'key'>
    >
  ) => {
    // Optimistic
    setStatuses((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
    const { error } = await supabase
      .from('user_statuses')
      .update(updates)
      .eq('id', id);
    if (error) await fetchStatuses();
    return { error };
  };

  const deleteStatus = async (id: string) => {
    setStatuses((prev) => prev.filter((s) => s.id !== id));
    const { error } = await supabase
      .from('user_statuses')
      .delete()
      .eq('id', id);
    if (error) await fetchStatuses();
    return { error };
  };

  return {
    statuses,
    loading,
    addStatus,
    updateStatus,
    deleteStatus,
    refetch: fetchStatuses,
  };
}
