# Podcast-to-Video Generator — Implementation Plan

## What We're Building

A **full-stack web application** (Next.js 14, App Router). Users upload a podcast, Claude detects viral-worthy moments, the user picks one moment, RunwayML generates a short-form vertical video for it, and the user can iteratively refine the video with natural language feedback (video-to-video loop) until they're happy — then download.

**No CLI. No manual steps. Everything in the browser.**

---

## New Architecture

```
Browser                               Next.js Server
───────                               ──────────────
Upload audio ───────────────────────► POST /api/upload
                                        └─ create session, save audio, start pipeline
Redirect to /session/{id}

Subscribe SSE ◄─────────────────────  GET /api/session/{id}/stream
Progress UI ◄─ transcribing, detecting, moment_detected events

Gate 1: Pick 1 moment ─────────────► POST /api/session/{id}/select
                                        └─ extract audio + generate initial video (text-to-video)

Video player + feedback input          (video ready, user watches)

Submit feedback ───────────────────► POST /api/session/{id}/refine
                                        └─ Claude refines prompt + video-to-video (gen4_aleph)

Repeat refinement loop...

Download ◄──────────────────────────  GET /api/download/{sessionId}
```

---

## Key Design Decisions

- **One moment, one video** — user picks 1 moment, gets 1 video (10s). No multi-scene complexity.
- **Concurrency = 1** — Runway Tier 1 allows 1 concurrent job. Pipeline is intentionally sequential.
- **No Remotion** — video is B-roll from Runway. Captions burned via FFmpeg drawtext from transcript word timings.
- **No scene planner** — Claude generates a single cinematic visual prompt for the full moment.
- **Iterative refinement** — video-to-video loop with gen4_aleph lets users nudge style/mood without starting over.
- **Video history** — every version is saved, user can go back to a prior version.

---

## Phase 1 — Project Setup

### 1.1 — Scaffold (already done, skip if project exists)

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
npm install \
  @anthropic-ai/sdk openai \
  fluent-ffmpeg ffmpeg-static ffprobe-static \
  p-queue zod winston \
  formidable uuid \
  @types/fluent-ffmpeg @types/formidable @types/uuid
```

**`next.config.ts`**:
```typescript
const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '500mb' } },
  api: { bodyParser: false },
};
```

---

### 1.2 — Core types (`lib/types.ts`)

```typescript
export type SessionStatus =
  | 'uploading'
  | 'transcribing'
  | 'detecting'
  | 'awaiting_selection'   // Gate 1 — user picks which moment to generate
  | 'generating_video'     // initial text-to-video in progress
  | 'awaiting_feedback'    // video ready, user can refine or download
  | 'refining'             // video-to-video in progress
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
  selectedMomentId?: string;       // the moment the user chose
  videoIterations: VideoIteration[]; // full history of generated videos
  currentVideoPath?: string;        // path to the latest video
  events: PipelineEvent[];
  error?: string;
}

export interface SessionConfig {
  videoModel: string;           // 'seedance2' default
  orientation: 'vertical' | 'landscape';
  styleAnchor: string;          // e.g. "cinematic, muted tones, 4K"
}

export interface PipelineEvent {
  id: string;
  type:
    | 'progress'
    | 'moment_detected'
    | 'video_ready'           // initial video or refined video done
    | 'error'
    | 'gate'
    | 'complete';
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
  version: number;             // 1 = initial, 2+ = refined
  videoPath: string;           // local path to the MP4
  visualPrompt: string;        // the full prompt sent to Runway
  userFeedback?: string;       // what the user asked for (undefined for v1)
  model: string;               // 'seedance2' or 'gen4_aleph'
  createdAt: string;
}
```

---

### 1.3 — Session manager (`lib/session.ts`)

All state in `temp/sessions/{sessionId}/session.json`.

```typescript
export async function createSession(config: SessionConfig, audioPath: string): Promise<Session>
export async function getSession(id: string): Promise<Session | null>
export async function updateSession(id: string, patch: Partial<Session>): Promise<Session>
export async function appendEvent(id: string, event: Omit<PipelineEvent, 'id'>): Promise<void>
// appendEvent: read → push → write .tmp → rename (atomic)
```

File layout:
```
temp/sessions/{sessionId}/
  session.json
  original_audio.mp3
  transcript.json          ← checkpoint
  moments.json             ← checkpoint
  moment_audio.wav         ← extracted audio for selected moment
  v1.mp4                   ← initial generated video
  v2.mp4                   ← first refinement
  v3.mp4                   ← second refinement
  final.mp4                ← symlink or copy of current best
