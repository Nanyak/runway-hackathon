'use client';

import { useState, useEffect } from 'react';
import { Moment, FrameVariation, PipelineEvent } from '@/lib/types';

interface FramePickerProps {
  moments: Moment[];
  sessionId: string;
  events: PipelineEvent[];
  onSelectionSubmitted: () => void;
}

const MOOD_COLORS: Record<Moment['mood'], string> = {
  inspiring: 'bg-blue-100 text-blue-700',
  funny: 'bg-orange-100 text-orange-700',
  educational: 'bg-green-100 text-green-700',
  controversial: 'bg-red-100 text-red-700',
  emotional: 'bg-purple-100 text-purple-700',
};

// ── Single moment's frame grid ─────────────────────────────────────────────────

interface MomentFrameGridProps {
  moment: Moment;
  sessionId: string;
  readyImages: Set<number>;      // variation indices where image is ready
  selected: number | null;
  onSelect: (index: number) => void;
  variations: FrameVariation[];
}

function MomentFrameGrid({
  moment,
  sessionId,
  readyImages,
  selected,
  onSelect,
  variations,
}: MomentFrameGridProps) {
  const duration = Math.round(moment.endSec - moment.startSec);

  return (
    <div className="rounded-[16px] border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      {/* Moment header */}
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
          </div>
        </div>
      </div>

      {/* Frame grid: 3 columns */}
      <div className="p-5">
        <p className="text-xs font-medium text-[#a59f97] uppercase tracking-wider mb-3">
          Pick a starting frame
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((index) => {
            const isReady = readyImages.has(index);
            const isSelected = selected === index;
            const variation = variations[index];

            return (
              <button
                key={index}
                type="button"
                onClick={() => isReady && onSelect(index)}
                disabled={!isReady}
                className={`relative aspect-[9/16] rounded-[10px] overflow-hidden border-2 transition-all
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-black
                  ${isSelected ? 'border-black ring-2 ring-black ring-offset-1 scale-[0.97]' : ''}
                  ${!isSelected && isReady ? 'border-transparent hover:border-[#ccc] hover:scale-[0.98]' : ''}
                  ${!isReady ? 'border-transparent cursor-not-allowed' : ''}
                `}
                aria-pressed={isSelected}
                aria-label={`Select variation ${index + 1}`}
              >
                {isReady ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/session/${sessionId}/variation-image/${moment.id}/${index}`}
                    alt={`Frame option ${index + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-[#f5f3f1] flex flex-col items-center justify-center gap-2">
                    <div className="w-5 h-5 rounded-full border-2 border-[#ccc] border-t-[#333] animate-spin" />
                    <p className="text-[10px] text-[#a59f97]">Generating…</p>
                  </div>
                )}

                {/* Option label */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <p className="text-[10px] font-semibold text-white">
                    {['Literal', 'Abstract', 'Atmospheric'][index]}
                  </p>
                </div>

                {/* Selected check */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Motion prompt preview for selected */}
        {selected !== null && variations[selected] && (
          <div className="mt-3 rounded-[10px] bg-[#f5f3f1] px-3 py-2.5">
            <p className="text-[10px] font-medium text-[#a59f97] uppercase tracking-wide mb-1">
              Camera motion
            </p>
            <p className="text-xs text-black leading-relaxed">{variations[selected].motionPrompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main FramePicker ───────────────────────────────────────────────────────────

export default function FramePicker({
  moments,
  sessionId,
  events,
  onSelectionSubmitted,
}: FramePickerProps) {
  // Track which variation images are ready per moment: momentId → Set<index>
  const [readyImages, setReadyImages] = useState<Record<string, Set<number>>>({});
  // User selections: momentId → variation index
  const [selections, setSelections] = useState<Record<string, number>>({});
  // Per-moment variation metadata
  const [variations, setVariations] = useState<Record<string, FrameVariation[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Collect ready images + fetch variation metadata from SSE events
  useEffect(() => {
    for (const event of events) {
      if (event.type === 'variation_ready') {
        const momentId = event.data.momentId as string;
        const index = event.data.index as number;
        setReadyImages((prev) => {
          const s = new Set(prev[momentId] ?? []);
          s.add(index);
          return { ...prev, [momentId]: s };
        });
      }
      if (event.type === 'gate' && event.data.gate === 'frame_selection') {
        const v = event.data.variations as Record<string, FrameVariation[]>;
        setVariations(v);
        // Pre-populate ready images from gate event (resume case)
        const ready: Record<string, Set<number>> = {};
        for (const [momentId, vars] of Object.entries(v)) {
          ready[momentId] = new Set(vars.filter((fv) => !!fv.imagePath).map((fv) => fv.index));
        }
        setReadyImages(ready);
      }
    }
  }, [events]);

  // Auto-select first ready variation per moment when it arrives
  useEffect(() => {
    for (const [momentId, ready] of Object.entries(readyImages)) {
      if (!(momentId in selections) && ready.size > 0) {
        setSelections((prev) => ({ ...prev, [momentId]: Array.from(ready)[0] }));
      }
    }
  }, [readyImages, selections]);

  function handleSelect(momentId: string, index: number) {
    setSelections((prev) => ({ ...prev, [momentId]: index }));
  }

  const allSelected = moments.every((m) => m.id in selections);
  const selectedCount = Object.keys(selections).length;

  async function handleSubmit() {
    if (!allSelected || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/select-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Submit failed');
      onSelectionSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const totalImages = moments.length * 3;
  const readyCount = Object.values(readyImages).reduce((acc, s) => acc + s.size, 0);
  const allImagesReady = readyCount >= totalImages;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-black">Choose Your Starting Frame</h2>
          <p className="text-sm text-[#777169] mt-0.5">
            Pick one visual concept per moment &mdash; we&apos;ll animate it into a video
          </p>
        </div>
        {!allImagesReady && (
          <div className="flex items-center gap-2 text-sm text-[#a59f97]">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-[#ccc] border-t-[#777] animate-spin" />
            {readyCount}/{totalImages} ready
          </div>
        )}
      </div>

      {/* Grid per moment */}
      <div className="space-y-5">
        {moments.map((moment) => (
          <MomentFrameGrid
            key={moment.id}
            moment={moment}
            sessionId={sessionId}
            readyImages={readyImages[moment.id] ?? new Set()}
            selected={selections[moment.id] ?? null}
            onSelect={(idx) => handleSelect(moment.id, idx)}
            variations={variations[moment.id] ?? []}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-5"
        style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-black font-medium">
            {selectedCount}/{moments.length} moments have a frame selected
          </p>
          <p className="text-xs text-[#a59f97]">
            ~$0.50 per video (image_to_video)
          </p>
        </div>

        {submitError && <p className="text-sm text-red-500 mb-3">{submitError}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allSelected || submitting}
          className="w-full py-3 rounded-[9999px] bg-black text-white text-sm font-medium
            disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {submitting
            ? 'Starting generation…'
            : `Generate ${moments.length} Video${moments.length !== 1 ? 's' : ''}`}
        </button>

        {!allSelected && (
          <p className="text-xs text-center text-[#a59f97] mt-2">
            Select a frame for each moment to continue
          </p>
        )}
      </div>
    </div>
  );
}
