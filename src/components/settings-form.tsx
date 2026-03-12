'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import type { UserSettings } from '@/types/database';

export function SettingsForm({
  user,
  settings,
  apiKeyMasked: initialApiKeyMasked,
}: {
  user: User;
  settings: UserSettings | null;
  apiKeyMasked: string | null;
}) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoSync, setAutoSync] = useState(settings?.auto_sync_enabled ?? false);
  const [syncInterval, setSyncInterval] = useState(
    settings?.sync_interval_hours?.toString() ?? '6'
  );

  const [hasApiKey, setHasApiKey] = useState(!!settings?.ai_api_key_encrypted);
  const [maskedKey, setMaskedKey] = useState(initialApiKeyMasked);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const oauthUsername = user.user_metadata?.user_name as string | undefined;
  const [githubUsername, setGithubUsername] = useState(
    settings?.github_username || oauthUsername || ''
  );
  const [savedGithubUsername, setSavedGithubUsername] = useState(
    settings?.github_username || oauthUsername || ''
  );

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_api_key: apiKey }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const last4 = apiKey.slice(-4);
      setMaskedKey(`${'•'.repeat(apiKey.length - 4)}${last4}`);
      setApiKey('');
      setHasApiKey(true);
      setIsEditingKey(false);
      toast.success('API key saved');
    } catch {
      toast.error('Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const saveSyncPreferences = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_sync_enabled: autoSync,
          sync_interval_hours: parseInt(syncInterval),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Sync preferences saved');
    } catch {
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold">AI Configuration</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide your Claude API key for AI-powered status detection
          </p>
          <Separator className="my-4" />
          <div className="space-y-3">
            <Label htmlFor="api-key">Claude API Key</Label>
            {hasApiKey && !isEditingKey ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Input
                  id="api-key"
                  type="text"
                  value={maskedKey ?? '••••••••••••'}
                  readOnly
                  className="font-mono text-muted-foreground"
                />
                <Button
                  variant="outline"
                  onClick={() => setIsEditingKey(true)}
                  className="w-full sm:w-auto"
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={saveApiKey} disabled={saving || !apiKey.trim()} className="flex-1 sm:flex-none">
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  {isEditingKey && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditingKey(false);
                        setApiKey('');
                      }}
                      className="flex-1 sm:flex-none"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}
            {hasApiKey && (
              <p className="text-xs text-muted-foreground">
                API key is stored encrypted.{!isEditingKey && ' Click Change to replace it.'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold">GitHub Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your GitHub username is used to match issue assignments, PRs, and reviews
          </p>
          <Separator className="my-4" />
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </div>
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:gap-3">
                <Input
                  placeholder="your-github-username"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  onBlur={() => {
                    if (!githubUsername.trim() && savedGithubUsername) {
                      setGithubUsername(savedGithubUsername);
                    }
                  }}
                  required
                />
                <Button
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!githubUsername.trim()) return;
                    setSaving(true);
                    try {
                      const res = await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ github_username: githubUsername.trim() }),
                      });
                      if (!res.ok) throw new Error('Failed to save');
                      setSavedGithubUsername(githubUsername.trim());
                      toast.success('GitHub username saved');
                    } catch {
                      toast.error('Failed to save username');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving || !githubUsername.trim() || githubUsername.trim() === savedGithubUsername}
                >
                  Save
                </Button>
              </div>
            </div>
            {oauthUsername && (
              <p className="text-xs text-muted-foreground">
                Auto-detected from GitHub OAuth: @{oauthUsername}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold">Sync Preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure automatic GitHub sync
          </p>
          <Separator className="my-4" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-sync</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically sync task statuses from GitHub
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSync}
                onClick={() => setAutoSync(!autoSync)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  autoSync ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${
                    autoSync ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {autoSync && (
              <div className="space-y-2">
                <Label htmlFor="sync-interval">Sync interval (hours)</Label>
                <select
                  id="sync-interval"
                  value={syncInterval}
                  onChange={(e) => setSyncInterval(e.target.value)}
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm sm:max-w-[200px]"
                >
                  <option value="1">Every hour</option>
                  <option value="3">Every 3 hours</option>
                  <option value="6">Every 6 hours</option>
                  <option value="12">Every 12 hours</option>
                  <option value="24">Every 24 hours</option>
                </select>
              </div>
            )}
            <Button onClick={saveSyncPreferences} disabled={saving}>
              Save Preferences
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
