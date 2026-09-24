import { describe, it, expect, vi } from 'vitest';
import {
  cloudflareJevDecider,
  typesafeJevDecider,
  jevModeFromEnv,
  deciderFromEnv,
} from './jev';

const QUESTIONS = {
  status: {
    type: 'choice' as const,
    instructions: 'Pick the status',
    criteria: { reviewing: 'PR open', merged: 'PR merged' },
  },
};

function okResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe('jevModeFromEnv', () => {
  it('defaults to off', () => {
    expect(jevModeFromEnv({})).toBe('off');
  });

  it('reads a valid mode', () => {
    expect(jevModeFromEnv({ JEV_MODE: 'shadow' })).toBe('shadow');
    expect(jevModeFromEnv({ JEV_MODE: 'on' })).toBe('on');
  });

  it('treats an unknown value as off', () => {
    expect(jevModeFromEnv({ JEV_MODE: 'yes please' })).toBe('off');
  });
});

describe('deciderFromEnv', () => {
  it('is null without credentials', () => {
    expect(deciderFromEnv({ JEV_MODE: 'on' })).toBeNull();
  });

  it('builds a decider when both Cloudflare credentials exist', () => {
    const d = deciderFromEnv({
      JEV_MODE: 'on',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_AI_TOKEN: 'tok',
    });
    expect(typeof d).toBe('function');
  });

  it('is null with only half of the Cloudflare pair', () => {
    expect(deciderFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'acc' })).toBeNull();
  });

  it('prefers the TypeSafe key when both providers are configured', async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      calls.push(url);
      return okResponse({ answers: {} });
    }) as unknown as typeof fetch;
    try {
      const d = deciderFromEnv({
        TYPESAFE_API_KEY: 'ts',
        CLOUDFLARE_ACCOUNT_ID: 'acc',
        CLOUDFLARE_AI_TOKEN: 'tok',
      });
      await d!({}, QUESTIONS);
      expect(calls).toEqual(['https://api.typesafe.ai/v1/systemone']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('typesafeJevDecider', () => {
  it('posts to the TypeSafe endpoint with the model and a bearer key', async () => {
    const fetchImpl = vi.fn(() => okResponse({ answers: {} }));
    const decide = typesafeJevDecider('apikey_x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await decide({ hello: 'world' }, QUESTIONS);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer apikey_x'
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'jev-latest',
      state: { hello: 'world' },
      questions: QUESTIONS,
    });
  });

  it('parses the response the live API actually returned', async () => {
    // Captured from api.typesafe.ai on 2026-09-24.
    const fetchImpl = vi.fn(() =>
      okResponse({
        model: 'jev-1.13.0',
        answers: { urgent: { type: 'noul', noul: 0.97 } },
        usage: { input_tokens: 287, output_tokens: 20 },
      })
    );
    const decide = typesafeJevDecider('k', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const answers = await decide({}, QUESTIONS);
    expect(answers).toEqual({ urgent: { type: 'noul', noul: 0.97 } });
  });

  it('returns null on a non-200', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('forbidden', { status: 403 }))
    );
    const decide = typesafeJevDecider('bad', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });

  it('returns null instead of throwing on a connect timeout', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('fetch failed'))
    );
    const decide = typesafeJevDecider('k', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });
});

describe('cloudflareJevDecider', () => {
  it('posts to the account endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn(() =>
      okResponse({
        result: {
          answers: {
            status: {
              type: 'choice',
              choice: 'merged',
              probabilities: { merged: 0.9 },
              confidence: 0.8,
            },
          },
        },
      })
    );
    const decide = cloudflareJevDecider('acc123', 'tok456', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const answers = await decide({ hello: 'world' }, QUESTIONS);

    expect(answers?.status).toEqual({
      type: 'choice',
      choice: 'merged',
      probabilities: { merged: 0.9 },
      confidence: 0.8,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/typesafe/jev'
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok456'
    );
    expect(JSON.parse(init.body as string)).toEqual({
      state: { hello: 'world' },
      questions: QUESTIONS,
    });
  });

  it('accepts a bare answers envelope', async () => {
    const fetchImpl = vi.fn(() =>
      okResponse({
        answers: {
          status: {
            type: 'choice',
            choice: 'reviewing',
            probabilities: {},
            confidence: 0.5,
          },
        },
      })
    );
    const decide = cloudflareJevDecider('a', 'b', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const answers = await decide({}, QUESTIONS);
    expect(answers?.status.type).toBe('choice');
  });

  it('returns null on a non-200', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 500 }))
    );
    const decide = cloudflareJevDecider('a', 'b', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });

  it('returns null when the body has no answers', async () => {
    const fetchImpl = vi.fn(() => okResponse({ result: {} }));
    const decide = cloudflareJevDecider('a', 'b', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });

  it('returns null instead of throwing when fetch rejects', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('socket hang up')));
    const decide = cloudflareJevDecider('a', 'b', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });
});
