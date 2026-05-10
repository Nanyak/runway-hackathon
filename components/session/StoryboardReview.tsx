'use client';

import { useState, useEffect, useCallback } from 'react';
import { Moment, PipelineEvent, StoryboardPlan } from '@/lib/types';

const MAX_ITERATIONS = 3;

const MOOD_COLORS: Record<Moment['mood'], string> = {
  inspiring: 'bg-blue-50 text-blue-600 border-blue-100',
  funny: 'bg-orange-50 text-orange-600 border-orange-100',
  educational: 'bg-green-50 text-green-600 border-green-100',
  controversial: 'bg-red-50 text-red-600 border-red-100',
  emotional: 'bg-purple-50 text-purple-600 border-purple-100',
};

// ── Lightbox ───────────────────────────────────────────────────────────────────

function Lightbox({
  url,
  orientation,
  onClose,
}: {
  url: string;
  orientation: 'vertical' | 'landscape';
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`relative bg-white rounded-[16px] shadow-2xl overflow-hidden flex flex-col ${
          orientation === 'vertical' ? 'h-[92vh] w-auto' : 'w-full max-w-5xl max-h-[92vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0eeec] flex-shrink-0">
          <p className="text-sm font-medium text-black">
            Full Storyboard
            <span className="ml-2 text-xs font-normal text-[#a59f97]">
              {orientation === 'vertical' ? '9:16 vertical' : '16:9 landscape'}
            </span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-[#a59f97] hover:text-black transition-colors p-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-[#f9f8f7]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Storyboard full preview"
            className={orientation === 'vertical' ? 'h-full w-auto' : 'w-full h-auto'}
          />
        </div>
      </div>
    </div>
  );
}

// ── Per-moment storyboard card ─────────────────────────────────────────────────

interface MomentStoryboardCardProps {
  moment: Moment;
  sessionId: string;
  storyboard: StoryboardPlan;
  events: PipelineEvent[];
  iterationsUsed: number;
  orientation: 'vertical' | 'landscape';
  onApproved: () => void;
}

function MomentStoryboardCard({
  moment,
  sessionId,
  storyboard,
  events,
  iterationsUsed,
  orientation,
  onApproved,
}: MomentStoryboardCardProps) {
  const variantCount = storyboard.sheetVariantCount ?? 1;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [readyVariants, setReadyVariants] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (storyboard.frames.some((f) => f.index === 0 && !!f.imagePath)) initial.add(0);
    return initial;
  });
  const [selectedVariant, setSelectedVariant] = useState(storyboard.selectedSheetIndex ?? 0);
  const [regenerating, setRegenerating] = useState(false);
  const [cacheBust, setCacheBust] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [refineState, setRefineState] = useState<'idle' | 'analyzing' | 'regenerating' | 'done'>('idle');
  const [approved, setApproved] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(iterationsUsed);

  const anySheetReady = readyVariants.size > 0;

  // Process SSE events for this moment
  useEffect(() => {
    for (const event of events) {
      if (event.type === 'storyboard_frame_ready' && event.data.momentId === moment.id) {
        const idx = typeof event.data.index === 'number' ? event.data.index : 0;
        setReadyVariants((prev) => new Set(Array.from(prev).concat([idx])));
        setRegenerating(false);
        setCacheBust(Date.now());
      }
      if (event.type === 'storyboard_analysis_complete' && event.data.momentId === moment.id) {
        setRegenerating(true);
        setRefineState('regenerating');
      }
      if (event.type === 'storyboard_ready' && event.data.momentId === moment.id) {
        setRegenerating(false);
        setRefineState('done');
        setFeedback('');
        setIterations((prev) => prev + 1);
        setTimeout(() => setRefineState('idle'), 1500);
      }
    }
  }, [events, moment.id]);

  const handleRefine = useCallback(async () => {
    if (!feedback.trim() || refineState !== 'idle' || iterations >= MAX_ITERATIONS) return;
    setRefineState('analyzing');
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/refine-storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ momentId: moment.id, feedback: feedback.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Refine failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRefineState('idle');
    }
  }, [feedback, refineState, iterations, sessionId, moment.id]);

  const handleApprove = useCallback(async () => {
    if (approving || approved) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/approve-storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ momentId: moment.id, selectedSheetIndex: selectedVariant }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Approve failed');
      setApproved(true);
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  }, [approving, approved, sessionId, moment.id, selectedVariant, onApproved]);

  const remainingIterations = MAX_ITERATIONS - iterations;
  const duration = Math.round(moment.endSec - moment.startSec);

  // Aspect ratio for the image containers
  const imageAspect = orientation === 'vertical' ? '1088 / 1920' : '1920 / 1088';

  return (
    <>
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} orientation={orientation} onClose={() => setLightboxUrl(null)} />
      )}

      <div
        className={`rounded-[18px] border bg-white overflow-hidden transition-all duration-200 ${
          approved ? 'border-green-300 shadow-[0_0_0_3px_rgba(134,239,172,0.2)]' : 'border-[#e5e5e5]'
        }`}
        style={{ boxShadow: approved ? undefined : 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
      >
        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-[15px] text-black leading-snug">{moment.title}</h3>
              <p className="text-sm text-[#777169] mt-1 line-clamp-2 leading-relaxed">{moment.hook}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${MOOD_COLORS[moment.mood]}`}>
                {moment.mood}
              </span>
              <span className="text-xs text-[#a59f97] tabular-nums">{duration}s</span>
              {approved && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Approved
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Storyboard section ── */}
        <div className="px-5 pb-1">
          {/* Section label + status */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-[#a59f97] uppercase tracking-widest">
              Storyboard · {storyboard.frames.length} panels
            </p>
            <div className="flex items-center gap-2">
              {!anySheetReady && (
                <span className="inline-flex items-center gap-1.5 text-xs text-[#a59f97]">
                  <span className="w-3 h-3 rounded-full border-2 border-[#ccc] border-t-[#888] animate-spin flex-shrink-0" />
                  Generating…
                </span>
              )}
              {regenerating && (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
                  <span className="w-3 h-3 rounded-full border-2 border-amber-300 border-t-amber-600 animate-spin flex-shrink-0" />
                  Refining…
                </span>
              )}
              {variantCount > 1 && anySheetReady && !regenerating && (
                <span className="text-[11px] text-[#a59f97]">{variantCount} variants</span>
              )}
            </div>
          </div>

          {/* Variant grid */}
          <div
            className={`grid gap-3 ${
              variantCount === 3 ? 'grid-cols-3' : variantCount === 2 ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {Array.from({ length: variantCount }, (_, i) => {
              const isReady = readyVariants.has(i);
              const isSelected = selectedVariant === i;
              const sheetUrl = `/api/session/${sessionId}/variation-image/${moment.id}/${i}?v=${cacheBust}`;

              return (
                <div key={i} className="flex flex-col gap-2">
                  {/* Variant tab label */}
                  {variantCount > 1 && (
                    <button
                      type="button"
                      onClick={() => isReady && !approved && setSelectedVariant(i)}
                      disabled={!isReady || approved}
                      className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 border transition-all ${
                        isSelected
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-[#777169] border-[#e5e5e5] hover:border-[#aaa]'
                      } disabled:opacity-50 disabled:cursor-default`}
                    >
                      {isSelected && (
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="flex-shrink-0">
                          <path d="M1.5 4.5l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      Variant {i + 1}
                    </button>
                  )}

                  {/* Image container with correct aspect ratio */}
                  <button
                    type="button"
                    onClick={() => isReady && !approved && setSelectedVariant(i)}
                    disabled={!isReady || approved}
                    className={`relative w-full rounded-[12px] overflow-hidden border-2 transition-all ${
                      isSelected ? 'border-black shadow-[0_0_0_2px_rgba(0,0,0,0.08)]' : 'border-transparent'
                    } ${isReady && !approved ? 'cursor-pointer' : 'cursor-default'} bg-[#f5f3f1]`}
                    style={{ aspectRatio: imageAspect }}
                  >
                    {isReady ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sheetUrl}
                          alt={`Storyboard variant ${i + 1}`}
                          className={`absolute inset-0 w-full h-full object-cover transition-opacity ${
                            regenerating && isSelected ? 'opacity-40' : 'opacity-100'
                          }`}
                        />

                        {/* Selected overlay badge */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black flex items-center justify-center shadow-md">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}

                        {/* Zoom button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxUrl(sheetUrl);
                          }}
                          className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center transition-colors shadow-sm"
                          title="View full storyboard"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5"
                              stroke="currentColor"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>

                        {/* Regenerating overlay */}
                        {regenerating && isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-white/90 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm">
                              <span className="w-3.5 h-3.5 rounded-full border-2 border-[#ccc] border-t-[#555] animate-spin" />
                              <span className="text-xs font-medium text-[#555]">Refining…</span>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="w-5 h-5 rounded-full border-2 border-[#ccc] border-t-[#666] animate-spin" />
                        <p className="text-[10px] text-[#a59f97]">Drawing panels…</p>
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Selection hint */}
          {anySheetReady && !approved && variantCount > 1 && (
            <p className="text-[11px] text-[#a59f97] mt-3">
              Select a variant above, then approve to use it for video generation.
            </p>
          )}
          {anySheetReady && !approved && variantCount === 1 && (
            <p className="text-[11px] text-[#a59f97] mt-3">
              Click the zoom icon to preview panels at full size before approving.
            </p>
          )}
        </div>

        {/* ── Feedback + actions ── */}
        {!approved && (
          <div className="px-5 pb-5 pt-4 border-t border-[#f0eeec] mt-4 space-y-3">
            {remainingIterations > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[#555]">Refine storyboard</p>
                  <p className="text-[11px] text-[#a59f97]">
                    {remainingIterations} of {MAX_ITERATIONS} left
                  </p>
                </div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={refineState !== 'idle'}
                  placeholder="Describe changes — e.g. more close-ups, add outdoor scenes, make it more dramatic…"
                  rows={2}
                  className="w-full text-sm rounded-[10px] border border-[#e5e5e5] bg-[#fdfcfc] px-3 py-2.5
                    placeholder:text-[#c5bfb8] focus:outline-none focus:ring-1 focus:ring-black resize-none
                    disabled:opacity-50 transition-colors"
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            {refineState === 'done' && (
              <p className="text-xs text-green-600 font-medium">
                Storyboard updated — review the new variants above.
              </p>
            )}

            <div className="flex gap-2.5">
              {remainingIterations > 0 && (
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={!feedback.trim() || refineState !== 'idle' || !anySheetReady}
                  className="flex-none px-5 py-2.5 rounded-[9999px] border border-[#e5e5e5] text-sm font-medium text-black
                    disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f3f1] transition-colors"
                >
                  {refineState === 'analyzing' ? 'Analyzing…' : refineState === 'regenerating' ? 'Regenerating…' : 'Refine'}
                </button>
              )}

              <button
                type="button"
                onClick={handleApprove}
                disabled={!anySheetReady || approving || refineState === 'analyzing' || refineState === 'regenerating'}
                className="flex-1 py-2.5 rounded-[9999px] bg-black text-white text-sm font-medium
                  disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {approving
                  ? 'Approving…'
                  : variantCount > 1
                  ? `Approve Variant ${selectedVariant + 1}`
                  : 'Approve & Generate Video'}
              </button>
            </div>

            {!anySheetReady && (
              <p className="text-[11px] text-center text-[#a59f97]">
                Wait for the storyboard to finish generating before approving.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Main StoryboardReview ──────────────────────────────────────────────────────

interface StoryboardReviewProps {
  moments: Moment[];
  sessionId: string;
  events: PipelineEvent[];
  storyboards: Record<string, StoryboardPlan>;
  storyboardIterations: Record<string, number>;
  orientation: 'vertical' | 'landscape';
  onApproved: () => void;
}

export default function StoryboardReview({
  moments,
  sessionId,
  events,
  storyboards,
  storyboardIterations,
  orientation,
  onApproved,
}: StoryboardReviewProps) {
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());

  function handleMomentApproved(momentId: string) {
    setApprovedIds((prev) => new Set(Array.from(prev).concat([momentId])));
    onApproved();
  }

  const allApproved = moments.every((m) => approvedIds.has(m.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-black">Review Storyboard</h2>
        <p className="text-sm text-[#777169] mt-1">
          Each storyboard panel is used as visual direction for Seedance 2 — approve or refine before generating your video.
        </p>
      </div>

      {/* Per-moment cards */}
      <div
        className={`grid gap-6 ${
          moments.length > 1 && orientation === 'landscape'
            ? 'grid-cols-1 lg:grid-cols-2'
            : 'grid-cols-1'
        }`}
      >
        {moments.map((moment) => {
          const storyboard = storyboards[moment.id];
          if (!storyboard) {
            return (
              <div
                key={moment.id}
                className="rounded-[18px] border border-[#e5e5e5] bg-white p-5 flex items-center gap-3"
                style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
              >
                <div className="w-4 h-4 rounded-full border-2 border-[#ccc] border-t-[#444] animate-spin flex-shrink-0" />
                <p className="text-sm text-[#777169]">Planning storyboard for &ldquo;{moment.title}&rdquo;…</p>
              </div>
            );
          }

          return (
            <MomentStoryboardCard
              key={moment.id}
              moment={moment}
              sessionId={sessionId}
              storyboard={storyboard}
              events={events}
              iterationsUsed={storyboardIterations[moment.id] ?? 0}
              orientation={orientation}
              onApproved={() => handleMomentApproved(moment.id)}
            />
          );
        })}
      </div>

      {allApproved && (
        <div className="rounded-[16px] border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8l3.5 3.5 7-7" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-green-700">All storyboards approved</p>
            <p className="text-xs text-green-600 mt-0.5">Generating your videos with Seedance 2…</p>
          </div>
        </div>
      )}
    </div>
  );
}
