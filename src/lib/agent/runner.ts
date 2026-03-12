import { createClient } from '@supabase/supabase-js';
import { createSyncGraph } from './graph';
import { decrypt } from '@/lib/encryption';
import type { Bounty } from '@/types/database';

export async function runSync(userId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Get user settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', userId)
    .single();

  if (!settings?.ai_api_key_encrypted) {
    throw new Error('No AI API key configured. Go to Settings to add one.');
  }

  if (!settings?.github_token_encrypted) {
    throw new Error('No GitHub token. Please reconnect with GitHub OAuth.');
  }

  const apiKey = decrypt(settings.ai_api_key_encrypted);
  const githubToken = settings.github_token_encrypted; // stored as plaintext from OAuth for now

  // Get bounties that need syncing
  const { data: bounties } = await supabase
    .from('bounties')
    .select('*')
    .eq('user_id', userId)
    .not('status', 'in', '("paid","wasted")');

  if (!bounties || bounties.length === 0) {
    return { bounties_updated: 0, errors: [] };
  }

  // Create sync log
  const { data: syncLog } = await supabase
    .from('sync_logs')
    .insert({ user_id: userId, status: 'running' })
    .select()
    .single();

  try {
    const graph = createSyncGraph();

    const result = await graph.invoke({
      bounties: bounties as Bounty[],
      githubToken,
      apiKey,
      currentIndex: 0,
      updates: [],
      errors: [],
    });

    let bountiesUpdated = 0;

    // Apply updates
    for (const update of result.updates) {
      if (update.confidence >= 0.6) {
        const updateData: Record<string, unknown> = {
          ai_summary: update.summary,
          last_synced_at: new Date().toISOString(),
        };

        // Only update status if confidence is high enough and status changed
        const currentBounty = bounties.find((b) => b.id === update.bountyId);
        if (currentBounty && update.suggestedStatus !== currentBounty.status && update.confidence >= 0.75) {
          updateData.status = update.suggestedStatus;
        }

        await supabase
          .from('bounties')
          .update(updateData)
          .eq('id', update.bountyId);

        bountiesUpdated++;
      }
    }

    // Update sync log
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          bounties_updated: bountiesUpdated,
          details: { updates: result.updates, errors: result.errors },
        })
        .eq('id', syncLog.id);
    }

    return { bounties_updated: bountiesUpdated, errors: result.errors };
  } catch (err) {
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', syncLog.id);
    }
    throw err;
  }
}
