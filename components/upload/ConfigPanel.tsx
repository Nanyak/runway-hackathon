'use client';

import { useState } from 'react';
import { SessionConfig } from '@/lib/types';

interface ConfigPanelProps {
  config: SessionConfig;
  onChange: (config: SessionConfig) => void;
}

export default function ConfigPanel({ config, onChange }: ConfigPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  function update(patch: Partial<SessionConfig>) {
    onChange({ ...config, ...patch });
  }

  return (
    <div className="w-full rounded-[16px] border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#f5f3f1] transition-colors"
      >
        <span className="text-sm font-medium text-black">Advanced Settings</span>
        <svg
          width="16" height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#777169"
          strokeWidth="2"
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 space-y-5 border-t border-[#e5e5e5]">
          {/* Max Moments */}
          <div className="pt-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-black font-medium">Max Moments</label>
              <span className="text-sm font-medium text-[#777169]">{config.maxMoments}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={config.maxMoments}
              onChange={(e) => update({ maxMoments: Number(e.target.value) })}
              className="w-full h-1 accent-black cursor-pointer"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-[#a59f97]">1</span>
              <span className="text-xs text-[#a59f97]">10</span>
            </div>
          </div>

          {/* Image model — locked to GPT Image-2 */}
          <div>
            <label className="text-sm text-black font-medium block mb-2">Image Model</label>
            <div className="w-full rounded border border-[#e5e5e5] bg-[#f9f8f7] px-3 py-2 text-sm text-black flex items-center justify-between">
              <span>GPT Image-2</span>
              <span className="text-xs text-[#a59f97] font-medium">32K prompt · up to 3 variants</span>
            </div>
          </div>

          {/* Video model — locked to Seedance 2 */}
          <div>
            <label className="text-sm text-black font-medium block mb-2">Video Model</label>
            <div className="w-full rounded border border-[#e5e5e5] bg-[#f9f8f7] px-3 py-2 text-sm text-black flex items-center justify-between">
              <span>Seedance 2</span>
              <span className="text-xs text-[#a59f97] font-medium">Image + audio refs</span>
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="text-sm text-black font-medium block mb-2">Orientation</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => update({ orientation: 'vertical' })}
                className={`flex-1 py-2 rounded-[9999px] text-sm font-medium border transition-colors ${
                  config.orientation === 'vertical'
                    ? 'bg-black text-[#fdfcfc] border-black'
                    : 'bg-white text-black border-[#e5e5e5] hover:bg-[#f5f3f1]'
                }`}
              >
                Vertical 9:16
              </button>
              <button
                type="button"
                onClick={() => update({ orientation: 'landscape' })}
                className={`flex-1 py-2 rounded-[9999px] text-sm font-medium border transition-colors ${
                  config.orientation === 'landscape'
                    ? 'bg-black text-[#fdfcfc] border-black'
                    : 'bg-white text-black border-[#e5e5e5] hover:bg-[#f5f3f1]'
                }`}
              >
                Landscape 16:9
              </button>
            </div>
          </div>

          {/* Speaker Name */}
          <div>
            <label className="text-sm text-black font-medium block mb-2">Speaker Name</label>
            <input
              type="text"
              value={config.speakerName}
              onChange={(e) => update({ speakerName: e.target.value })}
              placeholder="e.g. Lex Fridman"
              className="w-full rounded border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-black placeholder:text-[#a59f97] focus:outline-none focus:border-black"
            />
          </div>

          {/* Show Name */}
          <div>
            <label className="text-sm text-black font-medium block mb-2">Show / Podcast Name</label>
            <input
              type="text"
              value={config.showName}
              onChange={(e) => update({ showName: e.target.value })}
              placeholder="e.g. Lex Fridman Podcast"
              className="w-full rounded border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-black placeholder:text-[#a59f97] focus:outline-none focus:border-black"
            />
          </div>

        </div>
      )}
    </div>
  );
}
