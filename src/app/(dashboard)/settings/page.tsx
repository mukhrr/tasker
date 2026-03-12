import { createClient } from '@/lib/supabase/server';
import { SettingsForm } from '@/components/settings-form';
import type { UserSettings } from '@/types/database';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user!.id)
    .single();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure your AI agent and sync preferences
      </p>
      <div className="mt-8">
        <SettingsForm
          user={user!}
          settings={settings as UserSettings | null}
        />
      </div>
    </div>
  );
}
