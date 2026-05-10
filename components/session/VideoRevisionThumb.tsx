'use client';

import { useRef, useEffect } from 'react';

interface VideoRevisionThumbProps {
  src: string | null;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** When true, show a neutral placeholder (e.g. pending revision). */
  placeholder?: boolean;
}

/**
 * First-frame thumbnail using a muted video element (no separate poster asset).
 */
export default function VideoRevisionThumb({
  src,
  label,
  selected,
  disabled,
  onClick,
  placeholder,
}: VideoRevisionThumbProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src || placeholder) return;
    const onData = () => {
      try {
        el.currentTime = 0.15;
      } catch {
        /* seek may fail on empty */
      }
    };
    el.addEventListener('loadeddata', onData);
    return () => el.removeEventListener('loadeddata', onData);
  }, [src, placeholder]);

  if (placeholder || src === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex flex-col items-center gap-1 p-1 rounded-lg border transition-colors ${
          selected ? 'border-black bg-[#f5f3f1]' : 'border-[#e5e5e5] bg-[#1a1a1a]'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-white/40'}`}
        aria-label={label}
      >
        <div className="w-11 h-[62px] rounded bg-[#2a2a2a] flex items-center justify-center">
          <span className="text-[9px] text-white/35">…</span>
        </div>
        <span className="text-[10px] font-medium text-white/50">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 p-1 rounded-lg border transition-colors ${
        selected ? 'border-white bg-white/10' : 'border-transparent hover:border-white/30'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="w-11 h-[62px] rounded overflow-hidden bg-black ring-1 ring-white/10">
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          className="w-full h-full object-cover pointer-events-none"
          onSeeked={(e) => {
            try {
              e.currentTarget.pause();
            } catch {
              /* noop */
            }
          }}
        />
      </div>
      <span className={`text-[10px] font-medium ${selected ? 'text-white' : 'text-white/55'}`}>{label}</span>
    </button>
  );
}