```

---

### 1.4 — Utilities

**`lib/utils/retry.ts`**:
```typescript
export class PermanentError extends Error {}
export class RetryableError extends Error {}
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>
// opts: { maxAttempts, delayMs, backoff: 'exponential' | 'linear' }
```

**`lib/utils/file-utils.ts`**:
```typescript
export function sessionDir(sessionId: string): string
export function videoPath(sessionId: string, version: number): string
export function momentAudioPath(sessionId: string): string
export async function ensureDir(p: string): Promise<void>
export async function downloadFile(url: string, dest: string): Promise<void>
```

**`lib/logger.ts`** — Winston, writes to `temp/app.log` + console.

---

## Phase 2 — Upload Page

### 2.1 — Upload UI (`app/page.tsx`)

Centered page:
- `<DropZone>` — drag & drop or click, accept MP3/WAV/M4A/MP4
- `<ConfigPanel>` — collapsible:
  - Model selector (seedance2, gen4.5)
  - Orientation toggle (Vertical 9:16 / Landscape 16:9)
  - Style anchor text (default: "cinematic, muted tones, 4K, sharp focus")
- Upload progress bar (XHR with progress event)
- On complete → redirect to `/session/{sessionId}`

---

### 2.2 — Upload API (`app/api/upload/route.ts`)

```typescript
export async function POST(req: Request): Promise<Response> {
  // 1. Parse multipart form
  // 2. Validate MIME + size ≤ 2GB
  // 3. Save to temp/sessions/{sessionId}/original_audio.{ext}
  // 4. createSession(config, audioPath)
  // 5. Fire-and-forget: setImmediate(() => runPipeline(sessionId))
  // 6. Return { sessionId } immediately
}
```

---

## Phase 3 — Session Dashboard + SSE

### 3.1 — Session page (`app/session/[sessionId]/page.tsx`)

Client component. Renders different stage components based on `session.status`:

```
status === 'transcribing' | 'detecting'  →  <PipelineProgress>
status === 'awaiting_selection'          →  <MomentSelector>
status === 'generating_video'            →  <PipelineProgress> (video generating...)
status === 'awaiting_feedback'           →  <VideoWorkspace>   ← main interactive area
status === 'refining'                    →  <VideoWorkspace> with loading overlay
status === 'complete'                    →  <VideoWorkspace> with download button
```

### 3.2 — SSE Stream (`app/api/session/[sessionId]/stream/route.ts`)

Poll `session.json` every 500ms, send new events since `lastEventId`. Close stream on `complete` or `error`.

### 3.3 — Session GET API (`app/api/session/[sessionId]/route.ts`)

Returns full session JSON (minus large binary fields). Used for initial page hydration.

---

## Phase 4 — Gate 1: Moment Selection

### 4.1 — Moment Selector (`components/session/MomentSelector.tsx`)

Shown when `status === 'awaiting_selection'`. One card per detected moment:

```
┌────────────────────────────────────────┐
│  "The AI Will Take Your Job"           │
│  ██████████ 94 · Insight · 45s         │
│  ▶ [audio snippet player]              │
│  Why: Strong counter-intuitive claim   │
│                                        │
│        [Generate Video for This]       │
└────────────────────────────────────────┘
```

Clicking "Generate Video" → POST `/api/session/{id}/select` with `{ momentId }`.

### 4.2 — Select API (`app/api/session/[sessionId]/select/route.ts`)

```typescript
export async function POST(req: Request) {
  const { momentId } = await req.json();
  await updateSession(sessionId, {
    selectedMomentId: momentId,
    status: 'generating_video',
  });
  // Pipeline is polling — it picks up status change and starts video generation
  return Response.json({ ok: true });
}
```

---

## Phase 5 — Pipeline Modules

### 5.1 — Ingestion (`lib/modules/ingestion/index.ts`)

```typescript
export async function validateAudio(filePath: string): Promise<AudioMetadata>
// Check MIME, size, duration ≤ 180min. Throw PermanentError if invalid.

