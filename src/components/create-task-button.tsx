'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TaskPriority } from '@/types/database';

export function CreateTaskButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError('You must be logged in');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('tasks').insert({
      title: formData.get('title') as string,
      description: (formData.get('description') as string) || null,
      priority,
      repository_url: (formData.get('repository_url') as string) || null,
      issue_url: (formData.get('issue_url') as string) || null,
      status: 'open',
      creator_id: user.id,
      labels: [],
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setOpen(false);
    setLoading(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New Task</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Fix authentication bug in..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Describe the task..."
            />
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
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repository_url">Repository URL</Label>
            <Input
              id="repository_url"
              name="repository_url"
              type="url"
              placeholder="https://github.com/org/repo"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="issue_url">Issue URL</Label>
            <Input
              id="issue_url"
              name="issue_url"
              type="url"
              placeholder="https://github.com/org/repo/issues/123"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
