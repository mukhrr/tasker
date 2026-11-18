'use client';

const PILL =
  'mt-0.5 inline-flex h-4 flex-shrink-0 items-center rounded px-1 text-[10px] font-semibold leading-none';
const ON =
  'bg-amber-400/15 text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-300';

// Without onChange it is a label: shown only when the task is a review.
export function ReviewerBadge({
  isReviewer,
  onChange,
}: {
  isReviewer: boolean | null;
  onChange?: (value: boolean) => void;
}) {
  const on = isReviewer === true;
  if (!onChange) {
    return on ? (
      <span className={`${PILL} ${ON}`} title="You are the reviewer (C+)">
        C+
      </span>
    ) : null;
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Remove the C+ badge' : 'Mark as a C+ review'}
      title={on ? 'You are the reviewer (C+). Click to remove.' : 'Mark as C+'}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`${PILL} transition-opacity ${
        on
          ? ON
          : 'text-muted-foreground opacity-0 ring-1 ring-border hover:text-foreground focus-visible:opacity-100 group-hover/issue-cell:opacity-100 [@media(hover:none)]:opacity-60'
      }`}
    >
      C+
    </button>
  );
}
