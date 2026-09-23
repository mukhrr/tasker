// Jev decides; it cannot generate. The Analyzer seam in llm.ts still owns
// every word the user reads. Reached through Cloudflare Workers AI because
// TypeSafe's own access is waitlisted.
export type JevMode = 'off' | 'shadow' | 'on';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string | null>;
    };

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

// Resolves null on every failure. Callers fall back to the LLM path; a
// broken accelerator must never fail a sync.
export type Decider = (
  state: unknown,
  questions: Record<string, JevQuestion>
) => Promise<Record<string, JevAnswer> | null>;

const MODEL = 'typesafe/jev';
const DEFAULT_TIMEOUT_MS = 5000;

// The Workers AI envelope for this model is unconfirmed against a live
// call, so both the wrapped and bare shapes are accepted.
function answersFrom(body: unknown): Record<string, JevAnswer> | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as {
    result?: { answers?: unknown };
    answers?: unknown;
  };
  const answers = envelope.result?.answers ?? envelope.answers;
  if (!answers || typeof answers !== 'object') return null;
  return answers as Record<string, JevAnswer>;
}

export function cloudflareJevDecider(
  accountId: string,
  token: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Decider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

  return async (state, questions) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state, questions }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return answersFrom(await res.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

// Reads a plain record rather than NodeJS.ProcessEnv: Next augments that
// type with a required NODE_ENV, which callers should not have to supply.
type EnvLike = Record<string, string | undefined>;

export function jevModeFromEnv(env: EnvLike = process.env): JevMode {
  const mode = env.JEV_MODE;
  return mode === 'shadow' || mode === 'on' ? mode : 'off';
}

export function deciderFromEnv(env: EnvLike = process.env): Decider | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_AI_TOKEN;
  if (!accountId || !token) return null;
  return cloudflareJevDecider(accountId, token);
}
