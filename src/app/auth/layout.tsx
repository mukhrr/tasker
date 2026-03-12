import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Left decorative panel */}
      <div className="relative hidden w-[45%] overflow-hidden bg-[#0a0a0f] lg:flex lg:flex-col lg:justify-between">
        {/* Animated dot grid */}
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(139,92,246,0.8) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        {/* Gradient mesh overlay */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 20% 50%, rgba(139,92,246,0.12) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.08) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(168,85,247,0.06) 0%, transparent 50%)',
          }}
        />

        {/* Animated floating lines */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.07]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1="30%"
            x2="100%"
            y2="35%"
            stroke="url(#line-grad)"
            strokeWidth="1"
            className="animate-[drift_12s_ease-in-out_infinite]"
          />
          <line
            x1="0"
            y1="55%"
            x2="100%"
            y2="50%"
            stroke="url(#line-grad)"
            strokeWidth="1"
            className="animate-[drift_15s_ease-in-out_infinite_reverse]"
          />
          <line
            x1="0"
            y1="75%"
            x2="100%"
            y2="78%"
            stroke="url(#line-grad)"
            strokeWidth="1"
            className="animate-[drift_18s_ease-in-out_infinite]"
          />
        </svg>

        {/* Content */}
        <div className="relative z-10 p-10">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/20 backdrop-blur-sm">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-violet-400"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-white/90">
              Tasker
            </span>
          </Link>
        </div>

        {/* Center stats */}
        <div className="relative z-10 flex flex-col gap-5 px-10">
          {/* Floating stat cards */}
          <div className="flex gap-4">
            <div className="rounded-xl border border-white/6 bg-white/3 px-5 py-4 backdrop-blur-md">
              <p className="font-mono text-2xl font-bold tracking-tight text-white/90">
                2.4k+
              </p>
              <p className="mt-0.5 text-[13px] text-white/40">
                Tasks tracked
              </p>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/3 px-5 py-4 backdrop-blur-md">
              <p className="font-mono text-2xl font-bold tracking-tight text-white/90">
                $180k
              </p>
              <p className="mt-0.5 text-[13px] text-white/40">
                Total distributed
              </p>
            </div>
          </div>
          <div className="max-w-[320px]">
            <h2 className="text-[22px] leading-snug font-semibold tracking-tight text-white/80">
              Track tasks.
              <br />
              Ship faster.
              <br />
              <span className="text-violet-400/80">Get rewarded.</span>
            </h2>
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10 p-10">
          <p className="text-[13px] leading-relaxed text-white/25">
            Open source task tracking
            <br />
            powered by GitHub
          </p>
        </div>

        {/* Bottom gradient fade */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-[#0a0a0f] to-transparent" />
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col">
        {/* Mobile logo */}
        <div className="flex items-center gap-2.5 p-6 lg:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-violet-500"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Tasker
            </span>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
