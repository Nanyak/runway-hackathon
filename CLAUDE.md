# CLAUDE.md — Podcast-to-Video Generator

## What We're Building

A full-stack web application where users upload a podcast audio file, see detected viral moments in real time, pick **one moment** to generate a short-form vertical video for, then iteratively refine that video with natural language feedback (video-to-video loop) until they're happy — and download the final MP4.

**No CLI.** Everything happens through the browser.

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | **Next.js 14** (App Router, TypeScript) |
| Frontend | React 18, Tailwind CSS |
| Real-time updates | Server-Sent Events (SSE) via Next.js Route Handlers |
| File upload | `next/server` + `formidable` or built-in `FormData` |
| Transcription | OpenAI Whisper API (`whisper-1`, `verbose_json`) |
| LLM | Anthropic Claude (`claude-sonnet-4-5`) |
| Initial video | RunwayML `text_to_video` — **model: `seedance2`** |
| Video refinement | RunwayML `video_to_video` — **model: `gen4_aleph`** |
| Caption burning | FFmpeg `drawtext` / subtitles filter |
| Video processing | FFmpeg via `fluent-ffmpeg` + `ffmpeg-static` |
| Validation | Zod |
| Logging | Winston |
| State persistence | File-based (JSON in `temp/`) — no database needed |

---

## Environment Variables

```
RUNWAY_API_KEY=        # Already configured
OPENAI_API_KEY=        # For Whisper transcription
ANTHROPIC_API_KEY=     # For Claude viral detection + prompt building
```

---

## Project Structure

```
runway-hackathon/
├── .env.local
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # Upload page
│   ├── session/
│   │   └── [sessionId]/
│   │       └── page.tsx                  # Session dashboard
│   └── api/
│       ├── upload/
│       │   └── route.ts                  # POST: receive audio, create session, start pipeline
│       ├── session/
│       │   └── [sessionId]/
│       │       ├── route.ts              # GET: session state
│       │       ├── select/
│       │       │   └── route.ts          # POST: { momentId } → start video gen
│       │       ├── refine/
│       │       │   └── route.ts          # POST: { feedback } → video-to-video
│       │       ├── finalize/
│       │       │   └── route.ts          # POST: accept current video → burn captions
│       │       └── stream/
│       │           └── route.ts          # GET: SSE event stream
│       ├── video/
│       │   └── [sessionId]/
│       │       └── [version]/
│       │           └── route.ts          # GET: stream a version's MP4 (Range support)
│       └── download/
│           └── [sessionId]/
│               └── route.ts              # GET: final captioned MP4
│
├── components/
│   ├── upload/
│   │   ├── DropZone.tsx
│   │   └── ConfigPanel.tsx               # Model, orientation, style anchor
│   ├── session/
│   │   ├── PipelineProgress.tsx          # Step progress with SSE
│   │   ├── MomentCard.tsx                # Score, audio player, clip type
│   │   ├── MomentSelector.tsx            # Gate 1: pick 1 moment
│   │   └── VideoWorkspace.tsx            # Video player + feedback input + history
│   └── ui/
│       ├── Badge.tsx
│       ├── ProgressBar.tsx
│       └── AudioPlayer.tsx
│
├── lib/
│   ├── session.ts
│   ├── pipeline/
│   │   └── orchestrator.ts
│   └── modules/
│       ├── ingestion/
│       │   └── index.ts
│       ├── transcription/
│       │   ├── index.ts
│       │   └── whisper.ts
│       ├── viral-detector/
│       │   ├── index.ts
│       │   ├── prompts.ts
│       │   ├── schema.ts
│       │   └── deduplicator.ts
│       ├── prompt-builder/
│       │   └── index.ts                  # Claude: moment → visual prompt, feedback → refined prompt
│       ├── audio-extractor/
│       │   └── index.ts
│       ├── video-generator/
│       │   ├── index.ts
│       │   └── runway.ts                 # text_to_video + video_to_video + polling
│       └── caption-burner/
│           └── index.ts                  # FFmpeg drawtext / subtitles
│
└── temp/
    └── sessions/
        └── {sessionId}/
            ├── session.json
            ├── original_audio.*
            ├── transcript.json
            ├── moments.json
            ├── moment_audio.wav          ← extracted audio for selected moment
            ├── v1.mp4                    ← initial generated video
            ├── v2.mp4                    ← first refinement
            ├── v3.mp4                    ← second refinement (etc.)
            └── final.mp4                 ← captioned + audio merged output
```

---

## Key Interfaces (`lib/types.ts`)

