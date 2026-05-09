'use client';

import { useState } from 'react';
import { Moment, PipelineEvent } from '@/lib/types';

interface VideoPreviewProps {
  moments: Moment[];
  sessionId: string;
  events: PipelineEvent[];
  onRender: () => void;
}

export default function VideoPreview({ moments, sessionId, events, onRender }: VideoPreviewProps) {
  const [selectedMomentIdx, setSelectedMomentIdx] = useState(0);
  const [rendering, setRendering] = useState(false);

  // Build map of sceneId -> clipUrl from events
  const clipUrlMap: Record<string, string> = {};
  for (const event of events) {
    // 'clip_ready' is a legacy event type no longer emitted
    if ((event.type as string) === 'clip_ready' && typeof event.data.sceneId === 'string') {
      clipUrlMap[event.data.sceneId as string] = event.data.clipUrl as string;
    }
  }

  // Get clip URLs for each moment (by position matching since we don't track scene<->moment mapping in events)
  const clipUrls = Object.values(clipUrlMap);
  const selectedMoment = moments[selectedMomentIdx];

  function handleRender() {
    setRendering(true);
    onRender();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-black">Preview & Render</h2>
      </div>

      {/* Moment tabs */}
      {moments.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {moments.map((moment, idx) => (
            <button
              key={moment.id}
              type="button"
              onClick={() => setSelectedMomentIdx(idx)}
              className={`px-4 py-2 rounded-[9999px] text-sm font-medium border transition-colors ${
                idx === selectedMomentIdx
                  ? 'bg-black text-[#fdfcfc] border-black'
                  : 'bg-white text-black border-[#e5e5e5] hover:bg-[#f5f3f1]'
              }`}
            >
              {moment.title}
            </button>
          ))}
        </div>
      )}

      {selectedMoment && (
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white overflow-hidden"
          style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
        >
          <div className="p-5">
            <h3 className="font-medium text-base text-black mb-1">{selectedMoment.title}</h3>
            <p className="text-sm text-[#777169]">{selectedMoment.hook}</p>
          </div>

          {/* Clips grid for selected moment */}
          {clipUrls.length > 0 ? (
            <div className="px-5 pb-5">
              <div className="grid grid-cols-3 gap-3">
                {clipUrls.slice(0, 6).map((url, idx) => (
                  <div key={idx} className="aspect-[9/16] rounded-[8px] overflow-hidden bg-[#f5f3f1]">
                    <video
                      src={url}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <div className="h-32 bg-[#f5f3f1] rounded-[8px] flex items-center justify-center">
                <p className="text-sm text-[#a59f97]">No clips available yet</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Render CTA */}
      <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-5"
        style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
      >
        <p className="text-sm text-[#777169] mb-4">
          All clips are ready. Render the final videos with captions and hook overlays.
        </p>
        <button
          type="button"
          onClick={handleRender}
          disabled={rendering}
          className="w-full py-3 rounded-[9999px] bg-black text-[#fdfcfc] text-sm font-medium
            disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {rendering ? 'Rendering…' : `Render All & Download`}
        </button>
      </div>

      <p className="text-xs text-[#a59f97] text-center">
        Session: {sessionId.slice(0, 8)}
      </p>
    </div>
  );
}
