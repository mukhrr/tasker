import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight">Tasker</h1>
        <p className="mt-4 text-lg text-foreground/60">
          Manage open source tasks and track developer contributions across
          repositories.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/login"
            className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-lg border border-foreground/20 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-foreground/5"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
