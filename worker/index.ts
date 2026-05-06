import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { runPollCycle } from '../src/lib/proposals/poll';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTIVE_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1500);
const IDLE_INTERVAL_MS = Number(process.env.POLL_IDLE_INTERVAL_MS ?? 60_000);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.'
  );
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

let wakeResolver: (() => void) | null = null;
function wake() {
  const r = wakeResolver;
  wakeResolver = null;
  r?.();
}

// Wake the loop the moment any proposal row changes — covers new drafts being
// armed, disarmed, or auto-posted on a parallel worker.
supabase
  .channel('proposals-watch')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'proposals' },
    () => wake()
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('[proposals-worker] realtime subscribed');
    }
  });

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
  console.log('SIGINT received, finishing current cycle...');
  wake();
});
process.on('SIGTERM', () => {
  stopping = true;
  wake();
});

console.log(
  `[proposals-worker] starting; active=${ACTIVE_INTERVAL_MS}ms idle=${IDLE_INTERVAL_MS}ms`
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      wakeResolver = null;
      resolve();
    }, ms);
    wakeResolver = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

(async function loop() {
  while (!stopping) {
    const start = Date.now();
    let idle = true;
    try {
      const s = await runPollCycle(supabase);
      idle = s.repos === 0;
      if (s.matches > 0 || s.posted > 0 || s.failed > 0) {
        console.log(
          `[proposals-worker] cycle ok | repos=${s.repos} matches=${s.matches} posted=${s.posted} failed=${s.failed} | ${Date.now() - start}ms`
        );
      }
    } catch (e) {
      console.error('[proposals-worker] cycle error', e);
    }
    if (stopping) break;
    const elapsed = Date.now() - start;
    const target = idle ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS;
    const wait = Math.max(0, target - elapsed);
    if (wait > 0) await sleep(wait);
  }
  console.log('[proposals-worker] stopped.');
  process.exit(0);
})();
