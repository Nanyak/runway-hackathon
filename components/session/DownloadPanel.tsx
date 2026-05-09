'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Moment, PipelineEvent, VideoRevision } from '@/lib/types';

interface DownloadPanelProps {
  moments: Moment[];
  sessionId: string;
  events: PipelineEvent[];
}

const MOOD_COLORS: Record<Moment['mood'], string> = {
  inspiring: 'bg-blue-100 text-blue-700',
  funny: 'bg-orange-100 text-orange-700',
  educational: 'bg-green-100 text-green-700',
  controversial: 'bg-red-100 text-red-700',
  emotional: 'bg-purple-100 text-purple-700',
};

function formatDuration(startSec: number, endSec: number): string {
  const secs = Math.round(endSec - startSec);
  return `${secs}s`;
}

// ── Per-moment video editor ────────────────────────────────────────────────────

interface VideoEditorCardProps {
  moment: Moment;
  sessionId: string;
  isRendered: boolean;
}

function VideoEditorCard({ moment, sessionId, isRendered }: VideoEditorCardProps) {
  const [revisions, setRevisions] = useState<VideoRevision[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<'original' | string>('original');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRevisions = useCallback(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/moments/${moment.id}/revise`);
      if (!res.ok) return;
      const data = await res.json() as { revisions: VideoRevision[] };
      setRevisions(data.revisions);
    } catch { /* silent */ }
  }, [sessionId, moment.id]);

  // Poll while any revision is generating
  useEffect(() => {
    const hasActive = revisions.some(r => r.status === 'pending' || r.status === 'generating');
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(fetchRevisions, 4000);
    }
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [revisions, fetchRevisions]);

  useEffect(() => {
    if (isRendered) fetchRevisions();
  }, [isRendered, fetchRevisions]);

  // Auto-select latest ready revision
  useEffect(() => {
    const latestReady = [...revisions].reverse().find(r => r.status === 'ready');
    if (latestReady) setSelectedVersion(latestReady.id);
  }, [revisions]);

  const currentVideoSrc = selectedVersion === 'original'
    ? `/api/download/${sessionId}/${moment.id}`
    : `/api/session/${sessionId}/moments/${moment.id}/revision/${selectedVersion}`;

  const selectedRevision = revisions.find(r => r.id === selectedVersion);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/moments/${moment.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await res.json() as { revision?: VideoRevision; error?: string };
      if (!res.ok || !data.revision) { setError(data.error ?? 'Failed to submit'); return; }
      setRevisions(prev => [...prev, data.revision!]);
      setSelectedVersion(data.revision!.id);
      setFeedback('');
    } catch { setError('Network error — please try again'); }
    finally { setSubmitting(false); }
  }

  const downloadFilename = `${moment.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${selectedVersion !== 'original' ? `_v${selectedVersion}` : ''}.mp4`;

  return (
    <div
      className="rounded-[20px] border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.06) 0px 4px 12px' }}
    >
      <div className="flex flex-col lg:flex-row">

        {/* ── Left: Video player ── */}
        <div className="lg:w-64 xl:w-72 flex-shrink-0 bg-black flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-[180px] aspect-[9/16] bg-[#111] rounded-[12px] overflow-hidden relative">
            {isRendered ? (
              <video
                ref={videoRef}
                key={currentVideoSrc}
                src={currentVideoSrc}
                controls
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto" />
                  <p className="text-xs text-white/50">Rendering…</p>
                </div>
              </div>
            )}
          </div>

          {/* Version selector below video */}
          {revisions.length > 0 && (
            <div className="mt-3 flex gap-1.5 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => setSelectedVersion('original')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedVersion === 'original'
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                Original
              </button>
              {revisions.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => r.status === 'ready' && setSelectedVersion(r.id)}
                  disabled={r.status !== 'ready'}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors relative ${
                    selectedVersion === r.id
                      ? 'bg-white text-black'
                      : r.status === 'ready'
                        ? 'bg-white/10 text-white/60 hover:bg-white/20'
                        : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  v{r.id}
                  {(r.status === 'pending' || r.status === 'generating') && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Editor controls ── */}
        <div className="flex-1 p-5 flex flex-col gap-4">

          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-semibold text-base text-black leading-snug">{moment.title}</h3>
              <a
                href={currentVideoSrc}
                download={downloadFilename}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#e5e5e5]
                  text-xs font-medium text-[#777169] hover:border-black hover:text-black transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download
              </a>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MOOD_COLORS[moment.mood]}`}>
                {moment.mood}
              </span>
              <span className="text-xs text-[#a59f97]">{formatDuration(moment.startSec, moment.endSec)}</span>
              {selectedVersion !== 'original' && (
                <span className="text-xs text-[#a59f97]">· Viewing v{selectedVersion}</span>
              )}
            </div>
          </div>

          {/* Currently viewing info */}
          {selectedVersion !== 'original' && selectedRevision && (
            <div className="rounded-[10px] bg-[#f5f3f1] px-3 py-2.5">
              <p className="text-xs text-[#777169] font-medium mb-0.5">Version {selectedRevision.id} feedback</p>
              <p className="text-sm text-black">{selectedRevision.feedback}</p>
            </div>
          )}

          {/* Revision history */}
          {revisions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-[#a59f97] uppercase tracking-wide font-medium">History</p>
              {revisions.map(r => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 p-2.5 rounded-[10px] cursor-pointer transition-colors ${
                    selectedVersion === r.id ? 'bg-[#f5f3f1]' : 'hover:bg-[#f9f8f7]'
                  }`}
                  onClick={() => r.status === 'ready' && setSelectedVersion(r.id)}
                >
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#e5e5e5] flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-[#777169]">v{r.id}</span>
                  </div>
                  <p className="flex-1 text-xs text-black line-clamp-1">{r.feedback}</p>
                  <span className={`flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    r.status === 'ready' ? 'bg-green-100 text-green-700' :
                    r.status === 'generating' ? 'bg-amber-100 text-amber-700' :
                    r.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-[#f5f3f1] text-[#a59f97]'
                  }`}>
                    {r.status === 'generating' ? 'Generating…' : r.status === 'ready' ? 'Ready' : r.status === 'failed' ? 'Failed' : 'Queued'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* AI edit form */}
          {isRendered && (
            <form onSubmit={handleSubmit} className="space-y-2 border-t border-[#e5e5e5] pt-4">
              <p className="text-xs font-medium text-black">Edit with AI</p>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder='e.g. "Make it darker and more dramatic" or "Add warm cinematic lighting"'
                maxLength={500}
                rows={2}
                className="w-full rounded-[10px] border border-[#e5e5e5] bg-[#f9f8f7] px-3 py-2 text-sm text-black
                  placeholder:text-[#a59f97] focus:outline-none focus:border-black focus:bg-white resize-none transition-colors"
              />
              <div className="flex items-center justify-between gap-3">
                {error
                  ? <p className="text-xs text-red-600 flex-1">{error}</p>
                  : <p className="text-xs text-[#a59f97] flex-1">{feedback.length}/500</p>
                }
                <button
                  type="submit"
                  disabled={!feedback.trim() || submitting}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-xs
                    font-semibold hover:opacity-80 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Sending…</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v10m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 17h14" strokeLinecap="round"/></svg>Generate New Version</>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function DownloadPanel({ moments, sessionId, events }: DownloadPanelProps) {
  const renderedIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'render_complete' && typeof e.data.momentId === 'string') {
      renderedIds.add(e.data.momentId);
    }
  }

  const displayMoments = moments.length > 0 ? moments : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-black">Video Studio</h2>
        <span className="text-xs text-[#a59f97]">
          {displayMoments.length} clip{displayMoments.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-5">
        {displayMoments.map(moment => (
          <VideoEditorCard
            key={moment.id}
            moment={moment}
            sessionId={sessionId}
            isRendered={renderedIds.has(moment.id)}
          />
        ))}
      </div>

      {/* Batch download */}
      {displayMoments.length > 1 && (
        <div className="text-center">
          <a
            href={`/api/download/${sessionId}/zip`}
            download={`clips_${sessionId.slice(0, 8)}.zip`}
            className="text-xs text-[#a59f97] hover:text-black transition-colors underline underline-offset-2"
          >
            Download all as ZIP
          </a>
        </div>
      )}
    </div>
  );
}
