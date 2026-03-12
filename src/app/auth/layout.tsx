import Image from 'next/image';
import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Left decorative panel */}
      <div className="relative hidden w-[45%] overflow-hidden bg-[#08080c] lg:flex lg:flex-col">
        {/* Subtle noise texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* Gradient atmosphere */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 30% 0%, rgba(139,92,246,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 100%, rgba(59,130,246,0.06) 0%, transparent 50%)',
          }}
        />

        {/* Vertical accent line */}
        <div className="absolute top-0 right-0 h-full w-px bg-linear-to-b from-transparent via-violet-500/20 to-transparent" />

        {/* Content — vertically centered */}
        <div className="relative z-10 flex flex-1 flex-col justify-between p-10">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Tasker"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-base font-semibold tracking-tight text-white/80">
              Tasker
            </span>
          </Link>

          {/* Center content */}
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-[28px] leading-[1.2] font-bold tracking-tight text-white/90">
                Your AI agent
                <br />
                for open source
              </h2>
              <p className="mt-3 max-w-[280px] text-[14px] leading-relaxed text-white/40">
                Automatically tracks tasks, syncs with GitHub, and keeps your
                bounties organized.
              </p>
            </div>

            {/* Feature list */}
            <div className="flex flex-col gap-3">
              {[
                'AI-powered status updates',
                'GitHub issue & PR tracking',
                'Inline-editable task table',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10">
                    <svg
                      className="h-3 w-3 text-violet-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <span className="text-[13px] text-white/50">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <p className="text-[12px] text-white/20">Powered by GitHub & AI</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col">
        {/* Mobile logo */}
        <div className="flex items-center gap-2.5 p-6 lg:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Tasker"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-lg font-semibold tracking-tight">Tasker</span>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
