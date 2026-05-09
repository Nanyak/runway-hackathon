'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Session, PipelineEvent, Moment, SessionStatus } from '@/lib/types';
import PipelineProgress from '@/components/session/PipelineProgress';
import MomentApproval from '@/components/session/MomentApproval';
import StoryboardReview from '@/components/session/StoryboardReview';
import VideoWorkspace from '@/components/session/VideoWorkspace';
import ThinkingPanel from '@/components/session/ThinkingPanel';
import SessionActions from '@/components/session/SessionActions';

// ── Step resolution ────────────────────────────────────────────────────────────

type StepIndex = 1 | 2 | 3 | 4;

function resolveStep(status: SessionStatus, hasAnyFrame: boolean): StepIndex {
  if (['uploading', 'transcribing', 'detecting'].includes(status)) return 1;
  if (status === 'awaiting_approval') return 2;
  if (
    status === 'awaiting_storyboard_review' ||
    (hasAnyFrame && !['generating_video', 'awaiting_feedback', 'complete'].includes(status))
  ) return 3;
  return 4;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [thinkingMessages, setThinkingMessages] = useState<string[]>([]);
  const [streamingThought, setStreamingThought] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set when API includes `listMeta` — user owns this session in SQLite. */
  const [listMeta, setListMeta] = useState<{ displayName: string | null } | null | undefined>(undefined);

  const refetchSession = useCallback(() => {
    fetch(`/api/session/${sessionId}`)
      .then((res) => res.json() as Promise<{ session: Session; listMeta?: { displayName: string | null } }>)
      .then((body) => {
        setSession(body.session);
        setListMeta('listMeta' in body && body.listMeta !== undefined ? body.listMeta : null);
      })
      .catch(() => undefined);
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    setListMeta(undefined);
    fetch(`/api/session/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Session not found (${res.status})`);
        return res.json() as Promise<{ session: Session; listMeta?: { displayName: string | null } }>;
      })
      .then((body) => {
        setSession(body.session);
        setEvents(body.session.events);
        setListMeta('listMeta' in body && body.listMeta !== undefined ? body.listMeta : null);
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

      if (event.type === 'storyboard_thinking') {
        const d = event.data as { message?: string; chunk?: string; streaming?: boolean };
        if (d.message) setThinkingMessages((prev) => [...prev, d.message!]);
        if (d.chunk !== undefined) {
          if (!d.streaming) {
            setStreamingThought('');
          } else {
            setStreamingThought((prev) => prev + d.chunk);
          }
        }
      }

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

  // ── Loading / error screens ──────────────────────────────────────────────────

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

  const hasAnyStoryboardFrame = events.some((e) => e.type === 'storyboard_frame_ready');
  const currentStep = resolveStep(session.status, hasAnyStoryboardFrame);

  const sessionFallbackLabel = session.config.showName
    ? `${session.config.showName}${session.config.speakerName ? ` · ${session.config.speakerName}` : ''}`
    : session.config.speakerName || 'Podcast session';

  // Show ThinkingPanel on Step 1 always, and Step 3 whenever there is thinking content
  const showThinking = currentStep === 1 || currentStep === 3;
  // ThinkingPanel collapses itself once storyboard frames start arriving
  const thinkingDone = hasAnyStoryboardFrame;

  return (
    <main className="min-h-screen bg-[#fdfcfc] flex flex-col">
      {/* Top bar */}
      <div className="border-b border-[#e5e5e5] bg-white px-6 py-4 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center gap-5">
          <button
            onClick={() => router.push('/')}
            className="text-[#777169] hover:text-black transition-colors flex-shrink-0"
            aria-label="Back to home"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 12H5M5 12l7-7M5 12l7 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Step indicator */}
          <StepIndicator current={currentStep} status={session.status} />

          <div className="ml-auto flex-shrink-0 flex items-center gap-2">
            {listMeta != null && (
              <SessionActions
                sessionId={sessionId}
                fallbackLabel={sessionFallbackLabel}
                displayName={listMeta.displayName}
                onDisplayNameChange={(name) => setListMeta({ displayName: name })}
              />
            )}
            <StatusBadge status={session.status} />
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {/* Step 1 — Analyzing */}
        {currentStep === 1 && (
          <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
            {session.status === 'error' ? (
              <div className="rounded-[16px] border border-red-200 bg-red-50 px-5 py-4">
                <p className="text-sm text-red-700 font-medium">Pipeline error</p>
                <p className="text-sm text-red-600 mt-1">{session.error ?? 'An unexpected error occurred.'}</p>
              </div>
            ) : (
              <>
                <div className="text-center mb-2">
                  <h2 className="text-xl font-medium text-black">Analyzing your podcast</h2>
                  <p className="text-sm text-[#777169] mt-1">Transcribing audio and detecting viral moments…</p>
                </div>
                <div
                  className="rounded-[16px] border border-[#e5e5e5] bg-white p-6"
                  style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
                >
                  <PipelineProgress status={session.status} events={events} />
                </div>
                <ThinkingPanel
                  messages={thinkingMessages}
                  streamingThought={streamingThought}
                  visible={showThinking}
                  done={false}
                />
              </>
            )}
          </div>
        )}

        {/* Step 2 — Select Moments */}
        {currentStep === 2 && session.moments && (
          <div className="max-w-3xl mx-auto px-6 py-8">
            <MomentApproval
              moments={session.moments}
              sessionId={sessionId}
              onApproved={refetchSession}
            />
          </div>
        )}

        {/* Step 3 — Review Storyboard */}
        {currentStep === 3 && approvedMoments.length > 0 && (
          <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
            <ThinkingPanel
              messages={thinkingMessages}
              streamingThought={streamingThought}
              visible={showThinking}
              done={thinkingDone}
            />
            <StoryboardReview
              moments={approvedMoments}
              sessionId={sessionId}
              events={events}
              storyboards={session.storyboards ?? {}}
              storyboardIterations={session.storyboardIterations ?? {}}
              orientation={session.config.orientation}
              onApproved={refetchSession}
            />
          </div>
        )}

        {/* Step 4 — Edit Video */}
        {currentStep === 4 && approvedMoments.length > 0 && (
          <div className="max-w-5xl mx-auto px-6 py-8">
            <VideoWorkspace
              moments={approvedMoments}
              sessionId={sessionId}
              events={events}
            />
          </div>
        )}
      </div>
    </main>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Analyze' },
  { n: 2, label: 'Select' },
  { n: 3, label: 'Storyboard' },
  { n: 4, label: 'Edit Video' },
] as const;

function StepIndicator({ current, status }: { current: StepIndex; status: SessionStatus }) {
  const isError = status === 'error';

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      {STEPS.map((step, idx) => {
        const done = !isError && step.n < current;
        const active = step.n === current;
        const error = isError && step.n === current;

        return (
          <div key={step.n} className="flex items-center gap-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Circle */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-xs font-medium flex-shrink-0 ${
                error   ? 'bg-red-50 border-red-400 text-red-500'
                : done  ? 'bg-black border-black text-white'
                : active ? 'bg-white border-black text-black'
                : 'bg-white border-[#e5e5e5] text-[#a59f97]'
              }`}>
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : active && !error ? (
                  <span className="w-2 h-2 rounded-full bg-black" />
                ) : (
                  step.n
                )}
              </div>
              {/* Label */}
              <span className={`text-xs font-medium whitespace-nowrap hidden sm:block ${
                active ? 'text-black' : done ? 'text-black' : 'text-[#a59f97]'
              }`}>
                {step.label}
              </span>
            </div>

            {/* Connector */}
            {idx < STEPS.length - 1 && (
              <div className={`h-px w-6 flex-shrink-0 mx-1 ${done ? 'bg-black' : 'bg-[#e5e5e5]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Partial<Record<string, string>> = {
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  detecting: 'Detecting',
  awaiting_approval: 'Waiting',
  awaiting_storyboard_review: 'Review',
  generating_video: 'Generating',
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
      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