export async function rechunkAudio(filePath: string, outDir: string): Promise<string[]>
// Re-encode to 16kHz mono WAV. Split into ≤20MB chunks with 2s overlap for Whisper.
```

---

### 5.2 — Transcription (`lib/modules/transcription/`)

```typescript
// whisper.ts
export async function transcribeChunk(chunkPath: string): Promise<TranscriptSegment>
// openai.audio.transcriptions.create({ model: 'whisper-1', response_format: 'verbose_json',
//   timestamp_granularities: ['word'] })

// index.ts
export async function transcribeAll(
  chunks: string[],
  onProgress: (pct: number) => void
): Promise<TranscriptSegment[]>
// Sequential (Tier 1 rate limits). Calls onProgress after each chunk.

export function stitchTranscripts(transcripts: TranscriptSegment[]): TranscriptSegment[]
// Deduplicate words at 2s overlap boundaries.
```

Checkpoint: save to `transcript.json`.

---

### 5.3 — Viral Detector (`lib/modules/viral-detector/`)

**`prompts.ts`**:
```
You are a viral content strategist for TikTok, Instagram Reels, and YouTube Shorts.
Identify the most viral-worthy moments in this podcast transcript.
Score 0–100: emotional intensity, standalone clarity, quotability, hook potential.
Each moment: ≥15s, must not overlap others, must not cut mid-sentence.
Return JSON: [{ id, title, startSec, endSec, viralScore, reason, hook, mood, clipType }]
Return at most 5 moments, sorted by viralScore descending.
```

**`schema.ts`** — Zod validation:
- `viralScore`: 0–100
- `endSec - startSec >= 15`
- `hook.length <= 100`

**`deduplicator.ts`**: Greedy non-overlapping selection by score.

**`index.ts`**: `detectMoments(transcript, config, onMoment)` — Claude → parse → Zod validate → deduplicate → emit `moment_detected` SSE per moment → save `moments.json`.

---

### 5.4 — Audio Extractor (`lib/modules/audio-extractor/index.ts`)

```typescript
export async function extractMomentAudio(
  srcPath: string,
  moment: Moment,
  outPath: string
): Promise<void>
// FFmpeg: -ss startSec -t duration -af loudnorm=I=-14 -ar 48000 -ac 2
// Output is the audio track that will be merged with the final video.
```

---

### 5.5 — Prompt Builder (`lib/modules/prompt-builder/index.ts`)

Generates the visual prompt for Runway from the moment transcript + style anchor.

```typescript
export async function buildVisualPrompt(
  moment: Moment,
  transcript: TranscriptSegment[],
  styleAnchor: string
): Promise<string>
// Claude call: given the moment text, generate a rich cinematic visual description
// for a 10-second B-roll clip. No faces. No text overlays. Abstract/metaphorical
// imagery that complements the spoken content.
// Output: a single descriptive paragraph, max 300 chars.

export async function refineVisualPrompt(
  currentPrompt: string,
  userFeedback: string,
  styleAnchor: string
): Promise<string>
// Claude call: take the existing prompt + user feedback and produce an updated prompt.
// Preserve the core concept, apply the user's requested style/mood changes.
```

---

### 5.6 — Video Generator (`lib/modules/video-generator/`)

**`runway.ts`**:
```typescript
export async function submitTextToVideo(
  prompt: string,
  config: SessionConfig
): Promise<string>
// POST /v1/text_to_video
// { model: config.videoModel, promptText: prompt, duration: 10,
//   ratio: config.orientation === 'vertical' ? '720:1280' : '1280:720' }
// Returns jobId.

export async function submitVideoToVideo(
  videoPath: string,
  prompt: string,
  config: SessionConfig
): Promise<string>
// Upload video via /v1/uploads → get runway:// URI
// POST /v1/video_to_video
// { model: 'gen4_aleph', videoUri: runwayUri, promptText: prompt, ratio }
// Returns jobId.

export async function pollTask(jobId: string): Promise<string>
// GET /v1/tasks/{jobId} every 10s, max 60 attempts.
// Returns output URL on SUCCEEDED. Throws RetryableError on FAILED.
```

**`index.ts`**:
```typescript
export async function generateInitialVideo(
  prompt: string,
  config: SessionConfig,
  destPath: string
): Promise<void>
// submitTextToVideo → pollTask → downloadFile(outputUrl, destPath)

