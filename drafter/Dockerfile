# Tasker proposal drafter — Node 22 + git + the Codex CLI.
FROM node:22-slim

# git: clone/refresh the Expensify/App checkout the drafter investigates.
# ca-certificates: HTTPS to GitHub/Supabase/Telegram/OpenAI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The Codex CLI is a thin npm launcher around a native binary.
RUN npm install -g @openai/codex

WORKDIR /app
COPY package.json ./
COPY drafter.mjs ./
COPY prompts ./prompts
COPY skills ./skills

# Persisted volume holds the repo clone and CODEX_HOME (auth.json is refreshed
# in place, so it must survive redeploys). Mount a Railway volume at /data.
ENV DATA_DIR=/data
ENV CODEX_HOME=/data/codex

# glibc parks freed memory in per-thread arenas instead of returning it, so an
# idle container keeps whatever a Codex draft peaked at. Two arenas is enough for
# this workload and lets RSS actually come back down.
ENV MALLOC_ARENA_MAX=2

# Flags go on the command, not NODE_OPTIONS: the Codex CLI is an npm launcher and
# would inherit the env var. A capped heap makes V8 collect instead of grow, and
# --expose-gc lets the drafter compact after each draft.
CMD ["node", "--max-old-space-size=384", "--expose-gc", "drafter.mjs"]
