import { NextRequest } from 'next/server';
import { getDb } from '@/lib/cache/db';

interface LogRow {
  id: number;
  timestamp: number;
  environment_id: string | null;
  environment_name: string | null;
  method: string;
  path: string;
  zone: string | null;
  status: number;
  ip: string;
  user_agent: string;
  duration_ms: number;
  error: string | null;
}

// GET /api/proxy/logs/stream — SSE endpoint for live proxy logs
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  let lastId = 0;
  let closed = false;

  // Get latest ID as starting point
  try {
    const db = getDb();
    const row = db.prepare('SELECT MAX(id) as maxId FROM proxy_logs').get() as { maxId: number | null };
    lastId = row.maxId || 0;
  } catch {
    // Start from 0
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial keepalive
      controller.enqueue(encoder.encode(': connected\n\n'));

      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        try {
          const db = getDb();
          const rows = db.prepare(
            'SELECT * FROM proxy_logs WHERE id > ? ORDER BY id ASC LIMIT 50'
          ).all(lastId) as LogRow[];

          for (const row of rows) {
            const entry = {
              id: row.id,
              timestamp: new Date(row.timestamp * 1000).toISOString(),
              environmentId: row.environment_id,
              environmentName: row.environment_name,
              method: row.method,
              path: row.path,
              zone: row.zone,
              status: row.status,
              ip: row.ip,
              userAgent: row.user_agent,
              durationMs: row.duration_ms,
              error: row.error,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
            lastId = row.id;
          }

          // Send keepalive if no new logs
          if (rows.length === 0) {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          }
        } catch {
          // Ignore DB errors during polling
        }
      }, 2000); // Poll every 2 seconds

      // Clean up on abort
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
