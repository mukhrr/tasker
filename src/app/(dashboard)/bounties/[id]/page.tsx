import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BountyDetail } from '@/components/bounty-detail';
import type { Bounty } from '@/types/database';

export default async function BountyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: bounty } = await supabase
    .from('bounties')
    .select('*')
    .eq('id', id)
    .single();

  if (!bounty) {
    notFound();
  }

  return <BountyDetail bounty={bounty as Bounty} />;
}
