'use client';

import { useState, useRef, useEffect } from 'react';
import { HighlightText } from '../highlight-text';

const TRUNCATE_LENGTH = 80;

export function NoteCell({
  value,
  onChange,
  highlight,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  highlight?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = value ?? '';
  const isTruncatable = text.length > TRUNCATE_LENGTH;

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const newValue = trimmed || null;
    // Only save if actually changed
    if (newValue !== value) {
      onChange(newValue);
    }
  };

  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') {
              cancel();
            }
          }}
          onBlur={cancel}
          rows={3}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add a note..."
        />
        <p className="text-xs text-muted-foreground">
          Enter to save · Shift+Enter for new line · Esc to cancel
        </p>
      </div>
    );
  }

  if (!text) {
    return (
      <span
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
        className="cursor-pointer text-sm text-muted-foreground"
      >
        —
      </span>
    );
  }

  const displayText =
    !expanded && isTruncatable ? text.slice(0, TRUNCATE_LENGTH) + '…' : text;

  return (
    <div className="group/note">
      <span
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
        className="cursor-pointer whitespace-pre-wrap text-sm text-foreground"
      >
        <HighlightText text={displayText} query={highlight ?? ''} />
      </span>
      {isTruncatable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="ml-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {expanded ? 'show less' : 'more'}
        </button>
      )}
    </div>
  );
}