export async function refineVideo(
  currentVideoPath: string,
  refinedPrompt: string,
  config: SessionConfig,
  destPath: string
): Promise<void>
// submitVideoToVideo → pollTask → downloadFile(outputUrl, destPath)
```

---

### 5.7 — Caption Burner (`lib/modules/caption-burner/index.ts`)

Burns word-level captions onto the final video using FFmpeg drawtext.

```typescript
export async function burnCaptions(
  videoPath: string,
  audioPath: string,
  words: TranscriptWord[],   // words for the selected moment
  outPath: string
): Promise<void>
// 1. Generate .srt file from word timings
// 2. FFmpeg: -i video -i audio -vf subtitles=captions.srt
//    -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k
//    -movflags +faststart
// Bold white text, black outline, bottom-center, max 2 lines.
```

---

## Phase 6 — Orchestrator

### 6.1 — Pipeline Orchestrator (`lib/pipeline/orchestrator.ts`)

```typescript
export async function runPipeline(sessionId: string): Promise<void> {
  const emit = (type, data) =>
    appendEvent(sessionId, { type, data, timestamp: new Date().toISOString() });

  try {
    const session = await getSession(sessionId);

    // ── STEP 1: Ingestion ──
    emit('progress', { step: 'ingesting', message: 'Validating audio...' });
    const chunks = await rechunkAudio(session.audioPath, chunkDir(sessionId));

    // ── STEP 2: Transcription ──
    const transcript = await loadCheckpoint(sessionId, 'transcript') ??
      await (async () => {
        emit('progress', { step: 'transcribing', message: 'Transcribing audio...' });
        const t = await transcribeAll(chunks, pct =>
          emit('progress', { step: 'transcribing', pct, message: `Transcribing... ${pct}%` })
        );
        await saveCheckpoint(sessionId, 'transcript', t);
        return t;
      })();

    // ── STEP 3: Viral Detection ──
    const moments = await loadCheckpoint(sessionId, 'moments') ??
      await (async () => {
        emit('progress', { step: 'detecting', message: 'Finding viral moments...' });
        const m = await detectMoments(transcript, session.config, moment =>
          emit('moment_detected', { moment })
        );
        await saveCheckpoint(sessionId, 'moments', m);
        return m;
      })();

    // ── GATE 1: Wait for user to pick a moment ──
    emit('gate', { gate: 1, message: 'Pick a moment to generate' });
    await updateSession(sessionId, { status: 'awaiting_selection', moments });
    const selectedMomentId = await waitForMomentSelection(sessionId);
    // waitForMomentSelection: polls session.selectedMomentId every 2s

    const selectedMoment = moments.find(m => m.id === selectedMomentId);
    if (!selectedMoment) throw new PermanentError('Selected moment not found');

    // ── STEP 4: Extract audio ──
    emit('progress', { step: 'extracting_audio', message: 'Extracting audio clip...' });
    await extractMomentAudio(
      session.audioPath,
      selectedMoment,
      momentAudioPath(sessionId)
    );

    // ── STEP 5: Build visual prompt ──
    emit('progress', { step: 'building_prompt', message: 'Crafting visual prompt...' });
    const visualPrompt = await buildVisualPrompt(
      selectedMoment,
      transcript,
      session.config.styleAnchor
    );

    // ── STEP 6: Generate initial video ──
    emit('progress', { step: 'generating_video', message: 'Generating video...' });
    const v1Path = videoPath(sessionId, 1);
    await generateInitialVideo(visualPrompt, session.config, v1Path);

    const iteration: VideoIteration = {
      id: uuidv4(), version: 1, videoPath: v1Path,
      visualPrompt, model: session.config.videoModel,
      createdAt: new Date().toISOString(),
    };
    await updateSession(sessionId, {
      status: 'awaiting_feedback',
      currentVideoPath: v1Path,
      videoIterations: [iteration],
    });
    emit('video_ready', { version: 1, videoUrl: `/api/video/${sessionId}/v1` });

    // ── REFINEMENT LOOP: polls for refine requests ──
    await runRefinementLoop(sessionId, selectedMoment, transcript, session.config);

    // ── STEP 7: Burn captions onto final video ──
    const finalSession = await getSession(sessionId);
    if (!finalSession?.currentVideoPath) throw new PermanentError('No video to finalize');

    emit('progress', { step: 'finalizing', message: 'Burning captions...' });
    const momentWords = transcript
      .filter(s => s.startSec >= selectedMoment.startSec && s.endSec <= selectedMoment.endSec)
      .flatMap(s => s.words)
      .map(w => ({ ...w, startSec: w.startSec - selectedMoment.startSec,
                          endSec: w.endSec - selectedMoment.startSec }));

    await burnCaptions(
      finalSession.currentVideoPath,
      momentAudioPath(sessionId),
      momentWords,
      finalPath(sessionId)
    );

    await updateSession(sessionId, { status: 'complete' });
    emit('complete', { downloadUrl: `/api/download/${sessionId}` });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSession(sessionId, { status: 'error', error: message });
    emit('error', { message });
  }
}

