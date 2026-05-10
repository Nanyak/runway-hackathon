import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import logger from '@/lib/logger';

const FAST_POLL_MS = 500;
const SLOW_POLL_MS = 2000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventIndex = 0;
      const signal = req.signal;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      function closeController() {
        try { controller.close(); } catch { /* already closed */ }
      }

      signal.addEventListener('abort', () => {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        closeController();
      });

      function sendEvent(data: unknown) {
        const line = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(line));
      }

      async function poll() {
        if (signal.aborted) return;

        try {
          const session = await getSession(sessionId);
          if (!session) {
            sendEvent({ type: 'error', data: { message: 'Session not found' } });
            closeController();
            return;
          }

          const newEvents = session.events.slice(lastEventIndex);
          for (const event of newEvents) {
            sendEvent(event);
            lastEventIndex++;
          }

          if (session.status === 'complete' || session.status === 'error') {
            closeController();
            return;
          }

          // Slow down polling while waiting at gates — no work is happening
          const gateStatuses: string[] = ['awaiting_approval', 'awaiting_storyboard_review', 'awaiting_feedback'];
          const interval = gateStatuses.includes(session.status) ? SLOW_POLL_MS : FAST_POLL_MS;

          if (!signal.aborted) {
            timeoutHandle = setTimeout(poll, interval);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('SSE poll error', { sessionId, error: msg });
          if (!signal.aborted) {
            timeoutHandle = setTimeout(poll, FAST_POLL_MS);
          }
        }
      }

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
