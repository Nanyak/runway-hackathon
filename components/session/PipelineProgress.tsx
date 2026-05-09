'use client';

import { SessionStatus, PipelineEvent } from '@/lib/types';
import { RUNWAY_STACK_SUMMARY } from '@/lib/config/runway-highlights';

interface PipelineProgressProps {
  status: SessionStatus;
  events: PipelineEvent[];
}

type StepStatus = 'pending' | 'active' | 'complete' | 'error';

interface Step {
  id: string;
  label: string;
  statuses: SessionStatus[];
  completeStatuses: SessionStatus[];
}

const DONE: SessionStatus[] = [
  'awaiting_approval',
  'awaiting_storyboard_review',
  'generating_video',
  'awaiting_feedback',
  'complete',
];

const STEPS: Step[] = [
  {
    id: 'upload',
    label: 'Uploading',
    statuses: ['uploading'],
    completeStatuses: DONE,
  },
  {
    id: 'transcribe',
    label: 'Transcribing',
    statuses: ['transcribing'],
    completeStatuses: ['detecting', ...DONE],
  },
  {
    id: 'detect',
    label: 'Detecting viral moments',
    statuses: ['detecting'],
    completeStatuses: DONE,
  },
  {
    id: 'plan',
    label: 'Creating storyboard images (Runway stills)',
    statuses: ['awaiting_storyboard_review'],
    completeStatuses: ['generating_video', 'awaiting_feedback', 'complete'],
  },
  {
    id: 'generate',
    label: 'Generating video (Seedance2 multi-image)',
    statuses: ['generating_video'],
    completeStatuses: ['awaiting_feedback', 'complete'],
  },
];

function getStepStatus(step: Step, currentStatus: SessionStatus): StepStatus {
  if (currentStatus === 'error') return 'error';
  if (step.completeStatuses.includes(currentStatus)) return 'complete';
  if (step.statuses.includes(currentStatus)) return 'active';
  return 'pending';
}

function getLatestProgressMessage(events: PipelineEvent[], stepId: string): string | null {
  const relevant = events.filter(
    (e) => e.type === 'progress' && typeof e.data.step === 'string' && e.data.step === stepId
  );
  if (relevant.length === 0) return null;
  const last = relevant[relevant.length - 1];
  return typeof last.data.message === 'string' ? last.data.message : null;
}

export default function PipelineProgress({ status, events }: PipelineProgressProps) {
  const isError = status === 'error';

  return (
    <div className="space-y-1">
      {STEPS.map((step, idx) => {
        const stepStatus = isError ? 'error' : getStepStatus(step, status);
        const subMessage = getLatestProgressMessage(events, step.id);

        return (
          <div key={step.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={`
                w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border
                ${stepStatus === 'complete' ? 'bg-black border-black' : ''}
                ${stepStatus === 'active' ? 'border-black bg-white' : ''}
                ${stepStatus === 'pending' ? 'border-[#e5e5e5] bg-white' : ''}
                ${stepStatus === 'error' ? 'border-red-500 bg-red-50' : ''}
              `}>
                {stepStatus === 'complete' && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {stepStatus === 'active' && (
                  <div className="w-3 h-3 rounded-full border-2 border-black border-t-transparent animate-spin" />
                )}
                {stepStatus === 'error' && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`w-px h-6 mt-1 ${stepStatus === 'complete' ? 'bg-black' : 'bg-[#e5e5e5]'}`} />
              )}
            </div>

            <div className="pb-5">
              <p className={`text-sm font-medium leading-6 ${
                stepStatus === 'active' ? 'text-black' :
                stepStatus === 'complete' ? 'text-black' : 'text-[#a59f97]'
              }`}>
                {step.label}
              </p>
              {stepStatus === 'active' && subMessage && (
                <p className="text-xs text-[#777169] mt-0.5">{subMessage}</p>
              )}
            </div>
          </div>
        );
      })}

      {isError && (
        <div className="flex items-center gap-2 mt-2 text-sm text-red-500">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/>
            <path d="M8 5v3.5M8 11h.01" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Pipeline encountered an error
        </div>
      )}

      {!isError && (
        <p className="text-[10px] text-[#a59f97] leading-relaxed mt-4 pt-3 border-t border-[#e5e5e5]">
          {RUNWAY_STACK_SUMMARY}
        </p>
      )}
    </div>
  );
}
