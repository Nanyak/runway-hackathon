'use client';

import { useEffect, useState } from 'react';
import { Moment, PipelineEvent, Scene } from '@/lib/types';

interface SceneState {
  clipUrl?: string;
}

interface SceneGridProps {
  moments: Moment[];
  events: PipelineEvent[];
  sessionId: string;
}

function buildSceneStateMap(events: PipelineEvent[]): Record<string, SceneState> {
  const map: Record<string, SceneState> = {};

  for (const event of events) {
    // 'clip_ready' is a legacy event type no longer emitted — guard with cast to avoid TS error
    if ((event.type as string) === 'clip_ready' && typeof event.data.sceneId === 'string') {
      const sceneId = event.data.sceneId;
      map[sceneId] = { ...map[sceneId], clipUrl: event.data.clipUrl as string };
    }
  }

  return map;
}

export default function SceneGrid({ moments, events, sessionId }: SceneGridProps) {
  const [scenesByMoment, setScenesByMoment] = useState<Record<string, Scene[]>>({});

  useEffect(() => {
    if (!sessionId || moments.length === 0) return;

    async function fetchScenes() {
      try {
        const res = await fetch(`/api/session/${sessionId}/scenes`);
        if (res.ok) {
          const data = await res.json() as { scenesByMoment: Record<string, Scene[]> };
          setScenesByMoment(data.scenesByMoment);
        }
      } catch {
        // Silently ignore fetch errors; will retry on next moments change
      }
    }

    fetchScenes();
  }, [sessionId, moments]);

  const sceneStateMap = buildSceneStateMap(events);

  const hasAnyScenes = Object.keys(scenesByMoment).length > 0 ||
    events.some(e => (e.type as string) === 'clip_ready');

  if (!hasAnyScenes) {
    return (
      <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-8 text-center"
        style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
      >
        <div className="flex items-center justify-center gap-2 text-[#777169]">
          <div className="w-4 h-4 rounded-full border-2 border-[#777169] border-t-transparent animate-spin" />
          <span className="text-sm">Generating videos with RunwayML…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium text-black">Generated Scenes</h2>

      {moments.map((moment) => {
        const scenes = scenesByMoment[moment.id] ?? [];

        // If no scenes loaded yet, fall back to event-based scene IDs for this moment
        const eventSceneIds = Array.from(new Set(
          events
            .filter(e =>
              (e.type as string) === 'clip_ready' &&
              typeof e.data.sceneId === 'string' &&
              typeof e.data.momentId === 'string' &&
              e.data.momentId === moment.id
            )
            .map(e => e.data.sceneId as string)
        ));

        const hasScenes = scenes.length > 0 || eventSceneIds.length > 0;
        if (!hasScenes) return null;

        return (
          <div key={moment.id} className="space-y-3">
            <h3 className="text-sm font-medium text-[#777169] uppercase tracking-wide">
              {moment.title}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {scenes.length > 0
                ? scenes.map((scene, idx) => {
                    const state = sceneStateMap[scene.id] ?? {};
                    return (
                      <SceneCard
                        key={scene.id}
                        sceneId={scene.id}
                        index={idx}
                        captionText={scene.captionText}
                        state={state}
                      />
                    );
                  })
                : eventSceneIds.map((sceneId, idx) => {
                    const state = sceneStateMap[sceneId] ?? {};
                    return (
                      <SceneCard
                        key={sceneId}
                        sceneId={sceneId}
                        index={idx}
                        captionText=""
                        state={state}
                      />
                    );
                  })
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface SceneCardProps {
  sceneId: string;
  index: number;
  captionText: string;
  state: SceneState;
}

function SceneCard({ index, captionText, state }: SceneCardProps) {
  return (
    <div
      className="rounded-[16px] border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      {/* Scene media */}
      <div className="aspect-[9/16] bg-[#f5f3f1] relative">
        {state.clipUrl ? (
          <video
            src={state.clipUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="w-6 h-6 rounded-full border-2 border-[#a59f97] border-t-transparent animate-spin mx-auto" />
              <p className="text-xs text-[#a59f97]">Generating…</p>
            </div>
          </div>
        )}

        <div className="absolute top-2 right-2">
          {state.clipUrl
            ? <span className="bg-black text-white text-xs px-2 py-0.5 rounded-[9999px]">Ready</span>
            : <span className="bg-[#f5f3f1] text-[#a59f97] text-xs px-2 py-0.5 rounded-[9999px]">…</span>
          }
        </div>
      </div>

      <div className="p-3 space-y-1">
        <p className="text-xs text-[#777169]">Scene {index + 1}</p>
        {captionText && (
          <p className="text-xs text-black line-clamp-2">{captionText}</p>
        )}
      </div>
    </div>
  );
}
