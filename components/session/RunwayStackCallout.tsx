'use client';

import { RUNWAY_PIPELINE_STEPS, RUNWAY_STACK_SUMMARY } from '@/lib/config/runway-highlights';

export default function RunwayStackCallout() {
  return (
    <details className="group rounded-[12px] border border-[#e5e5e5] bg-[#f9f8f7] px-4 py-3 text-left">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-xs font-medium text-[#777169] [&::-webkit-details-marker]:hidden">
        <span>How Runway powers this demo</span>
        <span className="text-[#a59f97] transition-transform group-open:rotate-180">▼</span>
      </summary>
      <p className="mt-3 text-xs text-[#777169] leading-relaxed">{RUNWAY_STACK_SUMMARY}</p>
      <ul className="mt-3 space-y-2">
        {RUNWAY_PIPELINE_STEPS.map((step) => (
          <li key={step.title} className="text-xs">
            <span className="font-medium text-black">{step.title}</span>
            <span className="text-[#777169]"> — {step.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] text-[#a59f97]">
        API: <code className="font-mono">api.dev.runwayml.com</code> · tasks polled server-side
      </p>
    </details>
  );
}