async function runRefinementLoop(
  sessionId: string,
  moment: Moment,
  transcript: TranscriptSegment[],
  config: SessionConfig
): Promise<void> {
  // Polls session every 2s. When status changes to 'refining', execute the refinement.
  // Returns when status is set to 'complete' by the /finalize endpoint.
  while (true) {
    await sleep(2000);
    const session = await getSession(sessionId);
    if (!session) return;
    if (session.status === 'complete') return;
    if (session.status !== 'refining') continue;

    const currentIteration = session.videoIterations.at(-1);
    if (!currentIteration) continue;

    const feedback = session.pendingFeedback;
    if (!feedback) continue;

    const refinedPrompt = await refineVisualPrompt(
      currentIteration.visualPrompt,
      feedback,
      config.styleAnchor
    );

    const nextVersion = session.videoIterations.length + 1;
    const nextPath = videoPath(sessionId, nextVersion);
    await refineVideo(currentIteration.videoPath, refinedPrompt, config, nextPath);

    const newIteration: VideoIteration = {
      id: uuidv4(), version: nextVersion, videoPath: nextPath,
      visualPrompt: refinedPrompt, userFeedback: feedback,
      model: 'gen4_aleph', createdAt: new Date().toISOString(),
    };

    await updateSession(sessionId, {
      status: 'awaiting_feedback',
      currentVideoPath: nextPath,
      videoIterations: [...session.videoIterations, newIteration],
      pendingFeedback: undefined,
    });
    appendEvent(sessionId, {
      type: 'video_ready',
      data: { version: nextVersion, videoUrl: `/api/video/${sessionId}/v${nextVersion}` },
      timestamp: new Date().toISOString(),
    });
  }
}
```

Add `pendingFeedback?: string` to `Session` type.

---

## Phase 7 — Video Workspace UI

### 7.1 — VideoWorkspace (`components/session/VideoWorkspace.tsx`)

The main interactive component, shown during `awaiting_feedback`, `refining`, and `complete`.

```
┌─────────────────────────────────────────────┐
│                                             │
│   ┌─────────────────────────────────────┐  │
│   │                                     │  │
│   │          <video autoPlay loop>      │  │  ← current best video
│   │          v3 of 3                    │  │
│   └─────────────────────────────────────┘  │
│                                             │
│   History:  [v1] [v2] [▶ v3]               │  ← click to preview any version
│                                             │
│   ┌─────────────────────────────────────┐  │
│   │  What would you like to change?     │  │
│   │  e.g. "make it darker and moodier"  │  │
│   └─────────────────────────────────────┘  │
│                                             │
│   [Refine Video]          [Finalize & Download] │
└─────────────────────────────────────────────┘
```

- During `status === 'refining'`: show spinner overlay on video, disable inputs
- "Refine Video" → POST `/api/session/{id}/refine` with `{ feedback: string }`
- "Finalize & Download" → POST `/api/session/{id}/finalize` → triggers caption burning → download

### 7.2 — Refine API (`app/api/session/[sessionId]/refine/route.ts`)

```typescript
export async function POST(req: Request) {
  const { feedback } = await req.json();
  // Zod: feedback must be non-empty string ≤ 500 chars
  await updateSession(sessionId, {
    status: 'refining',
    pendingFeedback: feedback,
  });
  return Response.json({ ok: true });
}
```

### 7.3 — Finalize API (`app/api/session/[sessionId]/finalize/route.ts`)

```typescript
export async function POST(req: Request) {
  await updateSession(sessionId, { status: 'complete' });
  // Orchestrator's refinement loop exits, proceeds to caption burning
  return Response.json({ ok: true });
}
```

### 7.4 — Video serve API (`app/api/video/[sessionId]/[version]/route.ts`)

```typescript
export async function GET(req, { params }) {
  const { sessionId, version } = params;
  // version is 'v1', 'v2', etc.
  const vNum = parseInt(version.replace('v', ''), 10);
  const filePath = videoPath(sessionId, vNum);
  // Stream MP4 with Range header support (for <video> scrubbing)
}
```

### 7.5 — Download API (`app/api/download/[sessionId]/route.ts`)

```typescript
export async function GET(req, { params }) {
  const filePath = finalPath(params.sessionId);
  const stat = await fs.stat(filePath);
  return new Response(fs.createReadStream(filePath) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Content-Disposition': 'attachment; filename="viral_clip.mp4"',
    }
  });
}
```

---

## UI Page Map

| Route | Component | Condition |
|-------|-----------|-----------|
| `/` | Upload page | Always |
| `/session/{id}` | Session dashboard | After upload |
| — `PipelineProgress` | `transcribing` / `detecting` / `generating_video` |
| — `MomentSelector` | `awaiting_selection` |
| — `VideoWorkspace` | `awaiting_feedback` / `refining` / `complete` |

---

## API Route Map

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/upload` | Upload audio, start pipeline |
| GET | `/api/session/{id}` | Fetch session state |
| GET | `/api/session/{id}/stream` | SSE event stream |
| POST | `/api/session/{id}/select` | Pick a moment → start video gen |
| POST | `/api/session/{id}/refine` | Submit feedback → video-to-video |
| POST | `/api/session/{id}/finalize` | Accept current video → burn captions |
| GET | `/api/video/{id}/{version}` | Stream a version's MP4 |
| GET | `/api/download/{id}` | Download final captioned MP4 |

