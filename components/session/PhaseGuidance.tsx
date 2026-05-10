'use client';

import type { SessionStatus } from '@/lib/types';

type StepIndex = 1 | 2 | 3 | 4;

interface PhaseGuidanceProps {
  step: StepIndex;
  status: SessionStatus;
}

/**
 * Short, honest timing copy so users know what to expect during long API phases.
 */
export default function PhaseGuidance({ step, status }: PhaseGuidanceProps) {
  const text = resolveCopy(step, status);
  if (!text) return null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-2 border-b border-[#ebe8e4] bg-[#faf9f8]">
      <p className="text-xs text-[#777169] leading-relaxed">{text}</p>
    </div>
  );
}

function resolveCopy(step: StepIndex, status: SessionStatus): string | null {
  if (step === 1 && status === 'uploading') {
    return 'Uploading your file — almost ready to analyze.';
  }
  if (step === 1 && status === 'transcribing') {
    return 'Transcription usually takes 1–3 minutes for a typical clip; longer episodes take proportionally more.';
  }
  if (step === 1 && status === 'detecting') {
    return 'Scanning the transcript for viral-worthy moments — usually under a minute after transcription finishes.';
  }
  if (step === 1 && status === 'error') {
    return null;
  }
  if (step === 2) {
    return 'Pick the moments you want. You approve before any Runway jobs run — no surprise charges on clips you skip.';
  }
  if (step === 3) {
    return 'Storyboard images often take 2–5 minutes per moment depending on variant count. You can refine frames before video generation.';
  }
  if (step === 4 && status === 'generating_video') {
    return 'Video generation with Runway often takes several minutes per moment. This tab will update when each clip is ready.';
  }
  if (step === 4 && (status === 'awaiting_feedback' || status === 'complete')) {
    return 'Compare versions with the thumbnails, refine with a prompt, then save as final for captioned export and batch download.';
  }
  if (step === 4) {
    return 'When generation finishes, you can refine each clip or save it as final.';
  }
  return null;
}
