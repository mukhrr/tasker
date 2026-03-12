'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseIssueUrl } from '@/lib/github';
import type { Task, TaskStatus } from '@/types/database';

export function useTasks(userId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchTasks();

    const channel = supabase
      .channel('tasks-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const addTask = async (issueUrl: string) => {
    const parsed = parseIssueUrl(issueUrl);

    const newTask = {
      user_id: userId,
      issue_url: issueUrl,
      status: 'in_proposal' as TaskStatus,
      repo_owner: parsed?.owner ?? null,
      repo_name: parsed?.repo ?? null,
      issue_number: parsed?.number ?? null,
    };

    // Optimistic: add a temp task
    const tempId = crypto.randomUUID();
    const optimistic: Task = {
      ...newTask,
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

    setTasks((prev) => [optimistic, ...prev]);

    const { error } = await supabase.from('tasks').insert(newTask);
    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== tempId));
      throw error;
    }

    await fetchTasks();
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );

    const { error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id);

    if (error) {
      await fetchTasks();
      throw error;
    }
  };

  const deleteTask = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) {
      await fetchTasks();
      throw error;
    }
  };

  return { tasks, loading, addTask, updateTask, deleteTask, refetch: fetchTasks };
}
