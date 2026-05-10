'use client';

import { useState, useEffect, useCallback } from 'react';
import { Moment, PipelineEvent, StoryboardPlan } from '@/lib/types';

const MAX_ITERATIONS = 3;

const MOOD_COLORS: Record<Moment['mood'], string> = {
  inspiring: 'bg-blue-50 text-blue-600',
  funny: 'bg-orange-50 text-orange-600',
  educational: 'bg-green-50 text-green-600',
  controversial: 'bg-red-50 text-red-600',
  emotional: 'bg-purple-50 text-purple-600',
};

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
    // Mark index 0 as ready if storyboard already has an imagePath (resume case)
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

  return (
    <div
      className={`rounded-[16px] border bg-white overflow-hidden transition-all
        ${approved ? 'border-green-300' : 'border-[#e5e5e5]'}
      `}
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[#f0eeec]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base text-black leading-snug truncate">{moment.title}</h3>
            <p className="text-sm text-[#777169] mt-1 line-clamp-2 leading-relaxed">{moment.hook}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MOOD_COLORS[moment.mood]}`}>
              {moment.mood}
            </span>
            <span className="text-xs text-[#a59f97]">{duration}s</span>
            {approved && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Approved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Storyboard variants */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-[#a59f97] uppercase tracking-wider">
            Storyboard · {storyboard.frames.length} panels · {variantCount} variants
          </p>
          {!anySheetReady && (
            <div className="flex items-center gap-1.5 text-xs text-[#a59f97]">
              <div className="w-3 h-3 rounded-full border-2 border-[#ccc] border-t-[#777] animate-spin" />
              Generating variants…
            </div>
          )}
          {regenerating && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <div className="w-3 h-3 rounded-full border-2 border-amber-300 border-t-amber-600 animate-spin" />
              Regenerating…
            </div>
          )}
        </div>

        {/* Variant grid — side by side */}
        <div className={`grid gap-2 ${variantCount === 3 ? 'grid-cols-3' : variantCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {Array.from({ length: variantCount }, (_, i) => {
            const isReady = readyVariants.has(i);
            const isSelected = selectedVariant === i;
            const sheetUrl = `/api/session/${sessionId}/variation-image/${moment.id}/${i}?v=${cacheBust}`;
            return (
              <button
                key={i}
                type="button"
                onClick={() => isReady && !approved && setSelectedVariant(i)}
                disabled={!isReady || approved}
                className={`relative rounded-[10px] overflow-hidden border-2 transition-all
                  ${isSelected ? 'border-black' : 'border-transparent'}
                  ${isReady && !approved ? 'cursor-pointer hover:border-[#aaa]' : 'cursor-default'}
                  bg-[#f9f8f7]
                  ${regenerating && isSelected ? 'ring-2 ring-amber-300' : ''}
                `}
                style={{ minHeight: 120 }}
              >
                {isReady ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sheetUrl}
                      alt={`Storyboard variant ${i + 1}`}
                      className={`w-full object-contain transition-opacity ${regenerating && isSelected ? 'opacity-50' : 'opacity-100'}`}
                      style={{ maxHeight: orientation === 'vertical' ? 340 : 200 }}
                    />
                    {/* Selected badge */}
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 bg-black text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                        ✓
                      </div>
                    )}
                    {/* Variant label */}
                    <div className="absolute bottom-1.5 left-1.5 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                      {i + 1}
                    </div>
                    {/* Zoom / preview button */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLightboxUrl(sheetUrl); }}
                      className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
                      title="Preview full storyboard"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-10">
                    <div className="w-5 h-5 rounded-full border-2 border-[#ccc] border-t-[#555] animate-spin" />
                    <p className="text-[10px] text-[#a59f97]">Drawing…</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {anySheetReady && !approved && (
          <p className="text-[10px] text-[#a59f97] mt-2">
            Click a variant to select it, then approve to generate your video with that storyboard.
          </p>
        )}
      </div>

      {/* Lightbox modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className={`relative flex flex-col bg-white rounded-[14px] shadow-2xl overflow-hidden
              ${orientation === 'vertical'
                ? 'w-auto max-h-[92vh]'
                : 'w-full max-w-4xl max-h-[92vh]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0eeec] flex-shrink-0">
              <p className="text-sm font-medium text-black">
                Storyboard Preview
                <span className="ml-2 text-xs text-[#a59f97] font-normal">
                  {orientation === 'vertical' ? '9:16 vertical' : '16:9 landscape'}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="text-[#a59f97] hover:text-black transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxUrl}
                alt="Storyboard full preview"
                className={orientation === 'vertical' ? 'h-full w-auto max-h-[80vh]' : 'w-full h-auto'}
              />
            </div>
          </div>
        </div>
      )}

      {/* Feedback + actions */}
      {!approved && (
        <div className="px-5 pb-5 border-t border-[#f0eeec] pt-4 space-y-3">
          {remainingIterations > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[#777169]">Refine the storyboard</p>
                <p className="text-[10px] text-[#a59f97]">{remainingIterations} of {MAX_ITERATIONS} refinements left</p>
              </div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={refineState !== 'idle'}
                placeholder="Describe what to change — e.g. add a close-up in the middle, change the closing panel to an outdoor scene, make it more dramatic…"
                rows={3}
                className="w-full text-sm rounded-[10px] border border-[#e5e5e5] bg-[#fdfcfc] px-3 py-2.5
                  placeholder:text-[#c0b9b2] focus:outline-none focus:ring-1 focus:ring-black resize-none
                  disabled:opacity-50"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          {refineState === 'done' && (
            <p className="text-xs text-green-600 font-medium">Storyboard updated — review the new variants above</p>
          )}

          <div className="flex gap-2">
            {remainingIterations > 0 && (
              <button
                type="button"
                onClick={handleRefine}
                disabled={!feedback.trim() || refineState !== 'idle' || !anySheetReady}
                className="flex-1 py-2.5 rounded-[9999px] border border-[#e5e5e5] text-sm font-medium text-black
                  disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f3f1] transition-colors"
              >
                {refineState === 'analyzing' && 'Analyzing…'}
                {refineState === 'regenerating' && 'Regenerating…'}
                {(refineState === 'idle' || refineState === 'done') && 'Refine'}
              </button>
            )}

            <button
              type="button"
              onClick={handleApprove}
              disabled={!anySheetReady || approving || refineState === 'analyzing' || refineState === 'regenerating'}
              className="flex-1 py-2.5 rounded-[9999px] bg-black text-white text-sm font-medium
                disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {approving ? 'Approving…' : `Approve Variant ${selectedVariant + 1}`}
            </button>
          </div>

          {!anySheetReady && (
            <p className="text-[10px] text-center text-[#a59f97]">Wait for the storyboard to load before approving</p>
          )}
        </div>
      )}
    </div>
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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-medium text-black">Review Your Storyboard</h2>
        <p className="text-sm text-[#777169] mt-0.5">
          Each frame will be used as a visual reference for Seedance2 — approve or refine before generating your video
        </p>
      </div>

      {/* Per-moment cards */}
      <div className="space-y-5">
        {moments.map((moment) => {
          const storyboard = storyboards[moment.id];
          if (!storyboard) {
            return (
              <div key={moment.id} className="rounded-[16px] border border-[#e5e5e5] bg-white p-5 flex items-center gap-3">
                <div className="w-4 h-4 rounded-full border-2 border-[#ccc] border-t-[#333] animate-spin flex-shrink-0" />
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
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="8" stroke="#16a34a" strokeWidth="1.5"/>
            <path d="M5.5 9l2.5 2.5 5-5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-sm font-medium text-green-700">All storyboards approved — generating your videos now…</p>
        </div>
      )}
    </div>
  );
}
