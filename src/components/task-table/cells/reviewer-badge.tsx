'use client';

// Shown only when the task is a review.
export function ReviewerBadge({ isReviewer }: { isReviewer: boolean | null }) {
  if (isReviewer !== true) return null;
  return (
    <span
      className="inline-flex h-4 flex-shrink-0 items-center rounded px-1 text-[10px] font-semibold leading-none bg-amber-400/15 text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-300"
      title="You are the reviewer (C+)"
    >
      C+
    </span>
  );
}
