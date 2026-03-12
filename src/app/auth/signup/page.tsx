'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="animate-[fadeIn_0.5s_ease-out] text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-500"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h1 className="text-[24px] font-bold tracking-tight">
          Check your email
        </h1>
        <p className="mx-auto mt-3 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
          We&apos;ve sent a confirmation link to{' '}
          <span className="font-semibold text-foreground">{email}</span>
        </p>
        <Link
          href="/auth/login"
          className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.5s_ease-out]">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-tight">
          Create your account
        </h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          Start tracking tasks in minutes
        </p>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="mt-0.5 shrink-0 text-destructive"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <form onSubmit={handleSignup} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-[13px] font-medium">
            Full name
          </Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Jane Smith"
            className="h-11 rounded-xl border-border/60 bg-transparent px-4 text-[14px] transition-all duration-200 placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:ring-violet-500/20"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-[13px] font-medium">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="h-11 rounded-xl border-border/60 bg-transparent px-4 text-[14px] transition-all duration-200 placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:ring-violet-500/20"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-[13px] font-medium">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Min. 6 characters"
            className="h-11 rounded-xl border-border/60 bg-transparent px-4 text-[14px] transition-all duration-200 placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:ring-violet-500/20"
          />
        </div>

        <Button
          type="submit"
          className="h-11 w-full rounded-xl bg-violet-600 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25 active:scale-[0.98]"
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Creating account...
            </span>
          ) : (
            'Create account'
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground/60">
        By signing up, you agree to our{' '}
        <Link
          href="#"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Terms
        </Link>{' '}
        and{' '}
        <Link
          href="#"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Privacy Policy
        </Link>
      </p>

      <p className="mt-4 text-center text-[13px] text-muted-foreground/60">
        Already have an account?{' '}
        <Link
          href="/auth/login"
          className="font-semibold text-foreground transition-colors hover:text-violet-500"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
