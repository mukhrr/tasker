'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export function Navbar({ user }: { user: User }) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  };

  return (
    <nav className="border-b border-foreground/10">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/tasks" className="text-xl font-bold">
            Tasker
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/tasks"
              className="text-sm text-foreground/60 transition-colors hover:text-foreground"
            >
              Tasks
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-foreground/60">{user.email}</span>
          <button
            onClick={handleSignOut}
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
