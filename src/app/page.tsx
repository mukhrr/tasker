'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight">Tasker</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Manage open source tasks and track developer contributions across
          repositories.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/login" className={buttonVariants({ size: 'lg' })}>
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
