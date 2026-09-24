// JS port of src/lib/agent/jev.ts for the workers, which run plain Node and
// cannot import the app's TypeScript. The analyzer imports this file too.
const TYPESAFE_URL = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone';
const TYPESAFE_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;

function answersFrom(body) {
  if (!body || typeof body !== 'object') return null;
  const answers = body.result?.answers ?? body.answers;
  return answers && typeof answers === 'object' ? answers : null;
}

// Resolves null on every failure: a broken accelerator must never stop a draft.
async function postForAnswers(url, token, body, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return answersFrom(await res.json());
  } catch {
    return null;
  }
}

export function typesafeJevDecider(apiKey, opts = {}) {
  return (state, questions) =>
    postForAnswers(TYPESAFE_URL, apiKey, { model: TYPESAFE_MODEL, state, questions }, opts);
}

export function cloudflareJevDecider(accountId, token, opts = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/typesafe/jev`;
  return (state, questions) => postForAnswers(url, token, { state, questions }, opts);
}

export function jevModeFromEnv(env = process.env) {
  const mode = env.JEV_MODE;
  return mode === 'shadow' || mode === 'on' ? mode : 'off';
}

export function deciderFromEnv(env = process.env) {
  if (env.TYPESAFE_API_KEY) return typesafeJevDecider(env.TYPESAFE_API_KEY);
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN) {
    return cloudflareJevDecider(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_AI_TOKEN);
  }
  return null;
}

export function noulOf(answers, key) {
  const a = answers?.[key];
  return a?.type === 'noul' && typeof a.noul === 'number' ? a.noul : null;
}

export function choiceOf(answers, key) {
  const a = answers?.[key];
  if (a?.type !== 'choice' || typeof a.choice !== 'string') return null;
  return { choice: a.choice, confidence: a.probabilities?.[a.choice] ?? a.confidence ?? null };
}
