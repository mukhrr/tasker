'use client';

export function Background({
  transform,
}: {
  transform: (speed: number) => string;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(139,92,246,0.9) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        className="absolute -top-[40%] left-[20%] h-[80vh] w-[80vh] rounded-full opacity-[0.06] blur-[120px] will-change-transform dark:opacity-[0.10]"
        style={{
          background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
          transform: transform(-0.15),
        }}
      />
      <div
        className="absolute -bottom-[20%] right-[10%] h-[60vh] w-[60vh] rounded-full opacity-[0.04] blur-[100px] will-change-transform dark:opacity-[0.08]"
        style={{
          background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          transform: transform(-0.08),
        }}
      />
      <div
        className="absolute top-[50%] -left-[10%] h-[50vh] w-[50vh] rounded-full opacity-[0.03] blur-[90px] will-change-transform dark:opacity-[0.06]"
        style={{
          background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)',
          transform: transform(-0.12),
        }}
      />
      <div
        className="absolute top-[20%] right-[30%] h-[40vh] w-[40vh] rounded-full opacity-[0.03] blur-[100px] will-change-transform dark:opacity-[0.05]"
        style={{
          background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)',
          transform: transform(-0.2),
        }}
      />
    </div>
  );
}

export function FloatingLines({
  transform,
}: {
  transform: (speed: number) => string;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.03] will-change-transform dark:opacity-[0.05]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ transform: transform(-0.05) }}
    >
      <defs>
        <linearGradient
          id="landing-line-grad"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="0%"
        >
          <stop offset="0%" stopColor="transparent" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        y1="18%"
        x2="100%"
        y2="22%"
        stroke="url(#landing-line-grad)"
        strokeWidth="1"
        className="animate-[drift_14s_ease-in-out_infinite]"
      />
      <line
        x1="0"
        y1="45%"
        x2="100%"
        y2="42%"
        stroke="url(#landing-line-grad)"
        strokeWidth="1"
        className="animate-[drift_18s_ease-in-out_infinite_reverse]"
      />
      <line
        x1="0"
        y1="72%"
        x2="100%"
        y2="75%"
        stroke="url(#landing-line-grad)"
        strokeWidth="1"
        className="animate-[drift_22s_ease-in-out_infinite]"
      />
    </svg>
  );
}
