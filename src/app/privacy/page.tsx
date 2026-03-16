import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Tasker',
  description: 'Privacy policy for Tasker, the AI-powered open source task tracker.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/40 dark:border-white/[0.04]">
        <nav className="mx-auto flex h-14 max-w-4xl items-center px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Tasker" width={28} height={28} className="rounded-lg" />
            <span className="text-base font-bold tracking-tight">Tasker</span>
          </Link>
        </nav>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-5 py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: March 16, 2026</p>

        <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          <section>
            <h2>1. Introduction</h2>
            <p>
              Tasker (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is an open-source,
              AI-powered task tracker that integrates with GitHub. This Privacy Policy explains how
              we collect, use, and protect your information when you use our web application and
              browser extension.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>
            <p>We collect the following information:</p>
            <ul>
              <li>
                <strong className="text-foreground">Account information:</strong> When you sign in
                via GitHub OAuth, we receive your GitHub username, email address, and profile avatar.
              </li>
              <li>
                <strong className="text-foreground">GitHub data:</strong> Issue and pull request
                metadata (titles, statuses, URLs, comments) from repositories you connect. We do not
                access your source code.
              </li>
              <li>
                <strong className="text-foreground">Task data:</strong> Tasks you create or import,
                including statuses, notes, custom columns, and payment amounts.
              </li>
              <li>
                <strong className="text-foreground">API tokens:</strong> If you provide a GitHub
                personal access token, it is encrypted at rest using AES-256-GCM and is never stored
                in plaintext.
              </li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <ul>
              <li>To provide and operate the Tasker service, including AI-powered task syncing.</li>
              <li>To authenticate you and maintain your session.</li>
              <li>To fetch GitHub issue and pull request data for status tracking.</li>
              <li>To improve the service and fix bugs.</li>
            </ul>
          </section>

          <section>
            <h2>4. Browser Extension</h2>
            <p>
              The Tasker browser extension communicates with our servers to display task statuses on
              GitHub pages. The extension:
            </p>
            <ul>
              <li>Only activates on <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono text-foreground">github.com</code> pages.</li>
              <li>Sends GitHub issue/PR identifiers (owner, repo, number) to look up task statuses.</li>
              <li>Does not collect browsing history, keystrokes, or data from non-GitHub pages.</li>
              <li>Stores your authentication session locally in Chrome storage.</li>
            </ul>
          </section>

          <section>
            <h2>5. Data Storage &amp; Security</h2>
            <p>
              Your data is stored in Supabase (hosted on AWS) with row-level security policies
              ensuring you can only access your own data. API tokens and sensitive credentials are
              encrypted using AES-256-GCM before storage. All connections use HTTPS/TLS.
            </p>
          </section>

          <section>
            <h2>6. Third-Party Services</h2>
            <p>We use the following third-party services:</p>
            <ul>
              <li><strong className="text-foreground">Supabase</strong> — authentication and database hosting.</li>
              <li><strong className="text-foreground">GitHub API</strong> — fetching issue and PR data.</li>
              <li><strong className="text-foreground">Anthropic (Claude)</strong> — AI-powered task status analysis. Only task metadata and GitHub comments are sent; no personal data beyond what is in the issue content.</li>
              <li><strong className="text-foreground">Vercel</strong> — application hosting and analytics.</li>
            </ul>
          </section>

          <section>
            <h2>7. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. You may delete your account
              and all associated data at any time from the Settings page. Upon deletion, your data is
              permanently removed within 30 days.
            </p>
          </section>

          <section>
            <h2>8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction or deletion of your data.</li>
              <li>Export your task data.</li>
              <li>Revoke GitHub OAuth access at any time via your GitHub settings.</li>
            </ul>
          </section>

          <section>
            <h2>9. Cookies</h2>
            <p>
              We use essential cookies only for authentication and session management. We do not use
              tracking cookies or third-party advertising cookies.
            </p>
          </section>

          <section>
            <h2>10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this
              page with an updated &quot;Last updated&quot; date. Continued use of Tasker after
              changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2>11. Contact</h2>
            <p>
              If you have questions about this Privacy Policy, please open an issue on our{' '}
              <a
                href="https://github.com/mukhrr/tasker"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                GitHub repository
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 dark:border-white/[0.04]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-8">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Tasker" width={20} height={20} className="rounded" />
            <span className="text-sm font-medium text-muted-foreground">Tasker</span>
          </div>
          <p className="text-xs text-muted-foreground/60">
            Open source task tracking, powered by GitHub & AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
