'use client';

import { useState, useEffect } from 'react';

interface ThinkingPanelProps {
  messages: string[];
  streamingThought: string;
  visible: boolean;
  /** Set to true once the AI is done (e.g. storyboard frames arrived) — triggers auto-collapse */
  done?: boolean;
}

export default function ThinkingPanel({ messages, streamingThought, visible, done = false }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Auto-collapse once done and no more streaming text
  useEffect(() => {
    if (done && !streamingThought) {
      setCollapsed(true);
    }
  }, [done, streamingThought]);

  // Re-expand if new streaming starts (e.g. second moment planning)
  useEffect(() => {
    if (streamingThought) setCollapsed(false);
  }, [streamingThought]);

  if (!visible || (messages.length === 0 && !streamingThought)) return null;

  const isActive = !!streamingThought || !done;
  const recent = messages.slice(-4).reverse();

  // Collapsed state — show a small disclosure chip
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-full text-left rounded-[12px] border border-[#e5e5e5] bg-white px-4 py-3 flex items-center gap-2 hover:bg-[#f5f3f1] transition-colors"
        style={{ boxShadow: 'rgba(0,0,0,0.04) 0px 1px 3px' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a59f97" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
        </svg>
        <span className="text-xs text-[#777169] font-medium">AI reasoning complete</span>
        <span className="ml-auto text-xs text-[#a59f97]">Show ↓</span>
      </button>
    );
  }

  return (
    <div
      className="rounded-[16px] border border-[#e5e5e5] bg-white p-5"
      style={{ boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px 0px, rgba(0,0,0,0.04) 0px 2px 4px' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {isActive ? (
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a59f97" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
          </svg>
        )}
        <span className="text-sm font-medium text-black flex-1">
          {isActive ? 'Claude is planning…' : 'AI reasoning'}
        </span>
        {!isActive && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-xs text-[#a59f97] hover:text-black transition-colors"
          >
            Collapse ↑
          </button>
        )}
      </div>

      {/* Live streaming block */}
      {streamingThought && (
        <div className="mb-4 pb-4 border-b border-[#f0eeec] font-mono text-xs text-[#444] leading-relaxed whitespace-pre-wrap break-words max-h-52 overflow-y-auto">
          {streamingThought}
          <span className="inline-block w-0.5 h-3 bg-black ml-0.5 animate-pulse align-middle" />
        </div>
      )}

      {/* Discrete status messages */}
      {recent.length > 0 && (
        <ul className="space-y-2">
          {recent.map((msg, i) => (
            <li
              key={`${msg}-${i}`}
              className={`text-sm ${i === 0 && isActive ? 'text-black font-medium' : 'text-[#a59f97]'}`}
            >
              <span className="mr-2 text-[#e5e5e5]">›</span>
              {msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
