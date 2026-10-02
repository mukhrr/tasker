'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { HighlightText } from '../highlight-text';
import { shortenGitHubUrl, normalizeUrl } from '@/lib/github';
import { ExternalLink, Pencil } from 'lucide-react';

export function IssueCell({
  issueUrl,
  issueTitle,
  onChange,
  highlight,
}: {
  issueUrl: string;
  issueTitle: string | null;
  onChange: (title: string | null) => void;
  highlight?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issueTitle ?? '');
  const [titleExpanded, setTitleExpanded] = useState(false);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    onChange(trimmed || null);
  };

  const TRUNCATE_LENGTH = 80;
  const titleText = issueTitle || shortenGitHubUrl(issueUrl);
  const isTitleTruncatable = titleText.length > TRUNCATE_LENGTH;
  const displayTitle =
    !titleExpanded && isTitleTruncatable
      ? titleText.slice(0, TRUNCATE_LENGTH) + '\u2026'
      : titleText;

  if (editing) {
    return (
      <div>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(issueTitle ?? '');
              setEditing(false);
            }
          }}
          className="h-8 text-sm"
          placeholder="Issue title"
        />
        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {shortenGitHubUrl(issueUrl)}
        </div>
      </div>
    );
  }

  return (
    <div className="group/issue-cell">
      <div className="flex items-start gap-1">
        <span
          onClick={() => {
            setDraft(issueTitle ?? '');
            setEditing(true);
          }}
          className="cursor-pointer text-sm font-medium text-foreground hover:text-primary"
        >
          <HighlightText text={displayTitle} query={highlight ?? ''} />
        </span>
        <a
          href={normalizeUrl(issueUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 flex-shrink-0 text-muted-foreground opacity-100 transition-opacity hover:text-foreground sm:opacity-0 sm:group-hover/issue-cell:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
        <button
          onClick={() => {
            setDraft(issueTitle ?? '');
            setEditing(true);
          }}
          className="mt-0.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/issue-cell:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {isTitleTruncatable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setTitleExpanded(!titleExpanded);
          }}
          className="ml-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {titleExpanded ? 'show less' : 'more'}
        </button>
      )}
      {issueTitle && (
        <div className="line-clamp-1 text-xs text-muted-foreground">
          <HighlightText
            text={shortenGitHubUrl(issueUrl)}
            query={highlight ?? ''}
          />
        </div>
      )}
    </div>
  );
}
