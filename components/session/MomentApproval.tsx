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

// 3 variation images ($0.10 each) + 1 video ($0.50)
const VARIATION_COUNT = 3;
const IMAGE_COST = 0.10;
const VIDEO_COST = 0.50;

function estimateCost(count: number): string {
  const total = count * (VARIATION_COUNT * IMAGE_COST + VIDEO_COST);
  return total.toFixed(2);
}

export default function MomentApproval({ moments, sessionId, onApproved }: MomentApprovalProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(moments.map((m) => m.id))
  );
  const [hookEdits, setHookEdits] = useState<Record<string, string>>(
    Object.fromEntries(moments.map((m) => [m.id, m.hook]))
  );
  const [styleEdits, setStyleEdits] = useState<Record<string, string>>(
    Object.fromEntries(moments.map((m) => [m.id, resolveToPresetValue(m.suggestedStyle, m.mood)]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        body: JSON.stringify({ approvedIds, hookEdits, styleAnchors: styleEdits }),
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
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-black font-medium">
              {selectedCount} moment{selectedCount !== 1 ? 's' : ''} selected
            </p>
            <p className="text-xs text-[#777169] mt-0.5">
              Estimated cost: ~${estimateCost(selectedCount)}
              <span className="text-[#a59f97]"> ({selectedCount} × 3 images + 1 video)</span>
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
      </div>
    </div>
  );
}
