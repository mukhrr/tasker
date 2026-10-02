import { createClient, getUser } from '@/lib/supabase/server';
import { SettingsForm } from '@/components/settings-form';
import { decrypt } from '@/lib/encryption';
import type { UserSettings } from '@/types/database';

function maskApiKey(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    const key = decrypt(encrypted);
    const last4 = key.slice(-4);
    return `${'•'.repeat(key.length - 4)}${last4}`;
  } catch {
    return '••••••••••••';
  }
}

export default async function SettingsPage() {
  const user = await getUser();
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user!.id)
    .single();

  const typedSettings = settings as UserSettings | null;
  const apiKeyMasked = maskApiKey(typedSettings?.ai_api_key_encrypted ?? null);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-bold sm:text-2xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure your AI agent and sync preferences
      </p>
      <div className="mt-8">
        <SettingsForm
          user={user!}
          settings={typedSettings}
          apiKeyMasked={apiKeyMasked}
        />
      </div>
    </div>
  );
}
