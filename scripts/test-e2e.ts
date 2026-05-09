/**
 * E2E test: upload audio → auto-approve moments → auto-approve storyboard → wait for video.
 * Usage: npx tsx scripts/test-e2e.ts
 */
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';

function log(msg: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : '');
}

async function upload(audioPath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const config = {
    maxMoments: 1,
    videoModel: 'seedance2',
    imageModel: 'gpt_image_2',
    orientation: 'vertical',
    styleAnchor: 'cinematic, muted tones, 4K, sharp focus',
    speakerName: 'Tim Urban',
    showName: 'TED Talk',
  };

  const form = new FormData();
  form.append('file', blob, path.basename(audioPath));
  form.append('config', JSON.stringify(config));

  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upload failed ${res.status}: ${txt}`);
  }
  const data = await res.json() as { sessionId: string };
  return data.sessionId;
}

async function getSession(sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/session/${sessionId}`);
  const body = await res.json() as Record<string, unknown>;
  // Route returns { session: {...} }
  return (body.session as Record<string, unknown>) ?? body;
}

async function approveFirst(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  const moments = session.moments as Array<{ id: string; hook: string; suggestedStyle?: string }> | undefined;
  if (!moments?.length) throw new Error('No moments found');

  const first = moments[0]!;
  log('Approving moment', { id: first.id, hook: first.hook });

  const res = await fetch(`${BASE}/api/session/${sessionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      approvedIds: [first.id],
      hookEdits: { [first.id]: first.hook },
      styleAnchors: { [first.id]: first.suggestedStyle ?? 'cinematic, muted tones, 4K, sharp focus' },
    }),
  });

  if (!res.ok) throw new Error(`Approve failed: ${res.status} ${await res.text()}`);
  log('Moment approved');
}

async function waitForStoryboardImages(sessionId: string, timeoutMs = 600_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await getSession(sessionId);
    const storyboards = session.storyboards as Record<string, unknown> | undefined;
    if (storyboards && Object.keys(storyboards).length > 0) {
      log('Storyboard images ready');
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Timed out waiting for storyboard images');
}

async function approveStoryboard(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  const approvedIds = session.approvedMomentIds as string[] | undefined;
  if (!approvedIds?.length) throw new Error('No approved moment IDs');

  const momentId = approvedIds[0]!;
  log('Approving storyboard', { momentId });

  const res = await fetch(`${BASE}/api/session/${sessionId}/approve-storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ momentId, selectedSheetIndex: 0 }),
  });

  if (!res.ok) throw new Error(`Storyboard approve failed: ${res.status} ${await res.text()}`);
  log('Storyboard approved');
}

async function pollUntil(
  sessionId: string,
  targetStatuses: string[],
  timeoutMs = 600_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const session = await getSession(sessionId);
    const status = session.status as string;
    if (status !== last) {
      log(`Status → ${status}`);
      last = status;
    }
    if (status === 'error') {
      throw new Error(`Pipeline error: ${session.error as string}`);
    }
    if (targetStatuses.includes(status)) return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for ${targetStatuses.join('|')}`);
}

async function main() {
  const audioFile = path.join(
    process.cwd(),
    'temp/test-clips/Inside the Mind of a Master Procrastinat.mp3'
  );

  if (!fs.existsSync(audioFile)) {
    console.error('Audio file not found:', audioFile);
    process.exit(1);
  }

  log('=== E2E Test Start ===');
  log('Audio:', audioFile);

  // 1. Upload
  log('Uploading audio…');
  const sessionId = await upload(audioFile);
  log('Session created', { sessionId });
  log(`Dashboard: ${BASE}/session/${sessionId}`);

  // 2. Wait for moment detection
  log('Waiting for moment detection…');
  await pollUntil(sessionId, ['awaiting_approval']);

  // 3. Auto-approve first moment
  await approveFirst(sessionId);

  // 4. Wait for storyboard generation (status + actual images)
  log('Waiting for storyboard…');
  await pollUntil(sessionId, ['awaiting_storyboard_review'], 300_000);
  await waitForStoryboardImages(sessionId, 600_000);

  // 5. Auto-approve storyboard
  await approveStoryboard(sessionId);

  // 6. Wait for video generation (allow extra time for queued Runway jobs)
  log('Waiting for video generation…');
  await pollUntil(sessionId, ['awaiting_feedback', 'complete'], 900_000);

  // 7. Done
  const session = await getSession(sessionId);
  log('=== E2E Test PASSED ===');
  log('Final status:', session.status);
  log(`Video: ${BASE}/api/session/${sessionId}/video/${(session.approvedMomentIds as string[])?.[0]}`);
  log(`Download: ${BASE}/api/download/${sessionId}`);
}

main().catch((err) => {
  console.error('[FAIL]', err.message ?? err);
  process.exit(1);
});
