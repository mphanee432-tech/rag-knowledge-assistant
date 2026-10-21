'use client';

import React, { useState } from 'react';
import { Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';

interface MessageActionsProps {
  interactionId?: string;
  content: string;
  className?: string;
}

const ISSUE_TAGS = [
  'Inaccurate Code',
  'Wrong Citation',
  'Incomplete Context',
  'Hallucination',
] as const;

export function MessageActions({
  interactionId,
  content,
  className = '',
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [activeRating, setActiveRating] = useState<'thumbs_up' | 'thumbs_down' | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const submitFeedback = async (rating: 'thumbs_up' | 'thumbs_down', issueTag?: string) => {
    if (!interactionId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interactionId,
          rating,
          issueTag: issueTag || null,
        }),
      });

      if (res.ok) {
        setActiveRating(rating);
        if (issueTag) setSelectedTag(issueTag);
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setSubmitting(false);
      setShowPopover(false);
    }
  };

  const handleThumbsDownClick = () => {
    if (activeRating === 'thumbs_down') {
      setShowPopover(!showPopover);
      return;
    }
    setShowPopover(true);
  };

  return (
    <div className={`relative mt-2 flex items-center gap-1.5 pt-1 text-xs text-muted-foreground ${className}`}>
      {/* Copy Action */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
        title="Copy response markdown"
        type="button"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-emerald-500">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>Copy</span>
          </>
        )}
      </button>

      {/* Thumbs Up Action */}
      <button
        onClick={() => submitFeedback('thumbs_up')}
        disabled={submitting || !interactionId}
        className={`flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted cursor-pointer ${
          activeRating === 'thumbs_up'
            ? 'bg-emerald-500/10 text-emerald-600 font-medium dark:text-emerald-400'
            : 'hover:text-foreground'
        } ${!interactionId ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={interactionId ? 'Helpful response' : 'Waiting for interaction ID...'}
        type="button"
      >
        <ThumbsUp className={`h-3.5 w-3.5 ${activeRating === 'thumbs_up' ? 'fill-current' : ''}`} />
        <span>Helpful</span>
      </button>

      {/* Thumbs Down Action */}
      <button
        onClick={handleThumbsDownClick}
        disabled={submitting || !interactionId}
        className={`flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted cursor-pointer ${
          activeRating === 'thumbs_down'
            ? 'bg-rose-500/10 text-rose-600 font-medium dark:text-rose-400'
            : 'hover:text-foreground'
        } ${!interactionId ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={interactionId ? 'Report issue' : 'Waiting for interaction ID...'}
        type="button"
      >
        <ThumbsDown className={`h-3.5 w-3.5 ${activeRating === 'thumbs_down' ? 'fill-current' : ''}`} />
        <span>Issue</span>
      </button>

      {selectedTag && (
        <span className="ml-1 inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
          {selectedTag}
        </span>
      )}

      {/* Categorical Issue Popover */}
      {showPopover && (
        <div className="absolute left-16 top-8 z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md outline-none">
          <div className="mb-2 text-[11px] font-semibold text-foreground">
            What went wrong?
          </div>
          <div className="flex flex-col gap-1.5">
            {ISSUE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => submitFeedback('thumbs_down', tag)}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted focus:bg-muted focus:outline-none cursor-pointer"
              >
                <span>{tag}</span>
                {selectedTag === tag && <Check className="h-3 w-3 text-rose-500" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowPopover(false)}
            className="mt-2 w-full text-center text-[10px] text-muted-foreground hover:underline cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
