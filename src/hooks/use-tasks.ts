'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseIssueUrl } from '@/lib/github';
import type { Task, TaskStatus } from '@/types/database';

export function useTasks(userId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingTaskIds, setSyncingTaskIds] = useState<Set<string>>(new Set());
  const supabase = createClient();
  const channelId = useRef(`tasks-realtime-${crypto.randomUUID()}`);

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Deduplicate by repo+issue number (keep the first — most recent by created_at)
    const seen = new Set<string>();
    const unique = ((data as Task[]) ?? []).filter((t) => {
      const key = t.repo_owner && t.repo_name && t.issue_number
        ? `${t.repo_owner}/${t.repo_name}#${t.issue_number}`.toLowerCase()
        : t.issue_url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setTasks(unique);
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchTasks();

    const channel = supabase
      .channel(channelId.current)
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

  const syncTask = async (taskId: string, opts?: { silent?: boolean }) => {
    setSyncingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      const res = await fetch('/api/sync/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Sync failed');
      }
      await fetchTasks();
    } catch (err) {
      if (!opts?.silent) throw err;
    } finally {
      setSyncingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const addTask = async (issueUrl: string) => {
    // Check for duplicate issue
    const parsed = parseIssueUrl(issueUrl);
    const duplicate = tasks.find((t) => {
      if (parsed && t.repo_owner && t.repo_name && t.issue_number) {
        return (
          t.repo_owner.toLowerCase() === parsed.owner.toLowerCase() &&
          t.repo_name.toLowerCase() === parsed.repo.toLowerCase() &&
          t.issue_number === parsed.number
        );
      }
      return t.issue_url.toLowerCase() === issueUrl.toLowerCase();
    });
    if (duplicate) {
      throw new Error('This issue is already in your task list.');
    }

    const newTask = {
      user_id: userId,
      issue_url: issueUrl,
      status: 'in_proposal' as TaskStatus,
      status_group: 'todo',
      repo_owner: parsed?.owner ?? null,
      repo_name: parsed?.repo ?? null,
      issue_number: parsed?.number ?? null,
    };

    // Optimistic: add a temp task
    const tempId = crypto.randomUUID();
    const optimistic: Task = {
      ...newTask,
      id: tempId,
      issue_title: null,
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
    setSyncingTaskIds((prev) => new Set(prev).add(tempId));

    const { data, error } = await supabase
      .from('tasks')
      .insert(newTask)
      .select()
      .single();

    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== tempId));
      setSyncingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
      throw error;
    }

    // Replace optimistic with real task
    const realTask = data as Task;
    setTasks((prev) => prev.map((t) => (t.id === tempId ? realTask : t)));

    // Transfer syncing state from temp to real ID
    setSyncingTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      next.add(realTask.id);
      return next;
    });

    // Auto-sync the newly added task in the background
    syncTask(realTask.id, { silent: true });
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );

    const { error } = await supabase.from('tasks').update(updates).eq('id', id);

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

  return {
    tasks,
    loading,
    syncingTaskIds,
    addTask,
    updateTask,
    deleteTask,
    syncTask,
    refetch: fetchTasks,
  };
}
