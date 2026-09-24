import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Analyzer } from '../src/lib/agent/llm';
import { TASK_UPDATE_SCHEMA } from '../src/lib/agent/prompts';

const DATA_DIR = process.env.DATA_DIR || '/data';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';
const CODEX_MODEL = process.env.CODEX_MODEL || '';
// Landlock/bwrap are unavailable on Railway, so the sandbox flag fails there.
const CODEX_UNSAFE_SANDBOX = process.env.CODEX_UNSAFE_SANDBOX === 'true';
const CLI_TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MS || 120_000);

// The CLIs run model output on untrusted GitHub text; keep Tasker's secrets
// out of their environment. Auth comes in through explicit per-user vars.
const ENV_DENYLIST = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
];

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ENV_DENYLIST) delete env[k];
  return env;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input: string }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const killTree = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, CLI_TIMEOUT_MS);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) =>
      finish({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, timedOut })
    );
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input);
  });
}

// Only a failed run is classified from its text: a successful analysis of an
// issue about rate limiting must not read as our own quota being hit.
function classify(kind: string, res: RunResult): string | null {
  if (res.timedOut) return `${kind} timed out after ${CLI_TIMEOUT_MS}ms`;
  if (res.code === 0) return null;
  const text = `${res.stdout}\n${res.stderr}`;
  if (/usage limit|rate limit|too many requests|quota/i.test(text)) {
    return `${kind} usage limit reached`;
  }
  if (/not logged in|unauthorized|invalid.*token|401/i.test(res.stderr)) {
    // The label alone can't tell an expired refresh token from a revoked one.
    // Railway logs only; the user-facing message stays the plain label.
    console.error(`${kind} auth failure, stderr tail:\n${res.stderr.slice(-800)}`);
    return `${kind} not logged in`;
  }
  return `${kind} exited ${res.code}: ${res.stderr.slice(0, 300)}`;
}

async function scratchDir(userId: string): Promise<string> {
  const dir = path.join(DATA_DIR, 'scratch', userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

// claude -p with every tool removed: the prompt is pure text analysis, and
// --restricted keeps user/project settings from re-enabling anything.
export function claudeCliAnalyzer(
  oauthToken: string,
  userId: string
): Analyzer {
  return async (system, user) => {
    const cwd = await scratchDir(userId);
    const configDir = path.join(DATA_DIR, 'claude', userId);
    await mkdir(configDir, { recursive: true });
    const args = [
      '-p',
      '--output-format',
      'json',
      '--restricted',
      '--tools',
      '',
      '--system-prompt',
      system,
    ];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    const res = await run(CLAUDE_BIN, args, {
      cwd,
      input: user,
      env: {
        ...baseEnv(),
        CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        CLAUDE_CONFIG_DIR: configDir,
      },
    });
    const failure = classify('claude', res);
    if (failure) throw new Error(failure);
    let envelope: { result?: unknown; is_error?: boolean };
    try {
      envelope = JSON.parse(res.stdout.trim());
    } catch {
      throw new Error(
        `claude returned non-JSON output: ${res.stdout.slice(0, 200)}`
      );
    }
    if (
      envelope.is_error ||
      typeof envelope.result !== 'string' ||
      !envelope.result.trim()
    ) {
      const detail = String(envelope.result).slice(0, 300);
      if (/usage limit|rate limit|quota/i.test(detail)) {
        throw new Error('claude usage limit reached');
      }
      if (/not logged in|invalid.*token|authentication|401/i.test(detail)) {
        throw new Error('claude not logged in');
      }
      throw new Error(`claude error: ${detail}`);
    }
    return envelope.result;
  };
}

export interface CodexAuthStore {
  // Codex rotates tokens in auth.json; persist the new copy after each run.
  onAuthChanged(authJson: string): Promise<void>;
}

export function codexCliAnalyzer(
  authJson: string,
  userId: string,
  store: CodexAuthStore
): Analyzer {
  // Tracks the DB copy across tasks in one sync; the DB is the source of
  // truth because a refreshed token is written back there after every run,
  // and a re-pasted login in Settings must replace the on-disk file.
  let current = authJson;
  return async (system, user) => {
    const cwd = await scratchDir(userId);
    const codexHome = path.join(DATA_DIR, 'codex', userId);
    await mkdir(codexHome, { recursive: true });
    const authPath = path.join(codexHome, 'auth.json');
    const onDisk = existsSync(authPath) ? await readFile(authPath, 'utf8') : '';
    if (onDisk !== current) {
      await writeFile(authPath, current, { mode: 0o600 });
    }
    const schemaPath = path.join(cwd, 'task-update.schema.json');
    await writeFile(schemaPath, JSON.stringify(TASK_UPDATE_SCHEMA));
    const outFile = path.join(cwd, `codex-${Date.now()}.json`);

    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '-C',
      cwd,
      '--output-schema',
      schemaPath,
      '-o',
      outFile,
    ];
    if (CODEX_UNSAFE_SANDBOX)
      args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', 'read-only');
    if (CODEX_MODEL) args.push('-m', CODEX_MODEL);
    args.push('-');

    // Codex has no system-prompt flag; the analysis prompt is self-contained
    // enough that a concatenation reads the same.
    const res = await run(CODEX_BIN, args, {
      cwd,
      input: `${system}\n\n---\n\n${user}`,
      env: { ...baseEnv(), CODEX_HOME: codexHome },
    });

    let refreshed: string | null = null;
    try {
      refreshed = await readFile(authPath, 'utf8');
    } catch {
      /* auth.json unreadable; the next run reseeds it from the DB */
    }
    if (refreshed && refreshed !== current) {
      // Adopt the rotated token only once the DB has it, or a later run
      // would overwrite the good on-disk file with the stale DB copy.
      await store.onAuthChanged(refreshed);
      current = refreshed;
    }

    const failure = classify('codex', res);
    if (failure) throw new Error(failure);
    let body = '';
    try {
      body = (await readFile(outFile, 'utf8')).trim();
    } catch {
      body = '';
    } finally {
      await rm(outFile, { force: true });
    }
    if (!body) throw new Error('codex produced no output');
    return body;
  };
}
