import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!settings) {
    return NextResponse.json({
      id: user.id,
      has_api_key: false,
      auto_sync_enabled: false,
      sync_interval_hours: 6,
    });
  }

  return NextResponse.json({
    id: settings.id,
    has_api_key: !!settings.ai_api_key_encrypted,
    auto_sync_enabled: settings.auto_sync_enabled,
    sync_interval_hours: settings.sync_interval_hours,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  // Ensure the row exists first
  await supabase
    .from('user_settings')
    .upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true });

  // Then update only the fields that were provided
  const updates: Record<string, unknown> = {};

  if (body.ai_api_key) {
    updates.ai_api_key_encrypted = encrypt(body.ai_api_key);
  }

  if (body.auto_sync_enabled !== undefined) {
    updates.auto_sync_enabled = body.auto_sync_enabled;
  }

  if (body.sync_interval_hours !== undefined) {
    updates.sync_interval_hours = body.sync_interval_hours;
  }

  const { error } = await supabase
    .from('user_settings')
    .update(updates)
    .eq('id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
