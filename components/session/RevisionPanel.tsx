'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoRevision } from '@/lib/types';

interface RevisionPanelProps {
  sessionId: string;
  momentId: string;
  momentTitle: string;
}

const POLL_INTERVAL_MS = 5000;

function StatusPill({ status }: { status: VideoRevision['status'] }) {
  const map = {
    pending:    { label: 'Queued',      bg: 'bg-[#f5f3f1]',  text: 'text-[#777169]' },
    generating: { label: 'Generating…', bg: 'bg-[#fff8e1]',  text: 'text-[#b45309]' },
    ready:      { label: 'Ready',       bg: 'bg-[#e8f5e9]',  text: 'text-[#2e7d32]' },
    failed:     { label: 'Failed',      bg: 'bg-[#fce8e8]',  text: 'text-[#b71c1c]' },
  };
  const { label, bg, text } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${bg} ${text}`}>
      {status === 'generating' && (
        <span className="w-2 h-2 rounded-full bg-[#b45309] animate-pulse" />
      )}
      {label}
    </span>
  );
}

export default function RevisionPanel({ sessionId, momentId, momentTitle }: RevisionPanelProps) {
  const [revisions, setRevisions] = useState<VideoRevision[]>([]);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRevisions = useCallback(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/moments/${momentId}/revise`);
      if (!res.ok) return;
      const data = await res.json() as { revisions: VideoRevision[] };
      setRevisions(data.revisions);
    } catch {
      // silent — polling
    }
  }, [sessionId, momentId]);

  // Poll while any revision is in a non-terminal state
  useEffect(() => {
    const hasActiveJob = revisions.some(
      (r) => r.status === 'pending' || r.status === 'generating'
    );

    if (hasActiveJob && !pollRef.current) {
      pollRef.current = setInterval(fetchRevisions, POLL_INTERVAL_MS);
    }

    if (!hasActiveJob && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [revisions, fetchRevisions]);

  // Load revisions when panel is opened
  useEffect(() => {
    if (isOpen) fetchRevisions();
  }, [isOpen, fetchRevisions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/session/${sessionId}/moments/${momentId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });

      const data = await res.json() as { revision?: VideoRevision; error?: string };

      if (!res.ok || !data.revision) {
        setError(data.error ?? 'Failed to submit revision');
        return;
      }

      setRevisions((prev) => [...prev, data.revision!]);
      setFeedback('');
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[#e5e5e5] pt-3">
      {/* Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-[#777169] hover:text-black transition-colors"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        {revisions.length > 0
          ? `${revisions.length} revision${revisions.length !== 1 ? 's' : ''}`
          : 'Revise with AI feedback'}
      </button>

      {isOpen && (
        <div className="mt-3 space-y-4">
          {/* Feedback form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <label className="block text-xs font-medium text-[#777169] uppercase tracking-wide">
              Describe what to change
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={`e.g. "Make the atmosphere more dramatic with darker tones" or "Add more energy and movement to the visuals"`}
              maxLength={500}
              rows={3}
              className="w-full rounded-[12px] border border-[#e5e5e5] bg-white px-3 py-2.5 text-sm text-black
                placeholder:text-[#a59f97] focus:outline-none focus:border-black resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#a59f97]">{feedback.length}/500</span>
              <button
                type="submit"
                disabled={!feedback.trim() || submitting}
                className="px-4 py-2 rounded-[9999px] bg-black text-[#fdfcfc] text-sm font-medium
                  hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed
                  flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Submitting…
                  </>
                ) : 'Regenerate'}
              </button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </form>

          {/* Revision history */}
          {revisions.length > 0 && (
            <div className="space-y-3">
              {[...revisions].reverse().map((revision) => (
                <div
                  key={revision.id}
                  className="rounded-[12px] border border-[#e5e5e5] bg-[#f5f3f1] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-black flex-1">
                      <span className="font-medium text-[#a59f97]">v{revision.id} · </span>
                      {revision.feedback}
                    </p>
                    <StatusPill status={revision.status} />
                  </div>

                  {revision.status === 'generating' && (
                    <div className="flex items-center gap-2 text-xs text-[#a59f97]">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      RunwayML is processing your revision… (~1–2 min)
                    </div>
                  )}

                  {revision.status === 'ready' && (
                    <div className="space-y-2">
                      <video
                        src={`/api/session/${sessionId}/moments/${momentId}/revision/${revision.id}`}
                        controls
                        playsInline
                        className="w-full rounded-[8px] bg-black aspect-[9/16] max-h-64 object-contain"
                      />
                      <a
                        href={`/api/session/${sessionId}/moments/${momentId}/revision/${revision.id}`}
                        download={`${momentTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_v${revision.id}.mp4`}
                        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-[9999px]
                          border border-black text-black text-xs font-medium hover:bg-black hover:text-white transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        Download v{revision.id}
                      </a>
                    </div>
                  )}

                  {revision.status === 'failed' && (
                    <p className="text-xs text-red-600">{revision.error ?? 'Generation failed'}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
