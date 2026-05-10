'use client';

import { useState } from 'react';
import { Moment } from '@/lib/types';
import MomentCard from '@/components/session/MomentCard';
import { resolveToPresetValue } from '@/lib/config/style-presets';

interface MomentApprovalProps {
  moments: Moment[];
  sessionId: string;
  onApproved: () => void;
}

const IMAGE_COST = 0.10;
const VIDEO_COST = 0.50;

function estimateCost(momentCount: number, variantCount: number): string {
  const total = momentCount * (variantCount * IMAGE_COST + VIDEO_COST);
  return total.toFixed(2);
}

const VARIANT_OPTIONS = [1, 2, 3] as const;

export default function MomentApproval({ moments, sessionId, onApproved }: MomentApprovalProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const top = moments.reduce((best, m) => (m.viralScore > best.viralScore ? m : best), moments[0]);
    return new Set(top ? [top.id] : []);
  });
  const [hookEdits, setHookEdits] = useState<Record<string, string>>(
    Object.fromEntries(moments.map((m) => [m.id, m.hook]))
  );
  const [styleEdits, setStyleEdits] = useState<Record<string, string>>(
    Object.fromEntries(moments.map((m) => [m.id, resolveToPresetValue(m.suggestedStyle, m.mood)]))
  );
  const [variantCount, setVariantCount] = useState<1 | 2 | 3>(2);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [redetecting, setRedetecting] = useState(false);
  const [redetectError, setRedetectError] = useState<string | null>(null);

  function toggleMoment(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function editHook(id: string, text: string) {
    setHookEdits((prev) => ({ ...prev, [id]: text }));
  }

  function editStyle(id: string, text: string) {
    setStyleEdits((prev) => ({ ...prev, [id]: text }));
  }

  async function handleGenerate() {
    const approvedIds = Array.from(checkedIds);
    if (approvedIds.length === 0) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/session/${sessionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedIds, hookEdits, styleAnchors: styleEdits, sheetVariantCount: variantCount }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Approval failed');
      }

      onApproved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  async function handleRedetect() {
    setRedetecting(true);
    setRedetectError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/redetect`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Re-analysis failed');
      }
      // SSE stream will emit moment_detected events; trigger a refetch now so the
      // UI reflects the cleared moments immediately
      onApproved();
    } catch (err) {
      setRedetectError(err instanceof Error ? err.message : String(err));
    } finally {
      setRedetecting(false);
    }
  }

  const selectedCount = checkedIds.size;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-medium text-black">Detected Viral Moments</h2>
          <span className="inline-flex items-center rounded-[9999px] bg-[#f5f3f1] px-2.5 py-0.5 text-xs font-medium text-[#777169]">
            {moments.length}
          </span>
        </div>
      </div>

      {/* Moment cards */}
      <div className="space-y-4">
        {moments.map((moment) => (
          <MomentCard
            key={moment.id}
            moment={moment}
            checked={checkedIds.has(moment.id)}
            hookText={hookEdits[moment.id] ?? moment.hook}
            styleText={styleEdits[moment.id] ?? moment.suggestedStyle ?? ''}
            onToggle={() => toggleMoment(moment.id)}
            onHookEdit={(text) => editHook(moment.id, text)}
            onStyleEdit={(text) => editStyle(moment.id, text)}
            audioUrl={`/api/session/${sessionId}/audio/${moment.id}`}
          />
        ))}
      </div>

      {/* Cost estimate + CTA */}
      <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-5"
        style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
      >
        {/* Storyboard variant picker */}
        <div className="mb-4 pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-black font-medium">Storyboard variants per moment</label>
            <span className="text-xs text-[#a59f97]">GPT Image-2</span>
          </div>
          <div className="flex gap-2">
            {VARIANT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setVariantCount(n)}
                className={`flex-1 py-2 rounded-[9999px] text-sm font-medium border transition-colors ${
                  variantCount === n
                    ? 'bg-black text-[#fdfcfc] border-black'
                    : 'bg-white text-black border-[#e5e5e5] hover:bg-[#f5f3f1]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {variantCount > 1 && (
            <p className="mt-1.5 text-xs text-[#a59f97]">
              More variants take longer — each extra option adds ~30–60s per moment.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-black font-medium">
              {selectedCount} moment{selectedCount !== 1 ? 's' : ''} selected
            </p>
            <p className="text-xs text-[#777169] mt-0.5">
              Estimated cost: ~${estimateCost(selectedCount, variantCount)}
              <span className="text-[#a59f97]"> ({selectedCount} × {variantCount} image{variantCount !== 1 ? 's' : ''} + 1 video)</span>
            </p>
            <p className="text-xs text-[#a59f97] mt-0.5">
              Generate storyboards for{' '}
              <span className="font-medium text-black">{selectedCount * variantCount}</span>{' '}
              variant{selectedCount * variantCount !== 1 ? 's' : ''}{' '}
              ({selectedCount} moment{selectedCount !== 1 ? 's' : ''} × {variantCount} sheet{variantCount !== 1 ? 's' : ''})
            </p>
            <p className="text-xs text-[#a59f97] mt-2 leading-snug">
              You approve before Runway jobs run — no surprise charges on moments you skip.
            </p>
          </div>
        </div>

        {submitError && (
          <p className="text-sm text-red-500 mb-3">{submitError}</p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={selectedCount === 0 || submitting}
          className="w-full py-3 rounded-[9999px] bg-black text-[#fdfcfc] text-sm font-medium
            disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {submitting ? 'Creating visual concepts…' : `Generate Concepts for ${selectedCount} Moment${selectedCount !== 1 ? 's' : ''}`}
        </button>

        {redetectError && (
          <p className="text-sm text-red-500 mt-2">{redetectError}</p>
        )}

        <button
          type="button"
          onClick={handleRedetect}
          disabled={redetecting || submitting}
          className="w-full py-2.5 rounded-[9999px] border border-[#e5e5e5] text-sm font-medium text-[#777169]
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f3f1] transition-colors mt-2"
        >
          {redetecting ? 'Re-analyzing…' : 'Re-analyze moments'}
        </button>
      </div>
    </div>
  );
}
