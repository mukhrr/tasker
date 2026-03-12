'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw } from 'lucide-react';
import type { TaskStatusGroup } from '@/types/database';

export function Toolbar({
  activeTab,
  onTabChange,
  search,
  onSearchChange,
  onSync,
  syncing,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const tabs: { value: string; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'todo', label: 'To-do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
  ];

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 w-[200px] text-xs"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onSync}
        disabled={syncing}
        className="gap-2"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing...' : 'Sync Now'}
      </Button>
    </div>
  );
}
