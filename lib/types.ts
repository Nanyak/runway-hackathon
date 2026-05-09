export type SessionStatus =
  | 'uploading'
  | 'transcribing'
  | 'detecting'
  | 'awaiting_approval'          // Gate 1: user picks which moments to generate
  | 'awaiting_storyboard_review' // Gate 1.5: user reviews storyboard frames, optionally requests changes
  | 'generating_video'           // Seedance2 text_to_video running with all storyboard images + audio
  | 'awaiting_feedback'          // video(s) ready, user refines or finalizes
  | 'complete'
  | 'error';

export interface Session {
  id: string;
  createdAt: string;
  status: SessionStatus;
  config: SessionConfig;
  audioPath: string;
  transcript?: Transcript[];
  podcastContext?: PodcastContext;
  moments?: Moment[];
  approvedMomentIds?: string[];
  hookEdits?: Record<string, string>;
  // Per-moment style anchors: user-approved style string (AI-suggested or overridden at Gate 1)
  momentStyleAnchors?: Record<string, string>;
  // Local path to the GPT Image 2 character portrait generated before storyboard planning
  characterRefPath?: string;
  // Gate 1.5: storyboard review state per moment
  storyboards?: Record<string, StoryboardPlan>;
  storyboardApprovals?: Record<string, boolean>;
  storyboardIterations?: Record<string, number>;
  events: PipelineEvent[];
  error?: string;
}

export interface SessionConfig {
  maxMoments: number;
  /** Locked to gpt_image_2 — kept for legacy API compat. */
  imageModel?: string;
  videoModel: string;      // gen4.5 | seedance2 | etc.
  orientation: 'vertical' | 'landscape';
  styleAnchor: string;
  speakerName: string;
  showName: string;
  /** Number of storyboard sheet variants to generate (1–3). More = longer wait. */
  sheetVariantCount?: number;
}

export interface PipelineEvent {
  id: string;
  type:
    | 'progress'
    | 'moment_detected'
    | 'variation_ready'           // legacy: one frame variation image generated
    | 'storyboard_frame_ready'    // one storyboard frame image generated
    | 'storyboard_analysis_complete' // AI decided which frames to regenerate
    | 'storyboard_ready'          // all frames ready (after feedback loop completes)
    | 'storyboard_thinking'       // live AI reasoning message during storyboard planning/imaging
    | 'video_ready'               // moment video ready (text_to_video done)
    | 'render_complete'   // final.mp4 saved (same bytes as selected Runway clip + its audio)
    | 'error'
    | 'gate'
    | 'complete';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface TranscriptWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface Transcript {
  startSec: number;
  endSec: number;
  text: string;
  words: TranscriptWord[];
}

export interface Moment {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  viralScore: number;
  reason: string;
  hook: string;
  mood: 'inspiring' | 'funny' | 'educational' | 'controversial' | 'emotional';
  clipType: 'one-liner' | 'story-arc' | 'insight' | 'reaction';
  /** AI-suggested visual style for this moment's storyboard, based on mood and clip type. */
  suggestedStyle?: string;
}

/**
 * One candidate starting frame for a moment's video.
 * @deprecated Replaced by StoryboardFrame in the new storyboard-based flow.
 */
export interface FrameVariation {
  index: number;
  imagePrompt: string;
  motionPrompt: string;
  style: string;
  imagePath?: string;
}

/** One frame in a sequential visual narrative for a moment's video. */
export interface StoryboardFrame {
  index: number;            // 0-based position in the narrative sequence
  sceneDescription: string; // human-readable description of what happens in this frame
  imagePrompt: string;      // detailed prompt for text_to_image generation
  motionContribution: string; // how this frame advances the visual story
  style: string;            // visual style tags
  imagePath?: string;       // set after image generation
}

/** Full storyboard plan for one moment — frames + unified motion prompt for Seedance2. */
export interface StoryboardPlan {
  frames: StoryboardFrame[];
  overallMotionPrompt: string; // unified promptText for Seedance2 text_to_video
  /** How many sheet variants were generated (default 1, up to 3). */
  sheetVariantCount?: number;
  /** Which sheet variant index the user selected (0-based, default 0). Set on approval. */
  selectedSheetIndex?: number;
}

/** Analysis result from the storyboard-analyzer when user gives feedback. */
export interface StoryboardAnalysis {
  framesToRegenerate: number[];       // frame indices that need new images
  updatedFrames: StoryboardFrame[];   // full updated frame list (revised prompts)
  updatedMotionPrompt: string;        // revised overallMotionPrompt
}

export interface PodcastContext {
  topic: string;
  genre: string;
  speakers: string[];
  summary: string;
}

export interface VideoRevision {
  id: string;
  momentId: string;
  feedback: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  createdAt: string;
  videoPath?: string;
  error?: string;
}

export interface AudioMetadata {
  duration: number;
  format: string;
  size: number;
  path: string;
}

export interface JobRecord {
  momentId: string;   // previously named sceneId
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED';
  outputPath?: string;
}

/** @deprecated kept only for legacy Remotion Root.tsx type references */
export interface Scene {
  id: string;
  momentId: string;
  indexInMoment: number;
  startSec: number;
  endSec: number;
  captionText: string;
  imagePrompt: string;
  videoMotionPrompt: string;
  brollType: 'abstract' | 'metaphor' | 'literal' | 'text-only';
  transitionType: 'cut' | 'fade' | 'zoom';
}
