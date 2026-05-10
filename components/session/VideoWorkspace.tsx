'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Moment, PipelineEvent, VideoRevision } from '@/lib/types';
import VideoRevisionThumb from '@/components/session/VideoRevisionThumb';

interface VideoWorkspaceProps {
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


// ── Per-moment video card ──────────────────────────────────────────────────────

interface VideoCardProps {
  moment: Moment;
  sessionId: string;
  videoReady: boolean;
  finalized: boolean;
  downloadUrl?: string;
  videoError?: string;
}

function VideoCard({ moment, sessionId, videoReady, finalized, downloadUrl, videoError }: VideoCardProps) {
  const [revisions, setRevisions] = useState<VideoRevision[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<'original' | string>('original');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRevisions = useCallback(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/moments/${moment.id}/revise`);
      if (!res.ok) return;
      const data = await res.json() as { revisions: VideoRevision[] };
      setRevisions(data.revisions);
    } catch { /* silent */ }
  }, [sessionId, moment.id]);

  // Poll while any revision is in-flight. SSE only emits video_ready for the initial Runway
  // generation — individual revision status (pending → generating → ready/failed) is not
  // surfaced through the SSE stream, so we must poll this endpoint directly.
  useEffect(() => {
    const hasActive = revisions.some((r) => r.status === 'pending' || r.status === 'generating');
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
    if (videoReady) fetchRevisions();
  }, [videoReady, fetchRevisions]);

  useEffect(() => {
    if (finalized) setFinalizing(false);
  }, [finalized]);

  // Auto-select latest ready revision
  useEffect(() => {
    const latestReady = [...revisions].reverse().find((r) => r.status === 'ready');
    if (latestReady) setSelectedVersion(latestReady.id);
  }, [revisions]);

  // Determine current video source
  const rawVideoSrc = `/api/session/${sessionId}/video/${moment.id}`;
  const selectedRevision = revisions.find((r) => r.id === selectedVersion);
  const revisionSrc =
    selectedVersion !== 'original'
      ? `/api/session/${sessionId}/moments/${moment.id}/revision/${selectedVersion}`
      : null;
  const currentVideoSrc: string | null =
    selectedVersion === 'original'
      ? rawVideoSrc
      : selectedRevision?.status === 'ready' && revisionSrc !== null
        ? revisionSrc
        : null;
  const revisionFailed =
    selectedVersion !== 'original' && selectedRevision?.status === 'failed';
  const revisionInFlight =
    selectedVersion !== 'original' &&
    selectedRevision !== undefined &&
    (selectedRevision.status === 'pending' || selectedRevision.status === 'generating');
  const clipDownloadHref =
    videoReady &&
    currentVideoSrc !== null &&
    !revisionFailed &&
    !revisionInFlight
      ? `${currentVideoSrc}?download=1`
      : null;
  const duration = Math.round(moment.endSec - moment.startSec);

  async function handleFeedback(e: React.FormEvent) {
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
      if (!res.ok || !data.revision) throw new Error(data.error ?? 'Failed');
      setRevisions((prev) => [...prev, data.revision!]); // ! justified: checked above
      // Select the new revision so pills reflect it; player shows a loading state until Runway finishes.
      setSelectedVersion(data.revision.id);
      setFeedback('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/retry-video/${moment.id}`, {
        method: 'POST',
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Retry failed');
      // Stay in retrying state — video_ready SSE event will eventually arrive
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
      setRetrying(false);
    }
  }

  async function handleFinalize() {
    if (finalizing || finalized || currentVideoSrc === null || revisionFailed) return;
    setFinalizing(true);
    setError(null);
    try {
      const body =
        selectedVersion === 'original' ? {} : { revisionId: selectedVersion };
      const res = await fetch(`/api/session/${sessionId}/finalize/${moment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Finalize failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
      setFinalizing(false);
    }
  }

  const downloadFilename = `${moment.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;

  return (
    <div
      className="rounded-[20px] border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.06) 0px 4px 12px' }}
    >
      <div className="flex flex-col lg:flex-row lg:items-start">

        {/* ── Left: Video player (wide column — was capped at 180px) ── */}
        <div
          className="w-full lg:w-[min(100%,440px)] xl:w-[min(100%,500px)] 2xl:w-[min(100%,540px)] flex-shrink-0
            bg-black flex flex-col items-center justify-center p-5 sm:p-6 lg:self-start"
        >
          <div className="w-full max-w-[min(100%,380px)] sm:max-w-[420px] lg:max-w-none aspect-[9/16] bg-[#111] rounded-[12px] overflow-hidden relative mx-auto lg:mx-0">
            {videoReady ? (
              revisionFailed ? (
                <div className="w-full h-full flex items-center justify-center px-4">
                  <p className="text-xs text-center text-red-300">
                    {selectedRevision?.error ?? 'Revision failed. Try another prompt.'}
                  </p>
                </div>
              ) : revisionInFlight || currentVideoSrc === null ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center space-y-2 px-2">
                    <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin mx-auto" />
                    <p className="text-xs text-white/50">Runway is refining this version…</p>
                    <p className="text-[10px] text-white/35">Usually 1–3 min</p>
                  </div>
                </div>
              ) : (
                <video
                  src={currentVideoSrc}
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              )
            ) : videoError && !retrying ? (
              /* Content moderation / generation error — user can retry */
              <div className="w-full h-full flex items-center justify-center px-5">
                <div className="text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M9 6v4M9 12.5h.01" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="9" cy="9" r="7.5" stroke="#f87171" strokeWidth="1.3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/80">Video blocked</p>
                    <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                      {/content.moderation|blocked/i.test(videoError)
                        ? 'Content policy blocked this generation.'
                        : 'Generation failed.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors border border-white/20"
                  >
                    Retry generation
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin mx-auto" />
                  <p className="text-xs text-white/40">{retrying ? 'Retrying…' : 'Generating…'}</p>
                </div>
              </div>
            )}
          </div>


          {/* Version thumbnails (first frame) */}
          {(videoReady || revisions.length > 0) && (
            <div className="mt-3 flex gap-2 overflow-x-auto justify-center max-w-full pb-1 px-1">
              <VideoRevisionThumb
                src={videoReady ? rawVideoSrc : null}
                label="v0"
                selected={selectedVersion === 'original'}
                disabled={!videoReady}
                placeholder={!videoReady}
                onClick={() => {
                  if (videoReady) setSelectedVersion('original');
                }}
              />
              {revisions.map((r, i) => {
                const ready = r.status === 'ready';
                const revSrc = ready
                  ? `/api/session/${sessionId}/moments/${moment.id}/revision/${r.id}`
                  : null;
                return (
                  <VideoRevisionThumb
                    key={r.id}
                    src={revSrc}
                    label={`v${i + 1}`}
                    selected={selectedVersion === r.id}
                    disabled={!ready}
                    placeholder={!ready}
                    onClick={() => {
                      if (ready) setSelectedVersion(r.id);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: Controls ── */}
        <div className="flex-1 p-5 flex flex-col gap-4 min-h-[280px]">

          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-semibold text-base text-black leading-snug">{moment.title}</h3>
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                {clipDownloadHref && (
                  <a
                    href={clipDownloadHref}
                    download={downloadFilename}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#e5e5e5] text-black
                      text-xs font-medium hover:border-black hover:bg-[#f9f8f7] transition-colors"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Download clip
                  </a>
                )}
                {finalized && downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={downloadFilename}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white
                      text-xs font-medium hover:opacity-80 transition-opacity"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Final MP4
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MOOD_COLORS[moment.mood]}`}>
                {moment.mood}
              </span>
              <span className="text-xs text-[#a59f97]">{duration}s</span>
              {selectedVersion !== 'original' && (
                <span className="text-xs text-[#a59f97]">· v{selectedVersion}</span>
              )}
            </div>
          </div>

          {/* Viewing revision feedback */}
          {selectedVersion !== 'original' && selectedRevision && (
            <div className="rounded-[10px] bg-[#f5f3f1] px-3 py-2.5">
              <p className="text-xs text-[#777169] font-medium mb-0.5">Feedback used</p>
              <p className="text-sm text-black">{selectedRevision.feedback}</p>
            </div>
          )}

          {/* Revision history */}
          {revisions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-[#a59f97] uppercase tracking-wide font-medium">History</p>
              {revisions.map((r) => (
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
                    r.status === 'ready' ? 'bg-green-100 text-green-700'
                    : r.status === 'generating' ? 'bg-amber-100 text-amber-700'
                    : r.status === 'failed' ? 'bg-red-100 text-red-700'
                    : 'bg-[#f5f3f1] text-[#a59f97]'
                  }`}>
                    {r.status === 'generating' ? 'Generating…'
                      : r.status === 'ready' ? 'Ready'
                      : r.status === 'failed' ? 'Failed'
                      : 'Queued'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {/* Feedback + Finalize */}
          {videoReady && !finalized && (
            <div className="space-y-3 border-t border-[#e5e5e5] pt-4">
              {/* AI feedback form */}
              <form onSubmit={handleFeedback} className="space-y-2">
                <p className="text-xs font-medium text-black">Refine with AI</p>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder='e.g. "Make the lighting warmer and more cinematic" or "Change to a night scene"'
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-[10px] border border-[#e5e5e5] bg-[#f9f8f7] px-3 py-2 text-sm
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
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full border border-[#e5e5e5]
                      text-black text-xs font-semibold hover:border-black hover:bg-[#f5f3f1] transition-all
                      disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Generating…' : 'New version'}
                  </button>
                </div>
              </form>

              {/* Finalize CTA */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#e5e5e5]" />
                <span className="text-xs text-[#a59f97]">or</span>
                <div className="flex-1 h-px bg-[#e5e5e5]" />
              </div>

              <button
                type="button"
                onClick={handleFinalize}
                disabled={finalizing || currentVideoSrc === null || revisionFailed}
                className="w-full py-2.5 rounded-[9999px] bg-black text-white text-sm font-medium
                  disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {finalizing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Saving…
                  </span>
                ) : 'Save as final'}
              </button>
              <p className="text-xs text-center text-[#a59f97]">
                Saves the version you are watching (v0 or the selected revision) to your final file for download and zip exports.
              </p>
            </div>
          )}

          {/* Finalized state */}
          {finalized && (
            <div className="rounded-[12px] bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#16a34a" opacity="0.15"/>
                <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="flex-1">
                <p className="text-xs font-semibold text-green-800">Final video ready</p>
                {downloadUrl && (
                  <a href={downloadUrl} download={downloadFilename}
                    className="text-xs text-green-700 underline underline-offset-2 hover:text-green-900">
                    Download MP4
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main VideoWorkspace ────────────────────────────────────────────────────────

export default function VideoWorkspace({ moments, sessionId, events }: VideoWorkspaceProps) {
  // Track which moments have their video ready, errored, and which are finalized
  const videoReadyIds = new Set<string>();
  const videoErrors: Record<string, string> = {};
  const finalizedIds = new Set<string>();
  const downloadUrls: Record<string, string> = {};

  for (const e of events) {
    if (e.type === 'video_ready' && typeof e.data.momentId === 'string') {
      videoReadyIds.add(e.data.momentId);
      // Clear any prior error once video succeeds (e.g. after a retry)
      delete videoErrors[e.data.momentId];
    }
    if (e.type === 'video_error' && typeof e.data.momentId === 'string') {
      // Only record error if the video hasn't succeeded yet
      if (!videoReadyIds.has(e.data.momentId)) {
        videoErrors[e.data.momentId] = typeof e.data.message === 'string' ? e.data.message : 'Generation failed';
      }
    }
    if (e.type === 'render_complete' && typeof e.data.momentId === 'string') {
      finalizedIds.add(e.data.momentId);
      if (typeof e.data.downloadUrl === 'string') {
        downloadUrls[e.data.momentId] = e.data.downloadUrl;
      }
    }
  }

  const readyCount = videoReadyIds.size;
  const errorCount = Object.keys(videoErrors).length;
  const totalCount = moments.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-black">Video Studio</h2>
          <p className="text-sm text-[#777169] mt-0.5">
            {readyCount < totalCount && errorCount === 0
              ? `${readyCount}/${totalCount} videos generating…`
              : errorCount > 0
              ? `${errorCount} video${errorCount !== 1 ? 's' : ''} blocked — retry to regenerate`
              : 'Refine with Runway, download the clip, or save as final for batch download'}
          </p>
        </div>
        <span className="text-xs text-[#a59f97]">
          {totalCount} clip{totalCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-5">
        {moments.map((moment) => (
          <VideoCard
            key={moment.id}
            moment={moment}
            sessionId={sessionId}
            videoReady={videoReadyIds.has(moment.id)}
            finalized={finalizedIds.has(moment.id)}
            downloadUrl={downloadUrls[moment.id]}
            videoError={videoErrors[moment.id]}
          />
        ))}
      </div>
    </div>
  );
}
