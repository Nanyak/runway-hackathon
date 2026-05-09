'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Session, PipelineEvent, Moment } from '@/lib/types';
import PipelineProgress from '@/components/session/PipelineProgress';
import MomentApproval from '@/components/session/MomentApproval';
import StoryboardReview from '@/components/session/StoryboardReview';
import VideoWorkspace from '@/components/session/VideoWorkspace';
import RunwayStackCallout from '@/components/session/RunwayStackCallout';

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchSession = useCallback(() => {
    fetch(`/api/session/${sessionId}`)
      .then((res) => res.json() as Promise<{ session: Session }>)
      .then(({ session: s }) => setSession(s))
      .catch(() => undefined);
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    fetch(`/api/session/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Session not found (${res.status})`);
        return res.json() as Promise<{ session: Session }>;
      })
      .then(({ session: s }) => {
        setSession(s);
        setEvents(s.events);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [sessionId]);

  // SSE stream
  useEffect(() => {
    const es = new EventSource(`/api/session/${sessionId}/stream`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as PipelineEvent;

      setEvents((prev) => {
        if (prev.find((p) => p.id === event.id)) return prev;
        return [...prev, event];
      });

      // Re-fetch session on state-changing events
      if (
        event.type === 'gate' ||
        event.type === 'complete' ||
        event.type === 'error' ||
        event.type === 'moment_detected' ||
        event.type === 'video_ready' ||
        event.type === 'render_complete' ||
        event.type === 'storyboard_ready'
      ) {
        refetchSession();
      }
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [sessionId, refetchSession]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fdfcfc] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-black border-t-transparent animate-spin" />
      </main>
    );
  }

  if (error || !session) {
    return (
      <main className="min-h-screen bg-[#fdfcfc] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-[#777169]">{error ?? 'Session not found'}</p>
          <button onClick={() => router.push('/')} className="text-sm text-black underline">
            Go back
          </button>
        </div>
      </main>
    );
  }

  const approvedMoments: Moment[] = session.moments?.filter(
    (m) => session.approvedMomentIds?.includes(m.id)
  ) ?? [];

  // Determine which statuses should show the VideoWorkspace
  const showVideoWorkspace =
    session.status === 'generating_video' ||
    session.status === 'awaiting_feedback' ||
    session.status === 'complete';

  // Gate 1.5: show storyboard review as soon as any sheet is ready (progressive display)
  const hasAnyStoryboardFrame = events.some((e) => e.type === 'storyboard_frame_ready');
  const showFramePicker =
    session.status === 'awaiting_storyboard_review' || hasAnyStoryboardFrame;

  return (
    <main className="min-h-screen bg-[#fdfcfc]">
      {/* Top bar */}
      <div className="border-b border-[#e5e5e5] bg-white px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push('/')}
          className="text-[#777169] hover:text-black transition-colors"
          aria-label="Back to home"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div>
          <p className="text-xs text-[#a59f97] font-mono">
            Session {sessionId.slice(0, 8)}…
          </p>
        </div>
        {/* Live status badge */}
        <div className="ml-auto">
          <StatusBadge status={session.status} />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Pipeline progress — always visible */}
        <div
          className="rounded-[16px] border border-[#e5e5e5] bg-white p-6"
          style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
        >
          <h2 className="text-sm font-medium text-[#777169] uppercase tracking-wider mb-5">Pipeline</h2>
          <PipelineProgress status={session.status} events={events} />
          <div className="mt-5 pt-4 border-t border-[#e5e5e5]">
            <RunwayStackCallout />
          </div>
        </div>

        {/* Error banner */}
        {session.status === 'error' && (
          <div className="rounded-[16px] border border-red-200 bg-red-50 px-5 py-4">
            <p className="text-sm text-red-700 font-medium">Pipeline error</p>
            <p className="text-sm text-red-600 mt-1">{session.error ?? 'An unexpected error occurred.'}</p>
          </div>
        )}

        {/* Gate 1: Moment approval */}
        {session.status === 'awaiting_approval' && session.moments && (
          <MomentApproval
            moments={session.moments}
            sessionId={sessionId}
            onApproved={refetchSession}
          />
        )}

        {/* Gate 1.5: Storyboard review */}
        {showFramePicker && approvedMoments.length > 0 && (
          <StoryboardReview
            moments={approvedMoments}
            sessionId={sessionId}
            events={events}
            storyboards={session.storyboards ?? {}}
            storyboardIterations={session.storyboardIterations ?? {}}
            orientation={session.config.orientation}
            onApproved={refetchSession}
          />
        )}

        {/* Video studio: generating + feedback loop */}
        {showVideoWorkspace && approvedMoments.length > 0 && (
          <VideoWorkspace
            moments={approvedMoments}
            sessionId={sessionId}
            events={events}
          />
        )}
      </div>
    </main>
  );
}

// ── Tiny status badge ──────────────────────────────────────────────────────────

const STATUS_LABELS: Partial<Record<string, string>> = {
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  detecting: 'Detecting moments',
  awaiting_approval: 'Awaiting approval',
  awaiting_storyboard_review: 'Storyboard review',
  generating_video: 'Generating videos',
  awaiting_feedback: 'Ready',
  complete: 'Complete',
  error: 'Error',
};

function StatusBadge({ status }: { status: string }) {
  const isActive = !['awaiting_approval', 'awaiting_storyboard_review', 'awaiting_feedback', 'complete', 'error'].includes(status);
  const isError = status === 'error';
  const isDone = status === 'complete' || status === 'awaiting_feedback';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      isError ? 'bg-red-100 text-red-700'
      : isDone ? 'bg-green-100 text-green-700'
      : 'bg-[#f5f3f1] text-[#777169]'
    }`}>
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