```typescript
export type SessionStatus =
  | 'uploading'
  | 'transcribing'
  | 'detecting'
  | 'awaiting_selection'    // Gate 1 — user picks which moment to generate
  | 'generating_video'      // initial text-to-video in progress
  | 'awaiting_feedback'     // video ready, user can refine or finalize
  | 'refining'              // video-to-video in progress
  | 'complete'
  | 'error';

export interface Session {
  id: string;
  createdAt: string;
  status: SessionStatus;
  config: SessionConfig;
  audioPath: string;
  transcript?: TranscriptSegment[];
  moments?: Moment[];
  selectedMomentId?: string;
  videoIterations: VideoIteration[];
  currentVideoPath?: string;
  pendingFeedback?: string;
  events: PipelineEvent[];
  error?: string;
}

export interface SessionConfig {
  videoModel: string;            // 'seedance2' default
  orientation: 'vertical' | 'landscape';
  styleAnchor: string;           // e.g. "cinematic, muted tones, 4K, sharp focus"
}

export interface PipelineEvent {
  id: string;
  type: 'progress' | 'moment_detected' | 'video_ready' | 'error' | 'gate' | 'complete';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  words: TranscriptWord[];
}

export interface TranscriptWord {
  word: string;
  startSec: number;
  endSec: number;
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
}

export interface VideoIteration {
  id: string;
  version: number;
  videoPath: string;
  visualPrompt: string;
  userFeedback?: string;       // undefined for v1
  model: string;               // 'seedance2' for v1, 'gen4_aleph' for v2+
  createdAt: string;
}
```

---

## Session Flow

```
1. User uploads audio → POST /api/upload
2. Server creates sessionId, saves audio, starts pipeline in background
3. Browser → /session/{sessionId}
4. Frontend subscribes to SSE stream
5. SSE: transcribing → detecting → moment_detected (per moment) → awaiting_selection
6. User picks 1 moment → POST /api/session/{id}/select
7. Pipeline: extract audio + build visual prompt + generate video (text-to-video)
8. SSE: video_ready { version: 1 }
9. User watches video, optionally types feedback → POST /api/session/{id}/refine
10. Pipeline: refine prompt (Claude) + video-to-video (gen4_aleph) → new version
11. SSE: video_ready { version: 2 }
12. Repeat steps 9–11 until satisfied
13. User clicks "Finalize" → POST /api/session/{id}/finalize
14. Pipeline: burn captions + merge audio → final.mp4
15. SSE: complete { downloadUrl }
16. User downloads from GET /api/download/{sessionId}
```

---

## SSE Stream Format

```
data: {"type":"progress","step":"transcribing","message":"Transcribing...","pct":60}

data: {"type":"moment_detected","moment":{"id":"m1","title":"...","viralScore":87,...}}

data: {"type":"gate","gate":1,"message":"Pick a moment to generate"}

data: {"type":"progress","step":"generating_video","message":"Generating video..."}

data: {"type":"video_ready","version":1,"videoUrl":"/api/video/{sessionId}/v1"}

data: {"type":"video_ready","version":2,"videoUrl":"/api/video/{sessionId}/v2"}

data: {"type":"complete","downloadUrl":"/api/download/{sessionId}"}
```

---

## RunwayML API

**Base URL**: `https://api.dev.runwayml.com`
**Required header**: `X-Runway-Version: 2024-11-06`

### Text-to-Video (initial generation)
```
POST /v1/text_to_video
{ model: "seedance2", promptText, duration: 10,
  ratio: "720:1280" (vertical) | "1280:720" (landscape) }
→ { id: jobId }
```

### Video-to-Video (refinement)
```
POST /v1/video_to_video
{ model: "gen4_aleph", videoUri: "runway://...", promptText, ratio }
→ { id: jobId }
```
Upload local video first via `POST /v1/uploads` to get a `runway://` URI.

### Polling
```
GET /v1/tasks/{jobId}
→ { status: "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED", output: [url] }
```
Poll every 10s, max 60 attempts. On SUCCEEDED download `output[0]`.

---

## Error Handling

- `PermanentError` — bad auth, content policy, no moments found → `status: 'error'`
- `RetryableError` — 429, 503, network → retry with exponential backoff (max 3×)
- Runway FAILED task → retry once with simplified prompt; surface error in UI if still fails
- Claude bad JSON → retry 3× appending "Return ONLY valid JSON, no markdown"
- All errors → `appendEvent({ type: 'error' })` → inline alert in UI

---

## Coding Conventions

- TypeScript strict mode — no `any`, no `!` without comment
- All external API calls through `lib/utils/retry.ts`
- All file paths through `lib/utils/file-utils.ts`
- No `console.log` — use Winston logger from `lib/logger.ts`
- Zod-validate all LLM JSON
- Never log full API keys
- Pipeline modules are pure functions: typed inputs → typed outputs, no global state

---

## Running Locally

```bash
npm install
cp .env .env.local   # add OPENAI_API_KEY + ANTHROPIC_API_KEY
npm run dev          # Next.js at localhost:3000
```
