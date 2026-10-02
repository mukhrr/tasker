// Jev decides; it cannot generate. The Analyzer seam in llm.ts still owns
// every word the user reads. Two routes to the same model: TypeSafe's own API,
// and Cloudflare Workers AI for accounts without TypeSafe access.
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

const CLOUDFLARE_MODEL = 'typesafe/jev';
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const TYPESAFE_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;

interface DeciderOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// TypeSafe returns a bare { answers } (confirmed live 2026-09-24). The
// Workers AI envelope is still unconfirmed, so its wrapped shape is accepted.
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

async function postForAnswers(
  url: string,
  token: string,
  body: unknown,
  opts: DeciderOptions
): Promise<Record<string, JevAnswer> | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return answersFrom(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function typesafeJevDecider(
  apiKey: string,
  opts: DeciderOptions = {}
): Decider {
  return (state, questions) =>
    postForAnswers(
      TYPESAFE_URL,
      apiKey,
      { model: TYPESAFE_MODEL, state, questions },
      opts
    );
}

export function cloudflareJevDecider(
  accountId: string,
  token: string,
  opts: DeciderOptions = {}
): Decider {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CLOUDFLARE_MODEL}`;
  return (state, questions) =>
    postForAnswers(url, token, { state, questions }, opts);
}

// Reads a plain record rather than NodeJS.ProcessEnv: Next augments that
// type with a required NODE_ENV, which callers should not have to supply.
type EnvLike = Record<string, string | undefined>;

export function jevModeFromEnv(env: EnvLike = process.env): JevMode {
  const mode = env.JEV_MODE;
  return mode === 'shadow' || mode === 'on' ? mode : 'off';
}

export function deciderFromEnv(env: EnvLike = process.env): Decider | null {
  if (env.TYPESAFE_API_KEY) return typesafeJevDecider(env.TYPESAFE_API_KEY);
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_AI_TOKEN;
  if (!accountId || !token) return null;
  return cloudflareJevDecider(accountId, token);
}
