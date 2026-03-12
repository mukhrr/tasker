import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BountyTable } from '@/components/bounty-table/bounty-table';

export default async function BountiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Bounties</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your open source bounties and contributions
        </p>
      </div>
      <BountyTable userId={user.id} />
    </div>
  );
}
