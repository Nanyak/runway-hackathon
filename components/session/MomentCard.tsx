'use client';

import { Moment } from '@/lib/types';
import ProgressBar from '@/components/ui/ProgressBar';
import Badge from '@/components/ui/Badge';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { STYLE_PRESETS, suggestedStyleToPresetId } from '@/lib/config/style-presets';

const MIN_TRIM_CLIP_SEC = 2;

export interface MomentTrimState {
  startSec: number;
  endSec: number;
  boundStartSec: number;
  boundEndSec: number;
  onStartChange: (sec: number) => void;
  onEndChange: (sec: number) => void;
}

interface MomentCardProps {
  moment: Moment;
  checked: boolean;
  hookText: string;
  styleText: string;
  onToggle: () => void;
  onHookEdit: (text: string) => void;
  onStyleEdit: (text: string) => void;
  audioUrl: string;
  /** Optional trim within the detected window (applied when you continue). */
  trim?: MomentTrimState;
}

const MOOD_COLORS: Record<Moment['mood'], 'green' | 'orange' | 'blue' | 'default'> = {
  inspiring: 'blue',
  funny: 'orange',
  educational: 'green',
  controversial: 'orange',
  emotional: 'blue',
};

function formatDuration(startSec: number, endSec: number): string {
  const secs = Math.round(endSec - startSec);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function MomentCard({
  moment,
  checked,
  hookText,
  styleText,
  onToggle,
  onHookEdit,
  onStyleEdit,
  audioUrl,
  trim,
}: MomentCardProps) {
  const trimExportSec =
    trim !== undefined ? Math.round((trim.endSec - trim.startSec) * 10) / 10 : null;
  const canTrim =
    trim !== undefined &&
    trim.boundEndSec - trim.boundStartSec >= MIN_TRIM_CLIP_SEC + 0.05;

  return (
    <div
      className={`rounded-[16px] border bg-white p-5 transition-colors ${
        checked ? 'border-black' : 'border-[#e5e5e5]'
      }`}
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      {/* Header: checkbox + title */}
      <div className="flex items-start gap-3 mb-4">
        <button
          type="button"
          onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
            checked ? 'bg-black border-black' : 'border-[#e5e5e5] bg-white'
          }`}
        >
          {checked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
        <h3 className="font-medium text-base text-black leading-snug">{moment.title}</h3>
      </div>

      {/* Score + badges + duration */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar value={moment.viralScore} />
          </div>
          <span className="text-sm font-medium text-black w-8 text-right">{moment.viralScore}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge label={moment.mood} color={MOOD_COLORS[moment.mood]} />
          <Badge label={moment.clipType} />
          <span className="text-xs text-[#a59f97]">{formatDuration(moment.startSec, moment.endSec)}</span>
        </div>
      </div>

      {/* Audio player */}
      <div className="mb-4">
        <AudioPlayer src={audioUrl} duration={moment.endSec - moment.startSec} />
      </div>

      {canTrim && trim !== undefined && (
        <div className="mb-4 rounded-[12px] border border-[#ebe8e4] bg-[#faf9f8] px-3 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-black">Clip trim</p>
            <span className="text-xs text-[#a59f97]">
              Export ~{trimExportSec}s
              <span className="block sm:inline sm:ml-1 text-[10px] text-[#a59f97]/90">
                (preview is the full detected clip; trim applies when you continue)
              </span>
            </span>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] text-[#777169] uppercase tracking-wide">
              Start ({trim.startSec.toFixed(1)}s)
            </label>
            <input
              type="range"
              min={trim.boundStartSec}
              max={trim.boundEndSec - MIN_TRIM_CLIP_SEC}
              step={0.1}
              value={Math.min(trim.startSec, trim.boundEndSec - MIN_TRIM_CLIP_SEC)}
              onChange={(e) => trim.onStartChange(Number(e.target.value))}
              className="w-full h-1 accent-black cursor-pointer"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] text-[#777169] uppercase tracking-wide">
              End ({trim.endSec.toFixed(1)}s)
            </label>
            <input
              type="range"
              min={trim.boundStartSec + MIN_TRIM_CLIP_SEC}
              max={trim.boundEndSec}
              step={0.1}
              value={Math.max(trim.endSec, trim.boundStartSec + MIN_TRIM_CLIP_SEC)}
              onChange={(e) => trim.onEndChange(Number(e.target.value))}
              className="w-full h-1 accent-black cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Hook editor */}
      <div className="mb-4">
        <label className="text-xs text-[#777169] font-medium uppercase tracking-wider block mb-2">
          Hook text
        </label>
        <input
          type="text"
          value={hookText}
          onChange={(e) => onHookEdit(e.target.value)}
          maxLength={100}
          className="w-full border-0 border-b border-[#e5e5e5] bg-transparent px-0 py-1.5 text-sm text-black
            focus:outline-none focus:border-black placeholder:text-[#a59f97]"
          placeholder="Enter hook text…"
        />
      </div>

      {/* Visual style editor */}
      <div className="mb-4">
        <label className="text-xs text-[#777169] font-medium uppercase tracking-wider block mb-2">
          Visual style
        </label>
        {(() => {
          const aiPresetId = suggestedStyleToPresetId(moment.suggestedStyle, moment.mood);
          return (
            <div className="grid grid-cols-3 gap-1.5">
              {STYLE_PRESETS.map((preset) => {
                const isSelected = styleText === preset.value;
                const isAISuggested = preset.id === aiPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onStyleEdit(preset.value)}
                    className={`relative text-left rounded-lg border px-2.5 py-2 transition-colors ${
                      isSelected
                        ? 'border-black bg-[#f5f3f1]'
                        : 'border-[#e5e5e5] bg-white hover:bg-[#f9f8f7]'
                    }`}
                  >
                    <p className="text-xs font-medium text-black leading-tight pr-4">{preset.label}</p>
                    {isAISuggested && (
                      <span className="absolute top-1 right-1 text-[9px] font-semibold px-1 py-0.5 rounded bg-blue-50 text-blue-600 leading-none">
                        AI
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Reason */}
      <div>
        <p className="text-xs text-[#777169] font-medium uppercase tracking-wider mb-1">Why viral</p>
        <p className="text-sm text-[#777169]">{moment.reason}</p>
      </div>
    </div>
  );
}