---

## Cost Estimates

| Step | Cost |
|------|------|
| Whisper (1hr podcast) | ~$0.36 |
| Claude (detection + prompt build + each refine) | ~$0.10–0.30 |
| Runway text-to-video 10s (seedance2) | ~$0.36 |
| Each video-to-video refinement 10s (gen4_aleph) | ~$0.15 |
| **Total for 1 moment + 2 refinements** | **~$1.00–1.25** |

Display live estimate on the selection gate before user commits.

---

## Error Handling

- `PermanentError` — bad auth, content policy, no moments found → set `status: 'error'`
- `RetryableError` — 429, 503, FAILED → retry with backoff (max 3×)
- Runway FAILED task → retry once with simplified prompt; if still fails, surface error in UI with "Try again" button
- Claude bad JSON → retry 3× with "Return ONLY valid JSON, no markdown" suffix
- All errors → `appendEvent({ type: 'error', data: { message } })` → shown in UI as inline alert

---

## Build Order

1. `lib/types.ts` + `lib/utils/` + `lib/session.ts` + `lib/logger.ts`
2. `lib/modules/ingestion/` + `lib/modules/transcription/`
3. `app/api/upload/route.ts` + `app/page.tsx` + `components/upload/`
4. `app/api/session/{id}/stream/route.ts` + `components/session/PipelineProgress.tsx`
5. `lib/modules/viral-detector/` → `app/api/session/{id}` GET + `components/session/MomentSelector.tsx`
6. `app/api/session/{id}/select/route.ts`
7. `lib/modules/audio-extractor/` + `lib/modules/prompt-builder/`
8. `lib/modules/video-generator/` → `app/api/session/{id}/refine` + `app/api/session/{id}/finalize`
9. `app/api/video/{id}/{version}/route.ts` + `components/session/VideoWorkspace.tsx`
10. `lib/modules/caption-burner/` + `app/api/download/{id}/route.ts`
11. `lib/pipeline/orchestrator.ts` (wires steps 2–10)

---

## Running Locally

```bash
npm install
cp .env .env.local   # ensure all three API keys are set
npm run dev          # Next.js at http://localhost:3000
```
